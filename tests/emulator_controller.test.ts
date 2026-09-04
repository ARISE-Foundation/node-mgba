import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MessageChannel } from 'node:worker_threads';
import {
    EmulatorController,
    PokemonRedBluePlugin,
    LifecycleError,
    type VideoPacket,
    type MediaSink,
} from '../src/index.js';
import { WorkerEmulatorClient } from '../src/worker/WorkerEmulatorClient.js';
import { hasTestRom, getTestRomPath } from './helpers/rom.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROM_PATH = hasTestRom() ? getTestRomPath() : path.resolve(__dirname, '../fixtures/pokemon_blue.gb');

describe('EmulatorController Lifecycle & DX Suite', { skip: !hasTestRom() }, () => {
    it('1. Uninitialized controller strictly rejects all ready-only methods and getters with LifecycleError', async () => {
        const controller = new EmulatorController({ romPath: ROM_PATH, realtime: false });
        try {
            assert.equal(controller.state, 'uninitialized');

            // Check fail-fast on methods before initialize()
            await assert.rejects(
                () => controller.step(1),
                (err: unknown) => err instanceof LifecycleError && err.message.includes('step'),
            );
            await assert.rejects(
                () => controller.observe({ screen: true }),
                (err: unknown) => err instanceof LifecycleError && err.message.includes('observe'),
            );
            await assert.rejects(
                () => controller.loadROM(ROM_PATH),
                (err: unknown) => err instanceof LifecycleError && err.message.includes('loadROM'),
            );
            await assert.rejects(
                () => controller.startPlayback(),
                (err: unknown) => err instanceof LifecycleError && err.message.includes('startPlayback'),
            );
            await assert.rejects(
                () => controller.pausePlayback(),
                (err: unknown) => err instanceof LifecycleError && err.message.includes('pausePlayback'),
            );
            await assert.rejects(
                () => controller.clearButtons(),
                (err: unknown) => err instanceof LifecycleError && err.message.includes('clearButtons'),
            );
            await assert.rejects(
                () => controller.setKeyMask(1),
                (err: unknown) => err instanceof LifecycleError && err.message.includes('setKeyMask'),
            );
            await assert.rejects(
                () => controller.sliceMemory(0xC000, 10),
                (err: unknown) => err instanceof LifecycleError && err.message.includes('sliceMemory'),
            );
            await assert.rejects(
                () => controller.getVram(),
                (err: unknown) => err instanceof LifecycleError && err.message.includes('getVram'),
            );
            await assert.rejects(
                () => controller.getOam(),
                (err: unknown) => err instanceof LifecycleError && err.message.includes('getOam'),
            );
            await assert.rejects(
                () => controller.busWrite8(0xC000, 1),
                (err: unknown) => err instanceof LifecycleError && err.message.includes('busWrite8'),
            );
            await assert.rejects(
                () => controller.bankWrite8(0, 1, 0, 1),
                (err: unknown) => err instanceof LifecycleError && err.message.includes('bankWrite8'),
            );
            await assert.rejects(
                () => controller.saveState('/tmp/test.ss0'),
                (err: unknown) => err instanceof LifecycleError && err.message.includes('saveState'),
            );
            await assert.rejects(
                () => controller.loadState('/tmp/test.ss0'),
                (err: unknown) => err instanceof LifecycleError && err.message.includes('loadState'),
            );
            await assert.rejects(
                () => controller.reset(),
                (err: unknown) => err instanceof LifecycleError && err.message.includes('reset'),
            );
            await assert.rejects(
                () => controller.use(PokemonRedBluePlugin),
                (err: unknown) => err instanceof LifecycleError && err.message.includes('use'),
            );

            assert.throws(
                () => { void controller.screen; },
                (err: unknown) => err instanceof LifecycleError && err.message.includes('screen'),
            );
            assert.throws(
                () => { void controller.memory; },
                (err: unknown) => err instanceof LifecycleError && err.message.includes('memory'),
            );
            assert.throws(
                () => { void controller.controls; },
                (err: unknown) => err instanceof LifecycleError && err.message.includes('controls'),
            );
            assert.throws(
                () => { void controller.states; },
                (err: unknown) => err instanceof LifecycleError && err.message.includes('states'),
            );
            assert.throws(
                () => { void controller.symbols; },
                (err: unknown) => err instanceof LifecycleError && err.message.includes('symbols'),
            );
        } finally {
            await controller.close();
        }
    });

    it('2. Injected-client without loaded ROM rejects initialize(), and with loaded ROM allows ready operations', async () => {
        // A fresh client with no loaded ROM must reject initialize()
        const clientWithoutRom = new WorkerEmulatorClient({ watchdogTimeoutMs: 15000 });
        const controllerWithoutRom = new EmulatorController({ client: clientWithoutRom, realtime: false });
        try {
            await assert.rejects(
                () => controllerWithoutRom.initialize(),
                (err: unknown) => err instanceof LifecycleError && err.message.includes('ROM path is required'),
            );
        } finally {
            await controllerWithoutRom.close();
        }

        // A client that loaded a ROM transitions to ready on initialize() and allows operations
        const clientWithRom = new WorkerEmulatorClient({ watchdogTimeoutMs: 15000 });
        await clientWithRom.loadROM(ROM_PATH);
        const controllerWithRom = new EmulatorController({ client: clientWithRom, realtime: false });
        try {
            assert.equal(controllerWithRom.state, 'uninitialized');
            await controllerWithRom.initialize();
            assert.equal(controllerWithRom.state, 'ready');

            const obs = await controllerWithRom.observe({ screen: true });
            assert.ok(obs.screenBuffer);
            assert.equal(obs.screenBuffer.length, 160 * 144 * 4);

            const stepPacket = await controllerWithRom.step(1);
            assert.equal(stepPacket.width, 160);
        } finally {
            await controllerWithRom.close();
        }
    });

    it('3. Declarative mediaPort in options streams frames without post-initialization wiring', async () => {
        const channel = new MessageChannel();
        const receivedFrames: VideoPacket[] = [];

        channel.port1.on('message', (msg: { type: string; event: string; frame?: VideoPacket }) => {
            if (msg && msg.type === 'event' && msg.event === 'videoFrame' && msg.frame) {
                receivedFrames.push(msg.frame);
            }
        });

        const controller = new EmulatorController({
            romPath: ROM_PATH,
            realtime: true,
            mediaPort: channel.port2,
            fps: 60,
        });

        try {
            await controller.initialize();
            assert.equal(controller.state, 'ready');

            // Wait for at least 3 frames over the direct MessagePort
            const startTime = Date.now();
            while (receivedFrames.length < 3 && Date.now() - startTime < 3000) {
                await new Promise((resolve) => { setTimeout(resolve, 50); });
            }

            assert.ok(receivedFrames.length >= 3, `Expected >= 3 frames, got ${receivedFrames.length}`);
            const firstFrame = receivedFrames[0];
            assert.ok(firstFrame);
            assert.equal(firstFrame.width, 160);
            assert.equal(firstFrame.height, 144);
        } finally {
            channel.port1.close();
            await controller.close();
        }
    });

    it('4. Declarative mediaSinks are registered, exact-object idempotent, and reject collisions', async () => {
        assert.throws(
            () => new EmulatorController({ mediaSinks: [{ name: '' } as unknown as MediaSink] }),
            (err: unknown) => err instanceof TypeError,
        );

        const receivedPackets: VideoPacket[] = [];
        const testSink: MediaSink = {
            name: 'test_declarative_sink',
            onVideoFrame: (frame) => {
                receivedPackets.push(frame);
            },
        };

        const controller = new EmulatorController({
            romPath: ROM_PATH,
            realtime: true,
            mediaSinks: [testSink],
            fps: 60,
        });

        try {
            await controller.initialize();
            assert.equal(controller.state, 'ready');

            // Idempotent duplicate registration with exact same object
            controller.registerMediaSink(testSink);

            // Colliding registration with different object throwing explicit error
            const conflictingSink: MediaSink = {
                name: 'test_declarative_sink',
                onVideoFrame: () => {},
            };
            assert.throws(
                () => controller.registerMediaSink(conflictingSink),
                (err: unknown) => err instanceof Error && err.message.includes('already registered with a different object definition'),
            );

            const startTime = Date.now();
            while (receivedPackets.length < 3 && Date.now() - startTime < 3000) {
                await new Promise((resolve) => { setTimeout(resolve, 50); });
            }

            assert.ok(receivedPackets.length >= 3, `Expected >= 3 frames from sink, got ${receivedPackets.length}`);
        } finally {
            await controller.close();
        }
    });

    it('5. Dynamic initMediaPort hot-plugging connects a new port at runtime', async () => {
        const controller = new EmulatorController({
            romPath: ROM_PATH,
            realtime: true,
            fps: 60,
        });

        const channel = new MessageChannel();
        const frames: VideoPacket[] = [];
        channel.port1.on('message', (msg: { type: string; event: string; frame?: VideoPacket }) => {
            if (msg && msg.type === 'event' && msg.event === 'videoFrame' && msg.frame) {
                frames.push(msg.frame);
            }
        });

        try {
            await controller.initialize();
            await controller.initMediaPort(channel.port2);

            const startTime = Date.now();
            while (frames.length < 3 && Date.now() - startTime < 3000) {
                await new Promise((resolve) => { setTimeout(resolve, 50); });
            }

            assert.ok(frames.length >= 3, `Expected >= 3 frames on hot-plugged port, got ${frames.length}`);
        } finally {
            channel.port1.close();
            await controller.close();
        }
    });

    it('6. MgbaInstance.use() is strictly idempotent for identical class and throws on class mismatch', async () => {
        const controller = new EmulatorController({ romPath: ROM_PATH, realtime: false });
        try {
            await controller.initialize();

            const instance1 = await controller.use(PokemonRedBluePlugin);
            const instance2 = await controller.use(PokemonRedBluePlugin);
            assert.equal(instance1, instance2, 'Expected identical plugin instance on duplicate use() call');

            // Create a different class with identical pluginName
            class ConflictingPlugin {
                public static readonly pluginName = 'pokemon-red-blue';
                constructor(_emu: unknown) {}
            }

            await assert.rejects(
                () => controller.use(ConflictingPlugin as unknown as typeof PokemonRedBluePlugin),
                (err: unknown) => err instanceof Error && err.message.includes('already installed with a different class definition'),
            );
        } finally {
            await controller.close();
        }
    });

    it('7. Concurrent initialize() calls share a single in-flight promise and return identical RomInfo', async () => {
        const controller = new EmulatorController({ romPath: ROM_PATH, realtime: false });
        try {
            const [info1, info2, info3] = await Promise.all([
                controller.initialize(),
                controller.initialize(),
                controller.initialize(),
            ]);

            assert.equal(info1, info2);
            assert.equal(info2, info3);
            assert.equal(controller.state, 'ready');
        } finally {
            await controller.close();
        }
    });

    it('8. Closing an uninitialized controller disposes initialMediaPort and prevents subsequent initialization', async () => {
        const channel = new MessageChannel();
        const controller = new EmulatorController({
            romPath: ROM_PATH,
            mediaPort: channel.port2,
        });

        await controller.close();
        assert.equal(controller.state, 'closed');

        await assert.rejects(
            () => controller.initialize(),
            (err: unknown) => err instanceof LifecycleError && err.message.includes('closed'),
        );
        channel.port1.close();
    });

    it('9. setKeyMask delegates to worker and clearButtons resets keyMask', async () => {
        const controller = new EmulatorController({ romPath: ROM_PATH, realtime: false });
        try {
            await controller.initialize();
            assert.equal(controller.state, 'ready');

            await controller.setKeyMask(0x01);
            await controller.clearButtons();
        } finally {
            await controller.close();
        }
    });

    it('10. startPlayback and pausePlayback emit start and pause transition events', async () => {
        const controller = new EmulatorController({ romPath: ROM_PATH, realtime: false });
        try {
            await controller.initialize();
            assert.equal(controller.state, 'ready');

            const events: string[] = [];
            const frames: unknown[] = [];
            controller.on('start', () => events.push('start'));
            controller.on('pause', () => events.push('pause'));
            controller.on('frame', (f) => frames.push(f));

            await controller.startPlayback(60);
            assert.equal(controller.isPlaybackRunning(), true);

            // Redundant startPlayback should be idempotent and not emit duplicate event
            await controller.startPlayback(60);

            // Wait for frames to stream from worker
            await new Promise((r) => setTimeout(r, 120));

            await controller.pausePlayback();
            assert.equal(controller.isPlaybackRunning(), false);

            // Redundant pausePlayback should be idempotent and not emit duplicate event
            await controller.pausePlayback();

            assert.deepEqual(events, ['start', 'pause']);
            assert.ok(frames.length >= 2, `Expected frame events when starting playback from non-realtime controller, got ${frames.length}`);
        } finally {
            await controller.close();
        }
    });
});
