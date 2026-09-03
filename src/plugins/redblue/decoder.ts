import type { MemoryReader } from '../../core/MemoryReader.js';
import {
    defineStruct,
    u8,
    u16le,
    u16be,
    u24be,
} from '../../schema/index.js';
import {
    GEN1_CHAR_MAP,
    ITEM_NAMES,
    MOVE_NAMES,
    TYPE_NAMES,
    SPRITE_NAMES,
    INTERNAL_SPECIES_NAMES,
    POKEDEX_SPECIES_NAMES,
} from './constants.js';

export const PartyMonDataSchema = defineStruct({
    internalSpecies: u8(0x00),
    hp: u16be(0x01),
    statusByte: u8(0x04),
    type1Id: u8(0x05),
    type2Id: u8(0x06),
    otId: u16be(0x0C),
    experience: u24be(0x0E),
    hpEV: u16be(0x11),
    attackEV: u16be(0x13),
    defenseEV: u16be(0x15),
    speedEV: u16be(0x17),
    spAttackEV: u16be(0x19),
    iv: u16be(0x1B),
    level: u8(0x21),
    maxHP: u16be(0x22),
    attack: u16be(0x24),
    defense: u16be(0x26),
    speed: u16be(0x28),
    spAttack: u16be(0x2A),
});

export const StoredMonDataSchema = defineStruct({
    internalSpecies: u8(0x00),
    hp: u16be(0x01),
    level: u8(0x03),
    statusByte: u8(0x04),
    type1Id: u8(0x05),
    type2Id: u8(0x06),
    otId: u16be(0x0C),
    experience: u24be(0x0E),
    hpEV: u16be(0x11),
    attackEV: u16be(0x13),
    defenseEV: u16be(0x15),
    speedEV: u16be(0x17),
    spAttackEV: u16be(0x19),
    iv: u16be(0x1B),
});

export const ItemEntrySchema = defineStruct({
    id: u8(0x00),
    quantity: u8(0x01),
});

export const EnemyPokemonDataSchema = defineStruct({
    speciesId: u8(0x00),
    hp: u16le(0x01),
    level: u8(0x0E),
    maxHP: u16le(0x0F),
});

export interface PokemonPartyMember {
    readonly nickname: string;
    readonly species: string;
    readonly pokedexNumber: number;
    readonly level: number;
    readonly hp: number;
    readonly maxHP: number;
    readonly attack: number;
    readonly defense: number;
    readonly speed: number;
    readonly spAttack: number;
    readonly spDefense: number;
    readonly status: string;
    readonly type: string;
    readonly type1: string;
    readonly type2: string;
    readonly is_asleep: boolean;
    readonly has_poison: boolean;
    readonly has_burn: boolean;
    readonly has_freeze: boolean;
    readonly has_paralysis: boolean;
    readonly is_confused?: boolean | undefined;
    readonly gender: 'Male' | 'Female' | 'Genderless';
    readonly isShiny: boolean;
    readonly moves: readonly { readonly move: string; readonly pp: number }[];
    readonly otName: string;
    readonly otId: number;
    readonly experience: number;
    readonly hpEV: number;
    readonly attackEV: number;
    readonly defenseEV: number;
    readonly speedEV: number;
    readonly spAttackEV: number;
    readonly attackDV: number;
    readonly defenseDV: number;
    readonly speedDV: number;
    readonly specialDV: number;
    readonly hpDV: number;
}

export interface PokemonStoredMember extends PokemonPartyMember {
    readonly box: number;
}

export interface InventoryItem {
    readonly id: number;
    readonly name: string;
    readonly quantity: number;
}

export interface MapObject {
    readonly id: number;
    readonly sprite: number;
    readonly x: number;
    readonly y: number;
    readonly facing: 'down' | 'up' | 'left' | 'right' | 'unknown';
    readonly name: string;
    readonly movement_type?: number;
    readonly is_moving_npc?: boolean;
}

export interface EnemyPokemon {
    readonly species: string;
    readonly pokedexNumber: number;
    readonly caught: boolean;
    readonly level: number;
    readonly hp: number;
    readonly maxHP: number;
    readonly hpPercentage: number;
}

export interface OverworldMapData {
    readonly width: number;
    readonly height: number;
    readonly tiles: Record<string, Record<string, string>>;
}

export interface PokemonRedBlueState {
    readonly player: {
        readonly position: { readonly x: number; readonly y: number };
        readonly facing: 'down' | 'up' | 'left' | 'right';
        readonly name: string;
        readonly rival: string;
        readonly onGrass: boolean;
        readonly inBattle: boolean;
        readonly badges: number;
        readonly badgeCount: number;
        readonly money: number;
        readonly isSpinning: boolean;
        readonly isStrengthActive: boolean;
        readonly movementState: 'walking' | 'biking' | 'surfing';
        readonly isVisible: boolean;
    };
    readonly map: {
        readonly id: number;
        readonly group: number;
        readonly width: number;
        readonly height: number;
        readonly position: { readonly x: number; readonly y: number };
        readonly objects: readonly MapObject[];
        readonly isPossiblyMenuOpen: boolean;
    };
    readonly battle: {
        readonly inBattle: boolean;
        readonly battleType: 'none' | 'wild' | 'trainer';
        readonly enemyPokemon: EnemyPokemon | null;
    };
    readonly enemyPokemon: EnemyPokemon | null;
    readonly party: readonly PokemonPartyMember[];
    readonly partyCount: number;
    readonly inventory: readonly InventoryItem[];
    readonly storedItems: readonly InventoryItem[];
    readonly currentBoxNumber: number;
    readonly storedPokemon: readonly PokemonStoredMember[];
    readonly pokedexProgress: {
        readonly seen: number;
        readonly caught: number;
        readonly total: number;
    };
    readonly pokedexCaught: readonly string[];
    readonly screenText: string;
    readonly rawText: string;
    readonly isJoypadIgnored: boolean;
    readonly safariStepsLeft: number;
    readonly systemState: 'OVERWORLD' | 'LOADING' | 'FULL_MENU_OR_BATTLE_OR_SEEN_BY_NPC' | 'UNKNOWN';
    readonly visualMap: string;
    readonly simplifiedTerrain: string;
    readonly overworldMap: OverworldMapData;
    readonly namingScreenSelection: string | false;
}

