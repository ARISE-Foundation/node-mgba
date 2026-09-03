import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { SnapshotMemoryReader, type MemorySnapshotReader } from '../src/core/MemoryReader.js';

test('SnapshotMemoryReader Unit & Boundary Test Suite', async (t) => {
    const wram = Buffer.alloc(0x2000);
    const io = Buffer.alloc(0x80);
    const hram = Buffer.alloc(0x7F);
    const vram = Buffer.alloc(0x2000);
    const sram = Buffer.alloc(0x2000);
    const oam = Buffer.alloc(0xA0);
    const rom = Buffer.alloc(0x8000);

    // Populate test patterns
    wram[0x0000] = 0x42;
    wram[0x0001] = 0x13;
    wram[0x1FFF] = 0x99;

    io[0x00] = 0x01;
    io[0x7F] = 0x5A; // IO end at 0xFF7F

    hram[0x00] = 0x55;
    hram[0x7E] = 0xAA; // HRAM end at 0xFFFE

    vram[0x0000] = 0x88;
    sram[0x0000] = 0x77;
    oam[0x00] = 0x33;
    rom[0x0000] = 0xC3;
    rom[0x0100] = 0x00;

    const reader = new SnapshotMemoryReader({
        wram,
        io,
        hram,
        ie: 0x1F,
        vram,
        sram,
        oam,
        rom,
    });

    await t.test('1. Should read correctly across all Game Boy memory regions', () => {
        assert.equal(reader.readU8(0x0000), 0xC3); // ROM
        assert.equal(reader.readU8(0x8000), 0x88); // VRAM
        assert.equal(reader.readU8(0xA000), 0x77); // SRAM
        assert.equal(reader.readU8(0xC000), 0x42); // WRAM
        assert.equal(reader.readU8(0xC001), 0x13); // WRAM
        assert.equal(reader.readU8(0xDFFF), 0x99); // WRAM end
        assert.equal(reader.readU8(0xFE00), 0x33); // OAM
        assert.equal(reader.readU8(0xFF00), 0x01); // IO
        assert.equal(reader.readU8(0xFF7F), 0x5A); // IO end
        assert.equal(reader.readU8(0xFF80), 0x55); // HRAM
        assert.equal(reader.readU8(0xFFFE), 0xAA); // HRAM end
        assert.equal(reader.readU8(0xFFFF), 0x1F); // IE
    });

    await t.test('2. Should mirror Echo RAM (0xE000..0xFDFF) to WRAM (0xC000..0xDDFF)', () => {
        assert.equal(reader.readU8(0xE000), 0x42); // Mirrors 0xC000
        assert.equal(reader.readU8(0xE001), 0x13); // Mirrors 0xC001
    });

    await t.test('3. Should read multi-byte little-endian and big-endian integers', () => {
        assert.equal(reader.readU16LE(0xC000), 0x1342);
        assert.equal(reader.readU16BE(0xC000), 0x4213);

        wram[0x0002] = 0x01;
        wram[0x0003] = 0x02;
        assert.equal(reader.readU24LE(0xC000), 0x011342);
        assert.equal(reader.readU24BE(0xC000), 0x421301);
        assert.equal(reader.readU32LE(0xC000), 0x02011342);
    });

    await t.test('4. Should decode BCD integers and bit flags and reject invalid BCD nibbles', () => {
        wram[0x0010] = 0x12;
        wram[0x0011] = 0x34;
        wram[0x0012] = 0x56;

        assert.equal(reader.readBCD(0xC010, 1), 12);
        assert.equal(reader.readBCD(0xC010, 3), 123456);

        // Invalid BCD nibble throws RangeError
        wram[0x0013] = 0x1A;
        assert.throws(() => reader.readBCD(0xC013, 1), RangeError);

        // Invalid length throws RangeError
        assert.throws(() => reader.readBCD(0xC010, 0), RangeError);
        assert.throws(() => reader.readBCD(0xC010, -1), RangeError);

        wram[0x0020] = 0b00100101; // bits 0, 2, 5 set
        assert.equal(reader.readBit(0xC020, 0), true);
        assert.equal(reader.readBit(0xC020, 1), false);
        assert.equal(reader.readBit(0xC020, 2), true);
        assert.equal(reader.readBit(0xC020, 3), false);
        assert.equal(reader.readBit(0xC020, 5), true);
        assert.equal(reader.readBit(0xC020, 7), false);

        // Invalid bitIndex throws RangeError
        assert.throws(() => reader.readBit(0xC020, 8), RangeError);
        assert.throws(() => reader.readBit(0xC020, -1), RangeError);
    });

    await t.test('5. Should decode strings using character map and terminator', () => {
        const charMap: Record<number, string> = {
            0x80: 'A',
            0x81: 'B',
            0x82: 'C',
            0x83: 'D',
        };
        wram[0x0030] = 0x80;
        wram[0x0031] = 0x81;
        wram[0x0032] = 0x82;
        wram[0x0033] = 0x50; // terminator
        wram[0x0034] = 0x83;

        const str = reader.readString(0xC030, 10, charMap, 0x50);
        assert.equal(str, 'ABC');
    });

    await t.test('6. Should read flat physical ROM offsets and verify exact byte content', () => {
        rom[0x1230] = 0xAA;
        rom[0x1231] = 0xBB;
        rom[0x1232] = 0xCC;
        rom[0x1233] = 0xDD;
        rom[0x1234] = 0xFE;

        assert.equal(reader.readRomU8(0x1234), 0xFE);

        const slice = reader.readRomBytes(0x1230, 4);
        assert.equal(slice.length, 4);
        assert.deepEqual(Buffer.from(slice), Buffer.from([0xAA, 0xBB, 0xCC, 0xDD]));

        assert.throws(() => reader.readRomU8(0x8000), RangeError);
        assert.throws(() => reader.readRomBytes(0x7FFE, 4), RangeError);
    });

    await t.test('7. Should strictly fail on missing or undersized mandatory slices with TypeError/RangeError', () => {
        assert.throws(
            () => new SnapshotMemoryReader({ io, hram } as unknown as import('../src/core/MemoryReader.js').SnapshotMemorySlices),
            TypeError
        );
        assert.throws(
            () => new SnapshotMemoryReader({ wram: Buffer.alloc(0x1000), io, hram }),
            RangeError
        );
        assert.throws(
            () => new SnapshotMemoryReader({ wram, io: Buffer.alloc(0x40), hram }),
            RangeError
        );
        assert.throws(
            () => new SnapshotMemoryReader({ wram, io, hram: Buffer.alloc(0x7E) }),
            RangeError
        );
        assert.throws(
            () => new SnapshotMemoryReader({ wram, io, hram, vram: Buffer.alloc(0x1000) }),
            RangeError
        );
        assert.throws(
            () => new SnapshotMemoryReader({ wram, io, hram, sram: Buffer.alloc(0x1000) }),
            RangeError
        );
        assert.throws(
            () => new SnapshotMemoryReader({ wram, io, hram, oam: Buffer.alloc(0x50) }),
            RangeError
        );
    });

    await t.test('8. Should reject out-of-range, non-integer, and prohibited bus addresses with TypeError/RangeError', () => {
        assert.throws(() => reader.readU8(-1), RangeError);
        assert.throws(() => reader.readU8(0x10000), RangeError);
        assert.throws(() => reader.readU8(NaN), TypeError);
        assert.throws(() => reader.readU8(Infinity), TypeError);
        assert.throws(() => reader.readU8(1.5), RangeError);

        // Prohibited region 0xFEA0..0xFEFF
        assert.throws(() => reader.readU8(0xFEA0), RangeError);
        assert.throws(() => reader.readU8(0xFEFF), RangeError);
    });

    await t.test('9. Should reject multi-byte reads that exceed bus address boundaries', () => {
        assert.throws(() => reader.readU16LE(0xFFFF), RangeError);
        assert.throws(() => reader.readU16BE(0xFFFF), RangeError);
        assert.throws(() => reader.readU24LE(0xFFFE), RangeError);
        assert.throws(() => reader.readU24BE(0xFFFE), RangeError);
        assert.throws(() => reader.readU32LE(0xFFFD), RangeError);
        assert.throws(() => reader.readBCD(0xFFFE, 3), RangeError);
    });

    await t.test('10. Should fail when reading absent optional slices', () => {
        const minimalReader = new SnapshotMemoryReader({
            wram,
            io,
            hram,
        });

        // Reading ROM when not provided throws Error
        assert.throws(() => minimalReader.readU8(0x0000), /ROM slice is required/);
        // Reading VRAM when not provided throws Error
        assert.throws(() => minimalReader.readU8(0x8000), /VRAM slice is required/);
        // Reading SRAM when not provided throws Error
        assert.throws(() => minimalReader.readU8(0xA000), /SRAM slice is required/);
        // Reading OAM when not provided throws Error
        assert.throws(() => minimalReader.readU8(0xFE00), /OAM slice is required/);
        // Reading IE when not provided throws Error
        assert.throws(() => minimalReader.readU8(0xFFFF), /IE register/);
    });

    await t.test('11. SnapshotMemoryReader.fromObservation should parse valid observation and reject missing mandatory slices', () => {
        const memory = new SnapshotMemoryReader({
            wram,
            io,
            hram,
            vram,
            rom,
        });
        const obsReader = SnapshotMemoryReader.fromObservation({ memory });
        assert.equal(obsReader.readU8(0xC000), 0x42);

        assert.throws(
            () => SnapshotMemoryReader.fromObservation({} as { memory?: MemorySnapshotReader }),
            TypeError
        );
        assert.throws(
            () => SnapshotMemoryReader.fromObservation(null as unknown as { memory?: MemorySnapshotReader }),
            TypeError
        );
    });
});
