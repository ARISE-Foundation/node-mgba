import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Mgba, MgbaEmulator } from '../src/index.js';
import { PokemonRedBluePlugin } from '../plugins/index.js';
import { createMockMemoryReader } from '../src/testing/index.js';
import {
    defineStruct,
    u8,
    u16be,
    bitfield,
    enumField,
    arrayField,
    stringField,
} from '../src/schema/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROM_PATH = path.resolve(__dirname, '../fixtures/pokemon_blue.gb');
const SAVESTATE_PATH = path.resolve(__dirname, '../fixtures/turn_state.ss0');

interface BenchResult {
    name: string;
    iterations: number;
    totalMs: number;
    opsPerSec: number;
    avgMs: number;
    p95Ms: number;
}

function calculateP95(times: number[]): number {
    if (times.length === 0) return 0;
    const sorted = [...times].sort((a, b) => a - b);
    const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * 0.95) - 1));
    return sorted[index];
}

async function runBenchmark(
    name: string,
    iterations: number,
    fn: (i: number) => Promise<unknown> | unknown,
    warmupIterations = Math.min(iterations, 50),
): Promise<BenchResult> {
    // Warmup phase
    for (let i = 0; i < warmupIterations; i++) {
        await fn(i);
    }

    const times: number[] = [];
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
        const opStart = performance.now();
        await fn(i);
        times.push(performance.now() - opStart);
    }
    const totalMs = performance.now() - start;
    const avgMs = totalMs / iterations;
    const opsPerSec = Math.round((iterations / (totalMs / 1000)));
    const p95Ms = calculateP95(times);

    return {
        name,
        iterations,
        totalMs,
        opsPerSec,
        avgMs,
        p95Ms,
    };
}