export const POKEMON_BLUE_SHA256 = '35b4b5e023e2cf0557d435ecd006a2278dcdbcd162dc1b67dabc436a48bb28cc';

const ROM_LEDGE_TILES = 0x1A6CF;
const RAM_TILESET_ID = 0xD367;

const CUT_TILES: Record<number, number> = {
    0: 0x3D,
    7: 0x50,
};

const WATER_TILES = new Set<number>([0x14, 0x48]);
const WATER_TILESETS = new Set<number>([0x00, 0x03, 0x05, 0x07, 0x0D, 0x0E, 0x11, 0x16, 0x17]);
const LEDGE_TILESETS = new Set<number>([0x00, 0x03]);
const ADVANCED_COLLISION_TILESETS = new Set<number>([0x11, 0x03]);

const CAVE_TILESET_ID = 0x11;
const SAFARI_ZONE_TILESET_ID = 0x03;
const INDOOR_TILESET_ID = 0x16;
const INTERIOR_TILESET_ID = 0x10;
const GYM_TILESET_ID = 0x07;

const TERRAIN_VISUAL_MAP: Record<string, string> = {
    FLOOR: '..',
    CUT_TREE: 'CT',
    LEDGE: '--',
    TALL_GRASS: 'WW',
    WATER: '~~',
    WALL: 'XX',
    SPINNER_DOWN: 'Sv',
    SPINNER_UP: 'S^',
    SPINNER_RIGHT: 'S>',
    SPINNER_LEFT: 'S<',
    SPINNER_STOP: 'So',
    CLOSED_GATE: 'GT',
    TELEPORT: 'TP',
    HOLE: 'HL',
    ELEVATED_FLOOR: 'EF',
    STEPS: 'ST',
    BOULDER_BARRIER: 'BB',
    BOULDER_SWITCH: 'BS',
};

function readLedgeTiles(mem: MemoryReader): number[][] {
    const ledgeTiles: number[][] = [];
    let ptr = ROM_LEDGE_TILES;
    const maxLimit = ptr + 256;
    while (ptr < maxLimit && mem.readRomU8(ptr) !== 0xFF) {
        const row: number[] = [];
        for (let i = 0; i < 4; i++) {
            row.push(mem.readRomU8(ptr + i));
        }
        ledgeTiles.push(row);
        ptr += 4;
    }
    return ledgeTiles;
}

function isLedgeTile(tile: number, tilesetId: number, ledgeTiles: number[][]): boolean {
    if (!LEDGE_TILESETS.has(tilesetId)) {
        return false;
    }
    for (const ledge of ledgeTiles) {
        if (tile === ledge[2]) {
            return true;
        }
    }
    return false;
}

function isCutTile(tile: number, tilesetId: number): boolean {
    const cut = CUT_TILES[tilesetId];
    return cut !== undefined && cut === tile;
}

function isWaterTile(tile: number, tilesetId: number): boolean {
    if (!WATER_TILESETS.has(tilesetId)) {
        return false;
    }
    return WATER_TILES.has(tile);
}

function countSetBits(byte: number): number {
    let count = 0;
    let v = byte;
    while (v > 0) {
        count += v & 1;
        v >>= 1;
    }
    return count;
}

function decodeFacing(facingByte: number): 'down' | 'up' | 'left' | 'right' {
    if (facingByte === 0x04) return 'up';
    if (facingByte === 0x08) return 'left';
    if (facingByte === 0x0C) return 'right';
    return 'down';
}

function decodeString(mem: MemoryReader, address: number, length: number): string {
    return mem.readString(address, length, GEN1_CHAR_MAP, 0x50).trim();
}

function getPokedexNumberFromInternal(internalId: number): number {
    const name = INTERNAL_SPECIES_NAMES[internalId];
    if (!name) return 0;
    const dexIdx = POKEDEX_SPECIES_NAMES.indexOf(name);
    return dexIdx > 0 ? dexIdx : 0;
}

function decodeMoves(mem: MemoryReader, movesAddr: number, ppAddr: number): { move: string; pp: number }[] {
    const moves: { move: string; pp: number }[] = [];
    for (let i = 0; i < 4; i++) {
        const moveId = mem.readU8(movesAddr + i);
        if (moveId === 0) continue;
        const pp = mem.readU8(ppAddr + i) & 0x3F;
        moves.push({
            move: MOVE_NAMES[moveId] ?? `UNKNOWN_${moveId}`,
            pp,
        });
    }
    return moves;
}

function calculateBoxStats(
    mem: MemoryReader,
    dexNumber: number,
    level: number,
    hpDV: number, attackDV: number, defenseDV: number, speedDV: number, specialDV: number,
    hpEV: number, attackEV: number, defenseEV: number, speedEV: number, specialEV: number,
): { maxHP: number; attack: number; defense: number; speed: number; spAttack: number } {
    if (dexNumber <= 0 || dexNumber > 151) {
        return { maxHP: 0, attack: 0, defense: 0, speed: 0, spAttack: 0 };
    }

    const baseStatsAddr = 0x383DE + (dexNumber - 1) * 28;
    const baseHp = mem.readRomU8(baseStatsAddr + 1);
    const baseAtk = mem.readRomU8(baseStatsAddr + 2);
    const baseDef = mem.readRomU8(baseStatsAddr + 3);
    const baseSpd = mem.readRomU8(baseStatsAddr + 4);
    const baseSpc = mem.readRomU8(baseStatsAddr + 5);

    const calc = (base: number, dv: number, statExp: number, isHp: boolean): number => {
        const expVal = Math.floor(Math.sqrt(statExp) / 4);
        const stat = Math.floor((((base + dv) * 2 + expVal) * level) / 100);
        return isHp ? (stat + level + 10) : (stat + 5);
    };

    return {
        maxHP: calc(baseHp, hpDV, hpEV, true),
        attack: calc(baseAtk, attackDV, attackEV, false),
        defense: calc(baseDef, defenseDV, defenseEV, false),
        speed: calc(baseSpd, speedDV, speedEV, false),
        spAttack: calc(baseSpc, specialDV, specialEV, false),
    };
}

