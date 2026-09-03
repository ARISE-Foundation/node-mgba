import test from 'node:test';
import assert from 'node:assert/strict';
import { MgbaEmulator, type RomInfo } from '../src/index.js';
import { getTestRom, hasTestRom } from './helpers/rom.js';

test('Memory Domain & Endianness Vectors', async (t) => {
    if (!hasTestRom()) {
        t.skip('Test ROM fixture not found (set ROM_PATH to run)');
        return;
    }
    const testRom = getTestRom();
    const emulator = new MgbaEmulator();
    const romInfo = await emulator.loadROM(testRom.path);

    await t.test('1. Should validate ROM checksum and size', async () => {
        assert.ok(testRom.sizeBytes > 0, 'ROM size must be > 0 bytes');
        assert.equal(typeof testRom.sha256, 'string');
        assert.equal(testRom.sha256.length, 64, 'SHA-256 must be 64 hex characters');
    });

    await t.test('2. Should verify ROM and Bus header mapping parity', async () => {
        // Read Game Title from ROM space offset $0134-$013E (11 bytes)
        const romTitleBuf = emulator.core.read({ space: 'rom', offset: 0x0134, length: 11 }) as Buffer;
        const romTitle = romTitleBuf.toString('ascii').replace(/\0/g, '').trim();

        // Read Game Title via CPU bus address $0134-$013E
        const busTitleBuf = emulator.core.read({ space: 'bus', address: 0x0134, length: 11 }) as Buffer;
        const busTitle = busTitleBuf.toString('ascii').replace(/\0/g, '').trim();

        // Both ROM space and Bus space must resolve identical header data matching detected title
        assert.equal(busTitle, romTitle, 'Bus read and ROM space read must produce identical title header');
        assert.ok(romInfo.title.startsWith(romTitle.slice(0, 4)), 'Detected ROM title must match header bytes');

        // Read Cartridge Type at $0147 and ROM Size at $0148
        const cartType = emulator.core.read({ space: 'bus', address: 0x0147 });
        const romSizeCode = emulator.core.read({ space: 'bus', address: 0x0148 });
        assert.equal(typeof cartType, 'number');
        assert.equal(typeof romSizeCode, 'number');
    });

    await t.test('3. Should verify Big-Endian vs Little-Endian bus reading arithmetic', async () => {
        // Read 2 raw bytes at $014E-$014F (Global Checksum)
        const b0 = emulator.core.busRead8(0x014e);
        const b1 = emulator.core.busRead8(0x014f);

        const expectedBE = (b0 << 8) | b1;
        const expectedLE = (b1 << 8) | b0;

        assert.equal(emulator.core.busRead16BE(0x014e), expectedBE, 'busRead16BE arithmetic mismatch');
        assert.equal(emulator.core.busRead16LE(0x014e), expectedLE, 'busRead16LE arithmetic mismatch');
    });

    await t.test('5. Should correctly read banked ROM across different banks via batch API', () => {
        // Read byte at 0x4000 from Bank 1 (ROM offset 0x4000) and Bank 2 (ROM offset 0x8000)
        const [bank1Byte, bank2Byte] = emulator.core.readBatch([
            { address: 0x4000, bank: 1, type: 'u8' },
            { address: 0x4000, bank: 2, type: 'u8' },
        ]) as number[];

        const directBank1 = emulator.core.romRead8(0x4000);
        const directBank2 = emulator.core.romRead8(0x8000);

        assert.equal(bank1Byte, directBank1);
        assert.equal(bank2Byte, directBank2);
    });

    await t.test('6. Should enforce 32MB bounds on range reads', () => {
        assert.throws(() => {
            emulator.core.busReadRange(0x0000, 33 * 1024 * 1024);
        }, /Invalid bus read length/i);

        assert.throws(() => {
            emulator.core.readRegion('ROM', 0, 33 * 1024 * 1024);
        }, /Invalid region read length/i);
    });

    await t.test('7. Should expose verified cartridge metadata from ROM header', () => {
        const info = emulator.core.getRomInfo();
        assert.ok(info);
        assert.equal(typeof info.ramSize, 'number');
        assert.equal(typeof info.hasBattery, 'boolean');
        assert.equal(typeof info.hasRtc, 'boolean');
    });

    await t.test('8. Should enforce bank window boundaries on banked reads', () => {
        // Banked ROM reads at 0x7FFF with 2 bytes length (u16le) exceed the 16KB bank window and must be rejected
        assert.throws(() => {
            emulator.core.readBatch([
                { address: 0x7FFF, bank: 1, type: 'u16le' },
            ]);
        }, /Failed to execute native read_batch/i);
    });

    await t.test('9. Should reject out-of-range CGB bank numbers', () => {
        // VRAM bank 2 is invalid (only 0 and 1 exist on CGB)
        assert.throws(() => {
            emulator.core.readBatch([
                { address: 0x8000, bank: 2, type: 'u8' },
            ]);
        }, /Failed to execute native read_batch/i);

        // WRAM bank 8 is invalid (only 0..7 exist on CGB)
        assert.throws(() => {
            emulator.core.readBatch([
                { address: 0xD000, bank: 8, type: 'u8' },
            ]);
        }, /Failed to execute native read_batch/i);
    });

    await t.test('10. Should enforce strict scalar address bounds on NativeMgbaCore', () => {
        // Valid in-bounds write and read
        emulator.core.busWrite8(0xC000, 0x55);
        assert.equal(emulator.core.busRead8(0xC000), 0x55);

        emulator.core.busWrite16LE(0xC002, 0x1234);
        assert.equal(emulator.core.busRead16LE(0xC002), 0x1234);

        emulator.core.busWrite32LE(0xC004, 0x87654321);
        assert.equal(emulator.core.busRead32LE(0xC004), 0x87654321);

        // Out-of-bounds scalar address checks throw RangeError
        assert.throws(() => emulator.core.busRead8(0x10000), RangeError);
        assert.throws(() => emulator.core.busRead16LE(0xFFFF), RangeError);
        assert.throws(() => emulator.core.busRead16BE(0xFFFF), RangeError);
        assert.throws(() => emulator.core.busRead32LE(0xFFFD), RangeError);
        assert.throws(() => emulator.core.busWrite8(0x10000, 0), RangeError);
        assert.throws(() => emulator.core.busWrite16LE(0xFFFF, 0), RangeError);
        assert.throws(() => emulator.core.busWrite32LE(0xFFFD, 0), RangeError);
        assert.throws(() => emulator.core.busRead8(-1), RangeError);
    });

    await t.test('11. Should enforce GBA platform scalar address bounds (max: 0x10000000)', () => {
        // Temporarily simulate GBA platform on the core to verify GBA 256MB boundary logic
        const core = emulator.core as unknown as {
            romInfo: RomInfo;
            validateBusAddress: (addr: number, size: number) => number;
        };
        const origRomInfo = core.romInfo;
        try {
            core.romInfo = {
                ...origRomInfo,
                platform: 'GBA',
                model: 'AGB',
            };

            // In-bounds for GBA
            assert.equal(typeof core.validateBusAddress(0x02000000, 1), 'number');
            assert.equal(typeof core.validateBusAddress(0x0FFFFFFF, 1), 'number');
            assert.equal(typeof core.validateBusAddress(0x0FFFFFFE, 2), 'number');
            assert.equal(typeof core.validateBusAddress(0x0FFFFFFC, 4), 'number');

            // Out-of-bounds for GBA
            assert.throws(() => core.validateBusAddress(0x10000000, 1), RangeError);
            assert.throws(() => core.validateBusAddress(0x0FFFFFFF, 2), RangeError);
            assert.throws(() => core.validateBusAddress(0x0FFFFFFD, 4), RangeError);
        } finally {
            core.romInfo = origRomInfo;
        }
    });

    emulator.close();
});
