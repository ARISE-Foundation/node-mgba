import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { encodeVideoPacket, type VideoPacket } from '../src/index.js';

test('encodeVideoPacket Image Compression Suite', async (t) => {
    const rawBuffer = Buffer.alloc(160 * 144 * 4, 128);
    const packet: VideoPacket = {
        frameIndex: 1,
        pts: 0,
        width: 160,
        height: 144,
        strideBytes: 640,
        buffer: rawBuffer,
    };

    await t.test('1. Encodes raw VideoPacket to WebP buffer', async () => {
        const webpBuf = await encodeVideoPacket(packet, { format: 'webp', lossless: true });
        assert.ok(Buffer.isBuffer(webpBuf));
        assert.ok(webpBuf.length > 0);
        assert.equal(webpBuf.subarray(0, 4).toString('utf8'), 'RIFF');
        assert.equal(webpBuf.subarray(8, 12).toString('utf8'), 'WEBP');
    });

    await t.test('2. Encodes raw VideoPacket to PNG buffer', async () => {
        const pngBuf = await encodeVideoPacket(packet, { format: 'png' });
        assert.ok(Buffer.isBuffer(pngBuf));
        assert.ok(pngBuf.length > 0);
        // PNG magic header: 0x89 0x50 0x4E 0x47
        assert.equal(pngBuf[0], 0x89);
        assert.equal(pngBuf[1], 0x50);
        assert.equal(pngBuf[2], 0x4E);
        assert.equal(pngBuf[3], 0x47);
    });

    await t.test('3. Encodes raw VideoPacket to JPEG buffer', async () => {
        const jpegBuf = await encodeVideoPacket(packet, { format: 'jpeg', quality: 80 });
        assert.ok(Buffer.isBuffer(jpegBuf));
        assert.ok(jpegBuf.length > 0);
        // JPEG SOI magic header: 0xFF 0xD8
        assert.equal(jpegBuf[0], 0xFF);
        assert.equal(jpegBuf[1], 0xD8);
    });

    await t.test('4. Correctly unpacks and encodes padded-stride VideoPacket', async () => {
        const width = 160;
        const height = 144;
        const paddedStride = 800; // 800 bytes per row instead of 640
        const paddedBuffer = Buffer.alloc(paddedStride * height);

        // Fill each active row with 255
        for (let y = 0; y < height; y++) {
            paddedBuffer.fill(255, y * paddedStride, y * paddedStride + width * 4);
        }

        const paddedPacket: VideoPacket = {
            frameIndex: 1,
            pts: 0,
            width,
            height,
            strideBytes: paddedStride,
            buffer: paddedBuffer,
        };

        const pngBuf = await encodeVideoPacket(paddedPacket, { format: 'png' });
        assert.ok(Buffer.isBuffer(pngBuf));
        assert.ok(pngBuf.length > 0);
        assert.equal(pngBuf[0], 0x89);
    });
});