export function decodePokedex(mem: MemoryReader): { seenCount: number; ownedCount: number; ownedMask: Uint8Array; caughtNames: string[] } {
    const ownedMask = mem.readBytes(0xD2F7, 19);
    const seenMask = mem.readBytes(0xD30A, 19);

    let ownedCount = 0;
    let seenCount = 0;
    const caughtNames: string[] = [];

    for (let dexNum = 1; dexNum <= 151; dexNum++) {
        const byteIdx = Math.floor((dexNum - 1) / 8);
        const bitIdx = (dexNum - 1) % 8;

        const ownedByte = ownedMask[byteIdx] ?? 0;
        const seenByte = seenMask[byteIdx] ?? 0;

        if ((ownedByte & (1 << bitIdx)) !== 0) {
            ownedCount++;
            const name = POKEDEX_SPECIES_NAMES[dexNum];
            if (name) caughtNames.push(name);
        }
        if ((seenByte & (1 << bitIdx)) !== 0) {
            seenCount++;
        }
    }

    return { seenCount, ownedCount, ownedMask, caughtNames };
}

export function decodeParty(mem: MemoryReader): PokemonPartyMember[] {
    const partyCount = Math.min(6, Math.max(0, mem.readU8(0xD163)));
    const party: PokemonPartyMember[] = [];

    for (let i = 0; i < partyCount; i++) {
        const monAddr = 0xD16B + i * 44;
        const nickAddr = 0xD2B5 + i * 11;
        const otAddr = 0xD273 + i * 11;

        const raw = PartyMonDataSchema.read(mem, monAddr);
        if (raw.internalSpecies === 0x00 || raw.internalSpecies === 0xFF) continue;

        const pokedexNumber = getPokedexNumberFromInternal(raw.internalSpecies);
        const species = INTERNAL_SPECIES_NAMES[raw.internalSpecies] ?? `UNKNOWN_${raw.internalSpecies}`;
        const nickname = decodeString(mem, nickAddr, 11);
        const otName = decodeString(mem, otAddr, 11);

        const type1 = TYPE_NAMES[raw.type1Id] ?? 'UNKNOWN';
        const type2 = TYPE_NAMES[raw.type2Id] ?? 'UNKNOWN';
        const type = raw.type1Id !== raw.type2Id && type2 !== 'UNKNOWN' ? `${type1}/${type2}` : type1;

        const moves = decodeMoves(mem, monAddr + 8, monAddr + 29);

        const attackDV = (raw.iv >> 12) & 0x0F;
        const defenseDV = (raw.iv >> 8) & 0x0F;
        const speedDV = (raw.iv >> 4) & 0x0F;
        const specialDV = raw.iv & 0x0F;
        const hpDV = ((attackDV & 1) << 3) | ((defenseDV & 1) << 2) | ((speedDV & 1) << 1) | (specialDV & 1);

        const is_asleep = (raw.statusByte & 0x07) !== 0;
        const has_poison = (raw.statusByte & 0x08) !== 0;
        const has_burn = (raw.statusByte & 0x10) !== 0;
        const has_freeze = (raw.statusByte & 0x20) !== 0;
        const has_paralysis = (raw.statusByte & 0x40) !== 0;

        let status = 'OK';
        if (raw.hp === 0) status = 'FNT';
        else if (is_asleep) status = 'SLP';
        else if (has_poison) status = 'PSN';
        else if (has_burn) status = 'BRN';
        else if (has_freeze) status = 'FRZ';
        else if (has_paralysis) status = 'PAR';

        const isShiny = speedDV === 10 && defenseDV === 10 && specialDV === 10
            && [2, 3, 6, 7, 10, 11, 14, 15].includes(attackDV);

        let gender: 'Male' | 'Female' | 'Genderless' = 'Genderless';
        if ([29, 30, 31].includes(pokedexNumber)) gender = 'Female';
        else if ([32, 33, 34].includes(pokedexNumber)) gender = 'Male';

        let is_confused: boolean | undefined = undefined;
        if (i === 0) {
            const confusionByte = mem.readU8(0xD062);
            is_confused = (confusionByte & 0x80) !== 0;
        }

        party.push({
            nickname: nickname.length > 0 ? nickname : species,
            species,
            pokedexNumber,
            level: raw.level,
            hp: raw.hp,
            maxHP: raw.maxHP,
            attack: raw.attack,
            defense: raw.defense,
            speed: raw.speed,
            spAttack: raw.spAttack,
            spDefense: raw.spAttack,
            status,
            type,
            type1,
            type2,
            is_asleep,
            has_poison,
            has_burn,
            has_freeze,
            has_paralysis,
            is_confused,
            gender,
            isShiny,
            moves,
            otName,
            otId: raw.otId,
            experience: raw.experience,
            hpEV: raw.hpEV,
            attackEV: raw.attackEV,
            defenseEV: raw.defenseEV,
            speedEV: raw.speedEV,
            spAttackEV: raw.spAttackEV,
            attackDV,
            defenseDV,
            speedDV,
            specialDV,
            hpDV,
        });
    }

    return party;
}

