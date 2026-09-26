import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { NativeMgbaCore } from '../src/core/NativeMgbaCore.js';
import { Mgba } from '../src/index.js';
import { getBatteryRomPath } from './helpers/rom.js';
import { createSafeTempDir } from './helpers/temp.js';

interface PngChunk {
    readonly type: string;
    readonly length: number;
    readonly offset: number;
}

function parsePngChunks(buffer: Buffer): PngChunk[] {
    const pngMagic = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    assert.ok(buffer.length >= 8, 'Savestate buffer must be at least 8 bytes');
    assert.deepStrictEqual(
        buffer.subarray(0, 8),
        pngMagic,
        'Savestate must start with PNG header [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]'
    );

    const chunks: PngChunk[] = [];
    let offset = 8;
    while (offset + 8 <= buffer.length) {
        const length = buffer.readUInt32BE(offset);
        const type = buffer.subarray(offset + 4, offset + 8).toString('ascii');
        chunks.push({ type, length, offset });
        offset += 8 + length + 4; // 4-byte length + 4-byte type + payload + 4-byte CRC32
    }
    return chunks;
}

test('PNG Savestate Extdata Cartridge SRAM Preservation Suite', async (t) => {
    const tempHandle = createSafeTempDir('mgba-sram-savestate-');
    if (!tempHandle) {
        t.skip('Skipping: no writable temp directory');
        return;
    }

    const romPath = getBatteryRomPath(tempHandle.path);

    try {
        await t.test('1. NativeMgbaCore: PNG savestate contains gbAs and gbAx chunks and preserves SRAM across loadState', () => {
            const core = new NativeMgbaCore();
            core.loadROM(romPath);
            const statePath = path.join(tempHandle.path, 'native_sram_state.ss0');

            try {
                // Step a few frames to let emulator settle
                for (let i = 0; i < 5; i++) {
                    core.stepFrame(0);
                }

                const sram = core.getSram();
                assert.ok(sram.length > 0, `Expected SRAM buffer size > 0, got ${sram.length}`);

                // Write distinctive payload into SRAM
                const testPayload = Buffer.alloc(sram.length, 0x6e);
                testPayload.write('SRAM_PNG_EXTDATA_PERSISTENCE_TEST', 0x14, 'utf8');
                testPayload.writeUInt32LE(0xdeadbeef, 0x100);

                const setOk = core.setSram(testPayload);
                assert.strictEqual(setOk, true, 'setSram must succeed');
                assert.deepStrictEqual(core.getSram(), testPayload, 'getSram must match test payload');

                // Save state to .ss0 file
                const saveOk = core.saveState(statePath);
                assert.strictEqual(saveOk, true, 'saveState must return true');
                assert.ok(fs.existsSync(statePath), 'Savestate file must exist on disk');

                // Inspect binary structure of savestate
                const fileBytes = fs.readFileSync(statePath);
                const chunks = parsePngChunks(fileBytes);
                const chunkTypes = chunks.map((c) => c.type);

                // Verify PNG header and critical libmgba chunks
                assert.ok(
                    chunkTypes.includes('gbAs') || chunkTypes.includes('gbSs'),
                    `Expected savestate to contain gbAs or gbSs chunk, found: ${chunkTypes.join(', ')}`
                );
                assert.ok(
                    chunkTypes.includes('gbAx'),
                    `Expected savestate to contain gbAx extdata chunk, found: ${chunkTypes.join(', ')}`
                );

                // Overwrite SRAM with zeroes
                const zeroes = Buffer.alloc(sram.length, 0x00);
                core.setSram(zeroes);
                assert.deepStrictEqual(core.getSram(), zeroes, 'SRAM must be all zeroes prior to reload');

                // Reload state from .ss0
                const loadOk = core.loadState(statePath);
                assert.strictEqual(loadOk, true, 'loadState must return true');

                // Verify SRAM contents are completely restored from savestate extdata
                const restoredSram = core.getSram();
                assert.deepStrictEqual(
                    restoredSram,
                    testPayload,
                    'Cartridge SRAM must be fully restored from PNG savestate extdata'
                );
            } finally {
                core.close();
            }
        });

        await t.test('2. Mgba facade: SRAM is restored from savestate file via states.loadFromFile', async () => {
            const emu = await Mgba.load(romPath);
            const statePath = path.join(tempHandle.path, 'facade_sram_state.ss0');

            try {
                await emu.controls.tick(5);

                const sram = await emu.memory.getSram();
                const facadePayload = Buffer.alloc(sram.length, 0x8b);
                facadePayload.write('FACADE_SRAM_SAVESTATE_ROUNDTRIP', 0x30, 'utf8');
                facadePayload.writeUInt32BE(0xcafebebe, 0x200);

                await emu.memory.setSram(facadePayload);
                assert.deepStrictEqual(await emu.memory.getSram(), facadePayload, 'SRAM must match payload');

                const saveOk = await emu.states.saveToFile(statePath);
                assert.strictEqual(saveOk, true, 'emu.states.saveToFile must succeed');

                // Inspect PNG structure
                const fileBytes = fs.readFileSync(statePath);
                const chunks = parsePngChunks(fileBytes);
                const chunkTypes = chunks.map((c) => c.type);
                assert.ok(chunkTypes.includes('gbAx'), 'Savestate must contain gbAx extdata chunk');

                // Clear SRAM
                const zeroes = Buffer.alloc(sram.length, 0x00);
                await emu.memory.setSram(zeroes);
                assert.deepStrictEqual(await emu.memory.getSram(), zeroes, 'SRAM must be cleared');

                // Restore state
                const loadOk = await emu.states.loadFromFile(statePath);
                assert.strictEqual(loadOk, true, 'emu.states.loadFromFile must succeed');

                const restoredSram = await emu.memory.getSram();
                assert.deepStrictEqual(
                    restoredSram,
                    facadePayload,
                    'emu.memory.getSram() must reflect restored SRAM from savestate'
                );
            } finally {
                await emu.close();
            }
        });
    } finally {
        tempHandle.cleanup();
    }
});
