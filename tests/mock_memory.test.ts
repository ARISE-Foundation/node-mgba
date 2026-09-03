import test from 'node:test';
import assert from 'node:assert/strict';
import { createMockMemoryReader } from '../src/index.js';

test('MockMemoryReader - Unit Tests', async (t) => {
    await t.test('1. Fluent writes across WRAM, HRAM, SRAM, VRAM, and ROM slices', () => {
        const mem = createMockMemoryReader();

        mem.writeU8(0x0100, 0xAA)       // ROM
           .writeU8(0x8000, 0xBB)       // VRAM
           .writeU8(0xA000, 0xCC)       // SRAM
           .writeU8(0xC000, 0xDD)       // WRAM
           .writeU8(0xFF80, 0xEE)       // HRAM
           .writeU8(0xFFFF, 0x1F);      // IE register

        assert.equal(mem.readU8(0x0100), 0xAA);
        assert.equal(mem.readU8(0x8000), 0xBB);
        assert.equal(mem.readU8(0xA000), 0xCC);
        assert.equal(mem.readU8(0xC000), 0xDD);
        assert.equal(mem.readU8(0xFF80), 0xEE);
        assert.equal(mem.readU8(0xFFFF), 0x1F);
    });

    await t.test('2. writeString handles custom character maps and terminators', () => {
        const charMap: Record<number, string> = {
            0x80: 'P',
            0x81: 'I',
            0x82: 'K',
            0x83: 'A',
            0x50: '@',
        };

        const mem = createMockMemoryReader();
        mem.writeString(0xD16B, 'PIKA', { charMap, terminator: 0x50, fixedLength: 10 });

        const raw = mem.readString(0xD16B, 10, charMap, 0x50);
        assert.equal(raw, 'PIKA');
    });

    await t.test('3. writeBytes writes contiguous buffers', () => {
        const mem = createMockMemoryReader();
        mem.writeBytes(0xC000, [0x01, 0x02, 0x03, 0x04]);

        assert.equal(mem.readU8(0xC000), 0x01);
        assert.equal(mem.readU8(0xC001), 0x02);
        assert.equal(mem.readU8(0xC002), 0x03);
        assert.equal(mem.readU8(0xC003), 0x04);
        assert.equal(mem.readU32BE(0xC000), 0x01020304);
    });
});