export function decodeStoredPokemon(mem: MemoryReader, boxNumber: number): PokemonStoredMember[] {
    const numInBox = Math.min(20, Math.max(0, mem.readU8(0xDA80)));
    const stored: PokemonStoredMember[] = [];

    for (let i = 0; i < numInBox; i++) {
        const monAddr = 0xDA96 + i * 33;
        const nickAddr = 0xDE06 + i * 11;
        const otAddr = 0xDD2A + i * 11;

        const raw = StoredMonDataSchema.read(mem, monAddr);
        if (raw.internalSpecies === 0x00 || raw.internalSpecies === 0xFF) continue;

        const pokedexNumber = getPokedexNumberFromInternal(raw.internalSpecies);
        const species = INTERNAL_SPECIES_NAMES[raw.internalSpecies] ?? `UNKNOWN_${raw.internalSpecies}`;
        const nickname = decodeString(mem, nickAddr, 11);
        const otName = decodeString(mem, otAddr, 11);

        const type1 = TYPE_NAMES[raw.type1Id] ?? 'UNKNOWN';
        const type2 = TYPE_NAMES[raw.type2Id] ?? 'UNKNOWN';
        const type = raw.type1Id !== raw.type2Id && type2 !== 'UNKNOWN' ? `${type1}/${type2}` : type1;

        const moves = decodeMoves(mem, monAddr + 8, monAddr + 29);

        const attackDV = (raw.iv >> 12) & 0x0F;
        const defenseDV = (raw.iv >> 8) & 0x0F;
        const speedDV = (raw.iv >> 4) & 0x0F;
        const specialDV = raw.iv & 0x0F;
        const hpDV = ((attackDV & 1) << 3) | ((defenseDV & 1) << 2) | ((speedDV & 1) << 1) | (specialDV & 1);

        const { maxHP, attack, defense, speed, spAttack } = calculateBoxStats(
            mem,
            pokedexNumber,
            raw.level,
            hpDV, attackDV, defenseDV, speedDV, specialDV,
            raw.hpEV, raw.attackEV, raw.defenseEV, raw.speedEV, raw.spAttackEV,
        );

        const is_asleep = (raw.statusByte & 0x07) !== 0;
        const has_poison = (raw.statusByte & 0x08) !== 0;
        const has_burn = (raw.statusByte & 0x10) !== 0;
        const has_freeze = (raw.statusByte & 0x20) !== 0;
        const has_paralysis = (raw.statusByte & 0x40) !== 0;

        let status = 'OK';
        if (raw.hp === 0) status = 'FNT';
        else if (is_asleep) status = 'SLP';
        else if (has_poison) status = 'PSN';
        else if (has_burn) status = 'BRN';
        else if (has_freeze) status = 'FRZ';
        else if (has_paralysis) status = 'PAR';

        const isShiny = speedDV === 10 && defenseDV === 10 && specialDV === 10
            && [2, 3, 6, 7, 10, 11, 14, 15].includes(attackDV);

        let gender: 'Male' | 'Female' | 'Genderless' = 'Genderless';
        if ([29, 30, 31].includes(pokedexNumber)) gender = 'Female';
        else if ([32, 33, 34].includes(pokedexNumber)) gender = 'Male';

        stored.push({
            box: boxNumber,
            nickname: nickname.length > 0 ? nickname : species,
            species,
            pokedexNumber,
            level: raw.level,
            hp: raw.hp,
            maxHP,
            attack,
            defense,
            speed,
            spAttack,
            spDefense: spAttack,
            status,
            type,
            type1,
            type2,
            is_asleep,
            has_poison,
            has_burn,
            has_freeze,
            has_paralysis,
            gender,
            isShiny,
            moves,
            otName,
            otId: raw.otId,
            experience: raw.experience,
            hpEV: raw.hpEV,
            attackEV: raw.attackEV,
            defenseEV: raw.defenseEV,
            speedEV: raw.speedEV,
            spAttackEV: raw.spAttackEV,
            attackDV,
            defenseDV,
            speedDV,
            specialDV,
            hpDV,
        });
    }

    return stored;
}

export function decodeInventory(mem: MemoryReader, countAddr: number, maxItems: number): InventoryItem[] {
    const count = Math.min(maxItems, Math.max(0, mem.readU8(countAddr)));
    const items: InventoryItem[] = [];

    for (let i = 0; i < count; i++) {
        const itemId = mem.readU8(countAddr + 1 + i * 2);
        const quantity = mem.readU8(countAddr + 2 + i * 2);
        if (itemId === 0xFF || itemId === 0x00) break;

        let name: string;
        if (itemId >= 0xC4 && itemId <= 0xC8) {
            const hmNum = itemId - 0xC3;
            name = `HM${hmNum.toString().padStart(2, '0')}`;
        } else if (itemId >= 0xC9 && itemId <= 0xFE) {
            const tmNum = itemId - 0xC8;
            name = `TM${tmNum.toString().padStart(2, '0')}`;
        } else {
            name = ITEM_NAMES[itemId] ?? `UNKNOWN_0x${itemId.toString(16).toUpperCase()}`;
        }

        items.push({ id: itemId, name, quantity });
    }

    return items;
}

export function decodeStoredItems(mem: MemoryReader, countAddr: number, maxItems: number): InventoryItem[] {
    const count = Math.min(maxItems, Math.max(0, mem.readU8(countAddr)));
    const items: InventoryItem[] = [];

    for (let i = 0; i < count; i++) {
        const addr = countAddr + 1 + i * 2;
        if (addr > 0xD59E) break;

        const itemId = mem.readU8(addr);
        const quantity = mem.readU8(addr + 1);
        if (itemId === 0xFF || itemId === 0x00) break;

        let name: string;
        if (itemId >= 0xC4 && itemId <= 0xC8) {
            const hmNum = itemId - 0xC3;
            name = `HM${hmNum.toString().padStart(2, '0')}`;
        } else if (itemId >= 0xC9 && itemId <= 0xFE) {
            const tmNum = itemId - 0xC8;
            name = `TM${tmNum.toString().padStart(2, '0')}`;
        } else {
            name = ITEM_NAMES[itemId] ?? `UNKNOWN_0x${itemId.toString(16).toUpperCase()}`;
        }

        items.push({ id: itemId, name, quantity });
    }

    return items;
}

