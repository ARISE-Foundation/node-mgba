import process from 'node:process';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export interface RomValidationResult {
    readonly path: string;
    readonly sha256: string;
    readonly sizeBytes: number;
}

function resolveHomebrewPath(filename: string): string {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const cand1 = path.resolve(__dirname, '../fixtures/homebrew', filename);
    if (fs.existsSync(cand1)) return cand1;
    const cand2 = path.resolve(__dirname, '../../../tests/fixtures/homebrew', filename);
    if (fs.existsSync(cand2)) return cand2;
    return cand1;
}

function resolveRootFixturePath(filename: string): string {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const cand1 = path.resolve(__dirname, '../../fixtures', filename);
    if (fs.existsSync(cand1)) return cand1;
    const cand2 = path.resolve(__dirname, '../../../fixtures', filename);
    if (fs.existsSync(cand2)) return cand2;
    return cand1;
}

export function getHomebrewGbRomPath(): string {
    return resolveHomebrewPath('test_gb.gb');
}

export function getHomebrewGbaRomPath(): string {
    return resolveHomebrewPath('test_gba.gba');
}

export function getHomebrewGbaSavestatePath(): string {
    return resolveHomebrewPath('test_gba.ss0');
}

export function getHomebrewGbSavestatePath(): string {
    return resolveHomebrewPath('test_gb.ss0');
}

/**
 * Checks if a Pokémon-specific ROM is available for plugin tests.
 */
export function hasPokemonRom(): boolean {
    const envPath = process.env['POKEMON_ROM_PATH'];
    if (envPath && fs.existsSync(envPath)) return true;
    const fixtureRom = resolveRootFixturePath('pokemon_blue.gb');
    return fs.existsSync(fixtureRom);
}

/**
 * Resolves the Pokémon ROM path for plugin tests.
 */
export function getPokemonRom(): RomValidationResult {
    const envPath = process.env['POKEMON_ROM_PATH'];
    let romPath = envPath;
    const fixtureRom = resolveRootFixturePath('pokemon_blue.gb');

    if (!romPath || romPath.trim() === '') {
        if (fs.existsSync(fixtureRom)) {
            romPath = fixtureRom;
        }
    }

    if (!romPath || !fs.existsSync(romPath)) {
        throw new Error('Pokémon ROM fixture not found. Set POKEMON_ROM_PATH or provide fixtures/pokemon_blue.gb');
    }

    const stat = fs.statSync(romPath);
    const fileBuffer = fs.readFileSync(romPath);
    const sha256 = crypto.createHash('sha256').update(fileBuffer).digest('hex');

    return { path: romPath, sha256, sizeBytes: stat.size };
}

export function getPokemonRomPath(): string {
    return getPokemonRom().path;
}

/**
 * Checks if a valid Game Boy test ROM is accessible via ROM_PATH or pokemon_blue.gb.
 */
export function hasTestRom(): boolean {
    const envPath = process.env['ROM_PATH'];
    if (envPath && fs.existsSync(envPath)) return true;
    const fixtureRom = resolveRootFixturePath('pokemon_blue.gb');
    return fs.existsSync(fixtureRom);
}

/**
 * Resolves the Game Boy test ROM path from ROM_PATH or pokemon_blue.gb.
 */
export function getTestRom(): RomValidationResult {
    let romPath = process.env['ROM_PATH'];
    const fixtureRom = resolveRootFixturePath('pokemon_blue.gb');

    if (!romPath || romPath.trim() === '') {
        if (fs.existsSync(fixtureRom)) {
            romPath = fixtureRom;
        }
    }

    if (!romPath || !fs.existsSync(romPath)) {
        throw new Error('Game Boy test ROM fixture not found. Set ROM_PATH or provide fixtures/pokemon_blue.gb');
    }

    const stat = fs.statSync(romPath);
    if (stat.size === 0) {
        throw new Error(`ROM file at "${romPath}" is empty (0 bytes)`);
    }

    const fileBuffer = fs.readFileSync(romPath);
    const sha256 = crypto.createHash('sha256').update(fileBuffer).digest('hex');

    return {
        path: romPath,
        sha256,
        sizeBytes: stat.size,
    };
}

export function getTestRomPath(): string {
    return getTestRom().path;
}

/**
 * Checks if a valid GBA test ROM is accessible.
 * Defaults to homebrew test_gba.gba if no custom or commercial ROM is specified.
 */
export function hasGbaTestRom(): boolean {
    const envPath = process.env['GBA_ROM_PATH'];
    if (envPath && fs.existsSync(envPath)) return true;
    const fixtureRom = resolveRootFixturePath('super_mario_bros.gba');
    if (fs.existsSync(fixtureRom)) return true;
    return fs.existsSync(getHomebrewGbaRomPath());
}

/**
 * Resolves the GBA test ROM path, falling back to homebrew test_gba.gba.
 */
export function getGbaTestRomPath(): string {
    const envPath = process.env['GBA_ROM_PATH'];
    if (envPath && fs.existsSync(envPath)) return envPath;
    const fixtureRom = resolveRootFixturePath('super_mario_bros.gba');
    if (fs.existsSync(fixtureRom)) return fixtureRom;
    const homebrewRom = getHomebrewGbaRomPath();
    if (fs.existsSync(homebrewRom)) return homebrewRom;
    throw new Error(`No GBA test ROM found at "${homebrewRom}" or via GBA_ROM_PATH`);
}

/**
 * Checks if a GBA savestate is accessible matching the active GBA ROM.
 */
export function hasGbaSavestate(): boolean {
    const envPath = process.env['GBA_SAVESTATE_PATH'];
    if (envPath && fs.existsSync(envPath)) return true;

    const activeRom = getGbaTestRomPath();
    if (activeRom.includes('super_mario_bros')) {
        const marioSs = resolveRootFixturePath('super_mario_bros.ss0');
        if (fs.existsSync(marioSs)) return true;
    }

    return fs.existsSync(getHomebrewGbaSavestatePath());
}

/**
 * Resolves the GBA savestate path matching the active GBA ROM.
 */
export function getGbaSavestatePath(): string {
    const envPath = process.env['GBA_SAVESTATE_PATH'];
    if (envPath && fs.existsSync(envPath)) return envPath;

    const activeRom = getGbaTestRomPath();
    if (activeRom.includes('super_mario_bros')) {
        const marioSs = resolveRootFixturePath('super_mario_bros.ss0');
        if (fs.existsSync(marioSs)) return marioSs;
    }

    const homebrewSs = getHomebrewGbaSavestatePath();
    if (fs.existsSync(homebrewSs)) return homebrewSs;
    throw new Error(`No GBA savestate found at "${homebrewSs}" or via GBA_SAVESTATE_PATH`);
}


