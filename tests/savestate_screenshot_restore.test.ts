import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NativeMgbaCore } from '../src/core/NativeMgbaCore.js';
import { Mgba } from '../src/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test('Savestate Screenshot Frame Buffer Restoration Suite', async (t) => {
    const romPath = path.resolve(__dirname, 'fixtures/homebrew/test_gba.gba');
    const ssPath = path.resolve(__dirname, 'fixtures/homebrew/test_gba.ss0');

    await t.test('1. NativeMgbaCore.loadState restores savestate screenshot into video buffer before stepping', () => {
        const core = new NativeMgbaCore();
        core.loadROM(romPath);

        try {
            const loaded = core.loadState(ssPath);
            assert.strictEqual(loaded, true, 'Expected loadState to succeed');

            const videoPacket = core.getVideoFrame();
            assert.ok(videoPacket.buffer.length > 0, 'Video frame buffer must not be empty');

            let nonWhitePixels = 0;
            for (let i = 0; i < videoPacket.buffer.length; i += 4) {
                const r = videoPacket.buffer[i];
                const g = videoPacket.buffer[i + 1];
                const b = videoPacket.buffer[i + 2];
                if (r !== 255 || g !== 255 || b !== 255) {
                    nonWhitePixels++;
                }
            }

            // test_gba.ss0 contains 36,508 non-white pixels (not a blank white screen)
            assert.ok(
                nonWhitePixels > 1000,
                `Expected savestate screenshot to restore non-white pixels into video buffer, got ${nonWhitePixels}`,
            );
        } finally {
            core.close();
        }
    });

    await t.test('2. Mgba facade loadState restores savestate screenshot into emu.screen.frame() before stepping', async () => {
        const emu = await Mgba.load(romPath);

        try {
            const loaded = await emu.states.loadFromFile(ssPath);
            assert.strictEqual(loaded, true, 'Expected loadState on Mgba facade to succeed');

            const videoPacket = await emu.screen.frame();
            let nonWhitePixels = 0;
            for (let i = 0; i < videoPacket.buffer.length; i += 4) {
                const r = videoPacket.buffer[i];
                const g = videoPacket.buffer[i + 1];
                const b = videoPacket.buffer[i + 2];
                if (r !== 255 || g !== 255 || b !== 255) {
                    nonWhitePixels++;
                }
            }

            assert.ok(
                nonWhitePixels > 1000,
                `Expected emu.screen.frame() to contain restored screenshot, got ${nonWhitePixels}`,
            );
        } finally {
            await emu.close();
        }
    });
});

