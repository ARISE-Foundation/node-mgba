# Plugin Authoring Guide

`node-mgba` provides a class-based plugin system attached via `emu.use(PluginClass)`. Plugins receive the `MgbaInstance` in their constructor and can provide high-level game state decoders, automation helpers, and event subscriptions.

---

## Plugin Class Contract

Every plugin is a TypeScript class conforming to the `PluginClass` contract:

```typescript
export interface PluginClass<TInstance = unknown> {
    new (emu: MgbaInstance): TInstance;
    readonly pluginName: string;
    readonly supportedModels?: readonly ConsoleModel[] | undefined;
}
```

- **`static pluginName`**: A unique string identifier. Calling `emu.use(PluginClass)` is idempotent when called with the exact same class constructor (returning the existing instance). If a different class constructor attempts to register with an already-used `pluginName`, `emu.use()` will throw an error.
- **`static supportedModels`** *(optional)*: Allowed console models (`DMG`, `CGB`, `SGB`, `AGB`). `emu.use()` will throw if the loaded ROM's model is not in this list.
- **`definePlugin(PluginClass)`**: Helper function that returns the typed plugin class unchanged for type-checking convenience.

---

## 1. Game State Plugins (`GamePlugin<TState>`)

For plugins that decode structured game state from memory snapshots, extend `GamePlugin<TState>`:

```typescript
import { GamePlugin, type MemoryReader, type MemorySnapshotOptions } from 'node-mgba';

export interface OverworldState {
    playerX: number;
    playerY: number;
    mapId: number;
    inBattle: boolean;
}

export class OverworldPlugin extends GamePlugin<OverworldState> {
    public static override readonly pluginName = 'overworld';
    public static override readonly supportedModels = ['DMG', 'CGB'] as const;
    public static override readonly memorySlices: MemorySnapshotOptions = { vram: true };

    /**
     * Keep the static decoder side-effect free.
     * Takes any MemoryReader (live snapshot, offline observation, or mock)
     * and returns structured game state.
     */
    public static decode(mem: MemoryReader): OverworldState {
        return {
            playerX: mem.readU8(0xD362),
            playerY: mem.readU8(0xD361),
            mapId: mem.readU8(0xD35E),
            inBattle: mem.readU8(0xD057) !== 0,
        };
    }

    /**
     * Custom instance method for in-game manipulation.
     */
    public async freezePlayer(): Promise<void> {
        // Write directly to emulator memory via this.emu
        await this.emu.memory.write8(0xD360, 0xFF);
    }
}
```

> **Note on Model Support**: `GamePlugin` constructors validate `emu.console.model` against `supportedModels`. Since memory snapshotting currently targets the Game Boy memory bus, specify GB-family models (`DMG`, `CGB`, `SGB`). Full-bus snapshotting for GBA models is on the roadmap.

### Using the Plugin

```typescript
const emu = await Mgba.load('./game.gb');
const plugin = await emu.use(OverworldPlugin);

// getState() automatically snapshots memorySlices and runs OverworldPlugin.decode()
const state = await plugin.getState();
console.log(`Player on map ${state.mapId} at (${state.playerX}, ${state.playerY})`);

// Call custom instance methods
await plugin.freezePlayer();
```

---

## 2. Utility & Event Listener Plugins

Plugins can also subscribe to emulator events or provide custom automation helpers without defining game state schemas. `MgbaInstance` is an `EventEmitter` emitting:
- `'frame'` (`VideoPacket`): Emitted after each rendered video frame.
- `'audio'` (`AudioChunk`): Emitted when audio samples are produced.
- `'turnComplete'` (`TurnResult`): Emitted upon completion of an input sequence.
- `'memoryChange'`: Emitted when watched memory addresses change.
- `'stateRestore'`: Emitted when a savestate is restored.

```typescript
import type { MgbaInstance, VideoPacket } from 'node-mgba';

export class FrameLoggerPlugin {
    public static readonly pluginName = 'frame-logger';
    private count = 0;
    private readonly onFrame = (packet: VideoPacket): void => {
        this.count++;
        if (this.count % 60 === 0) {
            console.log(`Emulated frame ${packet.frameIndex}`);
        }
    };

    constructor(private emu: MgbaInstance) {
        // Subscribe to emulator frame events
        this.emu.on('frame', this.onFrame);
    }

    /**
     * Called automatically when emu.close() or emu.disposePlugins() is called.
     */
    public dispose(): void {
        this.emu.off('frame', this.onFrame);
        console.log(`Total frames tracked: ${this.count}`);
    }
}
```

### Attaching a Utility Plugin

```typescript
const emu = await Mgba.load('./game.gb');
const logger = await emu.use(FrameLoggerPlugin);

// Advance frames (triggering frame events)
await emu.controls.tick(120);

// emu.close() automatically calls dispose() on all active plugins
await emu.close();
```

---

## 3. Built-in Plugins: `PokemonRedBluePlugin`

`node-mgba/plugins` exports `PokemonRedBluePlugin`, an implementation of `GamePlugin<PokemonRedBlueState>` for Pokémon Red and Blue:

```typescript
import {
    PokemonRedBluePlugin,
    isPokemonRedBlue,
    type PokemonRedBlueState,
    type PokemonPartyMember,
} from 'node-mgba/plugins';

const emu = await Mgba.load('./pokemon_red.gb');
const pokemon = await emu.use(PokemonRedBluePlugin);

// Retrieve typed game state
const state = await pokemon.getState();

// Freeze or resume NPC sprite movement
await pokemon.freezeSprite(1);
await pokemon.resumeSprite(1);
```
