import test from 'node:test';
import assert from 'node:assert/strict';
import { MessageChannel } from 'node:worker_threads';
import {
    WorkerEmulatorClient,
    EmulatorController,
    press,
    wait,
} from '../src/index.js';
import type { AudioChunk, VideoPacket } from '../src/types/index.js';
import { getTestRomPath, hasTestRom } from './helpers/rom.js';

test('Worker Actor Autonomous Playback & Frame Transaction Suite', { concurrency: 1 }, async (t) => {
    if (!hasTestRom()) {
        t.skip('Test ROM fixture not found (set ROM_PATH to run)');
        return;
    }
    const romPath = getTestRomPath();

    await t.test('1. Autonomous 59.73 FPS pacing steps frames and emits video and audio', async () => {
        const client = new WorkerEmulatorClient();
        await client.loadROM(romPath);

        const videoFrames: VideoPacket[] = [];
        const audioChunks: AudioChunk[] = [];

        client.registerMediaSink({
            name: 'test-sink',
            onVideoFrame(f) {
                videoFrames.push(f);
            },
            onAudioChunk(c) {
                audioChunks.push(c);
            },
        });

        const startRes = await client.startPlayback(GB_FPS_TEST);
        assert.ok(startRes.fps > 0);

        // Wait ~300ms for several frames to execute autonomously
        await new Promise((r) => setTimeout(r, 300));
        await client.pausePlayback();

        assert.ok(videoFrames.length >= 3, `Expected at least 3 video frames, got ${videoFrames.length}`);
        assert.ok(audioChunks.length >= 3, `Expected at least 3 audio chunks, got ${audioChunks.length}`);

        await client.close();
    });

    await t.test('2. Sequence enqueue, execution, and completion lifecycle in actor mode', async () => {
        const client = new WorkerEmulatorClient();
        await client.loadROM(romPath);

        await client.startPlayback(GB_FPS_TEST);

        const handle = client.enqueueSequence([
            press('A', 2, 2),
            wait(2),
        ]);

        assert.ok(typeof handle.sequenceId === 'number');
        const res = await handle.promise;
        assert.equal(res.sequenceId, handle.sequenceId);
        assert.equal(res.actionsExecuted, 2);

        await client.pausePlayback();
        await client.close();
    });

    await t.test('3. Sequence cancellation and queue empty event dispatch', async () => {
        const client = new WorkerEmulatorClient();
        await client.loadROM(romPath);
        await client.startPlayback(GB_FPS_TEST);

        const queueEmptyPromise = new Promise<void>((resolve) => {
            client.once('queueEmpty', () => resolve());
        });

        const handle = client.enqueueSequence([
            press('START', 100, 100),
        ]);

        const rejectPromise = assert.rejects(handle.promise, (err: Error) => {
            assert.ok(err.message.includes('cancelled') || err.message.includes('Test cancellation'));
            return true;
        });

        // Cancel sequence mid-flight
        setTimeout(() => {
            handle.cancel('Test cancellation');
        }, 30);

        await rejectPromise;

        // Next quick sequence should trigger queueEmpty upon completion
        const quick = client.enqueueSequence([press('B', 1, 1)]);
        await quick.promise;
        await queueEmptyPromise;

        await client.pausePlayback();
        await client.close();
    });

    await t.test('4. Savestate restore invalidates in-flight sequences and emits streamReset', async () => {
        const client = new WorkerEmulatorClient();
        await client.loadROM(romPath);
        await client.startPlayback(GB_FPS_TEST);

        // Step a bit and take a state handle
        await new Promise((r) => setTimeout(r, 100));
        const stateHandle = await client.saveStateHandle();
        assert.ok(stateHandle.id.length > 0);

        const streamResetPromise = new Promise<void>((resolve) => {
            client.once('streamReset', (evt) => {
                assert.ok(evt.streamEpoch >= 1);
                resolve();
            });
        });

        // Enqueue a long sequence and attach rejection promise upfront
        const longHandle = client.enqueueSequence([press('A', 200, 200)]);
        const rejectPromise = assert.rejects(longHandle.promise, (err: Error) => {
            assert.ok(err.message.includes('invalidated by state restore') || err.message.includes('Actions cleared'));
            return true;
        });

        // Restore state mid-sequence
        const restoreOk = await client.restoreStateHandle(stateHandle.id);
        assert.equal(restoreOk, true);

        // Await both rejection and streamReset
        await Promise.all([rejectPromise, streamResetPromise]);

        await client.pausePlayback();
        await client.close();
    });

    await t.test('5. MessagePort direct media stream transfers video and audio buffers', async () => {
        const client = new WorkerEmulatorClient();
        await client.loadROM(romPath);

        const channel = new MessageChannel();
        await client.initMediaPort(channel.port2);

        const receivedMedia: Array<{ type: string; event: string }> = [];
        channel.port1.on('message', (msg) => {
            receivedMedia.push(msg);
        });

        await client.startPlayback(GB_FPS_TEST);
        await new Promise((r) => setTimeout(r, 200));
        await client.pausePlayback();

        assert.ok(receivedMedia.length > 0, 'Expected to receive media messages over MessagePort');
        const videoEvts = receivedMedia.filter((m) => m.event === 'videoFrame');
        const audioEvts = receivedMedia.filter((m) => m.event === 'audioChunk');

        assert.ok(videoEvts.length > 0, `Expected video frames over MessagePort, got ${videoEvts.length}`);
        assert.ok(audioEvts.length > 0, `Expected audio chunks over MessagePort, got ${audioEvts.length}`);
        const firstAudio = audioEvts[0] as unknown as { chunk: AudioChunk };
        assert.equal(firstAudio.chunk.sampleRate, 48000, 'Audio over MessagePort should be resampled to 48 kHz');

        channel.port1.close();
        await client.close();
    });

    await t.test('6. Dual media delivery to both registered MediaSink and MessagePort concurrently', async () => {
        const client = new WorkerEmulatorClient();
        await client.loadROM(romPath);

        const channel = new MessageChannel();
        await client.initMediaPort(channel.port2);

        const portMedia: Array<{ type: string; event: string }> = [];
        channel.port1.on('message', (msg) => {
            portMedia.push(msg);
        });

        const sinkFrames: VideoPacket[] = [];
        const sinkAudio: AudioChunk[] = [];
        client.registerMediaSink({
            name: 'dual-sink',
            onVideoFrame(f) {
                sinkFrames.push(f);
            },
            onAudioChunk(c) {
                sinkAudio.push(c);
            },
        });

        await client.startPlayback(GB_FPS_TEST);
        await new Promise((r) => setTimeout(r, 200));
        await client.pausePlayback();

        assert.ok(portMedia.length > 0, 'Expected media over MessagePort');
        assert.ok(sinkFrames.length > 0, 'Expected video frames in registered MediaSink');
        assert.ok(sinkAudio.length > 0, 'Expected audio chunks in registered MediaSink');

        channel.port1.close();
        await client.close();
    });

    await t.test('7. Cancelling the only active sequence emits queueEmpty', async () => {
        const client = new WorkerEmulatorClient();
        await client.loadROM(romPath);
        await client.startPlayback(GB_FPS_TEST);

        const queueEmptyPromise = new Promise<void>((resolve) => {
            client.once('queueEmpty', () => resolve());
        });

        const handle = client.enqueueSequence([press('START', 100, 100)]);
        const rejectPromise = assert.rejects(handle.promise, (err: Error) => {
            assert.ok(err.message.includes('cancelled') || err.message.includes('Test cancellation'));
            return true;
        });

        setTimeout(() => {
            handle.cancel('Test cancellation');
        }, 20);

        await Promise.all([rejectPromise, queueEmptyPromise]);

        await client.pausePlayback();
        await client.close();
    });

    await t.test('8. EmulatorController emits frame events in real-time mode without explicit media sink', async () => {
        const controller = new EmulatorController({
            romPath,
            realtime: true,
            fps: GB_FPS_TEST,
        });
        await controller.initialize();

        const receivedFrames: VideoPacket[] = [];
        controller.on('frame', (f) => {
            receivedFrames.push(f);
        });

        // Wait ~200ms
        await new Promise((r) => setTimeout(r, 200));
        await controller.pausePlayback();

        assert.ok(receivedFrames.length >= 3, `Expected at least 3 frame events on controller, got ${receivedFrames.length}`);
        await controller.close();
    });

    await t.test('9. Concurrent RPC flood does not starve frame clock pacing', async () => {
        const client = new WorkerEmulatorClient();
        await client.loadROM(romPath);

        let frameCount = 0;
        client.on('videoFrame', () => {
            frameCount++;
        });

        await client.startPlayback(GB_FPS_TEST);

        // Flood actor with continuous rapid RPCs over 150ms
        const startTime = performance.now();
        while (performance.now() - startTime < 150) {
            await Promise.all([
                client.sliceMemory('WRAM', 16, 0),
                client.sliceMemory('WRAM', 16, 16),
                client.sliceMemory('WRAM', 16, 32),
            ]);
        }

        // Verify that frames advanced concurrently during the sustained RPC flood
        assert.ok(frameCount >= 5, `Expected at least 5 frames during sustained RPC flood, got ${frameCount}`);

        await client.pausePlayback();
        await client.close();
    });

    await t.test('10. Multi-frame manual step() is strictly rejected during active playback', async () => {
        const client = new WorkerEmulatorClient();
        await client.loadROM(romPath);
        await client.startPlayback(GB_FPS_TEST);

        await assert.rejects(
            client.step(10),
            (err: Error) => {
                assert.ok(err.message.includes('Cannot execute multi-frame manual step'));
                return true;
            },
        );

        // Single-frame step is permitted
        const single = await client.step(1);
        assert.equal(single.width, 160);

        await client.pausePlayback();
        await client.close();
    });

    await t.test('11. Stream epoch monotonically increments across savestate loads and resets', async () => {
        const client = new WorkerEmulatorClient();
        try {
            await client.loadROM(romPath);
            await client.startPlayback(GB_FPS_TEST);

            const epochs: number[] = [];
            client.on('streamReset', (evt) => {
                epochs.push(evt.streamEpoch);
            });

            const handle = await client.saveStateHandle();
            assert.ok(handle.id, 'Savestate handle must be valid');

            const restored = await client.restoreStateHandle(handle.id);
            assert.ok(restored, 'Restoring state handle must succeed');

            await client.reset();

            assert.ok(epochs.length >= 2, `Expected at least 2 streamReset events, got ${epochs.length}`);
            const ep0 = epochs[0];
            const ep1 = epochs[1];
            assert.ok(ep0 !== undefined && ep1 !== undefined && ep0 < ep1, `Expected monotonically increasing epochs: ${epochs.join(', ')}`);
        } finally {
            await client.pausePlayback().catch(() => {});
            await client.close();
        }
    });
});

const GB_FPS_TEST = 60;

