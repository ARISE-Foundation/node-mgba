import test from 'node:test';
import assert from 'node:assert/strict';
import { MgbaEmulator } from '../src/index.js';
import { getTestRomPath, hasTestRom } from './helpers/rom.js';

test('Turbo Headless Throughput & Performance', async (t) => {
    if (!hasTestRom()) {
        t.skip('Test ROM fixture not found (set ROM_PATH to run)');
        return;
    }
    const romPath = getTestRomPath();
    const emulator = new MgbaEmulator();
    await emulator.loadROM(romPath);

    await t.test('1. Should achieve high-throughput turbo emulation (> 1000 FPS)', async () => {
        const frameCount = 1200;
        const startMem = process.memoryUsage().heapUsed;
        const startTime = Date.now();

        await emulator.step(frameCount);

        const durationMs = Date.now() - startTime;
        const fps = (frameCount / Math.max(1, durationMs)) * 1000;
        const endMem = process.memoryUsage().heapUsed;

        console.log(`Stepped ${frameCount} frames in ${durationMs}ms (~${Math.round(fps)} FPS)`);
        console.log(`Heap delta: ${Math.round((endMem - startMem) / 1024)} KB`);

        assert.ok(
            fps > 1000,
            `Expected turbo emulation to exceed 1000 FPS, achieved: ${Math.round(fps)} FPS (${durationMs}ms)`,
        );
    });

    emulator.close();
});
