import test from 'node:test';
import assert from 'node:assert/strict';
import {
    MgbaEmulator,
    RealtimeEmulationLoop,
    WorkerEmulatorClient,
    press,
    wait,
    release,
    normalizeMemoryRegion,
    normalizeMemorySpace,
    parseSinkIdentity,
    resolveButtonMask,
} from '../src/index.js';
import { getTestRomPath, hasTestRom } from './helpers/rom.js';

test('Contracts & Error Boundaries', async (t) => {
    if (!hasTestRom()) {
        t.skip('Test ROM fixture not found (set ROM_PATH to run)');
        return;
    }
    const romPath = getTestRomPath();

    await t.test('1. Should reject operations when emulator is uninitialized', async () => {
        const emulator = new MgbaEmulator();

        assert.throws(() => {
            emulator.core.getVideoFrame();
        }, /not initialized|not loaded/i);

        assert.throws(() => {
            emulator.core.getFrameCounter();
        }, /not initialized|not loaded/i);

        assert.throws(() => {
            emulator.core.read({ space: 'bus', address: 0x0100 });
        }, /not initialized|not loaded/i);

        await assert.rejects(async () => {
            await emulator.step(1);
        }, /loadROM\(\) must be called/i);

        await assert.rejects(async () => {
            await emulator.stepSequence([]);
        }, /loadROM\(\) must be called/i);
    });

    await t.test('2. Should reject invalid ROM paths', async () => {
        const emulator = new MgbaEmulator();
        await assert.rejects(async () => {
            await emulator.loadROM('/nonexistent/path/to/invalid_rom.gb');
        }, /Failed to initialize mGBA core/i);
    });

    await t.test('3. Should reject invalid button inputs', async () => {
        const emulator = new MgbaEmulator();
        await emulator.loadROM(romPath);

        await assert.rejects(async () => {
            // @ts-expect-error Testing runtime rejection of invalid button name
            await emulator.stepSequence([{ type: 'press', button: 'INVALID_BUTTON' }]);
        }, /Unrecognized button/i);

        await assert.rejects(async () => {
            // @ts-expect-error Testing runtime rejection of empty button name
            await emulator.stepSequence([{ type: 'hold', button: '', frames: 10 }]);
        }, /Unrecognized button/i);

        await emulator.close();
    });

    await t.test('4. Should reject operations after core is closed', async () => {
        const emulator = new MgbaEmulator();
        await emulator.loadROM(romPath);
        await emulator.close();

        assert.throws(() => {
            emulator.core.stepFrame(0);
        }, /not initialized|not loaded/i);

        assert.throws(() => {
            emulator.core.getVideoFrame();
        }, /not initialized|not loaded/i);

        await assert.rejects(async () => {
            await emulator.step(1);
        }, /loadROM\(\) must be called/i);
    });

    await t.test('5. Should handle invalid savestate paths safely', async () => {
        const emulator = new MgbaEmulator();
        await emulator.loadROM(romPath);

        const loadedMissing = emulator.loadState('/tmp/nonexistent_state_file_12345.state');
        assert.equal(loadedMissing, false, 'Expected loadState on missing file to return false');

        const saveToInvalidDir = emulator.saveState('/nonexistent_directory/state.sav');
        assert.equal(saveToInvalidDir, false, 'Expected saveState to invalid dir to return false');

        await emulator.close();
    });

    await t.test('6. Should normalize case-insensitive button names and reject unknown button names without side-effects', async () => {
        const emulator = new MgbaEmulator();
        let keyframesEmitted = 0;
        emulator.registerKeyframeSink({
            name: 'probe',
            onKeyframe: () => {
                keyframesEmitted++;
            },
        });
        await emulator.loadROM(romPath);

        // Case-insensitive buttons should normalize and succeed cleanly
        const result = await emulator.stepSequence([
            // @ts-expect-error Testing lowercase string input
            { type: 'press', button: 'a', holdFrames: 1, releaseFrames: 0 },
            // @ts-expect-error Testing mixed-case string input
            { type: 'press', button: 'Start', holdFrames: 1, releaseFrames: 0 },
        ], { postStabilizationFrames: 0 });
        assert.equal(result.durationFrames, 2, 'Normalized button sequence must execute successfully');
        assert.ok(keyframesEmitted > 0, 'Keyframes should be emitted for valid normalized execution');

        const keyframesBeforeError = keyframesEmitted;
        await assert.rejects(async () => {
            // @ts-expect-error Testing unknown button rejection
            await emulator.stepSequence([{ type: 'press', button: 'INVALID_BUTTON' }]);
        }, /Unrecognized button name: INVALID_BUTTON/i);

        assert.equal(keyframesEmitted, keyframesBeforeError, 'Zero additional keyframes must be emitted when validation fails');
        await emulator.close();
    });

    await t.test('7. Failed validation must not leak activeToken or poison subsequent steps', async () => {
        const emulator = new MgbaEmulator();
        await emulator.loadROM(romPath);

        await assert.rejects(async () => {
            await emulator.stepSequence([{ type: 'wait', frames: NaN }]);
        }, /must be a non-negative finite integer/i);

        emulator.clearActionQueue();
        const packet = await emulator.step(1);
        assert.ok(packet, 'Step after failed validation and clearActionQueue must succeed');
        await emulator.close();
    });

    await t.test('8. Sequence options must strictly validate non-negative integers', async () => {
        const emulator = new MgbaEmulator();
        await emulator.loadROM(romPath);

        for (const invalid of [NaN, -1, 1.5, Infinity, '16']) {
            await assert.rejects(async () => {
                await emulator.stepSequence(
                    [{ type: 'press', button: 'A' }],
                    { holdFrames: invalid as unknown as number },
                );
            }, /must be a non-negative finite integer/i);
        }

        await emulator.close();
    });

    await t.test('9. Zero-frame sequence options and actions must execute cleanly', async () => {
        const emulator = new MgbaEmulator();
        await emulator.loadROM(romPath);

        const result = await emulator.stepSequence(
            [{ type: 'press', button: 'A' }, { type: 'wait', frames: 0 }],
            { holdFrames: 0, releaseFrames: 0, postStabilizationFrames: 0 },
        );
        assert.equal(result.durationFrames, 0, 'Zero-frame actions must complete in 0 frames');

        await emulator.close();
    });

    await t.test('10. Aborted signal must not bypass upfront action validation', async () => {
        const emulator = new MgbaEmulator();
        await emulator.loadROM(romPath);

        const controller = new AbortController();
        controller.abort(new Error('Pre-aborted'));

        await assert.rejects(async () => {
            // @ts-expect-error Testing invalid action with aborted signal
            await emulator.stepSequence([{ type: 'press', button: 'INVALID' }], { signal: controller.signal });
        }, /Unrecognized button/i);

        await emulator.close();
    });

    await t.test('11. pressButtons and resolveButtonMask must normalize strings and strictly validate numeric masks', async () => {
        const emulator = new MgbaEmulator();
        await emulator.loadROM(romPath);
        const loop = new RealtimeEmulationLoop(emulator);

        // pressButtons accepts lowercase and 'wait' keywords
        assert.doesNotThrow(() => {
            loop.pressButtons(['a', 'start', 'wait', 'LEFT'], { waitFrames: 0 });
        });

        // pressButtons rejects unrecognized buttons
        assert.throws(() => {
            loop.pressButtons(['invalid_button']);
        }, /Unrecognized button/i);

        // Numeric button bitmasks are strictly validated (0..0x3FF)
        for (const invalid of [-1, 0x400, NaN, 1.5, Infinity]) {
            assert.throws(() => {
                resolveButtonMask(invalid);
            }, /Invalid numeric button mask/i);
        }

        await emulator.close();
    });

    await t.test('12. RealtimeEmulationLoop must execute zero-frame sequences without stepping emulator', async () => {
        let stepCount = 0;
        const fakeEmulator = {
            async step() {
                stepCount++;
                return {
                    frameIndex: stepCount,
                    pts: 0,
                    width: 160,
                    height: 144,
                    strideBytes: 640,
                    buffer: Buffer.alloc(92160),
                };
            },
        };
        const loop = new RealtimeEmulationLoop(fakeEmulator);
        const handle = loop.executeSequence(
            [{ type: 'press', button: 'A' }, { type: 'wait', frames: 0 }],
            { holdFrames: 0, releaseFrames: 0, postStabilizationFrames: 0 },
        );
        const res = await handle.promise;
        assert.equal(res.actionsExecuted, 2, 'Must report all 2 actions executed');
        assert.equal(stepCount, 0, 'Zero-frame sequence must not step emulator frame clock');
    });

    await t.test('13. WorkerEmulatorClient must execute zero-frame sequences and report exact actionsExecuted', async () => {
        const client = new WorkerEmulatorClient();
        try {
            await client.loadROM(romPath);
            const beforeFrames = await client.getFrameCounter();

            const handle = client.enqueueSequence(
                [{ type: 'press', button: 'A' }, { type: 'wait', frames: 0 }],
                { holdFrames: 0, releaseFrames: 0, postStabilizationFrames: 0 },
            );
            const res = await handle.promise;
            assert.equal(res.actionsExecuted, 2, 'Worker must report all 2 actions executed');

            const afterFrames = await client.getFrameCounter();
            assert.equal(afterFrames, beforeFrames, 'Zero-frame sequence in paused worker must not advance frame counter');
        } finally {
            await client.close();
        }
    });

    await t.test('14. pressButtons must strictly validate waitFrames as non-negative integer', async () => {
        const emulator = new MgbaEmulator();
        await emulator.loadROM(romPath);
        const loop = new RealtimeEmulationLoop(emulator);

        for (const invalid of [-1, NaN, 1.5, Infinity, '10']) {
            assert.throws(() => {
                loop.pressButtons(['A'], { waitFrames: invalid as unknown as number });
            }, /must be a non-negative finite integer/i);
        }

        await emulator.close();
    });

    await t.test('15. Bare release action must consume 1 frame in RealtimeEmulationLoop', async () => {
        let stepCount = 0;
        const fakeEmulator = {
            async step() {
                stepCount++;
                return {
                    frameIndex: stepCount,
                    pts: 0,
                    width: 160,
                    height: 144,
                    strideBytes: 640,
                    buffer: Buffer.alloc(92160),
                };
            },
        };
        const loop = new RealtimeEmulationLoop(fakeEmulator, { fps: 10000 });
        const handle = loop.executeSequence([release('A')], { postStabilizationFrames: 0 });
        loop.start();
        const res = await handle.promise;
        await loop.pause();

        assert.equal(res.actionsExecuted, 1);
        assert.equal(stepCount, 1, 'Bare release action must consume 1 frame step');
    });

    await t.test('16. Multi-action drain must emit isSequenceComplete true only on terminal action', async () => {
        let stepCount = 0;
        const fakeEmulator = {
            async step() {
                stepCount++;
                return {
                    frameIndex: stepCount,
                    pts: 0,
                    width: 160,
                    height: 144,
                    strideBytes: 640,
                    buffer: Buffer.alloc(92160),
                };
            },
        };
        const loop = new RealtimeEmulationLoop(fakeEmulator, { fps: 10000 });
        const events: { type: string; done: boolean }[] = [];
        loop.on('actionComplete', (act, done) => {
            events.push({ type: act.type, done });
        });

        const handle = loop.executeSequence(
            [wait(0), wait(0), press('A', 1, 0)],
            { postStabilizationFrames: 0 },
        );
        loop.start();
        const res = await handle.promise;
        await loop.pause();

        assert.equal(res.actionsExecuted, 3);
        assert.equal(events.length, 3);
        assert.equal(events[0]?.done, false, 'First drained action must NOT be marked sequenceComplete');
        assert.equal(events[1]?.done, false, 'Second drained action must NOT be marked sequenceComplete');
        assert.equal(events[2]?.done, true, 'Terminal action must be marked sequenceComplete');
    });

    await t.test('17. Realtime sequence with postStabilizationFrames reports exact user actionsExecuted', async () => {
        let stepCount = 0;
        const fakeEmulator = {
            async step() {
                stepCount++;
                return {
                    frameIndex: stepCount,
                    pts: 0,
                    width: 160,
                    height: 144,
                    strideBytes: 640,
                    buffer: Buffer.alloc(92160),
                };
            },
        };
        const loop = new RealtimeEmulationLoop(fakeEmulator, { fps: 10000 });
        const handle = loop.executeSequence(
            [press('A', 1, 0)],
            { postStabilizationFrames: 2 },
        );
        loop.start();
        const res = await handle.promise;
        await loop.pause();

        assert.equal(res.actionsExecuted, 1, 'Must report 1 user action executed despite synthetic post-stabilization wait');
        assert.equal(stepCount, 3, '1 hold frame + 2 post-stabilization frames = 3 steps');
    });

    await t.test('18. Trailing zero-frame action must not advance extra frame in RealtimeEmulationLoop', async () => {
        let stepCount = 0;
        const fakeEmulator = {
            async step() {
                stepCount++;
                return {
                    frameIndex: stepCount,
                    pts: 0,
                    width: 160,
                    height: 144,
                    strideBytes: 640,
                    buffer: Buffer.alloc(92160),
                };
            },
        };
        const loop = new RealtimeEmulationLoop(fakeEmulator, { fps: 10000 });
        const handle = loop.executeSequence(
            [press('A', 1, 0), wait(0)],
            { postStabilizationFrames: 0 },
        );
        loop.start();
        const res = await handle.promise;
        await loop.pause();

        assert.equal(res.actionsExecuted, 2);
        assert.equal(stepCount, 1, '1 hold frame + 0 trailing wait frames must equal 1 step');
    });

    await t.test('19. Trailing zero-frame action in worker actor must advance exact 1 frame', async () => {
        const client = new WorkerEmulatorClient();
        try {
            await client.loadROM(romPath);
            await client.startPlayback(60);
            const before = await client.getFrameCounter();
            const res = await client.enqueueSequence(
                [press('A', 1, 0), wait(0)],
                { postStabilizationFrames: 0 },
            ).promise;
            await client.pausePlayback();
            const after = await client.getFrameCounter();

            assert.equal(res.actionsExecuted, 2);
            assert.equal(after - before, 1, 'Must advance exactly 1 frame');
        } finally {
            await client.close();
        }
    });

    await t.test('20. User action with isPostStabilization metadata must not be suppressed from actionsExecuted', async () => {
        let stepCount = 0;
        const fakeEmulator = {
            async step() {
                stepCount++;
                return {
                    frameIndex: stepCount,
                    pts: 0,
                    width: 160,
                    height: 144,
                    strideBytes: 640,
                    buffer: Buffer.alloc(92160),
                };
            },
        };
        const loop = new RealtimeEmulationLoop(fakeEmulator, { fps: 10000 });
        const handle = loop.executeSequence(
            [press('A', 1, 0, { isPostStabilization: true } as unknown as import('../src/types/index.js').InputActionMetadata)],
            { postStabilizationFrames: 0 },
        );
        loop.start();
        const res = await handle.promise;
        await loop.pause();

        assert.equal(res.actionsExecuted, 1, 'Must report 1 user action executed');
    });

    await t.test('21. High FPS worker playback must not starve control requests', async () => {
        const client = new WorkerEmulatorClient();
        try {
            await client.loadROM(romPath);
            await client.startPlayback(10000);

            const sequencePromise = client.enqueueSequence(
                [press('A', 1, 0)],
                { postStabilizationFrames: 0 },
            ).promise;

            const timeoutPromise = new Promise<never>((_, reject) => {
                const timer = setTimeout(() => reject(new Error('Watchdog timeout: enqueueSequence starved under high FPS')), 2000);
                sequencePromise.finally(() => clearTimeout(timer));
            });

            const res = await Promise.race([sequencePromise, timeoutPromise]);
            assert.equal(res.actionsExecuted, 1);

            await client.pausePlayback();
        } finally {
            await client.close();
        }
    });

    await t.test('22. User action with isPostStabilization metadata in WorkerEmulatorClient must not be suppressed', async () => {
        const client = new WorkerEmulatorClient();
        try {
            await client.loadROM(romPath);
            await client.startPlayback(60);

            const res = await client.enqueueSequence(
                [press('A', 1, 0, { isPostStabilization: true } as unknown as import('../src/types/index.js').InputActionMetadata)],
                { postStabilizationFrames: 0 },
            ).promise;

            await client.pausePlayback();
            assert.equal(res.actionsExecuted, 1, 'Must report 1 user action executed in worker client');
        } finally {
            await client.close();
        }
    });

    await t.test('23. Memory region and space case normalization and hex address parsing in sliceMemory', async () => {
        const client = new WorkerEmulatorClient();
        try {
            await client.loadROM(romPath);

            // Region names should be case-insensitive
            const wramUpper = await client.sliceMemory('WRAM', 16, 0);
            const wramLower = await client.sliceMemory('wram', 16, 0);
            assert.deepEqual(wramLower, wramUpper, 'Case-insensitive region slice must match');

            // Hex string addresses should parse correctly
            const hex0x = await client.sliceMemory('0x0100', 16);
            const hexDollar = await client.sliceMemory('$0100', 16);
            const numAddr = await client.sliceMemory(0x0100, 16);
            assert.deepEqual(hex0x, numAddr, '0x-prefixed hex address string must match numeric address');
            assert.deepEqual(hexDollar, numAddr, '$-prefixed hex address string must match numeric address');

            // Invalid regions/spaces must fail fast
            assert.throws(() => {
                normalizeMemoryRegion('invalid_region');
            }, /Unknown memory region: invalid_region/i);

            assert.throws(() => {
                normalizeMemorySpace('invalid_space');
            }, /Unsupported memory space: invalid_space/i);
        } finally {
            await client.close();
        }
    });

    await t.test('24. MediaSink identity validation and typed array support', async () => {
        // Valid identities with whitespace trimming and symbols
        assert.equal(parseSinkIdentity('  obs-stream (primary)  '), 'obs-stream (primary)');

        // Invalid identities must fail fast
        for (const invalid of ['', '   ', 'a'.repeat(129), 'sink\x00null', 123]) {
            assert.throws(() => {
                parseSinkIdentity(invalid);
            }, /MediaSink identity/i);
        }
    });

    await t.test('25. readBatch must strictly validate descriptor read types', async () => {
        const emulator = new MgbaEmulator();
        await emulator.loadROM(romPath);

        assert.throws(() => {
            // @ts-expect-error Testing invalid batch read type
            emulator.core.readBatch([{ address: 0x100, type: 'invalid_type' }]);
        }, /Unsupported batch read type/i);

        await emulator.close();
    });
});
