import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { unpackMgbaPngBuffer } from '../src/utils/savestate.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test('Savestate PNG Container Unpacking Suite', async (t) => {
    await t.test('1. unpackMgbaPngBuffer extracts raw uncompressed state from GBA PNG savestate', () => {
        const fixturePath = path.resolve(__dirname, 'fixtures/homebrew/test_gba.ss0');
        if (!fs.existsSync(fixturePath)) {
            t.skip('GBA savestate fixture not found');
            return;
        }

        const pngBuffer = fs.readFileSync(fixturePath);
        const unpacked = unpackMgbaPngBuffer(pngBuffer);

        assert.ok(unpacked !== null, 'Expected non-null unpacked buffer');
        assert.ok(Buffer.isBuffer(unpacked), 'Expected Buffer instance');
        // GBA raw mState size is typically ~397 KB (397,312 bytes)
        assert.ok(unpacked.length > 300000, `Expected GBA state > 300KB, got ${unpacked.length} bytes`);
        // Verify mState magic bytes
        assert.equal(unpacked[0], 0x0b);
        assert.equal(unpacked[1], 0x00);
        assert.equal(unpacked[2], 0x00);
        assert.equal(unpacked[3], 0x01);
    });

    await t.test('2. unpackMgbaPngBuffer extracts raw uncompressed state from GB PNG savestate', () => {
        const fixturePath = path.resolve(__dirname, 'fixtures/homebrew/test_gb.ss0');
        if (!fs.existsSync(fixturePath)) {
            t.skip('GB savestate fixture not found');
            return;
        }

        const pngBuffer = fs.readFileSync(fixturePath);
        const unpacked = unpackMgbaPngBuffer(pngBuffer);

        assert.ok(unpacked !== null, 'Expected non-null unpacked buffer');
        assert.ok(Buffer.isBuffer(unpacked), 'Expected Buffer instance');
        // GB raw mState size is typically 70-72 KB (71,680 bytes)
        assert.ok(unpacked.length >= 70000, `Expected GB state >= 70KB, got ${unpacked.length} bytes`);
    });

    await t.test('3. unpackMgbaPngBuffer returns null for non-PNG buffers', () => {
        const rawBuffer = Buffer.from([0x01, 0x02, 0x03, 0x04, 0x05]);
        assert.strictEqual(unpackMgbaPngBuffer(rawBuffer), null);

        const emptyBuffer = Buffer.alloc(0);
        assert.strictEqual(unpackMgbaPngBuffer(emptyBuffer), null);
    });

    await t.test('4. unpackMgbaPngBuffer returns null for standard PNGs lacking mGBA state chunks', () => {
        // Standard PNG 1x1 pixel image without gbAs/gbaS chunks
        const standardPng = Buffer.from(
            '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082',
            'hex',
        );
        assert.strictEqual(unpackMgbaPngBuffer(standardPng), null);
    });
});