function getMissableObjects(mem: MemoryReader): Map<number, number> {
    const missable = new Map<number, number>();
    let ptr = 0xD5CE;
    let iterations = 0;
    while (iterations < 100) {
        const index = mem.readU8(ptr);
        if (index === 0xFF) break;
        const flagId = mem.readU8(ptr + 1);
        missable.set(index, flagId);
        ptr += 2;
        iterations++;
    }
    return missable;
}

function isMissableObjectRemoved(mem: MemoryReader, flagId: number): boolean {
    const bitPos = flagId % 8;
    const byteOffset = Math.floor(flagId / 8);
    const flagByte = mem.readU8(0xD5A6 + byteOffset);
    return (flagByte & (1 << bitPos)) !== 0;
}

export function decodeMapObjects(mem: MemoryReader, playerX: number, playerY: number): MapObject[] {
    const objects: MapObject[] = [];
    const camX = Math.max(0, playerX - 4);
    const camY = Math.max(0, playerY - 4);
    const missable = getMissableObjects(mem);

    for (let i = 1; i <= 15; i++) {
        const ptr = 0xC100 + i * 16;
        let sprite = mem.readU8(ptr);
        const onScreen = mem.readU8(ptr + 0x02);
        const y = mem.readU8(ptr + 0x104);
        const x = mem.readU8(ptr + 0x105);
        const facingNumeric = mem.readU8(ptr + 0x09);

        const flagId = missable.get(i);
        if (flagId !== undefined && isMissableObjectRemoved(mem, flagId)) {
            sprite = 0;
        }

        if (i === 15) {
            if (onScreen === 0xFF) {
                sprite = 0;
            } else if (sprite === 0x49) {
                sprite = 0x3D;
            }
        }

        if (sprite !== 0) {
            const finalX = x - 4;
            const finalY = y - 4;

            if (finalX >= camX && finalX < camX + 10 && finalY >= camY && finalY < camY + 9) {
                const name = SPRITE_NAMES[sprite] ?? `SPRITE_0x${sprite.toString(16).toUpperCase().padStart(2, '0')}`;
                let facing: 'down' | 'up' | 'left' | 'right' | 'unknown' = 'unknown';
                if (facingNumeric === 0x00) facing = 'down';
                else if (facingNumeric === 0x04) facing = 'up';
                else if (facingNumeric === 0x08) facing = 'left';
                else if (facingNumeric === 0x0C) facing = 'right';

                const movementByte1 = mem.readU8(ptr + 0x106);
                const is_moving_npc = movementByte1 === 0xFE;

                objects.push({
                    id: i,
                    sprite,
                    x: finalX,
                    y: finalY,
                    facing,
                    name,
                    movement_type: movementByte1,
                    is_moving_npc,
                });
            }
        }
    }

    return objects;
}

export function decodeEnemyPokemon(mem: MemoryReader, ownedMask: Uint8Array): EnemyPokemon | null {
    const raw = EnemyPokemonDataSchema.read(mem, 0xCFE5);
    if (raw.speciesId === 0) return null;

    const pokedexNumber = getPokedexNumberFromInternal(raw.speciesId);
    const species = INTERNAL_SPECIES_NAMES[raw.speciesId] ?? `UNKNOWN_${raw.speciesId}`;
    const level = raw.level;
    const hp = raw.hp;
    const maxHP = raw.maxHP;
    const hpPercentage = maxHP > 0 ? Math.round((hp / maxHP) * 100) : 0;

    let caught = false;
    if (pokedexNumber >= 1 && pokedexNumber <= 151) {
        const byteIdx = Math.floor((pokedexNumber - 1) / 8);
        const bitIdx = (pokedexNumber - 1) % 8;
        caught = ((ownedMask[byteIdx] ?? 0) & (1 << bitIdx)) !== 0;
    }

    return {
        species,
        pokedexNumber,
        caught,
        level,
        hp,
        maxHP,
        hpPercentage,
    };
}

function isTile0xFFFontDigit(mem: MemoryReader): boolean {
    try {
        // Tile 0xFF in vChars1 is at 0x8FF0 (0x8800 + 0x7F * 16).
        // Font glyph '9' in Pokemon Red/Blue has row 1 = 0x7C 0x7C (offset 2, 3) and row 2 = 0xC6 0xC6 (offset 4, 5).
        return mem.readU8(0x8FF2) === 0x7C && mem.readU8(0x8FF4) === 0xC6;
    } catch {
        return true;
    }
}

export function isTextboxOrMenuOpen(mem: MemoryReader): boolean {
    // 1. Scan wTileMap (0xC3A0..0xC507, 20x18 = 360 tiles) for box borders and menu cursors
    for (let addr = 0xC3A0; addr <= 0xC507; addr++) {
        const tile = mem.readU8(addr);
        if (tile === 0x79 || tile === 0xED) {
            return true;
        }
    }

    // 2. Check engine state flags in WRAM
    // wMenuWatchedKeys (0xCC29): non-zero when HandleMenuInput is listening for joypad
    // wFontLoaded (0xCFC4): bit 0 is set when DisplayTextID is active
    try {
        const watchedKeys = mem.readU8(0xCC29);
        if (watchedKeys !== 0) {
            return true;
        }
        const fontLoaded = mem.readU8(0xCFC4);
        if ((fontLoaded & 0x01) !== 0) {
            return true;
        }
    } catch {
        // Ignore errors if partial memory snapshot does not cover extended WRAM
    }

    return false;
}

