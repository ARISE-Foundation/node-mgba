import test from 'node:test';
import assert from 'node:assert/strict';
import { SymbolManager, inferRegionFromAddress, bankedToPhysicalOffset } from '../src/index.js';

test('SymbolManager & Address Inferencing Suite', async (t) => {
    await t.test('1. Should correctly infer GB and GBA memory regions', () => {
        assert.deepEqual(inferRegionFromAddress(0x0150), { region: 'ROM', writable: false });
        assert.deepEqual(inferRegionFromAddress(0x8000), { region: 'VRAM', writable: true });
        assert.deepEqual(inferRegionFromAddress(0xA000), { region: 'SRAM', writable: true });
        assert.deepEqual(inferRegionFromAddress(0xC000), { region: 'WRAM', writable: true });
        assert.deepEqual(inferRegionFromAddress(0xFE00), { region: 'OAM', writable: true });
        assert.deepEqual(inferRegionFromAddress(0xFF80), { region: 'HRAM', writable: true });
        assert.deepEqual(inferRegionFromAddress(0xFF00), { region: 'IO', writable: true });

        // GBA regions
        assert.deepEqual(inferRegionFromAddress(0x08000000), { region: 'ROM', writable: false });
        assert.deepEqual(inferRegionFromAddress(0x02000000), { region: 'EWRAM', writable: true });
        assert.deepEqual(inferRegionFromAddress(0x03000000), { region: 'IWRAM', writable: true });
        assert.deepEqual(inferRegionFromAddress(0x04000000), { region: 'IO', writable: true });
        assert.deepEqual(inferRegionFromAddress(0x05000000), { region: 'PALETTE', writable: true });
        assert.deepEqual(inferRegionFromAddress(0x06000000), { region: 'VRAM', writable: true });
        assert.deepEqual(inferRegionFromAddress(0x07000000), { region: 'OAM', writable: true });
    });

    await t.test('2. Should parse RGBDS .sym format lines and comments', () => {
        const sym = new SymbolManager();
        const symContent = `
; RGBDS symbol table
00:d163 wPartyCount
00:d16b wPartyMon1
01:4000 Bank1Function
# Another comment
00:ff80 hVBlank
`;
        sym.parseRgbdsSym(symContent);

        assert.equal(sym.has('wPartyCount'), true);
        const partyCount = sym.get('wPartyCount');
        assert.equal(partyCount.address, 0xD163);
        assert.equal(partyCount.bank, 0);
        assert.equal(partyCount.region, 'WRAM');
        assert.equal(partyCount.writable, true);

        const bank1Func = sym.get('Bank1Function');
        assert.equal(bank1Func.address, 0x4000);
        assert.equal(bank1Func.bank, 1);
        assert.equal(bank1Func.region, 'ROM');
        assert.equal(bank1Func.writable, false);

        const hVBlank = sym.get('hVBlank');
        assert.equal(hVBlank.address, 0xFF80);
        assert.equal(hVBlank.region, 'HRAM');
    });

    await t.test('3. Should parse GNU ld .map format', () => {
        const sym = new SymbolManager();
        const mapContent = `
.text
 0x08000200                AgbMain
.ewram
 0x02001000                gPlayerParty
.iwram
 0x03000100                gMainCallback
`;
        sym.parseGnuMap(mapContent);

        assert.equal(sym.has('AgbMain'), true);
        assert.equal(sym.get('AgbMain').address, 0x08000200);
        assert.equal(sym.get('AgbMain').region, 'ROM');

        assert.equal(sym.has('gPlayerParty'), true);
        assert.equal(sym.get('gPlayerParty').address, 0x02001000);
        assert.equal(sym.get('gPlayerParty').region, 'EWRAM');

        assert.equal(sym.has('gMainCallback'), true);
        assert.equal(sym.get('gMainCallback').address, 0x03000100);
        assert.equal(sym.get('gMainCallback').region, 'IWRAM');
    });

    await t.test('4. Should compute physical flat byte offsets from banked addresses', () => {
        // Bank 0 (unbanked or low ROM): address unchanged
        assert.equal(bankedToPhysicalOffset(0x0150, undefined), 0x0150);
        assert.equal(bankedToPhysicalOffset(0x0150, 0), 0x0150);

        // GB Banked ROM (16KB bank size, 0x4000 base):
        // Bank 1 at 0x4000 -> 0x4000
        assert.equal(bankedToPhysicalOffset(0x4000, 1, 0x4000, 0x4000), 0x4000);
        // Bank 2 at 0x4000 -> 0x8000
        assert.equal(bankedToPhysicalOffset(0x4000, 2, 0x4000, 0x4000), 0x8000);
        // Bank 0E at 0x43DE -> (14 * 0x4000) + (0x43DE - 0x4000) = 0x383DE
        assert.equal(bankedToPhysicalOffset(0x43DE, 0x0E, 0x4000, 0x4000), 0x383DE);

        // GB Banked WRAM (4KB bank size, 0xD000 base):
        // Bank 1 at 0xD000 -> 0x1000
        assert.equal(bankedToPhysicalOffset(0xD000, 1, 0x1000, 0xD000), 0x1000);
        // Bank 3 at 0xD500 -> (3 * 0x1000) + 0x500 = 0x3500
        assert.equal(bankedToPhysicalOffset(0xD500, 3, 0x1000, 0xD000), 0x3500);
    });

    await t.test('5. Should load symbols from disk files', async () => {
        const fs = await import('node:fs');
        const path = await import('node:path');
        const os = await import('node:os');

        const tmpDir = os.tmpdir();
        const symPath = path.join(tmpDir, 'test_symbols.sym');
        const mapPath = path.join(tmpDir, 'test_symbols.map');

        fs.writeFileSync(symPath, '00:d163 wPartyCount\n01:4000 Bank1Func');
        fs.writeFileSync(mapPath, '0x08000200 AgbMain');

        try {
            const sym = new SymbolManager();
            sym.loadRgbdsSymFile(symPath);
            assert.equal(sym.has('wPartyCount'), true);
            assert.equal(sym.get('wPartyCount').address, 0xD163);

            sym.loadGnuMapFile(mapPath);
            assert.equal(sym.has('AgbMain'), true);
            assert.equal(sym.get('AgbMain').address, 0x08000200);
        } finally {
            fs.unlinkSync(symPath);
            fs.unlinkSync(mapPath);
        }
    });
});
