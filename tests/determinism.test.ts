import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import xxhash from 'xxhash-wasm';
import { MgbaEmulator } from '../src/index.js';
import { getTestRomPath, hasTestRom } from './helpers/rom.js';
import { createSafeTempDir } from './helpers/temp.js';

test('Emulation Determinism & Savestate Cycle-Accuracy', async (t) => {
    if (!hasTestRom()) {
        t.skip('Test ROM fixture not found (set ROM_PATH to run)');
        return;
    }
    const romPath = getTestRomPath();
    const hasher = await xxhash();
    const emulator = new MgbaEmulator();
    await emulator.loadROM(romPath);

    await t.test('1. Should deterministically reproduce identical frames and memory across savestate reloads', async () => {
        const tempHandle = createSafeTempDir('mgba-determinism-');
        if (!tempHandle) {
            emulator.close();
            t.skip('Skipping disk savestate determinism test: no writable directory available in this environment');
            return;
        }

        const stateFile = path.join(tempHandle.path, `test_determinism_${Date.now()}_${process.pid}.state`);

        try {
            // Step to baseline checkpoint at frame 300
            await emulator.step(300);
            assert.equal(emulator.core.getFrameCounter(), 300);

            // Write sentinel value to WRAM before saving state
            emulator.core.busWrite8(0xc000, 0x42);

            const frame300 = emulator.core.getVideoFrame();
            const hash300 = hasher.h64Raw(frame300.buffer).toString(16);
            const ram300 = emulator.core.read({ space: 'bus', address: 0xc000, length: 64 }) as Buffer;
            assert.equal(ram300[0], 0x42);

            // Save state at frame 300
            const saved = emulator.saveState(stateFile);
            assert.equal(saved, true, 'Failed to save state');
            assert.ok(fs.existsSync(stateFile), 'Savestate file does not exist on disk');

            // Advance 300 frames to Frame 600 and mutate WRAM
            await emulator.step(300);
            assert.equal(emulator.core.getFrameCounter(), 600);
            emulator.core.busWrite8(0xc000, 0x99);

            const frame600 = emulator.core.getVideoFrame();
            const hash600 = hasher.h64Raw(frame600.buffer).toString(16);
            const ram600 = emulator.core.read({ space: 'bus', address: 0xc000, length: 64 }) as Buffer;
            assert.equal(ram600[0], 0x99);

            // Restore state back to frame 300
            const loaded = emulator.loadState(stateFile);
            assert.equal(loaded, true, 'Failed to load state');
            assert.equal(emulator.core.getFrameCounter(), 300, 'Frame counter should restore to 300');

            // Verify immediate visual & memory parity at restored frame 300
            const restoredFrame300 = emulator.core.getVideoFrame();
            const restoredHash300 = hasher.h64Raw(restoredFrame300.buffer).toString(16);
            const restoredRam300 = emulator.core.read({ space: 'bus', address: 0xc000, length: 64 }) as Buffer;

            assert.equal(restoredHash300, hash300, 'Restored frame 300 hash must match original frame 300 hash');
            assert.deepEqual(restoredRam300, ram300, 'Restored RAM must match original RAM snapshot');
            assert.equal(restoredRam300[0], 0x42, 'Restored sentinel RAM must match pre-save state');

            // Advance 300 frames again from restored state
            await emulator.step(300);
            assert.equal(emulator.core.getFrameCounter(), 600);

            // Mutate WRAM again to 0x99 to match original run
            emulator.core.busWrite8(0xc000, 0x99);

            // Verify deterministic reproduction of frame 600
            const recomputedFrame600 = emulator.core.getVideoFrame();
            const recomputedHash600 = hasher.h64Raw(recomputedFrame600.buffer).toString(16);
            const recomputedRam600 = emulator.core.read({ space: 'bus', address: 0xc000, length: 64 }) as Buffer;

            assert.equal(
                recomputedHash600,
                hash600,
                'Advancing 300 frames from restored state must yield the exact bit-for-bit frame hash as the first run',
            );
            assert.deepEqual(recomputedRam600, ram600, 'Recomputed RAM must match original frame 600 RAM snapshot');
        } finally {
            emulator.close();
            tempHandle.cleanup();
        }
    });
});