export function decodeScreenText(mem: MemoryReader): { screenText: string; rawText: string; isPossiblyMenuOpen: boolean } {
    if (!isTextboxOrMenuOpen(mem)) {
        return {
            screenText: '',
            rawText: '',
            isPossiblyMenuOpen: false,
        };
    }

    const is0xFFFont = isTile0xFFFontDigit(mem);
    const lines: string[] = [];
    const rawLines: string[] = [];

    for (let y = 0; y < 18; y++) {
        let lineText = '';
        let rawLineText = '';

        for (let x = 0; x < 20; x++) {
            const char = mem.readU8(0xC3A0 + y * 20 + x);
            let mapped = GEN1_CHAR_MAP[char] ?? ' ';
            if (char === 0xFF && !is0xFFFont) {
                mapped = ' ';
            }
            rawLineText += mapped;
            lineText += mapped;
        }

        rawLines.push(rawLineText.padEnd(20, ' '));
        const trimmed = lineText.trim();
        const stripped = trimmed.replace(/[┌─┐│└┘\s]/g, '');
        if (stripped.length > 0 && !/^9+$/.test(stripped)) {
            lines.push(trimmed);
        }
    }

    const isPossiblyMenuOpen = lines.some(l =>
        l.includes('POKéMON') || l.includes('ITEM') || l.includes('TRAINER') || l.includes('SAVE') || l.includes('OPTION') || l.includes('CANCEL')
    );

    return {
        screenText: lines.join('\n'),
        rawText: rawLines.join('\n'),
        isPossiblyMenuOpen,
    };
}

function decodeNamingScreenSelection(mem: MemoryReader): string | false {
    if (mem.readU8(0xC3F0) !== 0x79) {
        return false;
    }

    const firstLetter = mem.readU8(0xC406);
    if (firstLetter !== 0x80 && firstLetter !== 0xA0) {
        return false;
    }

    const cursorAddr = mem.readU16LE(0xC034);
    if (cursorAddr < 0xC3A0 || cursorAddr > 0xC508) {
        return false;
    }

    const letterTile = mem.readU8(cursorAddr + 1);
    if (letterTile >= 0x70 && letterTile <= 0x73) {
        return 'ED';
    }

    const letterStr = GEN1_CHAR_MAP[letterTile] ?? ' ';
    if (letterStr === ' ') {
        return false;
    }

    return letterStr;
}

