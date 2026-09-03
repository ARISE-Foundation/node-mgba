import test from 'node:test';
import assert from 'node:assert/strict';
import {
    defineStruct,
    u8,
    u16le,
    u16be,
    u24le,
    u24be,
    u32le,
    u32be,
    stringField,
    bcdField,
    bitfield,
    enumField,
    arrayField,
    customField,
    createMockMemoryReader,
    type StructSchema,
} from '../src/index.js';

test('Binary Schema DSL - Unit and Inference Tests', async (t) => {
    await t.test('1. Primitive numeric combinators read correct values and endianness', () => {
        const mem = createMockMemoryReader();
        mem.writeU8(0xC000, 0x42);
        mem.writeU16LE(0xC001, 0x1234);
        mem.writeU16BE(0xC003, 0x5678);
        mem.writeU24LE(0xC005, 0x123456);
        mem.writeU24BE(0xC008, 0x123456);
        mem.writeU32LE(0xC00B, 0xDEADBEEF);
        mem.writeU32BE(0xC00F, 0xCAFEBABE);

        const PrimitiveSchema = defineStruct({
            byteVal: u8(0x00),
            le16: u16le(0x01),
            be16: u16be(0x03),
            le24: u24le(0x05),
            be24: u24be(0x08),
            le32: u32le(0x0B),
            be32: u32be(0x0F),
        });

        const record = PrimitiveSchema.read(mem, 0xC000);

        assert.equal(record.byteVal, 0x42);
        assert.equal(record.le16, 0x1234);
        assert.equal(record.be16, 0x5678);
        assert.equal(record.le24, 0x123456);
        assert.equal(record.be24, 0x123456);
        assert.equal(record.le32, 0xDEADBEEF >>> 0);
        assert.equal(record.be32, 0xCAFEBABE >>> 0);
    });

    await t.test('2. stringField decodes mapped strings with terminators and trimming', () => {
        const charMap: Record<number, string> = {
            0x80: 'A',
            0x81: 'B',
            0x82: 'C',
            0x83: 'D',
            0x50: '@',
        };

        const mem = createMockMemoryReader();
        mem.writeU8(0xC000, 0x80); // 'A'
        mem.writeU8(0xC001, 0x81); // 'B'
        mem.writeU8(0xC002, 0x82); // 'C'
        mem.writeU8(0xC003, 0x50); // Terminator '@'
        mem.writeU8(0xC004, 0x83); // After terminator (should be ignored)

        const StringSchema = defineStruct({
            name: stringField(0x00, 10, { charMap, terminator: 0x50 }),
        });

        const res = StringSchema.read(mem, 0xC000);
        assert.equal(res.name, 'ABC');
    });

    await t.test('3. bcdField decodes Binary-Coded Decimal numbers', () => {
        const mem = createMockMemoryReader();
        mem.writeBCD(0xC000, 999999, 3); // 3 bytes -> 0x99, 0x99, 0x99

        const BcdSchema = defineStruct({
            money: bcdField(0x00, 3),
        });

        const res = BcdSchema.read(mem, 0xC000);
        assert.equal(res.money, 999999);
    });

    await t.test('4. bitfield extracts booleans and multi-bit integer ranges', () => {
        const mem = createMockMemoryReader();
        // 0b01001011 = 0x4B
        // bit 0..2 = 3 (sleep counter)
        // bit 3 = 1 (poison)
        // bit 4 = 0 (burn)
        // bit 5 = 0 (freeze)
        // bit 6 = 1 (paralysis)
        mem.writeU8(0xC000, 0x4B);

        const StatusBitfield = defineStruct({
            status: bitfield(0x00, {
                sleepCount: [0, 2] as const,
                poison: 3,
                burn: 4,
                freeze: 5,
                paralysis: 6,
            }),
        });

        const res = StatusBitfield.read(mem, 0xC000);
        assert.equal(res.status.sleepCount, 3);
        assert.equal(res.status.poison, true);
        assert.equal(res.status.burn, false);
        assert.equal(res.status.freeze, false);
        assert.equal(res.status.paralysis, true);
    });

    await t.test('5. enumField maps IDs to names with fallback', () => {
        const lookup = {
            1: 'FIRE',
            2: 'WATER',
            3: 'GRASS',
        } as const;

        const mem = createMockMemoryReader();
        mem.writeU8(0xC000, 2);
        mem.writeU8(0xC001, 99);

        const TypeSchema = defineStruct({
            typeKnown: enumField(0x00, lookup),
            typeUnknown: enumField(0x01, lookup, 'UNKNOWN_TYPE'),
        });

        const res = TypeSchema.read(mem, 0xC000);
        assert.equal(res.typeKnown, 'WATER');
        assert.equal(res.typeUnknown, 'UNKNOWN_TYPE');
    });

    await t.test('6. arrayField decodes repeated primitive and structured elements', () => {
        const mem = createMockMemoryReader();
        mem.writeU8(0xC000, 10);
        mem.writeU8(0xC001, 20);
        mem.writeU8(0xC002, 30);
        mem.writeU8(0xC003, 40);

        const ArraySchema = defineStruct({
            ppMoves: arrayField(0x00, 4, u8(0x00), 1),
        });

        const res = ArraySchema.read(mem, 0xC000);
        assert.deepEqual(res.ppMoves, [10, 20, 30, 40]);

        const element = defineStruct({ a: u8(0x00), b: u8(0x01) });
        const strideArray = arrayField(0x04, 3, element, 4); // element length 2, stride 4
        // extent should be 0x04 + (3 - 1) * 4 + 2 = 4 + 8 + 2 = 14
        assert.equal(strideArray.extent, 14);

        // writeRomBytes test
        mem.writeRomBytes(0x38000, [0xAA, 0xBB, 0xCC]);
        assert.equal(mem.readRomU8(0x38000), 0xAA);
        assert.equal(mem.readRomU8(0x38001), 0xBB);
        assert.equal(mem.readRomU8(0x38002), 0xCC);
    });

    await t.test('7. customField executes custom calculation with explicit byteLength', () => {
        const mem = createMockMemoryReader();
        mem.writeU16BE(0xC000, 0xABCD);

        const CustomSchema = defineStruct({
            dvScore: customField(2, (reader, base) => {
                const iv = reader.readU16BE(base);
                const atk = (iv >> 12) & 0x0F;
                const def = (iv >> 8) & 0x0F;
                return atk + def;
            }),
        });

        const res = CustomSchema.read(mem, 0xC000);
        assert.equal(res.dvScore, 0x0A + 0x0B); // 10 + 11 = 21
    });

    await t.test('8. High-throughput performance benchmark (< 0.05ms per decode)', () => {
        const mem = createMockMemoryReader();
        mem.writeU8(0xC000, 0x01);
        mem.writeU16BE(0xC001, 100);
        mem.writeU16BE(0xC003, 100);

        const BenchSchema = defineStruct({
            species: u8(0x00),
            hp: u16be(0x01),
            maxHP: u16be(0x03),
        });

        const iterations = 10000;
        const start = performance.now();
        for (let i = 0; i < iterations; i++) {
            BenchSchema.read(mem, 0xC000);
        }
        const elapsed = performance.now() - start;
        const perOpMs = elapsed / iterations;

        assert.ok(perOpMs < 0.05, `Expected per-op < 0.05ms, got ${perOpMs.toFixed(4)}ms`);
    });

    await t.test('9. Compile-time type inference verification', () => {
        const TestSchema = defineStruct({
            id: u8(0x00),
            name: stringField(0x01, 10, { charMap: {} }),
            flags: bitfield(0x0B, { active: 0, count: [1, 3] as const }),
        });

        type InferredType = typeof TestSchema extends StructSchema<infer T> ? T : never;

        // Static type assertion checks
        const check: InferredType = {
            id: 1,
            name: 'test',
            flags: {
                active: true,
                count: 5,
            },
        };
        assert.equal(typeof TestSchema.read, 'function');
        assert.equal(check.id, 1);
    });
});
