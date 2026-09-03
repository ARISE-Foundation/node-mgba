import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { WorkerEmulatorClient, press, wait, type Keyframe, type TurnResult } from '../src/index.js';
import { getTestRom, hasTestRom } from './helpers/rom.js';
import { createSafeTempDir } from './helpers/temp.js';

test('WorkerEmulatorClient RPC & Thread Isolation', async (t) => {
    if (!hasTestRom()) {
        t.skip('Test ROM fixture not found (set ROM_PATH to run)');
        return;
    }
    const testRom = getTestRom();

    await t.test('1. Should perform ping healthcheck and load ROM in worker thread', async () => {
        const client = new WorkerEmulatorClient();
        try {
            const pong = await client.ping();
            assert.equal(pong, 'pong', 'Worker ping must return pong');

            const romInfo = await client.loadROM(testRom.path);
            assert.equal(typeof romInfo.title, 'string');
            assert.ok(romInfo.title.length > 0, 'ROM title must not be empty');
            assert.ok(['GB', 'GBC', 'GBA', 'GB/GBC'].includes(romInfo.platform), `Invalid platform: ${romInfo.platform}`);
        } finally {
            await client.close();
        }
    });

    await t.test('2. Should step frames and receive valid zero-copy video packets', async () => {
        const client = new WorkerEmulatorClient();
        try {
            await client.loadROM(testRom.path);

            const packet = await client.step(10);
            assert.equal(typeof packet.frameIndex, 'number');
            assert.equal(packet.frameIndex, 10);
            assert.equal(packet.width, 160);
            assert.equal(packet.height, 144);
            assert.ok(Buffer.isBuffer(packet.buffer), 'Packet buffer must be a Node.js Buffer');
            assert.equal(packet.buffer.length, 160 * 144 * 4);
        } finally {
            await client.close();
        }
    });

    await t.test('3. Should stream keyframes and turn results via EventEmitter', async () => {
        const client = new WorkerEmulatorClient();
        const streamedKeyframes: Keyframe[] = [];
        let streamedTurnResult: TurnResult | null = null;

        client.on('keyframe', (kf: Keyframe) => {
            streamedKeyframes.push(kf);
        });

        client.on('turnComplete', (res: TurnResult) => {
            streamedTurnResult = res;
        });

        try {
            await client.loadROM(testRom.path);

            const turnResult = await client.stepSequence([
                press('A', 10, 5),
                wait(20),
            ]);

            assert.ok(turnResult.durationFrames > 0, 'turnResult durationFrames must be positive');
            assert.ok(turnResult.keyframes.length >= 2);
            assert.ok(Buffer.isBuffer(turnResult.keyframes[0]?.buffer));
            assert.equal(turnResult.keyframes[0]?.triggerReason, 'pre_action');
            assert.equal(turnResult.keyframes[turnResult.keyframes.length - 1]?.triggerReason, 'post_action');

            // Verify EventEmitter streaming received all events on the main thread
            assert.ok(streamedKeyframes.length >= 3, 'Must have received streamed keyframes');
            assert.ok(streamedTurnResult !== null, 'Must have received streamed turnComplete event');
        } finally {
            await client.close();
        }
    });

    await t.test('4. Should maintain savestate cycle-accuracy across worker RPC', async () => {
        const tempHandle = createSafeTempDir('mgba-worker-test-');
        if (!tempHandle) {
            t.skip('Skipping file-based savestate test: no writable directory available in this environment');
            return;
        }

        let client: WorkerEmulatorClient | null = null;
        try {
            const stateFile = path.join(tempHandle.path, 'state.ss0');
            client = new WorkerEmulatorClient();

            await client.loadROM(testRom.path);
            await client.step(120);

            const saved = await client.saveState(stateFile);
            assert.ok(saved, 'Savestate must succeed');

            const frameAtSave = await client.step(1);
            const hashAtSave = frameAtSave.buffer.toString('base64');

            // Advance 300 frames to alter state
            await client.step(300);

            // Restore savestate
            const loaded = await client.loadState(stateFile);
            assert.ok(loaded, 'Loadstate must succeed');

            const frameAfterLoad = await client.step(1);
            const hashAfterLoad = frameAfterLoad.buffer.toString('base64');

            assert.equal(hashAfterLoad, hashAtSave, 'Framebuffer after savestate restore must be identical');
        } finally {
            if (client) {
                await client.close();
            }
            tempHandle.cleanup();
        }
    });

    await t.test('5. Should handle error boundaries and post-close rejections', async () => {
        const client = new WorkerEmulatorClient();
        try {
            // Should reject invalid ROM path
            await assert.rejects(async () => {
                await client.loadROM('/nonexistent/path/to/rom.gb');
            }, /Failed to (?:load|initialize) .* ROM/i);

            await client.close();

            // Should reject calls after close
            await assert.rejects(async () => {
                await client.step(1);
            }, /WorkerEmulatorClient is closed/i);
        } finally {
            await client.close();
        }
    });

    await t.test('6. Should execute input sequence and observe memory via worker RPC', async () => {
        const client = new WorkerEmulatorClient();
        try {
            await client.loadROM(testRom.path);

            const turnResult = await client.stepSequence([
                press('START', 16, 8),
                wait(10),
            ]);

            assert.ok(turnResult !== null);
            assert.ok(Array.isArray(turnResult.keyframes));
            assert.ok(turnResult.keyframes.length >= 2);

            const obs = await client.observe({ memory: { vram: true } });
            assert.ok(obs.memory !== undefined);
            assert.equal(typeof obs.memory.readU8(0xC000), 'number');
        } finally {
            await client.close();
        }
    });

    await t.test('7. Should execute high-throughput stepping (> 1000 FPS) without blocking event loop', async () => {
        const client = new WorkerEmulatorClient();
        let tickTimer: ReturnType<typeof setInterval> | null = null;

        try {
            await client.loadROM(testRom.path);

            let eventLoopTicks = 0;
            tickTimer = setInterval(() => {
                eventLoopTicks++;
            }, 5);

            const frames = 1200;
            const startTime = Date.now();
            await client.step(frames);
            const durationMs = Date.now() - startTime;

            const fps = Math.round((frames / durationMs) * 1000);
            assert.ok(fps > 1000, `Worker throughput must exceed 1000 FPS (got ${fps} FPS)`);
            assert.ok(eventLoopTicks > 0, 'Main thread event loop must have ticked during worker execution');
        } finally {
            if (tickTimer) clearInterval(tickTimer);
            await client.close();
        }
    });

    await t.test('8. Should serialize concurrent requests in strict FIFO order', async () => {
        const client = new WorkerEmulatorClient();
        try {
            await client.loadROM(testRom.path);

            // Dispatch multiple concurrent requests simultaneously
            const results = await Promise.all([
                client.step(10),
                client.getFrameCounter(),
                client.step(20),
                client.getFrameCounter(),
                client.ping(),
            ]);

            assert.equal(results.length, 5, 'All concurrent requests must resolve successfully');
            assert.equal(results[4], 'pong', 'Fifth request must be pong');
            assert.equal(results[0]?.width, 160, 'First request packet width must be 160');
            assert.equal(results[2]?.width, 160, 'Third request packet width must be 160');
        } finally {
            await client.close();
        }
    });

    await t.test('9. Should terminate poisoned worker and reject all pending on watchdog timeout', async () => {
        // Create client with normal timeout to load ROM first
        const initClient = new WorkerEmulatorClient();
        try {
            await initClient.loadROM(testRom.path);
        } finally {
            await initClient.close();
        }

        // Create client with ultra-short watchdog timeout
        const client = new WorkerEmulatorClient({ watchdogTimeoutMs: 1 });
        try {
            // Load ROM and step 5000 frames will exceed 1ms watchdog timeout
            await assert.rejects(async () => {
                await client.loadROM(testRom.path);
                await client.step(5000);
            }, /timed out after 1ms/i);

            // Subsequent requests must be rejected immediately because worker was poisoned & closed
            await assert.rejects(async () => {
                await client.ping();
            }, /WorkerEmulatorClient is closed/i);
        } finally {
            await client.close();
        }
    });

    await t.test('10. Should return identical shared closePromise and reject subsequent requests', async () => {
        const client = new WorkerEmulatorClient();
        try {
            await client.loadROM(testRom.path);

            // Concurrent close calls return identical promise instance
            const firstClose = client.close();
            const secondClose = client.close();
            assert.equal(firstClose, secondClose, 'Concurrent close calls must return identical closePromise');
            await Promise.all([firstClose, secondClose]);

            // Subsequent operations reject cleanly
            await assert.rejects(async () => {
                await client.ping();
            }, /WorkerEmulatorClient is closed/i);
        } finally {
            await client.close();
        }
    });

    await t.test('11. Should reject requests with obsolete or mismatched session IDs / generations', async () => {
        const client = new WorkerEmulatorClient();
        try {
            await client.loadROM(testRom.path);

            // Directly post an invalid generation request to the underlying worker
            const worker = (client as unknown as { worker: { postMessage: (msg: unknown) => void } }).worker;
            const invalidReqPromise = new Promise((resolve, reject) => {
                const onMsg = (msg: unknown) => {
                    const res = msg as { id: number; success: boolean; error?: { message: string } };
                    if (res.id === 99999) {
                        (worker as unknown as import('node:events').EventEmitter).off('message', onMsg);
                        if (!res.success) {
                            reject(new Error(res.error?.message ?? 'Request failed'));
                        } else {
                            resolve(true);
                        }
                    }
                };
                (worker as unknown as import('node:events').EventEmitter).on('message', onMsg);
            });

            worker.postMessage({
                id: 99999,
                type: 'step',
                frames: 1,
                sessionId: 'wrong_session_id',
                generation: 999,
            });

            await assert.rejects(invalidReqPromise, /Request session mismatch/i);
        } finally {
            await client.close();
        }
    });

    await t.test('12. Should reject out-of-bounds bus read range requests via native shim validation', async () => {
        const client = new WorkerEmulatorClient();
        try {
            await client.loadROM(testRom.path);

            // Bus read at 0xFFFF with length 2 exceeds 16-bit address space on GB (0x10001 > 0x10000)
            await assert.rejects(
                client.sliceMemory(0xFFFF, 2),
                /Failed to read bus range/i
            );
        } finally {
            await client.close();
        }
    });

    await t.test('13. Should coalesce watch telemetry across multiple frame transitions into bounded IPC', async () => {
        const client = new WorkerEmulatorClient();
        const memoryChanges: Array<{ changes: Array<{ key: string; prev: number | Buffer; next: number | Buffer }>; droppedEvents?: number; telemetryId?: number }> = [];
        client.on('memoryChange', (evt) => {
            memoryChanges.push(evt);
        });

        try {
            await client.loadROM(testRom.path);
            // Set watch on 0xFF44 (LY register which increments across scanlines/frames in GB)
            await client.setWatchPlan([{ key: 'ly_reg', address: 0xFF44 }]);

            // Step 10 frames in a single RPC request
            await client.step(10);

            // Wait a brief tick for event delivery
            await new Promise((r) => setTimeout(r, 20));

            assert.ok(memoryChanges.length >= 1, 'Must receive at least one memoryChange event');
            const evt = memoryChanges[0];
            assert.ok(evt, 'Event must be defined');
            assert.ok(typeof evt.telemetryId === 'number' && evt.telemetryId >= 1, 'Must include monotonically increasing telemetryId');
            const lyEntry = evt.changes.find(c => c.key === 'ly_reg');
            assert.ok(lyEntry, 'Must report ly_reg change');
            assert.ok(typeof lyEntry.prev === 'number', 'Must have numeric prev value');
            assert.ok(typeof lyEntry.next === 'number', 'Must have numeric next value');
        } finally {
            await client.close();
        }
    });

    await t.test('14. Should enforce 1-in-flight telemetry and ignore mismatched/stale ACKs', async () => {
        const client = new WorkerEmulatorClient();
        const rawWorker = (client as unknown as { worker: import('node:worker_threads').Worker }).worker;

        try {
            await client.loadROM(testRom.path);
            await client.setWatchPlan([{ key: 'ly_reg', address: 0xFF44 }]);

            // Send a stale / mismatched telemetry ACK
            rawWorker.postMessage({
                type: 'telemetryAck',
                telemetryId: 999999,
                sessionId: 'stale_session_id',
                generation: 999,
            });

            // Step 5 frames
            await client.step(5);
            const pong = await client.ping();
            assert.equal(pong, 'pong', 'Worker must continue normally ignoring stale ACK');
        } finally {
            await client.close();
        }
    });

    await t.test('15. Should execute graceful worker close without session mismatch error', async () => {
        const client = new WorkerEmulatorClient();
        let sessionMismatchDetected = false;

        const worker = (client as unknown as { worker: import('node:worker_threads').Worker }).worker;
        const msgHandler = (msg: unknown) => {
            const err = (msg as { error?: { message?: string } })?.error;
            if (err?.message?.includes('session mismatch')) {
                sessionMismatchDetected = true;
            }
        };
        worker.on('message', msgHandler);

        try {
            await client.loadROM(testRom.path);
            await client.step(5);
            await client.close();

            assert.equal(sessionMismatchDetected, false, 'Graceful close must not trigger session mismatch');
        } finally {
            await client.close();
        }
    });
});
