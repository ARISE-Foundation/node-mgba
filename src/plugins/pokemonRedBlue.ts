import type { ConsoleModel } from '../types/ConsoleModel.js';
import type { MgbaInstance } from '../Mgba.js';
import type { MemoryReader } from '../core/MemoryReader.js';
import type { MemorySnapshotOptions } from '../types/MemoryRegion.js';
import { GamePlugin } from './GamePlugin.js';
import {
    decodePokemonRedBlueState,
    type PokemonRedBlueState,
    type PokemonPartyMember,
    type PokemonStoredMember,
    type EnemyPokemon,
    type InventoryItem,
    type MapObject,
    type OverworldMapData,
    POKEMON_BLUE_SHA256,
} from './redblue/decoder.js';
import {
    isPokemonRedBlue,
    RED_BLUE_TITLES,
    RED_BLUE_GAME_CODES,
} from './redblue/constants.js';

export {
    type PokemonRedBlueState,
    type PokemonPartyMember,
    type PokemonStoredMember,
    type EnemyPokemon,
    type InventoryItem,
    type MapObject,
    type OverworldMapData,
    POKEMON_BLUE_SHA256,
    isPokemonRedBlue,
    RED_BLUE_TITLES,
    RED_BLUE_GAME_CODES,
};

/**
 * Class-based Pokémon Red / Blue plugin for node-mgba.
 */
export class PokemonRedBluePlugin extends GamePlugin<PokemonRedBlueState> {
    public static override readonly pluginName = 'pokemon-red-blue';
    public static override readonly supportedModels: readonly ConsoleModel[] = ['DMG', 'CGB', 'SGB'];
    public static override readonly memorySlices: MemorySnapshotOptions = { vram: true };

    private readonly spriteMovementCache = new Map<number, number>();

    constructor(emu: MgbaInstance) {
        super(emu);
        if (!isPokemonRedBlue(emu.console.title, emu.console.gameCode)) {
            throw new Error(
                `PokemonRedBluePlugin supports Pokémon Red and Blue (English/European releases), but loaded ROM is "${emu.console.title}" (${emu.console.gameCode})`
            );
        }
    }

    /**
     * Pure static decoder for Pokémon Red/Blue memory snapshots.
     */
    public static decode(mem: MemoryReader): PokemonRedBlueState {
        return decodePokemonRedBlueState(mem);
    }

    #assertSpriteId(objectId: number): void {
        if (typeof objectId !== 'number' || !Number.isFinite(objectId)) {
            throw new TypeError(`Invalid objectId ${String(objectId)}. Must be a finite number.`);
        }
        if (!Number.isInteger(objectId) || objectId < 1 || objectId > 15) {
            throw new RangeError(`Invalid objectId ${objectId}. Must be an integer between 1 and 15.`);
        }
    }

    /**
     * Freezes the movement of an overworld sprite.
     */
    public async freezeSprite(objectId: number): Promise<string> {
        this.#assertSpriteId(objectId);
        const ptr1 = 0xC100 + objectId * 0x10;
        const ptr2 = 0xC200 + objectId * 0x10;
        const sprite = await this.emu.memory.read8(ptr1);
        if (sprite === 0) {
            return `Object ${objectId} is not active`;
        }
        if (this.spriteMovementCache.has(objectId)) {
            return `Sprite ${objectId} is already frozen`;
        }
        const movement = await this.emu.memory.read8(ptr2 + 0x06);
        await this.emu.memory.write8(ptr2 + 0x06, 0xFF);
        this.spriteMovementCache.set(objectId, movement);
        return `Stopped sprite ${objectId} (saved movement byte 0x${movement.toString(16)})`;
    }

    /**
     * Resumes the movement of a previously frozen overworld sprite.
     */
    public async resumeSprite(objectId: number): Promise<string> {
        this.#assertSpriteId(objectId);
        const ptr1 = 0xC100 + objectId * 0x10;
        const ptr2 = 0xC200 + objectId * 0x10;
        const sprite = await this.emu.memory.read8(ptr1);
        if (sprite === 0) {
            return `Object ${objectId} is not active`;
        }
        const savedMovement = this.spriteMovementCache.get(objectId);
        if (savedMovement === undefined) {
            return `No saved movement byte for sprite ${objectId}`;
        }
        await this.emu.memory.write8(ptr2 + 0x06, savedMovement);
        await this.emu.memory.write8(ptr1 + 0x01, 0x01); // restore movement status
        this.spriteMovementCache.delete(objectId);
        return `Resumed sprite ${objectId} (restored movement byte 0x${savedMovement.toString(16)})`;
    }

    /**
     * Cleans up cached sprite movement state on disposal.
     */
    public dispose(): void {
        this.spriteMovementCache.clear();
    }
}
