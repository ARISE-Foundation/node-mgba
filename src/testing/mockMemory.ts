import { Buffer } from 'node:buffer';
import { SnapshotMemoryReader } from '../core/MemoryReader.js';

export interface MockMemoryOptions {
    readonly wramSize?: number | undefined;
    readonly vramSize?: number | undefined;
    readonly sramSize?: number | undefined;
    readonly romSize?: number | undefined;
    readonly frameIndex?: number | undefined;
    readonly timestamp?: number | undefined;
}

export class MockMemoryReader extends SnapshotMemoryReader {
    private _rawWram: Buffer;
    private _rawIo: Buffer;
    private _rawHram: Buffer;
    private _rawVram: Buffer;
    private _rawOam: Buffer;
    private _rawSram: Buffer;
    private _rawRom: Buffer;

    constructor(options: MockMemoryOptions = {}) {
        const rawWram = Buffer.alloc(options.wramSize ?? 0x2000);
        const rawIo = Buffer.alloc(0x80);
        const rawHram = Buffer.alloc(0x7F);
        const rawVram = Buffer.alloc(options.vramSize ?? 0x2000);
        const rawOam = Buffer.alloc(0xA0);
        const rawSram = Buffer.alloc(options.sramSize ?? 0x8000);
        const rawRom = Buffer.alloc(options.romSize ?? 0x100000);

        super({
            wram: rawWram,
            io: rawIo,
            hram: rawHram,
            vram: rawVram,
            oam: rawOam,
            sram: rawSram,
            rom: rawRom,
            ie: 0,
            frameIndex: options.frameIndex ?? 0,
            timestamp: options.timestamp ?? Date.now(),
        });

        this._rawWram = rawWram;
        this._rawIo = rawIo;
        this._rawHram = rawHram;
        this._rawVram = rawVram;
        this._rawOam = rawOam;
        this._rawSram = rawSram;
        this._rawRom = rawRom;
    }

    public writeU8(address: number, value: number): this {
        const val = value & 0xFF;
        if (address >= 0x0000 && address < 0x8000) {
            this._rawRom[address] = val;
        } else if (address >= 0x8000 && address < 0xA000) {
            this._rawVram[address - 0x8000] = val;
        } else if (address >= 0xA000 && address < 0xC000) {
            this._rawSram[address - 0xA000] = val;
        } else if (address >= 0xC000 && address < 0xE000) {
            this._rawWram[address - 0xC000] = val;
        } else if (address >= 0xE000 && address < 0xFE00) {
            this._rawWram[address - 0xE000] = val;
        } else if (address >= 0xFE00 && address < 0xFEA0) {
            this._rawOam[address - 0xFE00] = val;
        } else if (address >= 0xFF00 && address < 0xFF80) {
            this._rawIo[address - 0xFF00] = val;
        } else if (address >= 0xFF80 && address < 0xFFFF) {
            this._rawHram[address - 0xFF80] = val;
        } else if (address === 0xFFFF) {
            // IE register
            (this as unknown as { ie: number }).ie = val;
        }
        return this;
    }

    public writeU16BE(address: number, value: number): this {
        this.writeU8(address, (value >> 8) & 0xFF);
        this.writeU8(address + 1, value & 0xFF);
        return this;
    }

    public writeU16LE(address: number, value: number): this {
        this.writeU8(address, value & 0xFF);
        this.writeU8(address + 1, (value >> 8) & 0xFF);
        return this;
    }

    public writeU24BE(address: number, value: number): this {
        this.writeU8(address, (value >> 16) & 0xFF);
        this.writeU8(address + 1, (value >> 8) & 0xFF);
        this.writeU8(address + 2, value & 0xFF);
        return this;
    }

    public writeU24LE(address: number, value: number): this {
        this.writeU8(address, value & 0xFF);
        this.writeU8(address + 1, (value >> 8) & 0xFF);
        this.writeU8(address + 2, (value >> 16) & 0xFF);
        return this;
    }

    public writeRomU8(offset: number, value: number): this {
        if (offset >= 0 && offset < this._rawRom.length) {
            this._rawRom[offset] = value & 0xFF;
        }
        return this;
    }

    public writeRomBytes(offset: number, data: Uint8Array | Buffer | readonly number[]): this {
        for (let i = 0; i < data.length; i++) {
            const b = data[i];
            if (b !== undefined) {
                this.writeRomU8(offset + i, b);
            }
        }
        return this;
    }

    public writeU32LE(address: number, value: number): this {
        this.writeU8(address, value & 0xFF);
        this.writeU8(address + 1, (value >> 8) & 0xFF);
        this.writeU8(address + 2, (value >> 16) & 0xFF);
        this.writeU8(address + 3, (value >>> 24) & 0xFF);
        return this;
    }

    public writeU32BE(address: number, value: number): this {
        this.writeU8(address, (value >>> 24) & 0xFF);
        this.writeU8(address + 1, (value >> 16) & 0xFF);
        this.writeU8(address + 2, (value >> 8) & 0xFF);
        this.writeU8(address + 3, value & 0xFF);
        return this;
    }

    public writeBCD(address: number, value: number, lengthBytes = 3): this {
        let str = Math.floor(Math.abs(value)).toString();
        const maxDigits = lengthBytes * 2;
        str = str.padStart(maxDigits, '0');
        if (str.length > maxDigits) {
            str = str.slice(str.length - maxDigits);
        }
        for (let i = 0; i < lengthBytes; i++) {
            const highNibble = parseInt(str[i * 2] ?? '0', 10);
            const lowNibble = parseInt(str[i * 2 + 1] ?? '0', 10);
            const byte = (highNibble << 4) | lowNibble;
            this.writeU8(address + i, byte);
        }
        return this;
    }

    public writeString(
        address: number,
        str: string,
        options: {
            readonly charMap?: Readonly<Record<number, string>> | undefined;
            readonly terminator?: number | undefined;
            readonly fixedLength?: number | undefined;
        } = {},
    ): this {
        const charMap = options.charMap;
        const reverseMap = new Map<string, number>();
        if (charMap) {
            for (const [codeStr, charVal] of Object.entries(charMap)) {
                reverseMap.set(charVal, parseInt(codeStr, 10));
            }
        }

        let offset = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str[i];
            if (!char) continue;
            const byteCode = reverseMap.get(char) ?? char.charCodeAt(0);
            this.writeU8(address + offset, byteCode);
            offset++;
        }

        if (options.terminator !== undefined) {
            this.writeU8(address + offset, options.terminator);
            offset++;
        }

        if (options.fixedLength !== undefined && offset < options.fixedLength) {
            const padVal = options.terminator ?? 0x00;
            while (offset < options.fixedLength) {
                this.writeU8(address + offset, padVal);
                offset++;
            }
        }

        return this;
    }

    public writeBytes(address: number, data: Uint8Array | Buffer | readonly number[]): this {
        for (let i = 0; i < data.length; i++) {
            const b = data[i];
            if (b !== undefined) {
                this.writeU8(address + i, b);
            }
        }
        return this;
    }
}

export function createMockMemoryReader(options: MockMemoryOptions = {}): MockMemoryReader {
    return new MockMemoryReader(options);
}
