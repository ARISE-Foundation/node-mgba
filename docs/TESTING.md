# In-Memory Decoder Testing

`node-mgba/testing` exports `MockMemoryReader`, `createMockMemoryReader`, and `MockMemoryOptions` to test memory decoders and state parsing logic in standard unit test runners (e.g. `node:test`, `vitest`, `jest`) without launching emulator processes or requiring ROM binaries.

---

## Writing a Unit Test

```typescript
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMockMemoryReader } from 'node-mgba/testing';
import { PartyPokemonSchema } from './schemas.js';

test('PartyPokemonSchema correctly decodes simulated RAM', () => {
    const mem = createMockMemoryReader();

    // 1. Populate simulated WRAM addresses (writer methods support chaining)
    mem.writeU8(0xD16B, 25)           // species: Pikachu (25)
       .writeU16BE(0xD16C, 120)        // currentHp: 120
       .writeU8(0xD16E, 50)           // level: 50
       .writeU8(0xD16F, 0b01001011)   // status: sleepCount=3, poison=true, paralysis=true
       .writeU8(0xD170, 0)            // type1: NORMAL (0)
       .writeU8(0xD171, 2)            // type2: FLYING (2)
       .writeBytes(0xD173, [10, 20, 30, 40]); // moves

    // 2. Decode struct from memory
    const pokemon = PartyPokemonSchema.read(mem, 0xD16B);

    // 3. Assert decoded values
    assert.equal(pokemon.species, 25);
    assert.equal(pokemon.currentHp, 120);
    assert.equal(pokemon.level, 50);
    assert.equal(pokemon.status.sleepCount, 3);
    assert.equal(pokemon.status.poison, true);
    assert.equal(pokemon.status.paralysis, true);
    assert.equal(pokemon.type1, 'NORMAL');
    assert.equal(pokemon.type2, 'FLYING');
    assert.deepEqual(pokemon.moves, [10, 20, 30, 40]);
});
```

---

## `MockMemoryOptions`

When creating a `MockMemoryReader`, options can be passed to configure simulated buffer sizes and frame metadata:

```typescript
const mem = createMockMemoryReader({
    wramSize: 0x8000,    // Custom WRAM buffer size (default 32KB)
    vramSize: 0x4000,    // Custom VRAM buffer size (default 16KB)
    sramSize: 0x8000,    // Custom SRAM buffer size (default 32KB)
    romSize: 0x100000,   // Custom ROM buffer size (default 1MB)
    frameIndex: 120,     // Initial frameIndex
    timestamp: 2000,     // Initial timestamp (ms)
});
```

---

## `MockMemoryReader` Writer Methods

All mutation methods return `this` to allow fluent call chaining:

| Method | Description |
|---|---|
| `mem.writeU8(addr, val)` | Write an 8-bit unsigned integer to simulated memory |
| `mem.writeU16LE(addr, val)` | Write a 16-bit unsigned integer (Little-Endian) |
| `mem.writeU16BE(addr, val)` | Write a 16-bit unsigned integer (Big-Endian) |
| `mem.writeU24LE(addr, val)` | Write a 24-bit unsigned integer (Little-Endian) |
| `mem.writeU24BE(addr, val)` | Write a 24-bit unsigned integer (Big-Endian) |
| `mem.writeU32LE(addr, val)` | Write a 32-bit unsigned integer (Little-Endian) |
| `mem.writeU32BE(addr, val)` | Write a 32-bit unsigned integer (Big-Endian) |
| `mem.writeBCD(addr, val, len)` | Write a number encoded as Binary-Coded Decimal |
| `mem.writeString(addr, str, charMap, term?)` | Write a string encoded using a character map |
| `mem.writeBytes(addr, data)` | Write an array or Buffer of bytes starting at address |
| `mem.writeRomU8(offset, val)` | Write a single byte to flat physical ROM space |
| `mem.writeRomBytes(offset, data)` | Write an array or Buffer of bytes to flat physical ROM space |

---

## Integration Tests

Integration test suites run against bundled homebrew fixtures by default:

```bash
pnpm test
```

To run game-specific plugin tests or override test fixtures:

```bash
export POKEMON_ROM_PATH="/path/to/pokemon_blue.gb"
export ROM_PATH="/path/to/game.gb"
export SAVESTATE_PATH="/path/to/state.ss0"
export MGBA_LOG_LEVEL=silent
pnpm test
```

