import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { Mgba } from '../src/Mgba.js';
import {
    BackgroundLayerRenderer,
    computeMeanLuminance,
    type GbaBackgroundRegisters,
    type GbBackgroundRegisters,
} from '../src/graphics/index.js';
import {
    hasGbaTestRom,
    getGbaTestRomPath,
    hasGbaSavestate,
    getGbaSavestatePath,
    hasTestRom,
    getHomebrewGbRomPath,
    getHomebrewGbSavestatePath,
} from './helpers/rom.js';

test('Background Layer Rendering Suite', async (suite) => {
    await suite.test('1. Luminance calculation: pure black = 0.0, pure white = 1.0, and weighted RGB', () => {
        // Pure black 2x2 RGBA
        const blackBuf = Buffer.alloc(16, 0);
        // Alpha set to 255 to ensure alpha is ignored in luminance
        for (let i = 0; i < 16; i += 4) blackBuf[i + 3] = 255;
        assert.equal(computeMeanLuminance(blackBuf), 0.0);

        // Pure white 2x2 RGBA
        const whiteBuf = Buffer.alloc(16);
        for (let i = 0; i < 16; i += 4) {
            whiteBuf[i] = 255;
            whiteBuf[i + 1] = 255;
            whiteBuf[i + 2] = 255;
            whiteBuf[i + 3] = 255;
        }
        assert.ok(Math.abs(computeMeanLuminance(whiteBuf) - 1.0) < 1e-6);

        // Pure Red: (0.299 * 255) / 255 = 0.299
        const redBuf = Buffer.from([255, 0, 0, 255]);
        assert.ok(Math.abs(computeMeanLuminance(redBuf) - 0.299) < 1e-6);

        // Pure Green: (0.587 * 255) / 255 = 0.587
        const greenBuf = Buffer.from([0, 255, 0, 255]);
        assert.ok(Math.abs(computeMeanLuminance(greenBuf) - 0.587) < 1e-6);

        // Pure Blue: (0.114 * 255) / 255 = 0.114
        const blueBuf = Buffer.from([0, 0, 255, 255]);
        assert.ok(Math.abs(computeMeanLuminance(blueBuf) - 0.114) < 1e-6);
    });

    await suite.test('2. GBA Mode 0 decoding with multiple layers and priority blending', () => {
        const vram = Buffer.alloc(0x18000); // 96 KB
        const palette = Buffer.alloc(512);

        // Palette setup:
        // Palette 0: color 0 = transparent, color 1 = Red (0x001F)
        palette.writeUInt16LE(0x0000, 0);
        palette.writeUInt16LE(0x001F, 2); // BGR555 Red: R=31, G=0, B=0

        // Palette 1: color 0 = transparent, color 1 = Blue (0x7C00)
        palette.writeUInt16LE(0x0000, 32);
        palette.writeUInt16LE(0x7C00, 34); // BGR555 Blue: R=0, G=0, B=31

        // Tile data in Char Block 0 (offset 0):
        // Tile 0: all color 0 (transparent)
        // Tile 1: solid color 1 (0x11111111 repeated across 8 rows)
        const tile1Offset = 32;
        for (let r = 0; r < 8; r++) {
            vram.writeUInt32LE(0x11111111, tile1Offset + r * 4);
        }

        // BG1: Screen Base Block 28 (offset 28 * 0x800 = 0xE000). Priority 2 (lower priority).
        // Fill Tile (0, 0) with Tile 1, Palette 0 (Red).
        const bg1MapOffset = 28 * 0x800;
        vram.writeUInt16LE(0x0001, bg1MapOffset); // Tile 1, Palette 0

        // BG2: Screen Base Block 29 (offset 29 * 0x800 = 0xE800). Priority 1 (higher priority, foreground).
        // Tile (0, 0) is Tile 0 (transparent) -> BG1 (Red) should show through.
        // Tile (1, 0) is Tile 1, Palette 1 (Blue) -> BG2 (Blue) should render.
        const bg2MapOffset = 29 * 0x800;
        vram.writeUInt16LE(0x0000, bg2MapOffset); // Tile 0 (transparent) at (0, 0)
        vram.writeUInt16LE(0x1001, bg2MapOffset + 2); // Tile 1, Palette 1 at (1, 0)

        // DISPCNT: Mode 0 (bits 0-2 = 0), BG1 enabled (bit 9), BG2 enabled (bit 10)
        const dispcnt = (1 << 9) | (1 << 10);
        // BG1CNT: Priority 2, CharBase 0, ScreenBase 28, Size 0 (32x32) -> 2 | (28 << 8) = 0x1C02
        const bg1cnt = 2 | (28 << 8);
        // BG2CNT: Priority 1, CharBase 0, ScreenBase 29, Size 0 (32x32) -> 1 | (29 << 8) = 0x1D01
        const bg2cnt = 1 | (29 << 8);

        const regs: GbaBackgroundRegisters = {
            dispcnt,
            bgCnt: [0, bg1cnt, bg2cnt, 0],
            bgHofs: [0, 16, 16, 0],
            bgVofs: [0, 24, 24, 0],
        };

        const result = BackgroundLayerRenderer.renderGba(vram, palette, regs);

        assert.equal(result.isTiledMode, true);
        assert.equal(result.width, 256);
        assert.equal(result.height, 256);
        assert.equal(result.scrollX, 16);
        assert.equal(result.scrollY, 24);
        assert.deepEqual(result.layersRendered, [1, 2]);

        // Verify pixel at (0, 0): BG1's Red shows through because BG2 is transparent at (0, 0)
        assert.equal(result.buffer[0], 255, 'R at (0,0) must be 255 from BG1 Red');
        assert.equal(result.buffer[1], 0, 'G at (0,0) must be 0');
        assert.equal(result.buffer[2], 0, 'B at (0,0) must be 0');
        assert.equal(result.buffer[3], 255, 'A at (0,0) must be 255');

        // Verify pixel at (8, 0): BG2's Blue renders on top
        const pxOffset = 8 * 4;
        assert.equal(result.buffer[pxOffset], 0, 'R at (8,0) must be 0');
        assert.equal(result.buffer[pxOffset + 1], 0, 'G at (8,0) must be 0');
        assert.equal(result.buffer[pxOffset + 2], 255, 'B at (8,0) must be 255 from BG2 Blue');
        assert.equal(result.buffer[pxOffset + 3], 255, 'A at (8,0) must be 255');
    });

    await suite.test('3. GBA exclusion of layer 0 by default and include/exclude overrides', () => {
        const vram = Buffer.alloc(0x18000);
        const palette = Buffer.alloc(512);

        // DISPCNT: Mode 0, BG0, BG1, BG2 enabled
        const dispcnt = (1 << 8) | (1 << 9) | (1 << 10);
        const regs: GbaBackgroundRegisters = {
            dispcnt,
            bgCnt: [0, 0, 0, 0],
            bgHofs: [0, 0, 0, 0],
            bgVofs: [0, 0, 0, 0],
        };

        // Default options: excludes layer 0
        const defaultResult = BackgroundLayerRenderer.renderGba(vram, palette, regs);
        assert.deepEqual(defaultResult.layersRendered, [1, 2]);

        // Explicit includeLayers: [0] overrides default exclusion
        const include0Result = BackgroundLayerRenderer.renderGba(vram, palette, regs, { includeLayers: [0] });
        assert.deepEqual(include0Result.layersRendered, [0]);

        // Explicit excludeLayers: [1] keeps 0 and 2
        const exclude1Result = BackgroundLayerRenderer.renderGba(vram, palette, regs, { excludeLayers: [1] });
        assert.deepEqual(exclude1Result.layersRendered, [0, 2]);

        // Non-tiled mode (Mode 1, 2, 3, etc.)
        const nonTiledRegs: GbaBackgroundRegisters = {
            ...regs,
            dispcnt: dispcnt | 3, // Mode 3
        };
        const nonTiledResult = BackgroundLayerRenderer.renderGba(vram, palette, nonTiledRegs);
        assert.equal(nonTiledResult.isTiledMode, false);
        assert.deepEqual(nonTiledResult.layersRendered, []);
    });

    await suite.test('4. Game Boy DMG background decoding with unsigned and signed tile addressing', () => {
        const vram = Buffer.alloc(0x2000); // 8 KB DMG VRAM

        // Create Tile 0 at 0x0000: Color 0 (blank)
        // Create Tile 1 at 0x0010: Color 3 (darkest)
        for (let r = 0; r < 8; r++) {
            vram[0x0010 + r * 2] = 0xFF;     // Bitplane 0
            vram[0x0010 + r * 2 + 1] = 0xFF; // Bitplane 1 -> color index 3
        }

        // Create Tile 128 (signed -128) at 0x0800 (address 0x8800): Color 1
        for (let r = 0; r < 8; r++) {
            vram[0x0800 + r * 2] = 0xFF;     // Bitplane 0
            vram[0x0800 + r * 2 + 1] = 0x00; // Bitplane 1 -> color index 1
        }

        // Put Tile 1 at (0, 0) of 0x9800 tilemap (offset 0x1800)
        vram[0x1800] = 1;

        // BGP = 0xE4 (standard palette: 0->0 (white), 1->1 (light gray), 2->2 (dark gray), 3->3 (black))
        // LCDC: LCD enable (0x80), BG unsigned 0x8000 (0x10), BG tilemap 0x9800 (0x00), BG enable (0x01) -> 0x91
        const regs: GbBackgroundRegisters = {
            lcdc: 0x91,
            scx: 4,
            scy: 8,
            bgp: 0xE4,
        };

        const resultUnsigned = BackgroundLayerRenderer.renderGb(vram, regs);
        assert.equal(resultUnsigned.isTiledMode, true);
        assert.equal(resultUnsigned.width, 256);
        assert.equal(resultUnsigned.height, 256);
        assert.equal(resultUnsigned.scrollX, 4);
        assert.equal(resultUnsigned.scrollY, 8);
        assert.deepEqual(resultUnsigned.layersRendered, [0]);
        // Tile 1 has color index 3 -> shade 3 (black: 255 - 3*85 = 0)
        assert.equal(resultUnsigned.buffer[0], 0, 'R must be 0 for shade 3');
        assert.equal(resultUnsigned.buffer[3], 255, 'A must be 255');

        // Now test signed addressing: LCDC bit 4 = 0 (0x8800 signed)
        // Put Tile 128 at (0, 0) of 0x9800
        vram[0x1800] = 128;
        const regsSigned: GbBackgroundRegisters = {
            ...regs,
            lcdc: 0x81, // bit 4 cleared
        };
        const resultSigned = BackgroundLayerRenderer.renderGb(vram, regsSigned);
        // Tile 128 has color index 1 -> shade 1 (light gray: 255 - 1*85 = 170)
        assert.equal(resultSigned.buffer[0], 170, 'R must be 170 for shade 1');

        // Test LCD disabled (bit 7 = 0)
        const disabledResult = BackgroundLayerRenderer.renderGb(vram, { ...regs, lcdc: 0x11 });
        assert.equal(disabledResult.isTiledMode, false);
        assert.deepEqual(disabledResult.layersRendered, []);
    });

    await suite.test('5. Game Boy CGB background decoding with bank 1 attributes and CGB palette', () => {
        const vram = Buffer.alloc(0x4000); // 16 KB CGB VRAM
        const cgbPalette = Buffer.alloc(64); // 8 palettes of 4 colors * 2 bytes

        // Palette 2: color 1 = Green (0x03E0)
        const pal2Offset = (2 * 4 + 1) * 2;
        cgbPalette.writeUInt16LE(0x03E0, pal2Offset); // BGR555: R=0, G=31, B=0

        // Tile 5 in Bank 1 (offset 0x2000 + 5 * 16 = 0x2050): Color 1
        const tileOffset = 0x2000 + 5 * 16;
        for (let r = 0; r < 8; r++) {
            vram[tileOffset + r * 2] = 0xFF;     // Bitplane 0
            vram[tileOffset + r * 2 + 1] = 0x00; // Bitplane 1 -> color index 1
        }

        // Tilemap at 0x9800 (offset 0x1800): tileId = 5
        vram[0x1800] = 5;
        // Tilemap Bank 1 attributes at offset 0x2000 + 0x1800 = 0x3800:
        // Palette 2 (bits 0-2 = 2), VRAM Bank 1 (bit 3 = 1) -> 2 | 8 = 10
        vram[0x3800] = 10;

        const regs: GbBackgroundRegisters = {
            lcdc: 0x91, // LCD enable, 0x8000 unsigned, 0x9800 map, BG enable
            scx: 0,
            scy: 0,
            bgp: 0xE4,
        };

        const result = BackgroundLayerRenderer.renderGb(vram, regs, { isCgb: true, cgbPalette });
        assert.equal(result.isTiledMode, true);
        assert.equal(result.width, 256);
        assert.equal(result.height, 256);
        // Green from Palette 2: R=0, G=255, B=0
        assert.equal(result.buffer[0], 0, 'R must be 0');
        assert.equal(result.buffer[1], 255, 'G must be 255 from CGB green palette');
        assert.equal(result.buffer[2], 0, 'B must be 0');
        assert.equal(result.buffer[3], 255, 'A must be 255');
    });

    await suite.test('6. End-to-end Mgba.screen.renderBackgroundLayers() and PNG sample generation', async () => {
        const scratchDir = path.resolve('scratch');
        if (!fs.existsSync(scratchDir)) {
            fs.mkdirSync(scratchDir, { recursive: true });
        }

        // Test GBA: load Sors overworld state from fixtures, otherwise test_gba.gba
        const sorsRomPath = path.resolve('../mgba-ai-player/roms/pokemon_sors_v1.3.gba');
        const sorsSsPath = path.resolve('fixtures/sors_overworld.ss0');

        let gbaRomToLoad: string | null = null;
        let gbaSsToLoad: string | null = null;

        if (fs.existsSync(sorsRomPath) && fs.existsSync(sorsSsPath)) {
            gbaRomToLoad = sorsRomPath;
            gbaSsToLoad = sorsSsPath;
        } else if (hasGbaTestRom() && hasGbaSavestate()) {
            gbaRomToLoad = getGbaTestRomPath();
            gbaSsToLoad = getGbaSavestatePath();
        }

        if (gbaRomToLoad && gbaSsToLoad) {
            const emu = await Mgba.load(gbaRomToLoad);
            try {
                await emu.states.loadFromFile(gbaSsToLoad);

                // Call emu.screen.renderBackgroundLayers()
                const renderRes = await emu.screen.renderBackgroundLayers();
                assert.ok(renderRes.width >= 256);
                assert.ok(renderRes.height >= 256);
                assert.equal(renderRes.isTiledMode, true);
                assert.ok(renderRes.buffer.length >= 256 * 256 * 4);
                assert.ok(typeof renderRes.meanLuminance === 'number');
                assert.ok(renderRes.meanLuminance >= 0.0 && renderRes.meanLuminance <= 1.0);

                // Save PNG output to scratch/checkpoint1_gba.png
                const gbaPngPath = path.join(scratchDir, 'checkpoint1_gba.png');
                await sharp(renderRes.buffer, {
                    raw: { width: renderRes.width, height: renderRes.height, channels: 4 },
                })
                    .png()
                    .toFile(gbaPngPath);
                assert.ok(fs.existsSync(gbaPngPath), 'checkpoint1_gba.png must exist');
                const stat = fs.statSync(gbaPngPath);
                assert.ok(stat.size > 100, 'checkpoint1_gba.png must not be empty');
            } finally {
                await emu.close();
            }
        }

        // Test GB: load Pokémon Blue overworld state if available, otherwise test_gb.gb
        const pokemonBluePath = path.resolve('fixtures/pokemon_blue.gb');
        const overworldStatePath = path.resolve('fixtures/redblue_overworld.ss0');

        let gbRomToLoad: string | null = null;
        let gbSsToLoad: string | null = null;

        if (fs.existsSync(pokemonBluePath) && fs.existsSync(overworldStatePath)) {
            gbRomToLoad = pokemonBluePath;
            gbSsToLoad = overworldStatePath;
        } else if (hasTestRom()) {
            gbRomToLoad = getHomebrewGbRomPath();
            gbSsToLoad = getHomebrewGbSavestatePath();
        }

        if (gbRomToLoad && gbSsToLoad) {
            const emu = await Mgba.load(gbRomToLoad);
            try {
                await emu.states.loadFromFile(gbSsToLoad);

                const gbRenderRes = await emu.screen.renderBackgroundLayers();
                assert.equal(gbRenderRes.width, 256);
                assert.equal(gbRenderRes.height, 256);
                assert.equal(gbRenderRes.isTiledMode, true);
                assert.equal(gbRenderRes.buffer.length, 256 * 256 * 4);
                assert.deepEqual(gbRenderRes.layersRendered, [0]);
                assert.ok(gbRenderRes.meanLuminance >= 0.0 && gbRenderRes.meanLuminance <= 1.0);

                // Save PNG output to scratch/checkpoint1_gb.png
                const gbPngPath = path.join(scratchDir, 'checkpoint1_gb.png');
                await sharp(gbRenderRes.buffer, {
                    raw: { width: gbRenderRes.width, height: gbRenderRes.height, channels: 4 },
                })
                    .png()
                    .toFile(gbPngPath);
                assert.ok(fs.existsSync(gbPngPath), 'checkpoint1_gb.png must exist');
                const stat = fs.statSync(gbPngPath);
                assert.ok(stat.size > 100, 'checkpoint1_gb.png must not be empty');
            } finally {
                await emu.close();
            }
        }
    });
});
