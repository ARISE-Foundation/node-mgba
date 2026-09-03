import test from 'node:test';
import assert from 'node:assert/strict';
import { SpriteDecoder, TilemapDecoder } from '../src/index.js';

test('Graphics Decoders (SpriteDecoder & TilemapDecoder) Suite', async (t) => {
    await t.test('1. SpriteDecoder should correctly decode Game Boy OAM (40 sprites)', () => {
        const oamBuffer = Buffer.alloc(160);
        // Sprite 0: Y=32 (screen Y=16), X=16 (screen X=8), Tile=0x05, Attr=0x00
        oamBuffer.writeUInt8(32, 0);
        oamBuffer.writeUInt8(16, 1);
        oamBuffer.writeUInt8(0x05, 2);
        oamBuffer.writeUInt8(0x00, 3);

        // Sprite 1: Y=0 (disabled), X=0, Tile=0x00, Attr=0x20 (xFlip)
        oamBuffer.writeUInt8(0, 4);
        oamBuffer.writeUInt8(0, 5);
        oamBuffer.writeUInt8(0x00, 6);
        oamBuffer.writeUInt8(0x20, 7);

        const sprites = SpriteDecoder.decodeGb(oamBuffer, false, false);
        assert.equal(sprites.length, 40);

        const s0 = sprites[0];
        assert.ok(s0);
        assert.equal(s0.id, 0);
        assert.equal(s0.x, 8);
        assert.equal(s0.y, 16);
        assert.equal(s0.tileId, 5);
        assert.equal(s0.enabled, true);
        assert.equal(s0.intersectsViewport, true);
        assert.equal(s0.gb?.xFlip, false);

        const s1 = sprites[1];
        assert.ok(s1);
        assert.equal(s1.enabled, false);
        assert.equal(s1.gb?.xFlip, true);
    });

    await t.test('2. SpriteDecoder should decode GBA OAM (128 sprites)', () => {
        const oamBuffer = Buffer.alloc(1024);
        // Sprite 0: Attr0: Y=20, Shape=wide (1), 256-color (1)
        // Shape wide = 0x4000, 256-color = 0x2000, Y=20 -> 0x6014
        oamBuffer.writeUInt16LE(0x6014, 0);
        // Attr1: Size=1 (wide_1 = 32x8), X=50 -> 0x4032
        oamBuffer.writeUInt16LE(0x4032, 2);
        // Attr2: Tile=0x12, Priority=1 -> 0x0412
        oamBuffer.writeUInt16LE(0x0412, 4);

        const sprites = SpriteDecoder.decodeGba(oamBuffer);
        assert.equal(sprites.length, 128);

        const s0 = sprites[0];
        assert.ok(s0);
        assert.equal(s0.id, 0);
        assert.equal(s0.y, 20);
        assert.equal(s0.x, 50);
        assert.equal(s0.width, 32);
        assert.equal(s0.height, 8);
        assert.equal(s0.tileId, 0x12);
        assert.equal(s0.gba?.shape, 'wide');
        assert.equal(s0.gba?.colorMode, '256-color');
        assert.equal(s0.gba?.priority, 1);
    });

    await t.test('4. SpriteDecoder should decode GBA affine matrix and double size sprites', () => {
        const oamBuffer = Buffer.alloc(1024);
        // Sprite 0: Affine (bit 8 = 1), DoubleSize (bit 9 = 1), Shape=square (0), Y=10 -> 0x030A
        oamBuffer.writeUInt16LE(0x030A, 0);
        // Attr1: Size=1 (square_1 = 16x16 -> doubleSize = 32x32), AffineParamIndex=0, X=20 -> 0x4014
        oamBuffer.writeUInt16LE(0x4014, 2);
        // Attr2: Tile=0x01 -> 0x0001
        oamBuffer.writeUInt16LE(0x0001, 4);

        // Affine matrix 0 params in OAM entries 0..3:
        // entry 0 (offset 6): pa = 0x0100 (1.0)
        // entry 1 (offset 14): pb = 0x0000 (0.0)
        // entry 2 (offset 22): pc = 0x0000 (0.0)
        // entry 3 (offset 30): pd = 0x0100 (1.0)
        oamBuffer.writeInt16LE(0x0100, 6);
        oamBuffer.writeInt16LE(0x0000, 14);
        oamBuffer.writeInt16LE(0x0000, 22);
        oamBuffer.writeInt16LE(0x0100, 30);

        const sprites = SpriteDecoder.decodeGba(oamBuffer);
        const s0 = sprites[0];
        assert.ok(s0);
        assert.equal(s0.gba?.isAffine, true);
        assert.equal(s0.gba?.isDoubleSize, true);
        assert.equal(s0.width, 32); // 16 * 2
        assert.equal(s0.height, 32);
        assert.ok(s0.gba?.affineMatrix);
        assert.equal(s0.gba?.affineMatrix?.pa, 1.0);
        assert.equal(s0.gba?.affineMatrix?.pd, 1.0);
    });

    await t.test('5. TilemapDecoder should decode GBA affine tilemaps and bitmap modes', () => {
        const vramBuffer = Buffer.alloc(0x18000);
        // Test affine BG: 32x32 tiles, tile index at (1, 1) = 0x55
        vramBuffer.writeUInt8(0x55, 32 + 1);
        const affine = TilemapDecoder.decodeGbaAffine(vramBuffer, 0, { dimension: 32 });
        assert.equal(affine.type, 'affine');
        assert.equal(affine.width, 32);
        assert.equal(affine.tileGrid[1]?.[1], 0x55);

        // Test Mode 3 bitmap
        vramBuffer.writeUInt16LE(0x7FFF, 0); // white pixel
        const bmp3 = TilemapDecoder.decodeGbaBitmap(vramBuffer, 3);
        assert.equal(bmp3.mode, 3);
        assert.equal(bmp3.width, 240);
        assert.equal(bmp3.height, 160);
        assert.equal(bmp3.data.readUInt16LE(0), 0x7FFF);

        // Test Mode 4 bitmap (frame 1 at 0xA000)
        vramBuffer.writeUInt8(0x0A, 0xA000 + 5);
        const bmp4 = TilemapDecoder.decodeGbaBitmap(vramBuffer, 4, { frameIndex: 1 });
        assert.equal(bmp4.mode, 4);
        assert.equal(bmp4.frameIndex, 1);
        assert.equal(bmp4.data.readUInt8(5), 0x0A);
    });
});