async function main() {
    console.log('='.repeat(70));
    console.log('🚀 node-mgba Performance Benchmark Suite');
    console.log('='.repeat(70));
    console.log(`OS: ${os.type()} ${os.release()} (${os.arch()})`);
    console.log(`CPU: ${os.cpus()[0]?.model ?? 'Unknown'} (${os.cpus().length} logical cores)`);
    console.log(`Node.js: ${process.version}`);
    console.log(`ROM: ${path.basename(ROM_PATH)}`);
    if (existsSync(SAVESTATE_PATH)) {
        console.log(`Savestate: ${path.basename(SAVESTATE_PATH)} (Populated mid-game reference state)`);
    }
    console.log('='.repeat(70));
    console.log('');

    const results: BenchResult[] = [];

    // -------------------------------------------------------------
    // Category 1: Emulation Stepping Throughput (Headless Turbo)
    // -------------------------------------------------------------
    console.log('▶ Benchmarking Emulation Stepping Throughput...');

    // 1.1 Direct in-process native core
    const directEmu = new MgbaEmulator();
    try {
        await directEmu.loadROM(ROM_PATH);
        const directFrames = 3000;
        const directResult = await runBenchmark(
            'Native Core Direct Stepping (In-Process)',
            directFrames,
            () => directEmu.step(),
            100,
        );
        results.push(directResult);
        console.log(`  ✓ Native Core: ${directResult.opsPerSec.toLocaleString()} FPS (${(directResult.avgMs * 1000).toFixed(1)} µs/frame)`);
    } finally {
        await directEmu.close();
    }

    // 1.2 Worker Thread RPC Stepping
    const emu = await Mgba.load(ROM_PATH);
    try {
        if (existsSync(SAVESTATE_PATH)) {
            await emu.states.loadFromFile(SAVESTATE_PATH);
        }

        const workerFrames = 2000;
        const workerResult = await runBenchmark(
            'Worker Thread RPC Stepping (Isolated)',
            workerFrames,
            () => emu.controls.tick(1),
            50,
        );
        results.push(workerResult);
        console.log(`  ✓ Worker RPC: ${workerResult.opsPerSec.toLocaleString()} FPS (${(workerResult.avgMs * 1000).toFixed(1)} µs/frame)`);

        // -------------------------------------------------------------
        // Category 2: Memory Operations Latency
        // -------------------------------------------------------------
        console.log('\n▶ Benchmarking Memory Bus Operations...');

        // 2.1 Single byte read
        const read8Result = await runBenchmark(
            'Memory read8 (WRAM)',
            2000,
            () => emu.memory.read8(0xD362),
            100,
        );
        results.push(read8Result);
        console.log(`  ✓ read8(): ${read8Result.opsPerSec.toLocaleString()} ops/sec (${(read8Result.avgMs * 1000).toFixed(1)} µs/op)`);

        // 2.2 Single byte write
        const write8Result = await runBenchmark(
            'Memory write8 (WRAM)',
            2000,
            () => emu.memory.write8(0xC500, 0x42),
            100,
        );
        results.push(write8Result);
        console.log(`  ✓ write8(): ${write8Result.opsPerSec.toLocaleString()} ops/sec (${(write8Result.avgMs * 1000).toFixed(1)} µs/op)`);

        // 2.3 Batch read (50 addresses)
        const batchAddresses = Array.from({ length: 50 }, (_, idx) => ({ address: 0xC000 + idx * 4, type: 'u8' as const }));
        const batchResult = await runBenchmark(
            'Memory readBatch (50 Addresses in 1 IPC)',
            1000,
            () => emu.memory.readBatch(batchAddresses),
            50,
        );
        results.push(batchResult);
        console.log(`  ✓ readBatch(50 addresses): ${batchResult.opsPerSec.toLocaleString()} batches/sec (${batchResult.avgMs.toFixed(3)} ms/batch)`);

        // 2.4 Memory slice (256 bytes)
        const sliceResult = await runBenchmark(
            'Memory slice (256 bytes)',
            1000,
            () => emu.memory.slice(0xC100, 256),
            50,
        );
        results.push(sliceResult);
        console.log(`  ✓ slice(256 bytes): ${sliceResult.opsPerSec.toLocaleString()} slices/sec (${(sliceResult.avgMs * 1000).toFixed(1)} µs/slice)`);

        // -------------------------------------------------------------
        // Category 3: Binary Schema DSL & Game State Decoding
        // -------------------------------------------------------------
        console.log('\n▶ Benchmarking Binary Schema DSL & Game State Decoding...');

        const CHAR_MAP: Record<number, string> = { 0x80: 'A', 0x81: 'B', 0x50: '@' };
        const PartyPokemonSchema = defineStruct({
            species: u8(0x00),
            hp: u16be(0x01),
            status: bitfield(0x03, { sleep: [0, 2] as const, poison: 3, paralysis: 4 }),
            type: enumField(0x04, { 1: 'NORMAL', 2: 'WATER', 3: 'GRASS' }),
            moves: arrayField(0x05, 4, u8(0x00)),
            nickname: stringField(0x09, 10, { charMap: CHAR_MAP, terminator: 0x50 }),
        });

        const mockMem = createMockMemoryReader();
        mockMem.writeU8(0xD16B, 25)
            .writeU16BE(0xD16C, 100)
            .writeU8(0xD16E, 0b00001000)
            .writeU8(0xD16F, 1)
            .writeBytes(0xD170, [10, 20, 30, 40]);

        // 3.1 Pure in-memory struct decoding
        const schemaResult = await runBenchmark(
            'Binary Schema DSL Struct Decode (In-Memory)',
            50000,
            () => {
                PartyPokemonSchema.read(mockMem, 0xD16B);
            },
            500,
        );
        results.push(schemaResult);
        console.log(`  ✓ Schema DSL Struct: ${schemaResult.opsPerSec.toLocaleString()} decodes/sec (${(schemaResult.avgMs * 1000).toFixed(2)} µs/decode)`);

        // 3.2 Full game state decode from populated reference snapshot (party, box, bag, badges, collision)
        const snapshot = await emu.memory.snapshot();
        const purePluginDecodeResult = await runBenchmark(
            'PokemonRedBluePlugin.decode() Populated State Decode',
            20000,
            () => {
                PokemonRedBluePlugin.decode(snapshot);
            },
            200,
        );
        results.push(purePluginDecodeResult);
        console.log(`  ✓ PokemonRedBluePlugin.decode(): ${purePluginDecodeResult.opsPerSec.toLocaleString()} decodes/sec (${(purePluginDecodeResult.avgMs * 1000).toFixed(2)} µs/decode)`);

        // 3.3 Live game state snapshot & decode via plugin
        const pokemonPlugin = await emu.use(PokemonRedBluePlugin);
        const livePluginStateResult = await runBenchmark(
            'PokemonRedBluePlugin.getState() (Snapshot + Decode)',
            500,
            () => pokemonPlugin.getState(),
            20,
        );
        results.push(livePluginStateResult);
        console.log(`  ✓ plugin.getState() (Live Snapshot): ${livePluginStateResult.opsPerSec.toLocaleString()} ops/sec (${livePluginStateResult.avgMs.toFixed(3)} ms/op)`);

        // -------------------------------------------------------------
        // Category 4: Savestate Save & Restore Performance
        // -------------------------------------------------------------
        console.log('\n▶ Benchmarking Savestate Operations...');

        // 4.1 In-memory state save & restore
        let handleId = '';
        const stateSaveResult = await runBenchmark(
            'In-Memory State Save (emu.states.save)',
            300,
            async () => {
                const h = await emu.states.save();
                handleId = h.id;
            },
            20,
        );
        results.push(stateSaveResult);
        console.log(`  ✓ emu.states.save(): ${stateSaveResult.opsPerSec.toLocaleString()} saves/sec (${stateSaveResult.avgMs.toFixed(3)} ms/save)`);

        const stateRestoreResult = await runBenchmark(
            'In-Memory State Restore (emu.states.restore)',
            300,
            () => emu.states.restore(handleId),
            20,
        );
        results.push(stateRestoreResult);
        console.log(`  ✓ emu.states.restore(): ${stateRestoreResult.opsPerSec.toLocaleString()} restores/sec (${stateRestoreResult.avgMs.toFixed(3)} ms/restore)`);

        // 4.2 File savestate save & load
        const tmpSavePath = path.join(os.tmpdir(), `bench_save_${Date.now()}_${process.pid}.ss0`);
        try {
            const fileSaveResult = await runBenchmark(
                'File Savestate Save (emu.states.saveToFile)',
                200,
                () => emu.states.saveToFile(tmpSavePath),
                10,
            );
            results.push(fileSaveResult);
            console.log(`  ✓ saveToFile(): ${fileSaveResult.opsPerSec.toLocaleString()} saves/sec (${fileSaveResult.avgMs.toFixed(3)} ms/save)`);

            const fileLoadResult = await runBenchmark(
                'File Savestate Load (emu.states.loadFromFile)',
                200,
                () => emu.states.loadFromFile(tmpSavePath),
                10,
            );
            results.push(fileLoadResult);
            console.log(`  ✓ loadFromFile(): ${fileLoadResult.opsPerSec.toLocaleString()} loads/sec (${fileLoadResult.avgMs.toFixed(3)} ms/load)`);
        } finally {
            try {
                await fs.unlink(tmpSavePath);
            } catch {
                // Ignore cleanup if file wasn't created
            }
        }

        // -------------------------------------------------------------
        // Category 5: Frame Extraction & Image Encoding
        // -------------------------------------------------------------
        console.log('\n▶ Benchmarking Graphics & Image Encoding...');

        // 5.1 PNG Encoding
        const pngResult = await runBenchmark(
            'Screen Capture to PNG (emu.screen.toPng)',
            200,
            () => emu.screen.toPng(),
            10,
        );
        results.push(pngResult);
        console.log(`  ✓ toPng(): ${pngResult.opsPerSec.toLocaleString()} images/sec (${pngResult.avgMs.toFixed(3)} ms/image)`);

        // 5.2 WebP Encoding
        const webpResult = await runBenchmark(
            'Screen Capture to WebP (emu.screen.toWebp)',
            200,
            () => emu.screen.toWebp(),
            10,
        );
        results.push(webpResult);
        console.log(`  ✓ toWebp(): ${webpResult.opsPerSec.toLocaleString()} images/sec (${webpResult.avgMs.toFixed(3)} ms/image)`);
    } finally {
        await emu.close();
    }

    // -------------------------------------------------------------
    // Formatted Markdown Table Output
    // -------------------------------------------------------------
    console.log('\n' + '='.repeat(70));
    console.log('📊 Summary Benchmark Table (Markdown)');
    console.log('='.repeat(70));
    console.log('| Benchmark Operation | Iterations | Throughput | Avg Latency | p95 Latency |');
    console.log('|---|---|---|---|---|');
    for (const r of results) {
        const latencyStr = r.avgMs < 1 ? `${(r.avgMs * 1000).toFixed(1)} µs` : `${r.avgMs.toFixed(2)} ms`;
        const p95Str = r.p95Ms < 1 ? `${(r.p95Ms * 1000).toFixed(1)} µs` : `${r.p95Ms.toFixed(2)} ms`;
        console.log(`| ${r.name} | ${r.iterations.toLocaleString()} | **${r.opsPerSec.toLocaleString()} ops/s** | ${latencyStr} | ${p95Str} |`);
    }
    console.log('='.repeat(70));
}

main().catch((err) => {
    console.error('❌ Benchmark failed:', err);
    process.exit(1);
});
