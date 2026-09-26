import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { EmulatorController, EmulatorCrashError } from '../src/index.js';
import { getBatteryRomPath, getHomebrewGbRomPath } from './helpers/rom.js';
import { createSafeTempDir } from './helpers/temp.js';

test('EmulatorController Autonomous Battery Lifecycle & Crash Guard Policies Suite', async (t) => {
    const tempHandle = createSafeTempDir('mgba-controller-battery-');
    if (!tempHandle) {
        t.skip('Skipping: no writable temp directory');
        return;
    }

    const baseBatteryRom = getBatteryRomPath(tempHandle.path);

    try {
        await t.test('1. Auto-Derived Battery Path (batterySavePath: true)', async () => {
            const tempRomPath = path.join(tempHandle.path, 'temp_game.gb');
            fs.copyFileSync(baseBatteryRom, tempRomPath);

            const expectedSavPath = path.join(tempHandle.path, 'temp_game.sav');
            const statePath = path.join(tempHandle.path, 'temp_game.ss0');

            const controller = new EmulatorController({
                romPath: tempRomPath,
                batterySavePath: true,
                realtime: false,
            });

            try {
                assert.strictEqual(
                    controller.batterySavePath,
                    expectedSavPath,
                    'batterySavePath should auto-derive to match ROM name with .sav extension',
                );

                await controller.initialize();
                assert.strictEqual(controller.state, 'ready');

                const initialSram = await controller.getSram();
                assert.ok(initialSram.length > 0, `Expected SRAM length > 0, got ${initialSram.length}`);

                const testPattern = Buffer.alloc(initialSram.length, 0x42);
                testPattern.write('AUTO_DERIVED_BATTERY_SRAM_TEST', 0x10, 'utf8');

                const setOk = await controller.setSram(testPattern);
                assert.strictEqual(setOk, true, 'setSram must return true');

                const saveOk = await controller.saveState(statePath);
                assert.strictEqual(saveOk, true, 'saveState must succeed');

                assert.ok(fs.existsSync(expectedSavPath), 'temp_game.sav must be automatically created on disk');
                const savedFileBytes = fs.readFileSync(expectedSavPath);
                assert.deepStrictEqual(savedFileBytes, testPattern, 'Flushed battery save file must match modified SRAM');
            } finally {
                await controller.close();
            }
        });

        await t.test('2. Explicit Battery Path (batterySavePath: string)', async () => {
            const customBatteryPath = path.join(tempHandle.path, 'custom_save.sav');
            const statePath = path.join(tempHandle.path, 'custom_state.ss0');

            const controller = new EmulatorController({
                romPath: baseBatteryRom,
                batterySavePath: customBatteryPath,
                realtime: false,
            });

            try {
                assert.strictEqual(controller.batterySavePath, customBatteryPath);

                await controller.initialize();
                assert.strictEqual(controller.state, 'ready');

                const initialSram = await controller.getSram();
                const testPattern = Buffer.alloc(initialSram.length, 0x55);
                testPattern.write('EXPLICIT_BATTERY_PATH_SRAM_TEST', 0x10, 'utf8');

                await controller.setSram(testPattern);

                const saveOk = await controller.saveState(statePath);
                assert.strictEqual(saveOk, true, 'saveState must return true');

                assert.ok(fs.existsSync(customBatteryPath), 'custom_save.sav must exist on disk after saveState');
                assert.deepStrictEqual(
                    fs.readFileSync(customBatteryPath),
                    testPattern,
                    'Saved battery file must match SRAM pattern',
                );
            } finally {
                await controller.close();
            }
        });

        await t.test('3. Auto-Load Existing Battery File on initialize()', async () => {
            const customBatteryPath = path.join(tempHandle.path, 'autoload_custom_save.sav');

            // Obtain SRAM length from base battery ROM
            const probeController = new EmulatorController({
                romPath: baseBatteryRom,
                realtime: false,
            });
            let sramLength: number;
            try {
                await probeController.initialize();
                sramLength = (await probeController.getSram()).length;
            } finally {
                await probeController.close();
            }

            const prepopulatedPattern = Buffer.alloc(sramLength, 0x77);
            prepopulatedPattern.write('PREPOPULATED_AUTOLOAD_BATTERY_DATA', 0, 'utf8');
            fs.writeFileSync(customBatteryPath, prepopulatedPattern);

            const controller = new EmulatorController({
                romPath: baseBatteryRom,
                batterySavePath: customBatteryPath,
                realtime: false,
            });

            try {
                await controller.initialize();
                assert.strictEqual(controller.state, 'ready');

                const loadedSram = await controller.getSram();
                assert.deepStrictEqual(
                    loadedSram,
                    prepopulatedPattern,
                    'getSram must match pre-populated file contents after initialize()',
                );
            } finally {
                await controller.close();
            }
        });

        await t.test('4. Controller-Level Crash Guard Defaults', async () => {
            const statePath = path.join(tempHandle.path, 'crash_guard_controller.ss0');
            const crashRom = getHomebrewGbRomPath();

            const controller = new EmulatorController({
                romPath: crashRom,
                guardCrashes: true,
                realtime: false,
            });

            try {
                await controller.initialize();
                assert.strictEqual(controller.state, 'ready');

                // Normal state: saveState succeeds without options
                const saveNormal = await controller.saveState(statePath);
                assert.strictEqual(saveNormal, true, 'Normal saveState must succeed with guardCrashes: true');

                // Corrupt CPU state: disable all interrupts in IE (0xFFFF = 0x00) and step frames until CPU deadlocks
                await controller.busWrite8(0xffff, 0x00);
                let isDeadlocked = false;
                for (let i = 0; i < 60; i++) {
                    await controller.step(1);
                    const health = await controller.checkCpuHealth();
                    if (!health.ok) {
                        isDeadlocked = true;
                        break;
                    }
                }
                assert.ok(isDeadlocked, 'CPU must enter deadlocked/corrupted state after disabling interrupts in IE');

                // Once deadlocked, saveState WITHOUT options must reject with EmulatorCrashError
                await assert.rejects(
                    () => controller.saveState(statePath),
                    (err: unknown) => {
                        assert.ok(err instanceof EmulatorCrashError, `Expected EmulatorCrashError, got: ${err}`);
                        return true;
                    },
                    'saveState without options must reject with EmulatorCrashError under controller-level guardCrashes: true',
                );

                // Explicit override { guardCrashes: false } must succeed despite controller default
                const saveOverridden = await controller.saveState(statePath, { guardCrashes: false });
                assert.strictEqual(saveOverridden, true, 'saveState with explicit { guardCrashes: false } override must succeed');
            } finally {
                await controller.close();
            }
        });

        await t.test('5. Error on batterySavePath: true without romPath', async () => {
            const controller = new EmulatorController({
                batterySavePath: true,
                realtime: false,
            });

            try {
                assert.throws(
                    () => { void controller.batterySavePath; },
                    (err: unknown) => err instanceof Error && /(?:romPath|ROM path)/i.test(err.message),
                    'controller.batterySavePath must throw explicit error about missing romPath',
                );

                await assert.rejects(
                    () => controller.initialize(),
                    (err: unknown) => err instanceof Error && /(?:romPath|ROM path)/i.test(err.message),
                    'controller.initialize() must throw explicit error about missing romPath',
                );
            } finally {
                await controller.close();
            }
        });

        await t.test('6. Safe teardown of uninitialized controller with batterySavePath: true', async () => {
            const controller = new EmulatorController({
                batterySavePath: true,
                realtime: false,
            });

            // Calling close() without prior initialize() must succeed without unhandled exception
            await assert.doesNotReject(
                async () => { await controller.close(); },
                'close() on uninitialized controller with batterySavePath: true must not throw',
            );
        });

        await t.test('7. Battery path derivation with dotted directory and extensionless ROM', async () => {
            const dottedDir = path.join(tempHandle.path, 'release.v1.0');
            fs.mkdirSync(dottedDir, { recursive: true });

            const romWithExt = path.join(dottedDir, 'game.gb');
            const controllerWithExt = new EmulatorController({
                romPath: romWithExt,
                batterySavePath: true,
                realtime: false,
            });
            assert.strictEqual(
                controllerWithExt.batterySavePath,
                path.join(dottedDir, 'game.sav'),
                'batterySavePath must preserve dotted directory path when ROM has extension',
            );

            const romWithoutExt = path.join(dottedDir, 'game');
            const controllerWithoutExt = new EmulatorController({
                romPath: romWithoutExt,
                batterySavePath: true,
                realtime: false,
            });
            assert.strictEqual(
                controllerWithoutExt.batterySavePath,
                path.join(dottedDir, 'game.sav'),
                'batterySavePath must preserve dotted directory path when ROM has no extension',
            );
        });
    } finally {
        tempHandle.cleanup();
    }
});
