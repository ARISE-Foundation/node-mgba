import process from 'node:process';
import fs from 'node:fs';
import crypto from 'node:crypto';

export interface RomValidationResult {
    readonly path: string;
    readonly sha256: string;
    readonly sizeBytes: number;
}

/**
 * Checks if a valid test ROM is accessible via ROM_PATH or local fixtures.
 */
export function hasTestRom(): boolean {
    let romPath = process.env['ROM_PATH'];
    const fixtureRom = new URL('../../fixtures/pokemon_blue.gb', import.meta.url).pathname;

    if (!romPath || romPath.trim() === '') {
        if (fs.existsSync(fixtureRom)) {
            romPath = fixtureRom;
        }
    }

    if (!romPath || romPath.trim() === '') {
        return false;
    }

    return fs.existsSync(romPath);
}

/**
 * Resolves the test ROM path from the ROM_PATH environment variable or local fixture,
 * and validates the file's presence and SHA-256 checksum.
 */
export function getTestRom(): RomValidationResult {
    let romPath = process.env['ROM_PATH'];
    const fixtureRom = new URL('../../fixtures/pokemon_blue.gb', import.meta.url).pathname;

    if (!romPath || romPath.trim() === '') {
        if (fs.existsSync(fixtureRom)) {
            romPath = fixtureRom;
        }
    }

    if (!romPath || romPath.trim() === '') {
        throw new Error(
            'ROM_PATH environment variable is required for tests. ' +
            'Please export ROM_PATH (e.g. export ROM_PATH="/path/to/Pokemon - Blue.gb")',
        );
    }

    if (!fs.existsSync(romPath)) {
        throw new Error(`Specified ROM file does not exist at ROM_PATH: "${romPath}"`);
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

import path from 'node:path';
import { fileURLToPath } from 'node:url';

function resolveFixturePath(filename: string): string {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const cand1 = path.resolve(__dirname, '../../../fixtures', filename);
    if (fs.existsSync(cand1)) return cand1;
    const cand2 = path.resolve(__dirname, '../../fixtures', filename);
    if (fs.existsSync(cand2)) return cand2;
    return cand1;
}

export function hasGbaTestRom(): boolean {
    const fixtureRom = resolveFixturePath('super_mario_bros.gba');
    const romPath = process.env['GBA_ROM_PATH'] || fixtureRom;
    return fs.existsSync(romPath);
}

export function getGbaTestRomPath(): string {
    const fixtureRom = resolveFixturePath('super_mario_bros.gba');
    const romPath = process.env['GBA_ROM_PATH'] || fixtureRom;
    if (!fs.existsSync(romPath)) {
        throw new Error(`Specified GBA ROM file does not exist at path: "${romPath}"`);
    }
    return romPath;
}

export function hasGbaSavestate(): boolean {
    const fixtureSs = resolveFixturePath('super_mario_bros.ss0');
    const ssPath = process.env['GBA_SAVESTATE_PATH'] || fixtureSs;
    return fs.existsSync(ssPath);
}

export function getGbaSavestatePath(): string {
    const fixtureSs = resolveFixturePath('super_mario_bros.ss0');
    const ssPath = process.env['GBA_SAVESTATE_PATH'] || fixtureSs;
    if (!fs.existsSync(ssPath)) {
        throw new Error(`Specified GBA savestate does not exist at path: "${ssPath}"`);
    }
    return ssPath;
}

