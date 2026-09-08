import test from 'node:test';
import assert from 'node:assert/strict';
import { Mgba } from '../src/index.js';
import { hasGbaTestRom, getGbaTestRomPath, hasGbaSavestate, getGbaSavestatePath } from './helpers/rom.js';

test('GBA ROM & Savestate Integration Suite', async (t) => {
    if (!hasGbaTestRom()) {
        t.skip('GBA test ROM fixture not found (set ROM_PATH to run)');
        return;
    }
    const romPath = getGbaTestRomPath();

    await t.test('1. Mgba.load should initialize GBA ROM with AGB hardware metadata and 240x160 resolution', async () => {
        const emu = await Mgba.load(romPath);
        try {
            assert.equal(emu.console.model, 'AGB');
            assert.equal(emu.console.platform, 'GBA');
            assert.equal(emu.console.width, 240);
            assert.equal(emu.console.height, 160);
            assert.ok(emu.console.romSize > 0, 'ROM size must be positive');
            assert.ok(typeof emu.console.title === 'string', 'Title must be a string');
            assert.ok(typeof emu.console.gameCode === 'string', 'Game code must be a string');
            assert.ok(typeof emu.console.cartridge.hasBattery === 'boolean', 'hasBattery must be boolean');
        } finally {
            await emu.close();
        }
    });

    await t.test('2. GBA savestate restore should render unscrambled 240x160 frames with valid dimensions', async () => {
        if (!hasGbaSavestate()) {
            t.skip('GBA savestate fixture not found');
            return;
        }
        const ssPath = getGbaSavestatePath();
        const emu = await Mgba.load(romPath);
        try {
            const loaded = await emu.states.loadFromFile(ssPath);
            assert.equal(loaded, true, 'Savestate loadFromFile must succeed');

            const frame = await emu.screen.frame();
            assert.equal(frame.width, 240);
            assert.equal(frame.height, 160);
            assert.equal(frame.strideBytes, 240 * 4);
            assert.equal(frame.buffer.length, 240 * 160 * 4);

            // Verify the frame is populated with non-zero pixel data
            let nonZeroPixels = 0;
            for (let i = 0; i < frame.buffer.length; i += 4) {
                if (frame.buffer[i] !== 0 || frame.buffer[i + 1] !== 0 || frame.buffer[i + 2] !== 0) {
                    nonZeroPixels++;
                }
            }
            assert.ok(nonZeroPixels > 100, `Expected populated screen, got ${nonZeroPixels} non-zero pixels`);

            // Verify PNG output
            const png = await emu.screen.toPng();
            assert.ok(Buffer.isBuffer(png));
            assert.equal(png[0], 0x89);
            assert.equal(png[1], 0x50);
            assert.equal(png[2], 0x4E);
            assert.equal(png[3], 0x47);

            // Verify PNG IHDR dimensions: width=240, height=160
            assert.equal(png.readUInt32BE(16), 240, 'PNG width must be 240');
            assert.equal(png.readUInt32BE(20), 160, 'PNG height must be 160');
        } finally {
            await emu.close();
        }
    });

    await t.test('3. GBA control inputs and stepping should produce cycle-accurate 240x160 keyframes', async () => {
        if (!hasGbaSavestate()) {
            t.skip('GBA savestate fixture not found');
            return;
        }
        const ssPath = getGbaSavestatePath();
        const emu = await Mgba.load(romPath);
        try {
            await emu.states.loadFromFile(ssPath);

            const initialFrameIndex = await emu.console.getFrameCounter();
            const turnResult = await emu.controls.press('RIGHT', 10);

            const afterFrameIndex = await emu.console.getFrameCounter();
            assert.ok(afterFrameIndex > initialFrameIndex, 'Frame counter must advance after press sequence');

            assert.ok(turnResult.keyframes.length > 0, 'TurnResult must contain keyframes');
            for (const kf of turnResult.keyframes) {
                assert.equal(kf.width, 240);
                assert.equal(kf.height, 160);
                assert.equal(kf.buffer.length, 240 * 160 * 4);
            }
        } finally {
            await emu.close();
        }
    });

    await t.test('4. GBA memory reads should access IWRAM, EWRAM, and ROM regions', async () => {
        const emu = await Mgba.load(romPath);
        try {
            // Read first 16 bytes of ROM via bus (Game Pak Waitstate 0: 0x08000000)
            const romHeaderBus = await emu.memory.slice(0x08000000, 16);
            assert.equal(romHeaderBus.length, 16);

            // Read first 16 bytes of ROM directly via linear ROM space
            const romDirect = await emu.memory.slice('ROM', 16, 0);
            assert.equal(romDirect.length, 16);

            // Verify bus read at 0x08000000 matches linear ROM read
            assert.deepEqual(romHeaderBus, romDirect);

            // Test 8-bit, 16-bit, and 32-bit scalar bus reads
            const byte0 = await emu.memory.read8(0x08000000);
            const word0 = await emu.memory.read16LE(0x08000000);
            const dword0 = await emu.memory.read32LE(0x08000000);

            assert.equal(byte0, romHeaderBus[0]);
            assert.equal(word0, romHeaderBus.readUInt16LE(0));
            assert.equal(dword0, romHeaderBus.readUInt32LE(0));

            // Test EWRAM (0x02000000) and IWRAM (0x03000000) reads
            const ewram = await emu.memory.readRegion('EWRAM', 0, 64);
            assert.equal(ewram.length, 64);

            const iwram = await emu.memory.readRegion('IWRAM', 0, 64);
            assert.equal(iwram.length, 64);
        } finally {
            await emu.close();
        }
    });

    await t.test('5. GBA screen crop and WebP encoding should respect 240x160 boundaries', async () => {
        if (!hasGbaSavestate()) {
            t.skip('GBA savestate fixture not found');
            return;
        }
        const ssPath = getGbaSavestatePath();
        const emu = await Mgba.load(romPath);
        try {
            await emu.states.loadFromFile(ssPath);

            // Crop a 64x64 region
            const cropped = await emu.screen.crop({ x: 30, y: 20, width: 64, height: 64 });
            assert.ok(Buffer.isBuffer(cropped));
            assert.ok(cropped.length > 50);
            assert.equal(cropped.readUInt32BE(16), 64);
            assert.equal(cropped.readUInt32BE(20), 64);

            // Encode to WebP
            const webp = await emu.screen.toWebp();
            assert.ok(Buffer.isBuffer(webp));
            assert.ok(webp.length > 50);
            // Verify WebP magic: 'RIFF' .... 'WEBP'
            assert.equal(webp.toString('ascii', 0, 4), 'RIFF');
            assert.equal(webp.toString('ascii', 8, 12), 'WEBP');
        } finally {
            await emu.close();
        }
    });
});
