import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { NativeMgbaCore } from '../src/core/NativeMgbaCore.js';
import { Mgba } from '../src/index.js';
import { getBatteryRomPath } from './helpers/rom.js';
import { createSafeTempDir } from './helpers/temp.js';

test('Cartridge Battery (.sav) and Direct SRAM Lifecycle Suite', async (t) => {
    const tempHandle = createSafeTempDir('mgba-battery-test-');
    if (!tempHandle) {
        t.skip('Skipping: no writable temp directory');
        return;
    }

    const romPath = getBatteryRomPath(tempHandle.path);

    try {
        await t.test('1. NativeMgbaCore: direct SRAM buffer manipulation, saveBatteryFile, and loadBatteryFile', () => {
            const core = new NativeMgbaCore();
            core.loadROM(romPath);

            try {
                const initialSram = core.getSram();
                assert.ok(initialSram.length > 0, `Expected SRAM buffer size > 0, got ${initialSram.length}`);

                const testPattern = Buffer.alloc(initialSram.length, 0x5a);
                testPattern.write('PERSISTENT_SRAM_NATIVE_CORE_PAYLOAD', 0x10, 'utf8');

                const writeOk = core.setSram(testPattern);
                assert.strictEqual(writeOk, true, 'setSram must return true');

                const sramAfterWrite = core.getSram();
                assert.deepStrictEqual(sramAfterWrite, testPattern, 'getSram must match pattern set by setSram');

                const savePath = path.join(tempHandle.path, 'native_core_battery.sav');
                const saveOk = core.saveBatteryFile(savePath);
                assert.strictEqual(saveOk, true, 'saveBatteryFile must return true');
                assert.ok(fs.existsSync(savePath), 'Battery file must exist on disk after saveBatteryFile');

                const savedBytes = fs.readFileSync(savePath);
                assert.ok(savedBytes.length > 0, 'Saved battery file size must be > 0');
                assert.deepStrictEqual(savedBytes, testPattern, 'Saved battery file contents must match SRAM buffer');

                // Clear SRAM to zeroes
                const zeroPattern = Buffer.alloc(initialSram.length, 0x00);
                assert.strictEqual(core.setSram(zeroPattern), true, 'Clearing SRAM must succeed');
                assert.deepStrictEqual(core.getSram(), zeroPattern, 'getSram after clear must be all zeroes');

                // Reload battery file and assert restoration
                const loadOk = core.loadBatteryFile(savePath);
                assert.strictEqual(loadOk, true, 'loadBatteryFile must return true');
                assert.deepStrictEqual(core.getSram(), testPattern, 'getSram after loadBatteryFile must restore test pattern');
            } finally {
                core.close();
            }
        });

        await t.test('2. Mgba facade: direct saveBatteryToFile and loadBatteryFromFile', async () => {
            const emu = await Mgba.load(romPath);
            const directPath = path.join(tempHandle.path, 'facade_direct.sav');

            try {
                const sram = await emu.memory.getSram();
                assert.ok(sram.length > 0, `Expected facade SRAM size > 0, got ${sram.length}`);

                const pattern = Buffer.alloc(sram.length, 0xa5);
                pattern.write('FACADE_DIRECT_BATTERY_TEST', 0x08, 'utf8');

                const setOk = await emu.memory.setSram(pattern);
                assert.strictEqual(setOk, true, 'emu.memory.setSram must return true');
                assert.deepStrictEqual(await emu.memory.getSram(), pattern, 'emu.memory.getSram must match set pattern');

                const saveOk = await emu.states.saveBatteryToFile(directPath);
                assert.strictEqual(saveOk, true, 'emu.states.saveBatteryToFile must return true');
                assert.ok(fs.existsSync(directPath), 'Battery file must exist on disk');
                assert.deepStrictEqual(fs.readFileSync(directPath), pattern, 'Battery file must match SRAM pattern');

                // Clear SRAM
                const zeroPattern = Buffer.alloc(sram.length, 0x00);
                await emu.memory.setSram(zeroPattern);
                assert.deepStrictEqual(await emu.memory.getSram(), zeroPattern, 'SRAM must be cleared');

                // Restore
                const loadOk = await emu.states.loadBatteryFromFile(directPath);
                assert.strictEqual(loadOk, true, 'emu.states.loadBatteryFromFile must return true');
                assert.deepStrictEqual(await emu.memory.getSram(), pattern, 'Restored SRAM must match original pattern');
            } finally {
                await emu.close();
            }
        });

        await t.test('3. Mgba facade: autoFlushBatteryOnSave flushes SRAM on saveState', async () => {
            const batteryPath = path.join(tempHandle.path, 'autoflush.sav');
            const statePath = path.join(tempHandle.path, 'autoflush.ss0');

            const emu = await Mgba.load(romPath, {
                batterySavePath: batteryPath,
                autoFlushBatteryOnSave: true,
            });

            try {
                const sram = await emu.memory.getSram();
                const pattern = Buffer.alloc(sram.length, 0x7c);
                pattern.write('AUTO_FLUSH_ON_SAVESTATE', 0x20, 'utf8');

                await emu.memory.setSram(pattern);

                assert.strictEqual(fs.existsSync(batteryPath), false, 'Battery file should not exist prior to savestate or close');

                const saveStateOk = await emu.states.saveToFile(statePath);
                assert.strictEqual(saveStateOk, true, 'saveToFile must succeed');
                assert.ok(fs.existsSync(batteryPath), 'Battery file must be automatically flushed on saveState');
                assert.deepStrictEqual(fs.readFileSync(batteryPath), pattern, 'Flushed battery file must match current SRAM');
            } finally {
                await emu.close();
            }
        });

        await t.test('4. Mgba facade: auto-loads existing batterySavePath on initialization and auto-flushes on close', async () => {
            const batteryPath = path.join(tempHandle.path, 'autoload_and_close_flush.sav');

            // Phase A: Seed battery file with known content
            const emu1 = await Mgba.load(romPath, {
                batterySavePath: batteryPath,
                autoFlushBatteryOnSave: false,
            });

            const sramLength = (await emu1.memory.getSram()).length;
            const seedPattern = Buffer.alloc(sramLength, 0x33);
            seedPattern.write('SEED_BATTERY_FOR_AUTOLOAD', 0, 'utf8');

            await emu1.memory.setSram(seedPattern);
            // Closing emu1 should auto-flush seedPattern to batteryPath
            await emu1.close();

            assert.ok(fs.existsSync(batteryPath), 'Battery file must exist after closing emu1');
            assert.deepStrictEqual(fs.readFileSync(batteryPath), seedPattern, 'Battery file must contain seedPattern');

            // Phase B: Launch emu2 with existing batterySavePath - must auto-load on start
            const emu2 = await Mgba.load(romPath, {
                batterySavePath: batteryPath,
            });

            const updatedPattern = Buffer.alloc(sramLength, 0x99);
            updatedPattern.write('MUTATED_PATTERN_FLUSH_ON_CLOSE', 0, 'utf8');

            try {
                const autoLoadedSram = await emu2.memory.getSram();
                assert.deepStrictEqual(autoLoadedSram, seedPattern, 'emu2 must auto-load existing battery file on startup');

                // Mutate SRAM and verify close auto-flushes the updated content
                await emu2.memory.setSram(updatedPattern);
            } finally {
                await emu2.close();
            }

            // Verify file has updated pattern after emu2 close
            assert.deepStrictEqual(fs.readFileSync(batteryPath), updatedPattern, 'Battery file must be updated on emu2 close');
        });
    } finally {
        tempHandle.cleanup();
    }
});
