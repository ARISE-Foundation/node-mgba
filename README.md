# node-mgba

[![CI](https://github.com/ARISE-Foundation/node-mgba/actions/workflows/ci.yml/badge.svg)](https://github.com/ARISE-Foundation/node-mgba/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/node-mgba.svg)](https://www.npmjs.com/package/node-mgba)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Platform: Linux x64](https://img.shields.io/badge/Platform-Linux%20x64-brightgreen.svg)](#)

> **Scriptable, headless mGBA emulator for Node.js — like PyBoy, but powered by `libmgba` for Game Boy, GBC, and GBA.**

`node-mgba` provides native Node.js bindings to the C `libmgba` core. It is built for scripting, agent automation, and machine learning research, giving you direct programmatic control over the emulator:

- **Headless & fast:** Runs without a GUI window at 1,000+ to 3,400+ FPS.
- **Controls & state:** Step frames, inject button inputs, and save/load state in memory or to disk.
- **Direct memory access:** Read and write directly to memory buses (WRAM, VRAM, HRAM) without socket overhead.
- **Screen & audio capture:** Grab raw pixel buffers, encode to PNG/WebP, or stream audio/video frames.
- **Plugin decoders:** Optional high-level memory decoders (includes Pokémon Red/Blue state parsing).

Originally built to power the 24/7 autonomous agent on **[Gemini Plays Pokémon](https://www.twitch.tv/gemini_plays_pokemon/about)** ([web viewer](https://gpp-viewer.arisef.org)).

## Installation

```bash
pnpm add node-mgba
```

## Quickstart

```typescript
import { Mgba } from 'node-mgba';

// Load ROM (supports .gb, .gbc, .gba)
const emu = await Mgba.load('./game.gb');

// Advance frames and send input
await emu.controls.tick(60);
await emu.controls.press('A');

// Read memory
const playerX = await emu.memory.read8(0xD362);

// Capture screenshot buffer
const pngBuffer = await emu.screen.toPng();

// Close when done
await emu.close();
```

---

## Console Support & Limitations

| Platform / Model | Emulation & Controls | Direct Memory (`read8`, `readBatch`, `slice`) | Memory Snapshots (`observe`, `GamePlugin.getState()`) |
|---|---|---|---|
| **Game Boy (DMG / SGB)** | Supported | Supported | Supported |
| **Game Boy Color (CGB)** | Supported | Supported | Supported |
| **Game Boy Advance (AGB)** | Supported | Supported | *Planned on Roadmap* |

> **Note on GBA Memory Snapshots**: GBA emulation, gamepad controls, audio/video streaming, savestates, and direct bus memory reads (`read8`, `read16LE`, `read32LE`, `slice`) are currently supported. Snapshots covering multiple memory regions (`emu.observe({ memory: ... })` and `GamePlugin.getState()`) are currently limited to Game Boy (DMG/CGB/SGB) models and are planned on the roadmap for GBA.

---

## Common Tasks

### Input & Frame Stepping
```typescript
// Press with explicit frame timing
await emu.controls.press('START', { holdFrames: 8, releaseFrames: 4 });

// Hold a button across multiple ticks
await emu.controls.hold('B');
await emu.controls.tick(30);
await emu.controls.release('B');

// Run an input sequence
await emu.controls.sequence([
    { type: 'press', button: 'UP', holdFrames: 6, releaseFrames: 4 },
    { type: 'wait', frames: 10 },
    { type: 'press', button: 'A', holdFrames: 6, releaseFrames: 4 },
]);
```

### Reading & Writing Memory
```typescript
// Read unsigned integers
const byte = await emu.memory.read8(0xC000);
const u16 = await emu.memory.read16LE(0xC001);
const u32 = await emu.memory.read32LE(0xC003);

// Write to memory
await emu.memory.write8(0xC500, 0x42);

// Read multiple addresses in one call
const [x, y, mapId] = await emu.memory.readBatch([0xD362, 0xD361, 0xD35E]);
```

### Savestates
```typescript
// Save and load state files
await emu.states.saveToFile('./save.state');
await emu.states.loadFromFile('./save.state');

// In-memory state handles
const handle = await emu.states.save();
await emu.states.restore(handle);
```

### Waiting for In-Game Conditions
```typescript
// Wait until memory matches a condition (or timeout is reached)
await emu.waitFor({
    timeoutFrames: 300,
    condition: async (instance) => {
        const battleStatus = await instance.memory.read8(0xD057);
        return battleStatus !== 0;
    },
});
```

### Video & Audio Streaming
```typescript
import { Mgba, WebSocketMediaSink, FfmpegRecordingSink } from 'node-mgba';

// Stream video and audio chunks over WebSocket clients
const wsSink = new WebSocketMediaSink({
    name: 'live-stream',
    clients: () => wss.clients,
});

// Or record gameplay directly to an MP4 file
const recorder = new FfmpegRecordingSink({
    outputPath: './gameplay.mp4',
    fps: 60,
});

// Pass sinks when loading the emulator
const emu = await Mgba.load('./game.gb', {
    mediaSinks: [wsSink, recorder],
});
```

### Game Plugins & State Decoding
```typescript
import { PokemonRedBluePlugin } from 'node-mgba/plugins';

// Attach game plugin
const pokemon = await emu.use(PokemonRedBluePlugin);

// Retrieve structured game state
const state = await pokemon.getState();
console.log(state.player.position, state.party);
```

---

## Performance

Measured on AMD Ryzen 9 5950X with *Pokémon Blue* (`pnpm run bench`):

| Metric | Throughput | Avg Latency | Notes |
|---|---|---|---|
| **Headless Stepping** | **~1,110 FPS** | 0.90 ms / frame | Non-blocking `worker_threads` RPC |
| **Direct Core Stepping** | **~3,420 FPS** | 0.29 ms / frame | In-process native core |
| **Single Memory Read/Write** | **~10,000 ops/s** | ~100 µs / op | Direct WRAM bus access |
| **Batch Memory Read (50 addrs)** | **~6,390 batches/s** | 0.16 ms / batch | Single IPC round-trip |
| **Schema DSL Struct Decode** | **~960,690 ops/s** | 1.0 µs / struct | In-memory binary parser |
| **Full Game State Decode** | **~22,270 decodes/s** | 44.9 µs / decode | Populated party, bag, map, box |
| **Savestate Restore** | **~2,280 restores/s** | 0.44 ms / restore | Cycle-accurate state handle |

For full benchmarks and methodology, see the [Performance & Benchmarks Guide](docs/BENCHMARKS.md).

---

## Development & Testing

### Obtaining ROMs & Legal Notice

`node-mgba` does **not** distribute copyrighted game ROMs or proprietary BIOS files. To run tests or execute automation scripts with commercial games, you must provide your own legally obtained ROM files (for example, dumped from physical cartridges you own using hardware such as GBxCart RW, Joey Jr, or Epilogue GB Operator). Open-source homebrew ROMs (`.gb`, `.gbc`, `.gba`) can also be used for testing and general development.

The built-in `PokemonRedBluePlugin` supports standard English and European releases of *Pokémon Red* and *Pokémon Blue*, as well as ROM hacks (such as color palette swaps or quality-of-life patches) that preserve standard Gen 1 RAM layouts.

### Running Tests

The test suite adapts automatically to whether a ROM is available:

```bash
# Run unit tests (runs pure in-memory decoders and mocks without needing a ROM)
pnpm test

# Run full integration suite with a Game Boy ROM
export ROM_PATH="/path/to/game.gb"
pnpm test
```

### Interactive Web GUI Studio

`node-mgba` includes a built-in Vue 3 web interface for debugging emulation, testing input sequences, and inspecting real-time RAM decoding:

```bash
# Build the native shim, TypeScript, and GUI bundle
pnpm run build

# Launch the GUI server with a Game Boy ROM (opens at http://localhost:3456)
ROM_PATH="/path/to/game.gb" pnpm run gui

# Or run the GUI frontend in Vite development mode with hot-reloading
pnpm run gui:dev
```

> **Note**: The GUI's state inspector and telemetry HUD panels are currently tailored specifically for **Pokémon Red & Blue** (displaying real-time party stats, inventory, badges, and map coordinates).

---

## Subpath Exports

| Import | Description |
|---|---|
| `node-mgba` | Core emulator facade, controls, memory, and media sinks |
| `node-mgba/plugins` | Plugin base class (`GamePlugin`) and built-in plugins (`PokemonRedBluePlugin`) |
| `node-mgba/schema` | Declarative binary schema DSL for defining RAM decoders |
| `node-mgba/testing` | In-memory `MockMemoryReader` for unit testing decoders |
| `node-mgba/browser` | Browser media playback helpers (`WebAudioPlayer`, `CanvasRenderer`) |

For detailed guides:
- [Plugin Authoring Guide](docs/PLUGINS.md)
- [Binary Schema DSL Reference](docs/SCHEMA_DSL.md)
- [In-Memory Decoder Testing](docs/TESTING.md)
- [Performance & Benchmarks](docs/BENCHMARKS.md)
