import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { NativeMgbaCore } from '../src/core/NativeMgbaCore.js';
import { MgbaEmulator, EmulatorCrashError } from '../src/core/MgbaEmulator.js';
import { reconstructWorkerError } from '../src/worker/WorkerEmulatorClient.js';
import { Mgba } from '../src/index.js';
import { getHomebrewGbRomPath } from './helpers/rom.js';
import { createSafeTempDir } from './helpers/temp.js';

test('CPU Register Inspection, Health Diagnostics & Opt-in Crash Guard Suite', async (t) => {
    const romPath = getHomebrewGbRomPath();
    const tempHandle = createSafeTempDir('mgba-cpu-health-');
    if (!tempHandle) {
        t.skip('Skipping: no writable temp directory');
        return;
    }

    try {
        await t.test('1. NativeMgbaCore.getCpuState returns complete register set and execution flags', () => {
            const core = new NativeMgbaCore();
            core.loadROM(romPath);

            try {
                // Step a few frames to populate CPU registers
                for (let i = 0; i < 5; i++) {
                    core.stepFrame(0);
                }

                const state = core.getCpuState();

                assert.strictEqual(typeof state.pc, 'number', 'CPU PC must be a number');
                assert.strictEqual(typeof state.sp, 'number', 'CPU SP must be a number');
                assert.strictEqual(typeof state.a, 'number', 'Register A must be a number');
                assert.strictEqual(typeof state.b, 'number', 'Register B must be a number');
                assert.strictEqual(typeof state.c, 'number', 'Register C must be a number');
                assert.strictEqual(typeof state.d, 'number', 'Register D must be a number');
                assert.strictEqual(typeof state.e, 'number', 'Register E must be a number');
                assert.strictEqual(typeof state.f, 'number', 'Register F must be a number');
                assert.strictEqual(typeof state.h, 'number', 'Register H must be a number');
                assert.strictEqual(typeof state.l, 'number', 'Register L must be a number');
                assert.strictEqual(typeof state.halted, 'boolean', 'CPU halted flag must be boolean');
                assert.strictEqual(typeof state.ime, 'boolean', 'CPU IME flag must be boolean');

                // Initial health evaluation on running ROM must be ok
                const health = core.checkCpuHealth();
                assert.strictEqual(health.ok, true, 'Healthy running core must report health.ok === true');
                assert.strictEqual(health.reason, undefined, 'Healthy running core must not have a failure reason');
                assert.strictEqual(health.pc, state.pc, 'Health report must mirror PC');
                assert.strictEqual(health.sp, state.sp, 'Health report must mirror SP');
                assert.strictEqual(health.halted, state.halted, 'Health report must mirror halted flag');
                assert.strictEqual(health.ime, state.ime, 'Health report must mirror IME flag');
            } finally {
                core.close();
            }
        });

        await t.test('2. NativeMgbaCore.checkCpuHealth ACE compatibility: WRAM execution is explicitly valid', () => {
            const core = new NativeMgbaCore();
            core.loadROM(romPath);

            try {
                core.stepFrame(0);
                const originalGetCpu = core.getCpuState.bind(core);

                // Simulate Arbitrary Code Execution (ACE) where PC points into WRAM (0xC000..0xDFFF)
                core.getCpuState = () => ({
                    ...originalGetCpu(),
                    pc: 0xc2a0, // WRAM address
                    sp: 0xdff0, // Valid stack pointer in high WRAM
                    halted: false,
                    ime: true,
                });

                const aceHealth = core.checkCpuHealth();
                assert.strictEqual(aceHealth.ok, true, 'Execution within WRAM (ACE) must evaluate to ok: true');
                assert.strictEqual(aceHealth.reason, undefined, 'ACE must not trigger a crash reason');

                // When HALT with IME=0, if IE has interrupts enabled (e.g. 0x01 for VBlank), it is NOT deadlocked
                core.busWrite8(0xffff, 0x01);
                core.getCpuState = () => ({
                    ...originalGetCpu(),
                    pc: 0x0150,
                    sp: 0xdff0,
                    halted: true,
                    ime: false,
                });
                const interruptWaitHealth = core.checkCpuHealth();
                assert.strictEqual(interruptWaitHealth.ok, true, 'HALT with IME=0 but IE enabled is a valid low-power wait loop');

                // Terminal deadlock occurs when HALT with IME=0 AND no interrupts enabled in IE
                core.busWrite8(0xffff, 0x00);
                const deadlockHealth = core.checkCpuHealth();
                assert.strictEqual(deadlockHealth.ok, false, 'HALT with IME and IE disabled must report ok: false');
                assert.ok(
                    deadlockHealth.reason?.toLowerCase().includes('halt')
                    || deadlockHealth.reason?.toLowerCase().includes('deadlock'),
                    `Expected deadlock reason, got: ${deadlockHealth.reason}`
                );

                // Simulate corrupted SP into Echo RAM (>= 0xE000)
                core.getCpuState = () => ({
                    ...originalGetCpu(),
                    pc: 0x0150,
                    sp: 0xe000,
                    halted: false,
                    ime: true,
                });

                const echoSpHealth = core.checkCpuHealth();
                assert.strictEqual(echoSpHealth.ok, false, 'SP >= 0xE000 (Echo RAM) must report ok: false');
                assert.ok(
                    echoSpHealth.reason?.includes('0xE000') || echoSpHealth.reason?.toLowerCase().includes('echo'),
                    `Expected echo RAM reason, got: ${echoSpHealth.reason}`
                );

                // Simulate corrupted SP below RAM (< 0x8000)
                core.getCpuState = () => ({
                    ...originalGetCpu(),
                    pc: 0x0150,
                    sp: 0x7fff,
                    halted: false,
                    ime: true,
                });

                const lowSpHealth = core.checkCpuHealth();
                assert.strictEqual(lowSpHealth.ok, false, 'SP < 0x8000 must report ok: false');
                assert.ok(
                    lowSpHealth.reason?.includes('0x8000'),
                    `Expected SP < 0x8000 reason, got: ${lowSpHealth.reason}`
                );
            } finally {
                core.close();
            }
        });

        await t.test('3. MgbaEmulator: saveState opt-in crash guard semantics', async () => {
            const emulator = new MgbaEmulator();
            await emulator.loadROM(romPath);
            const statePath = path.join(tempHandle.path, 'crash_guard_test.ss0');

            try {
                await emulator.step(10);

                // 1. Normal saveState without options must succeed (crash guard disabled by default)
                const saveDefault = emulator.saveState(statePath);
                assert.strictEqual(saveDefault, true, 'Default saveState must succeed');

                // 2. saveState with { guardCrashes: false } must succeed
                const saveExplicitFalse = emulator.saveState(statePath, { guardCrashes: false });
                assert.strictEqual(saveExplicitFalse, true, 'saveState with guardCrashes: false must succeed');

                // 3. Simulate corrupted CPU state
                emulator.checkCpuHealth = () => ({
                    ok: false,
                    reason: 'Stack pointer in Echo RAM (SP >= 0xE000)',
                    pc: 0x0150,
                    sp: 0xe100,
                    halted: false,
                    ime: true,
                });

                assert.strictEqual(emulator.checkCpuHealth().ok, false, 'checkCpuHealth must report ok === false');

                // 4. With corrupted CPU state, saving WITHOUT guardCrashes must still succeed (opt-in invariant)
                const saveUnguardedWhileCorrupted = emulator.saveState(statePath);
                assert.strictEqual(saveUnguardedWhileCorrupted, true, 'Unguarded saveState must succeed even when CPU is corrupted');

                const saveExplicitFalseWhileCorrupted = emulator.saveState(statePath, { guardCrashes: false });
                assert.strictEqual(saveExplicitFalseWhileCorrupted, true, 'guardCrashes: false must succeed even when CPU is corrupted');

                // 5. With guardCrashes: true, saveState must throw EmulatorCrashError
                assert.throws(
                    () => emulator.saveState(statePath, { guardCrashes: true }),
                    (err: unknown) => {
                        assert.ok(err instanceof EmulatorCrashError, 'Must throw an EmulatorCrashError instance');
                        assert.ok(
                            (err as Error).message.includes('Stack pointer in Echo RAM')
                            || (err as Error).message.includes('crashed'),
                            `Error message must describe crash: ${(err as Error).message}`
                        );
                        return true;
                    }
                );
            } finally {
                await emulator.close();
            }
        });

        await t.test('4. Mgba facade diagnostics namespace: getCpuState and checkCpuHealth', async () => {
            const emu = await Mgba.load(romPath);

            try {
                await emu.controls.tick(5);

                const cpu = await emu.diagnostics.getCpuState();
                assert.strictEqual(typeof cpu.pc, 'number', 'facade cpu.pc must be a number');
                assert.strictEqual(typeof cpu.sp, 'number', 'facade cpu.sp must be a number');

                const health = await emu.diagnostics.checkCpuHealth();
                assert.strictEqual(health.ok, true, 'facade checkCpuHealth must report ok: true on healthy ROM');
                assert.strictEqual(health.pc, cpu.pc, 'facade health report must match PC');
            } finally {
                await emu.close();
            }
        });

        await t.test('5. WorkerEmulatorClient: reconstructWorkerError deserializes EmulatorCrashError across worker boundary', () => {
            const reconstructed = reconstructWorkerError({
                code: 'ERR_UNKNOWN',
                name: 'EmulatorCrashError',
                message: 'Refusing to save crashed emulator state: Terminal CPU deadlock (PC: 0x0150, SP: 0xDFF0)',
            });
            assert.ok(reconstructed instanceof EmulatorCrashError, 'Must reconstruct as EmulatorCrashError instance');
            assert.strictEqual(reconstructed.name, 'EmulatorCrashError');
            assert.ok(reconstructed.message.includes('Refusing to save crashed emulator state'));
        });
    } finally {
        tempHandle.cleanup();
    }
});
