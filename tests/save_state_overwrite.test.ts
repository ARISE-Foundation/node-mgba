import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { MgbaEmulator, NativeMgbaCore } from '../src/index.js';
import { getHomebrewGbRomPath } from './helpers/rom.js';
import { createSafeTempDir } from './helpers/temp.js';

test('NativeMgbaCore & MgbaEmulator savestate overwrite semantics', async (t) => {
    const romPath = getHomebrewGbRomPath();
    const tempHandle = createSafeTempDir('mgba-overwrite-');
    if (!tempHandle) {
        t.skip('Skipping: no writable temp directory');
        return;
    }

    const stateFile = path.join(tempHandle.path, `test_overwrite_${Date.now()}.ss0`);

    try {
        await t.test('1. NativeMgbaCore.saveState repeatedly overwrites existing file', () => {
            const core = new NativeMgbaCore();
            core.loadROM(romPath);

            try {
                // Step a few frames
                core.stepFrame(0);

                // Initial save
                const firstSave = core.saveState(stateFile);
                assert.strictEqual(firstSave, true, 'First saveState must return true');
                assert.ok(fs.existsSync(stateFile), 'Savestate file must exist after first save');
                const firstSize = fs.statSync(stateFile).size;
                assert.ok(firstSize > 500, 'Savestate must contain non-empty data');

                // Step frames and modify memory to ensure distinct state
                core.busWrite8(0xc000, 0x77);
                core.stepFrame(0);

                // Overwrite save to the exact same file path
                const secondSave = core.saveState(stateFile);
                assert.strictEqual(secondSave, true, 'Subsequent saveState overwrite must return true');
                assert.ok(fs.existsSync(stateFile), 'Savestate file must still exist after overwrite');
                const secondSize = fs.statSync(stateFile).size;
                assert.ok(secondSize > 500, 'Savestate must maintain valid data on overwrite');

                // Verify the state can be cleanly reloaded
                const loaded = core.loadState(stateFile);
                assert.strictEqual(loaded, true, 'loadState on overwritten file must succeed');
                assert.strictEqual(core.busRead8(0xc000), 0x77, 'Overwritten state memory must match');
            } finally {
                core.close();
            }
        });

        await t.test('2. MgbaEmulator facade repeatedly overwrites existing file', async () => {
            const emulator = new MgbaEmulator();
            await emulator.loadROM(romPath);

            try {
                await emulator.step(10);
                const firstSave = emulator.saveState(stateFile);
                assert.strictEqual(firstSave, true, 'First facade saveState must return true');

                await emulator.step(10);
                const secondSave = emulator.saveState(stateFile);
                assert.strictEqual(secondSave, true, 'Second facade saveState overwrite must return true');

                const loaded = emulator.loadState(stateFile);
                assert.strictEqual(loaded, true, 'loadState must succeed after facade overwrite');
            } finally {
                await emulator.close();
            }
        });
    } finally {
        tempHandle.cleanup();
    }
});
