import fs from 'node:fs';
import type { MemoryRegionName } from '../types/MemoryRegion.js';

export interface SymbolRecord {
    readonly name: string;
    readonly address: number;
    readonly bank?: number | undefined;
    readonly region: MemoryRegionName;
    readonly size?: number | undefined;
    readonly writable: boolean;
}

export function inferRegionFromAddress(address: number): { region: MemoryRegionName; writable: boolean } {
    const addr = address >>> 0;

    // GBA address map
    if (addr >= 0x08000000 && addr <= 0x0DFFFFFF) {
        return { region: 'ROM', writable: false };
    }
    if (addr >= 0x02000000 && addr <= 0x0203FFFF) {
        return { region: 'EWRAM', writable: true };
    }
    if (addr >= 0x03000000 && addr <= 0x03007FFF) {
        return { region: 'IWRAM', writable: true };
    }
    if (addr >= 0x04000000 && addr <= 0x040003FF) {
        return { region: 'IO', writable: true };
    }
    if (addr >= 0x05000000 && addr <= 0x050003FF) {
        return { region: 'PALETTE', writable: true };
    }
    if (addr >= 0x06000000 && addr <= 0x06017FFF) {
        return { region: 'VRAM', writable: true };
    }
    if (addr >= 0x07000000 && addr <= 0x070003FF) {
        return { region: 'OAM', writable: true };
    }
    if (addr >= 0x0E000000 && addr <= 0x0E00FFFF) {
        return { region: 'SRAM', writable: true };
    }

    // GB/CGB address map
    if (addr < 0x8000) {
        return { region: 'ROM', writable: false };
    }
    if (addr >= 0x8000 && addr <= 0x9FFF) {
        return { region: 'VRAM', writable: true };
    }
    if (addr >= 0xA000 && addr <= 0xBFFF) {
        return { region: 'SRAM', writable: true };
    }
    if (addr >= 0xC000 && addr <= 0xDFFF) {
        return { region: 'WRAM', writable: true };
    }
    if (addr >= 0xFE00 && addr <= 0xFE9F) {
        return { region: 'OAM', writable: true };
    }
    if (addr >= 0xFF80 && addr <= 0xFFFE) {
        return { region: 'HRAM', writable: true };
    }
    if (addr >= 0xFF00 && addr <= 0xFF7F) {
        return { region: 'IO', writable: true };
    }

    return { region: 'WRAM', writable: true };
}

export class SymbolManager {
    private symbols = new Map<string, SymbolRecord>();

    /**
     * Loads and parses an RGBDS .sym format file from disk.
     */
    public loadRgbdsSymFile(filepath: string): this {
        const content = fs.readFileSync(filepath, 'utf8');
        return this.parseRgbdsSym(content);
    }

    /**
     * Parses an RGBDS .sym format content string.
     * Format: `<bank>:<address> <name>` (e.g. `00:d163 wPartyCount` or `01:4000 Func_Main`)
     */
    public parseRgbdsSym(content: string): this {
        const lines = content.split(/\r?\n/);
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('#')) continue;

            const match = trimmed.match(/^([0-9a-fA-F]+):([0-9a-fA-F]+)\s+([a-zA-Z0-9_$.@]+)/);
            if (match && match[1] && match[2] && match[3]) {
                const bank = parseInt(match[1], 16);
                const address = parseInt(match[2], 16);
                const name = match[3];

                const { region, writable } = inferRegionFromAddress(address);
                this.symbols.set(name, {
                    name,
                    address,
                    bank,
                    region,
                    writable,
                });
            }
        }
        return this;
    }

    /**
     * Loads and parses a GNU ld / devkitARM .map format file from disk.
     */
    public loadGnuMapFile(filepath: string): this {
        const content = fs.readFileSync(filepath, 'utf8');
        return this.parseGnuMap(content);
    }

    /**
     * Parses a GNU ld / devkitARM .map format content string.
     */
    public parseGnuMap(content: string): this {
        const lines = content.split(/\r?\n/);
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('.')) continue;

            const match = trimmed.match(/^0x([0-9a-fA-F]{8})\s+([a-zA-Z0-9_]+)/);
            if (match && match[1] && match[2]) {
                const address = parseInt(match[1], 16);
                const name = match[2];
                const { region, writable } = inferRegionFromAddress(address);
                this.symbols.set(name, {
                    name,
                    address,
                    region,
                    writable,
                });
            }
        }
        return this;
    }

    /**
     * Manually registers a symbol record or dictionary of names to addresses.
     */
    public add(name: string, address: number, bank?: number): this {
        const { region, writable } = inferRegionFromAddress(address);
        this.symbols.set(name, {
            name,
            address,
            bank,
            region,
            writable,
        });
        return this;
    }

    public addMap(dict: Record<string, number>): this {
        for (const [name, addr] of Object.entries(dict)) {
            this.add(name, addr);
        }
        return this;
    }

    public resolve(name: string): SymbolRecord | undefined {
        return this.symbols.get(name);
    }

    public get(name: string): SymbolRecord {
        const rec = this.symbols.get(name);
        if (!rec) {
            throw new Error(`Symbol "${name}" not found in SymbolManager.`);
        }
        return rec;
    }

    public has(name: string): boolean {
        return this.symbols.has(name);
    }

    public all(): readonly SymbolRecord[] {
        return Array.from(this.symbols.values());
    }

    public clear(): void {
        this.symbols.clear();
    }
}

export function bankedToPhysicalOffset(
    address: number,
    bank?: number,
    bankWindowSize: number = 0x4000,
    bankBaseAddress: number = 0x4000
): number {
    if (bank === undefined) {
        return address >>> 0;
    }
    if (!Number.isInteger(bank) || bank < 0) {
        throw new RangeError(`Invalid bank: ${bank}. Bank must be a non-negative integer.`);
    }
    if (bank === 0 && address < bankBaseAddress) {
        return address >>> 0;
    }
    return ((bank * bankWindowSize) + (address - bankBaseAddress)) >>> 0;
}

