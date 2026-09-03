# Declarative Binary Schema DSL

The `node-mgba/schema` module provides declarative combinators for parsing binary structs from memory snapshots with automatic TypeScript type inference.

---

## Combinator Reference

| Combinator | Parameters | Output Type | Description |
|---|---|---|---|
| `u8(offset)` | `offset: number` | `number` | 8-bit unsigned integer |
| `u16le(offset)` | `offset: number` | `number` | 16-bit unsigned integer (Little-Endian) |
| `u16be(offset)` | `offset: number` | `number` | 16-bit unsigned integer (Big-Endian) |
| `u24le(offset)` | `offset: number` | `number` | 24-bit unsigned integer (Little-Endian) |
| `u24be(offset)` | `offset: number` | `number` | 24-bit unsigned integer (Big-Endian) |
| `u32le(offset)` | `offset: number` | `number` | 32-bit unsigned integer (Little-Endian) |
| `u32be(offset)` | `offset: number` | `number` | 32-bit unsigned integer (Big-Endian) |
| `bcdField(offset, byteLength)` | `offset: number, byteLength: number` | `number` | Binary-Coded Decimal number (e.g. money or score) |
| `bitfield(offset, spec)` | `offset: number, spec: BitfieldSpec` | `object` | Named bit flags (booleans) and multi-bit integer ranges |
| `enumField(offset, lookupTable, fallback?)` | `offset, lookupTable: Record<number, string>, fallback?: string` | `string` | Maps numeric IDs to string names. Unknown IDs default to `fallback` or `'UNKNOWN_' + value`. |
| `arrayField(offset, count, element, stride?)` | `offset, count, element, stride?` | `readonly T[]` | Repeated primitive or struct elements |
| `stringField(offset, length, options)` | `offset, length, { charMap, terminator, trim }` | `string` | Mapped string with custom character table and terminator |
| `customField(byteLength, fn)` | `byteLength: number, fn: (reader, base) => T` | `T` | Custom calculation from raw memory with explicit byte footprint |

---

## Struct Definition Example

```typescript
import {
    defineStruct,
    u8,
    u16be,
    bcdField,
    bitfield,
    enumField,
    arrayField,
    stringField,
    customField,
} from 'node-mgba/schema';

const CHAR_MAP: Record<number, string> = {
    0x80: 'A', 0x81: 'B', 0x82: 'C', 0x50: '@',
};

export const PartyPokemonSchema = defineStruct({
    species: u8(0x00),
    currentHp: u16be(0x01),
    level: u8(0x03),
    status: bitfield(0x04, {
        sleepCount: [0, 2] as const, // bits 0-2 as integer (0-7)
        poison: 3,                   // bit 3 as boolean
        burn: 4,                     // bit 4 as boolean
        freeze: 5,                   // bit 5 as boolean
        paralysis: 6,                // bit 6 as boolean
    }),
    type1: enumField(0x05, { 0: 'NORMAL', 1: 'FIGHTING', 2: 'FLYING' }),
    type2: enumField(0x06, { 0: 'NORMAL', 1: 'FIGHTING', 2: 'FLYING' }),
    moves: arrayField(0x08, 4, u8(0x00)),
    otName: stringField(0x0C, 10, { charMap: CHAR_MAP, terminator: 0x50 }),
    ivScore: customField(0x1D, (reader, base) => {
        const raw = reader.readU16BE(base + 0x1B);
        return ((raw >> 12) & 0x0F) + ((raw >> 8) & 0x0F);
    }),
});

// Infer TypeScript type directly from schema definition
export type PartyPokemon = ReturnType<typeof PartyPokemonSchema.read>;
```

---

## Reading Structs from Memory

```typescript
import type { MemoryReader } from 'node-mgba';

function parsePartyMember(mem: MemoryReader, baseAddress: number): PartyPokemon {
    return PartyPokemonSchema.read(mem, baseAddress);
}
```

---

## Exported TypeScript Types

`node-mgba/schema` exports the following reference types:
- `Field<T>`: Interface representing a single schema field decoder.
- `StructSchema<T>`: Schema object produced by `defineStruct()`.
- `InferField<TField>`: Helper to infer output type of a field combinator.
- `InferDefinition<TSchema>`: Helper to infer output type of a struct definition.
- `BitfieldSpec`: Mapping of field names to bit indices or `[startBit, endBit]` tuples.
- `InferBitfield<TSpec>`: Helper to infer the resulting object shape of a bitfield.
- `StringFieldOptions`: Options for `stringField` (`charMap`, `terminator`, `trim`).
