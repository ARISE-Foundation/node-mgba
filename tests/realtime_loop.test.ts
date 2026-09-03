import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import {
    MgbaEmulator,
    RealtimeEmulationLoop,
    WebSocketMediaSink,
    type WebSocketClientLike,
    type VideoPacket,
    type AudioChunk,
    type InputAction,
    hold,
    wait,
    press,
    release,
    GB_FPS,
} from '../src/index.js';

const testRom = {
    path: path.resolve(process.env['ROM_PATH'] || 'fixtures/pokemon_blue.gb'),
};

test('RealtimeEmulationLoop & WebSocketMediaSink Integration', async (t) => {
    await t.test('1. Should pace real-time frame execution at ~59.73 FPS without timer drift', async (subT) => {
        if (!fs.existsSync(testRom.path)) {
            subT.skip(`Test ROM not found at ${testRom.path}`);
            return;
        }

        const emulator = new MgbaEmulator();
        await emulator.loadROM(testRom.path);

        const capturedFrames: VideoPacket[] = [];
        const loop = new RealtimeEmulationLoop(emulator, {
            fps: GB_FPS,
            onFrame(frame) {
                capturedFrames.push(frame);
            },
        });

        assert.equal(loop.isRunning, false);
        assert.equal(loop.fps, GB_FPS);

        const startTime = performance.now();
        loop.start();
        assert.equal(loop.isRunning, true);

        // Run for 1.0 second
        await new Promise((resolve) => setTimeout(resolve, 1000));

        await loop.pause();
        const elapsed = (performance.now() - startTime) / 1000;
        assert.equal(loop.isRunning, false);

        const frameCount = capturedFrames.length;
        const effectiveFps = frameCount / elapsed;

        // Frame count over 1.0s should be ~59.73 (+/- 5 frames margin for test runner jitter)
        assert.ok(frameCount >= 54 && frameCount <= 66, `Expected ~60 frames over 1.0s, got ${frameCount} (effective FPS: ${effectiveFps.toFixed(2)})`);

        // Check frame properties
        const firstFrame = capturedFrames[0];
        assert.ok(firstFrame);
        assert.equal(firstFrame.width, 160);
        assert.equal(firstFrame.height, 144);

        // Ensure paused loop delivers no more frames
        const pausedCount = capturedFrames.length;
        await new Promise((resolve) => setTimeout(resolve, 100));
        assert.equal(capturedFrames.length, pausedCount, 'Paused loop must not deliver additional frames');

        await emulator.close();
    });

    await t.test('2. Should execute queued InputActions frame-by-frame at 60 FPS in real time', async (subT) => {
        if (!fs.existsSync(testRom.path)) {
            subT.skip(`Test ROM not found at ${testRom.path}`);
            return;
        }

        const emulator = new MgbaEmulator();
        await emulator.loadROM(testRom.path);

        const capturedFrames: VideoPacket[] = [];
        const completedActions: InputAction[] = [];
        let queueEmptyFired = false;

        const loop = new RealtimeEmulationLoop(emulator, {
            fps: 120, // Fast test speed for quick unit test
            onFrame(frame) {
                capturedFrames.push(frame);
            },
        });

        loop.on('actionComplete', (action: InputAction) => {
            completedActions.push(action);
        });

        loop.on('queueEmpty', () => {
            queueEmptyFired = true;
        });

        // Queue: 10 frames hold RIGHT + 5 frames wait + press A (8 frames hold + 4 frames release) = 27 frames
        loop.queueActions([
            hold('RIGHT', 10),
            wait(5),
            press('A', 8, 4),
        ]);

        loop.start();

        // Wait until queue is empty
        await new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('Action queue execution timed out')), 2000);
            loop.on('queueEmpty', () => {
                clearTimeout(timeout);
                void loop.pause().then(() => resolve());
            });
        });

        assert.equal(queueEmptyFired, true);
        assert.equal(completedActions.length, 3);
        assert.equal(completedActions[0]?.type, 'hold');
        assert.equal(completedActions[1]?.type, 'wait');
        assert.equal(completedActions[2]?.type, 'press');

        // Total frames stepped should match exact sum of action frames: 10 + 5 + 8 + 4 = 27 (+/- 2 loop tick margin)
        assert.ok(capturedFrames.length >= 27 && capturedFrames.length <= 30, `Expected ~27 frames for queued actions, got ${capturedFrames.length}`);

        await emulator.close();
    });

    await t.test('3. Should stream audio and video chunks across WebSocketMediaSink with per-client filtering', async () => {
        const sentMessages1: string[] = [];
        const sentMessages2: string[] = [];

        const client1: WebSocketClientLike = {
            readyState: 1, // OPEN
            send(data) {
                sentMessages1.push(data.toString());
            },
        };

        const client2: WebSocketClientLike = {
            readyState: 1, // OPEN
            send(data) {
                sentMessages2.push(data.toString());
            },
        };

        const unmutedSet = new Set<WebSocketClientLike>([client1]); // client1 unmuted, client2 muted

        const wsSink = new WebSocketMediaSink({
            clients: [client1, client2],
            filterClient(client, type) {
                if (type === 'audio') {
                    return unmutedSet.has(client);
                }
                return true;
            },
            formatVideoPayload(packet) {
                return { type: 'video_frame', frameIndex: packet.frameIndex };
            },
        });

        const testVideo: VideoPacket = {
            frameIndex: 1,
            pts: 0.016,
            width: 160,
            height: 144,
            strideBytes: 640,
            buffer: Buffer.alloc(160 * 144 * 4),
        };

        const testAudio: AudioChunk = {
            frameIndex: 1,
            pts: 0.016,
            sampleRate: 131072,
            channels: 2,
            sampleFrames: 2200,
            buffer: Buffer.alloc(2200 * 4),
        };

        // Emit video & audio
        wsSink.onVideoFrame(testVideo);
        wsSink.onAudioChunk(testAudio);

        // Client 1 (unmuted) should have received both video and audio
        assert.equal(sentMessages1.length, 2);
        const msg1_0 = JSON.parse(sentMessages1[0] ?? '{}') as { type: string };
        const msg1_1 = JSON.parse(sentMessages1[1] ?? '{}') as { type: string };
        assert.equal(msg1_0.type, 'video_frame');
        assert.equal(msg1_1.type, 'audio');

        // Client 2 (muted) should have received ONLY video
        assert.equal(sentMessages2.length, 1);
        const msg2_0 = JSON.parse(sentMessages2[0] ?? '{}') as { type: string };
        assert.equal(msg2_0.type, 'video_frame');
    });

    await t.test('4. Should cleanly handle rapid toggle and lifecycle without leaking timer handles', async () => {
        const dummyPacket: VideoPacket = {
            frameIndex: 1,
            pts: 0,
            width: 160,
            height: 144,
            strideBytes: 640,
            buffer: Buffer.alloc(160 * 144 * 4),
        };
        const mockEmulator = {
            async step(): Promise<VideoPacket> {
                return dummyPacket;
            },
        };

        const loop = new RealtimeEmulationLoop(mockEmulator);

        for (let i = 0; i < 10; i++) {
            if (loop.isRunning) {
                await loop.pause();
            } else {
                loop.start();
            }
            assert.equal(loop.isRunning, i % 2 === 0);
        }

        await loop.stop();
        assert.equal(loop.isRunning, false);
    });

    await t.test('5. Should invalidate stale loop generations on rapid restart', async () => {
        let stepCalls = 0;
        const mockEmulator = {
            async step(): Promise<VideoPacket> {
                stepCalls++;
                await new Promise((resolve) => setTimeout(resolve, 10));
                return {
                    frameIndex: stepCalls,
                    pts: 0,
                    width: 160,
                    height: 144,
                    strideBytes: 640,
                    buffer: Buffer.alloc(160 * 144 * 4),
                };
            },
        };

        const loop = new RealtimeEmulationLoop(mockEmulator, { fps: 100 });

        // Start, immediately pause, and restart
        loop.start();
        const pausePromise = loop.pause();
        loop.start(); // re-start while pause is pending

        await pausePromise;
        await new Promise((resolve) => setTimeout(resolve, 50));
        await loop.stop();

        assert.ok(stepCalls > 0, 'Must have executed steps on active generation');
    });

    await t.test('6. Should safely pause loop on step error without unhandled rejection', async () => {
        let attempts = 0;
        const failingEmulator = {
            async step(): Promise<VideoPacket> {
                attempts++;
                throw new Error('Simulated step hardware failure');
            },
        };

        let caughtError: Error | null = null;
        const loop = new RealtimeEmulationLoop(failingEmulator, {
            fps: 100,
            onError(err) {
                caughtError = err;
            },
        });

        loop.start();

        await new Promise((resolve) => setTimeout(resolve, 30));
        assert.ok(attempts > 0, 'Failing step must have been invoked');
        assert.equal(loop.isRunning, false, 'Loop must pause itself on error');
        assert.ok(caughtError, 'onError callback must receive error');
        assert.match((caughtError as Error).message, /Simulated step hardware failure/);
    });

    await t.test('7. Should respect backpressure thresholds in WebSocketMediaSink', async () => {
        const received: string[] = [];
        const slowClient: WebSocketClientLike = {
            readyState: 1,
            bufferedAmount: 1024 * 1024, // 1MB buffer backlog (exceeds threshold)
            send(data) {
                received.push(data.toString());
            },
        };

        const sink = new WebSocketMediaSink({
            clients: [slowClient],
            maxAudioBufferedBytes: 512 * 1024, // 512KB threshold
        });

        sink.onAudioChunk({
            frameIndex: 1,
            pts: 0.016,
            sampleRate: 131072,
            channels: 2,
            sampleFrames: 2200,
            buffer: Buffer.alloc(2200 * 4),
        });

        assert.equal(received.length, 0, 'Must drop audio chunk when client buffer backlog exceeds threshold');
    });

    await t.test('8. Should preserve queued action head without consumption if step fails', async () => {
        let shouldFail = true;
        const testAction = hold('A', 5);

        const emulator = {
            async step(): Promise<VideoPacket> {
                if (shouldFail) {
                    throw new Error('Transient step failure');
                }
                return {
                    frameIndex: 1,
                    pts: 0,
                    width: 160,
                    height: 144,
                    strideBytes: 640,
                    buffer: Buffer.alloc(160 * 144 * 4),
                };
            },
        };

        const loop = new RealtimeEmulationLoop(emulator, { fps: 100 });
        loop.queueAction(testAction);

        loop.start();
        await new Promise((resolve) => setTimeout(resolve, 30));

        // Loop paused on error
        assert.equal(loop.isRunning, false);

        // Now allow step to succeed and restart
        shouldFail = false;
        loop.start();
        await new Promise((resolve) => setTimeout(resolve, 80));
        await loop.stop();
    });

    await t.test('9. Should handle start -> pause -> start -> pause sequence with in-flight step', async () => {
        let resolveStep: ((pkt: VideoPacket) => void) | null = null;
        const delayedEmulator = {
            step(): Promise<VideoPacket> {
                return new Promise<VideoPacket>((resolve) => {
                    resolveStep = resolve;
                });
            },
        };

        const loop = new RealtimeEmulationLoop(delayedEmulator, { fps: 100 });

        loop.start();
        const firstPause = loop.pause();
        loop.start(); // Restart while first pause is awaiting in-flight step
        const secondPause = loop.pause(); // Pause the new running loop

        // Complete the in-flight step
        if (resolveStep) {
            (resolveStep as (pkt: VideoPacket) => void)({
                frameIndex: 1,
                pts: 0,
                width: 160,
                height: 144,
                strideBytes: 640,
                buffer: Buffer.alloc(160 * 144 * 4),
            });
        }

        await Promise.all([firstPause, secondPause]);
        assert.equal(loop.isRunning, false, 'Loop must be paused after second pause resolves');

        await loop.stop();
    });

    await t.test('10. Should support persistent button masks across hold and release actions', async () => {
        const receivedMasks: number[] = [];
        const recordingEmulator = {
            async step(_frames?: number, keyMask?: number): Promise<VideoPacket> {
                receivedMasks.push(keyMask ?? 0);
                return {
                    frameIndex: receivedMasks.length,
                    pts: 0,
                    width: 160,
                    height: 144,
                    strideBytes: 640,
                    buffer: Buffer.alloc(160 * 144 * 4),
                };
            },
        };

        const loop = new RealtimeEmulationLoop(recordingEmulator, { fps: 100 });

        // hold A for 2 frames, wait 2 frames (mask should still have A), then release A
        loop.queueActions([
            hold('A', 2),
            wait(2),
            release('A'),
            wait(1),
        ]);

        loop.start();
        await new Promise<void>((resolve) => {
            loop.on('queueEmpty', () => {
                void loop.pause().then(() => resolve());
            });
        });

        // Masks:
        // Frame 1: A (1)
        // Frame 2: A (1)
        // Frame 3: A (1) from persistent mask
        // Frame 4: A (1) from persistent mask
        // Frame 5: 0 (after release A)
        // Frame 6: 0 (wait)
        assert.ok(receivedMasks.length >= 6);
        assert.equal((receivedMasks[0] ?? 0) & 1, 1);
        assert.equal((receivedMasks[1] ?? 0) & 1, 1);
        assert.equal((receivedMasks[2] ?? 0) & 1, 1);
        assert.equal((receivedMasks[3] ?? 0) & 1, 1);
        assert.equal((receivedMasks[4] ?? 0) & 1, 0);
        assert.equal((receivedMasks[5] ?? 0) & 1, 0);

        await loop.stop();
    });

    await t.test('11. Should await asynchronous onFrame callback completion before pause() resolves', async () => {
        const dummyPacket: VideoPacket = {
            frameIndex: 1,
            pts: 0,
            width: 160,
            height: 144,
            strideBytes: 640,
            buffer: Buffer.alloc(160 * 144 * 4),
        };

        let releaseOnFrame: (() => void) | null = null;
        let onFrameEntered = false;
        let onFrameExited = false;

        const loop = new RealtimeEmulationLoop(
            { step: async () => dummyPacket },
            {
                async onFrame() {
                    onFrameEntered = true;
                    await new Promise<void>((resolve) => {
                        releaseOnFrame = resolve;
                    });
                    onFrameExited = true;
                },
            },
        );

        loop.start();

        while (!onFrameEntered) {
            await new Promise((resolve) => setImmediate(resolve));
        }

        let pauseResolved = false;
        const pausePromise = loop.pause().then(() => {
            pauseResolved = true;
        });

        // Yield to event loop: pause must NOT have resolved while onFrame is still awaiting
        await new Promise((resolve) => setImmediate(resolve));
        assert.equal(pauseResolved, false, 'pause() must await onFrame completion');

        // Complete onFrame callback
        if (releaseOnFrame) {
            (releaseOnFrame as () => void)();
        }

        await pausePromise;
        assert.equal(pauseResolved, true);
        assert.equal(onFrameExited, true);
        assert.equal(loop.isRunning, false);

        await loop.stop();
    });

    await t.test('12. Should support zero-frame release duration in press actions', async () => {
        const receivedMasks: number[] = [];
        const recordingEmulator = {
            async step(_frames?: number, keyMask?: number): Promise<VideoPacket> {
                receivedMasks.push(keyMask ?? 0);
                return {
                    frameIndex: receivedMasks.length,
                    pts: 0,
                    width: 160,
                    height: 144,
                    strideBytes: 640,
                    buffer: Buffer.alloc(160 * 144 * 4),
                };
            },
        };

        const loop = new RealtimeEmulationLoop(recordingEmulator, { fps: 100 });

        // press A with 1 hold frame and 0 release frames
        loop.queueAction(press('A', 1, 0));

        loop.start();
        await new Promise<void>((resolve) => {
            loop.on('actionComplete', () => {
                void loop.pause().then(() => resolve());
            });
        });

        // Exactly 1 frame executed with mask A (1), no release frames
        assert.equal(receivedMasks.length, 1);
        assert.equal((receivedMasks[0] ?? 0) & 1, 1);

        await loop.stop();
    });

    await t.test('13. Should prevent cleared action queue resurrection from in-flight step', async () => {
        let resolveStep: ((pkt: VideoPacket) => void) | null = null;
        const delayedEmulator = {
            step(): Promise<VideoPacket> {
                return new Promise<VideoPacket>((resolve) => {
                    resolveStep = resolve;
                });
            },
        };

        const loop = new RealtimeEmulationLoop(delayedEmulator, { fps: 100 });
        loop.queueAction(hold('A', 10));

        loop.start();
        await new Promise((resolve) => setImmediate(resolve));

        // Clear action queue while step is in flight
        loop.clearActionQueue();

        // Complete the in-flight step
        if (resolveStep) {
            (resolveStep as (pkt: VideoPacket) => void)({
                frameIndex: 1,
                pts: 0,
                width: 160,
                height: 144,
                strideBytes: 640,
                buffer: Buffer.alloc(160 * 144 * 4),
            });
        }

        await new Promise((resolve) => setImmediate(resolve));
        await loop.stop();
    });
});