function decodeTerrainGrid(mem: MemoryReader, playerX: number, playerY: number, mapWidth: number, mapHeight: number): {
    visualMap: string;
    simplifiedTerrain: string;
    overworldMap: OverworldMapData;
} {
    const tilesetId = mem.readU8(RAM_TILESET_ID);
    const needsAdvancedCollision = ADVANCED_COLLISION_TILESETS.has(tilesetId);

    const impassableTiles = new Uint8Array(256).fill(1);
    const collisionPtr = mem.readU16LE(0xD530);
    const tilesetType = mem.readU8(0xFFD7);
    let grassTile = 0;

    if (tilesetType > 0) {
        grassTile = mem.readU8(0xD535);
        if (grassTile !== 0xFF) {
            impassableTiles[grassTile] = 0;
        }
    }

    let ptr = collisionPtr;
    while (true) {
        const tileId = mem.readRomU8(ptr);
        if (tileId === 0xFF) break;
        impassableTiles[tileId] = 0;
        ptr++;
    }

    const ledgeTiles = readLedgeTiles(mem);
    const screenTiles = mem.readBytes(0xC3A0, 360);

    const walkableMatrix: boolean[][] = [];
    for (let y = 0; y < 9; y++) {
        const row: boolean[] = [];
        for (let x = 0; x < 10; x++) {
            const bottomLeftX = x * 2;
            const bottomLeftY = y * 2 + 1;

            if (bottomLeftY < 18 && bottomLeftX < 20) {
                const bottomLeftTile = screenTiles[bottomLeftY * 20 + bottomLeftX] ?? 0;
                const bottomRightTile = screenTiles[bottomLeftY * 20 + bottomLeftX + 1] ?? 0;

                let isWalkable: boolean;
                if (needsAdvancedCollision) {
                    const topLeftX = x * 2;
                    const topLeftY = y * 2;

                    if (topLeftY < 18 && topLeftX < 20) {
                        const topLeftTile = screenTiles[topLeftY * 20 + topLeftX] ?? 0;
                        const bottomLeftWalkable = impassableTiles[bottomLeftTile] === 0 || bottomLeftTile === grassTile;
                        const topLeftWalkable = impassableTiles[topLeftTile] === 0 || topLeftTile === grassTile;
                        isWalkable = bottomLeftWalkable && topLeftWalkable;

                        if (tilesetId === CAVE_TILESET_ID && bottomRightTile === 0x17) {
                            isWalkable = impassableTiles[bottomRightTile] === 0 || bottomRightTile === grassTile;
                        }
                    } else {
                        isWalkable = false;
                    }
                } else {
                    isWalkable = impassableTiles[bottomLeftTile] === 0 || bottomLeftTile === grassTile;
                }
                row.push(isWalkable);
            } else {
                row.push(false);
            }
        }
        walkableMatrix.push(row);
    }

    let visualMap = `Map Terrain Grid (Tileset: 0x${tilesetId.toString(16).toUpperCase().padStart(2, '0')})\nLegend: XX = impassable, WW = grass, -- = ledge, CT = cuttable, ~~ = water, .. = ground, Sv = spinner_down, S^ = spinner_up, S> = spinner_right, S< = spinner_left, So = spinner_stop\n\n\n`;
    let simplifiedTerrain = '';
    const overworldMapTiles: Record<string, Record<string, string>> = {};

    for (let y = 0; y < 9; y++) {
        let line = '';
        for (let x = 0; x < 10; x++) {
            const bottomLeftX = x * 2;
            const bottomLeftY = y * 2 + 1;
            const topLeftX = x * 2;
            const topLeftY = y * 2;

            if (bottomLeftY < 18 && bottomLeftX < 20) {
                const bottomLeftTile = screenTiles[bottomLeftY * 20 + bottomLeftX] ?? 0;
                const bottomRightTile = screenTiles[bottomLeftY * 20 + bottomLeftX + 1] ?? 0;
                const topLeftTile = screenTiles[topLeftY * 20 + topLeftX] ?? 0;
                const topRightTile = screenTiles[topLeftY * 20 + bottomLeftX + 1] ?? 0;

                const relX = x - 4 + playerX;
                const relY = y - 4 + playerY;

                let terrainType = '';

                if (tilesetId === INTERIOR_TILESET_ID) {
                    if (bottomLeftTile === 0x5E) {
                        terrainType = 'CLOSED_GATE';
                    }
                }

                if (tilesetId === INDOOR_TILESET_ID && terrainType === '') {
                    if (bottomLeftTile === 0x18 || bottomLeftTile === 0x24) {
                        terrainType = 'CLOSED_GATE';
                    } else if (bottomLeftTile === 0x11 && bottomRightTile === 0x11 && topLeftTile === 0x11 && topRightTile === 0x11) {
                        terrainType = 'HOLE';
                    }
                }

                if (tilesetId === INDOOR_TILESET_ID && terrainType === '') {
                    if (bottomLeftTile === 0x20 && bottomRightTile === 0x30 && topLeftTile === 0x21 && topRightTile === 0x31) {
                        terrainType = 'TELEPORT';
                    } else if (bottomLeftTile === 0x20 && bottomRightTile === 0x30) {
                        terrainType = 'SPINNER_DOWN';
                    } else if (bottomLeftTile === 0x21 && bottomRightTile === 0x31) {
                        terrainType = 'SPINNER_UP';
                    } else if (bottomLeftTile === 0x30 && bottomRightTile === 0x30) {
                        terrainType = 'SPINNER_RIGHT';
                    } else if (bottomLeftTile === 0x20 && bottomRightTile === 0x20) {
                        terrainType = 'SPINNER_LEFT';
                    } else if (bottomLeftTile === 0x5E && bottomRightTile === 0x5E) {
                        terrainType = 'SPINNER_STOP';
                    }
                }

                if (tilesetId === GYM_TILESET_ID && terrainType === '') {
                    if (bottomLeftTile === 0x20 && bottomRightTile === 0x30 && topLeftTile === 0x21 && topRightTile === 0x31) {
                        terrainType = 'TELEPORT';
                    } else if (bottomLeftTile === 0x4C && bottomRightTile === 0x4D) {
                        terrainType = 'SPINNER_DOWN';
                    } else if (bottomLeftTile === 0x3C && bottomRightTile === 0x3D) {
                        terrainType = 'SPINNER_UP';
                    } else if (bottomLeftTile === 0x4D && bottomRightTile === 0x4D) {
                        terrainType = 'SPINNER_RIGHT';
                    } else if (bottomLeftTile === 0x4C && bottomRightTile === 0x4C) {
                        terrainType = 'SPINNER_LEFT';
                    } else if (bottomLeftTile === 0x3F && bottomRightTile === 0x3F) {
                        terrainType = 'SPINNER_STOP';
                    }
                }

                if (tilesetId === SAFARI_ZONE_TILESET_ID && terrainType === '') {
                    if (bottomLeftTile === 0x2E && bottomRightTile === 0x2E) {
                        terrainType = 'ELEVATED_FLOOR';
                    } else if (bottomLeftTile === 0x40) {
                        terrainType = 'STEPS';
                    }
                }

                if (tilesetId === CAVE_TILESET_ID && terrainType === '') {
                    if (bottomLeftTile === 0x1A || bottomLeftTile === 0x18) {
                        terrainType = 'FLOOR';
                    } else if (bottomLeftTile === 0x15) {
                        terrainType = 'STEPS';
                    } else if (bottomLeftTile === 0x05 && bottomRightTile === 0x05) {
                        terrainType = 'ELEVATED_FLOOR';
                    } else if (bottomLeftTile === 0x24 && bottomRightTile === 0x01) {
                        terrainType = 'BOULDER_BARRIER';
                    } else if (bottomLeftTile === 0x2D && bottomRightTile === 0x2E) {
                        terrainType = 'BOULDER_SWITCH';
                    } else if (bottomLeftTile === 0x22 && bottomRightTile === 0x22) {
                        terrainType = 'HOLE';
                    }
                }

                if (terrainType === '') {
                    if (isCutTile(bottomLeftTile, tilesetId)) {
                        terrainType = 'CUT_TREE';
                    } else if (isLedgeTile(bottomLeftTile, tilesetId, ledgeTiles)) {
                        const isVerticalWall = bottomLeftTile === 39 && bottomRightTile === 39 && topLeftTile === 39 && topRightTile === 39;
                        const isHorizontalWall = bottomLeftTile === 55 && bottomRightTile === 55 && topLeftTile === 55 && topRightTile === 55;
                        const isBottomLeftCornerWall = topLeftTile === 39 && topRightTile === 54 && bottomLeftTile === 54 && bottomRightTile === 55;
                        const isBottomRightCornerWall = topLeftTile === 52 && topRightTile === 36 && bottomLeftTile === 55 && bottomRightTile === 52;
                        const isTopLeftCornerWall = bottomLeftTile === 29 && bottomRightTile === 45 && topLeftTile === 48 && topRightTile === 29;

                        const isCaveWall = isVerticalWall || isHorizontalWall || isBottomLeftCornerWall || isBottomRightCornerWall || isTopLeftCornerWall;
                        const isTree = bottomLeftTile === 54 && bottomRightTile === 48;
                        const isDirt = bottomLeftTile === 55 && bottomRightTile === 48;

                        if (isDirt) {
                            terrainType = 'FLOOR';
                        } else if (isCaveWall || isTree) {
                            terrainType = 'WALL';
                        } else {
                            terrainType = 'LEDGE';
                        }
                    } else if (isWaterTile(bottomLeftTile, tilesetId) || isWaterTile(bottomRightTile, tilesetId)) {
                        terrainType = 'WATER';
                    } else if (walkableMatrix[y]?.[x]) {
                        if (bottomLeftTile === grassTile) {
                            terrainType = 'TALL_GRASS';
                        } else {
                            terrainType = 'FLOOR';
                        }
                    } else {
                        terrainType = 'WALL';
                    }
                }

                const sym = TERRAIN_VISUAL_MAP[terrainType] ?? '??';
                line += `[${sym}]`;

                const strRelY = String(relY);
                const strRelX = String(relX);
                const rowObj = overworldMapTiles[strRelY] ?? (overworldMapTiles[strRelY] = {});
                rowObj[strRelX] = terrainType;

                simplifiedTerrain += `(${relX}, ${relY}): ${terrainType}\n`;
            } else {
                line += '[  ]';
            }
        }
        visualMap += line + '\n';
    }

    return {
        visualMap,
        simplifiedTerrain,
        overworldMap: {
            width: mapWidth,
            height: mapHeight,
            tiles: overworldMapTiles,
        },
    };
}

