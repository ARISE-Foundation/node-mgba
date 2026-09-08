import test from 'node:test';
import assert from 'node:assert/strict';
import {
    MgbaEmulator,
    WorkerEmulatorClient,
    press,
    wait,
    normalizeMemoryRegion,
    normalizeMemorySpace,
    parseSinkIdentity,
    resolveButtonMask,
    expandButtonsToInputActions,
    validateStepSequenceOptions,
    type PressButtonsOptions,
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

    await t.test('11. expandButtonsToInputActions and resolveButtonMask must normalize strings and strictly validate numeric masks', async () => {
        // expandButtonsToInputActions accepts lowercase and 'wait' keywords
        assert.doesNotThrow(() => {
            expandButtonsToInputActions([
                { button: 'a' },
                { button: 'start' },
                { button: 'wait', holdFrames: 30 },
                { button: 'LEFT', releaseFrames: 10 },
            ]);
        });

        // expandButtonsToInputActions rejects unrecognized buttons
        assert.throws(() => {
            expandButtonsToInputActions([{ button: 'invalid_button' }]);
        }, /Unrecognized button/i);

        // expandButtonsToInputActions rejects non-object inputs
        assert.throws(() => {
            expandButtonsToInputActions(['a'] as any);
        }, /Invalid button action/i);

        // Numeric button bitmasks are strictly validated (0..0x3FF)
        for (const invalid of [-1, 0x400, NaN, 1.5, Infinity]) {
            assert.throws(() => {
                resolveButtonMask(invalid);
            }, /Invalid numeric button mask/i);
        }
    });

    await t.test('12. validateStepSequenceOptions must strictly validate waitFrames as non-negative integer', async () => {
        for (const invalid of [-1, NaN, 1.5, Infinity, '10']) {
            assert.throws(() => {
                validateStepSequenceOptions<PressButtonsOptions>({ waitFrames: invalid as unknown as number });
            }, /must be a non-negative finite integer/i);
        }
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

    await t.test('14. Trailing zero-frame action in worker actor must advance exact 1 frame', async () => {
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

    await t.test('15. High FPS worker playback must not starve control requests', async () => {
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

    await t.test('16. User action with isPostStabilization metadata in WorkerEmulatorClient must not be suppressed', async () => {
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

    await t.test('26. stepSequence must properly release button during releaseFrames on consecutive presses', async () => {
        const emulator = new MgbaEmulator();
        const keysPerFrame: number[] = [];
        emulator.registerPlugin({
            name: 'key-tracker',
            onFrame: (data) => {
                keysPerFrame.push(data.currentKeys);
            },
        });
        await emulator.loadROM(romPath);

        await emulator.stepSequence([
            { type: 'press', button: 'A', holdFrames: 2, releaseFrames: 2 },
            { type: 'press', button: 'A', holdFrames: 2, releaseFrames: 2 },
        ], { postStabilizationFrames: 0 });

        // Expected pattern: hold 2 frames (1, 1), release 2 frames (0, 0), hold 2 frames (1, 1), release 2 frames (0, 0)
        assert.deepEqual(keysPerFrame, [1, 1, 0, 0, 1, 1, 0, 0]);

        await emulator.close();
    });
});