export function decodePokemonRedBlueState(mem: MemoryReader): PokemonRedBlueState {
    const mapId = mem.readU8(0xD35E);
    const playerY = mem.readU8(0xD361);
    const playerX = mem.readU8(0xD362);
    const mapWidth = mem.readU8(0xD369) * 2;
    const mapHeight = mem.readU8(0xD368) * 2;

    const facingByte = mem.readU8(0xC109);
    const facing = decodeFacing(facingByte);

    const badges = mem.readU8(0xD356);
    const badgeCount = countSetBits(badges);

    let money: number;
    try {
        money = mem.readBCD(0xD347, 3);
    } catch {
        money = 0;
    }
    const playerName = decodeString(mem, 0xD158, 11);
    const rivalName = decodeString(mem, 0xD34A, 11);

    const flagByteD728 = mem.readU8(0xD728);
    const isStrengthActive = (flagByteD728 & 0x01) !== 0;
    const onGrass = mem.readU8(0xC207) === 0x80;
    const playerAnimState = mem.readU8(0xD736);
    const isSpinning = (playerAnimState & 0x80) !== 0;

    const movementStateByte = mem.readU8(0xD700);
    const movementState = movementStateByte === 1 ? 'biking' : movementStateByte === 2 ? 'surfing' : 'walking';

    const isJoypadIgnored = mem.readU8(0xCD6B) !== 0;

    let safariStepsLeft = 0;
    if (mapId >= 217 && mapId <= 225) {
        safariStepsLeft = mem.readU16BE(0xD70D);
    }

    const systemStateValue = mem.readU8(0xCFCB);
    let systemState: 'OVERWORLD' | 'LOADING' | 'FULL_MENU_OR_BATTLE_OR_SEEN_BY_NPC' | 'UNKNOWN' = 'UNKNOWN';
    if (systemStateValue === 0x01) systemState = 'OVERWORLD';
    else if (systemStateValue === 0x00) systemState = 'LOADING';
    else if (systemStateValue === 0xFF) systemState = 'FULL_MENU_OR_BATTLE_OR_SEEN_BY_NPC';

    const battleByte = mem.readU8(0xD057);
    const battleType = battleByte === 1 ? 'wild' : battleByte === 2 ? 'trainer' : 'none';
    const inBattle = battleType !== 'none';

    const pokedex = decodePokedex(mem);
    const party = decodeParty(mem);
    const inventory = decodeInventory(mem, 0xD31D, 20);
    const storedItems = decodeStoredItems(mem, 0xD53A, 50);
    const currentBoxNumber = (mem.readU8(0xD5A0) & 0x7F) + 1;
    const storedPokemon = decodeStoredPokemon(mem, currentBoxNumber);
    const objects = decodeMapObjects(mem, playerX, playerY);
    const { screenText, rawText, isPossiblyMenuOpen } = decodeScreenText(mem);

    const enemyPokemon = inBattle ? decodeEnemyPokemon(mem, pokedex.ownedMask) : null;
    const terrain = decodeTerrainGrid(mem, playerX, playerY, mapWidth, mapHeight);
    const namingScreenSelection = decodeNamingScreenSelection(mem);

    return {
        player: {
            position: { x: playerX, y: playerY },
            facing,
            name: playerName,
            rival: rivalName,
            onGrass,
            inBattle,
            badges,
            badgeCount,
            money,
            isSpinning,
            isStrengthActive,
            movementState,
            isVisible: true,
        },
        map: {
            id: mapId,
            group: 0,
            width: mapWidth,
            height: mapHeight,
            position: { x: playerX, y: playerY },
            objects,
            isPossiblyMenuOpen,
        },
        battle: {
            inBattle,
            battleType,
            enemyPokemon,
        },
        enemyPokemon,
        party,
        partyCount: party.length,
        inventory,
        storedItems,
        currentBoxNumber,
        storedPokemon,
        pokedexProgress: {
            seen: pokedex.seenCount,
            caught: pokedex.ownedCount,
            total: 151,
        },
        pokedexCaught: pokedex.caughtNames,
        screenText,
        rawText,
        isJoypadIgnored,
        safariStepsLeft,
        systemState,
        visualMap: terrain.visualMap,
        simplifiedTerrain: terrain.simplifiedTerrain,
        overworldMap: terrain.overworldMap,
        namingScreenSelection,
    };
}
