import { Buffer } from 'node:buffer';

/**
 * Universal MemoryReader interface for decoupled, synchronous Game Boy memory reads.
 * Provides unified bus-mapped reads and physical ROM lookups.
 */
export interface MemoryReader {
    /**
     * Reads an 8-bit unsigned integer from the Game Boy memory bus (0x0000..0xFFFF).
     */
    readU8(address: number): number;

    /**
     * Reads a 16-bit little-endian unsigned integer from the bus.
     */
    readU16LE(address: number): number;

    /**
     * Reads a 16-bit big-endian unsigned integer from the bus.
     */
    readU16BE(address: number): number;

    /**
     * Reads a 24-bit little-endian unsigned integer from the bus.
     */
    readU24LE(address: number): number;

    /**
     * Reads a 24-bit big-endian unsigned integer from the bus.
     */
    readU24BE(address: number): number;

    /**
     * Reads a 32-bit little-endian unsigned integer from the bus.
     */
    readU32LE(address: number): number;

    /**
     * Reads a 32-bit big-endian unsigned integer from the bus.
     */
    readU32BE(address: number): number;

    /**
     * Reads a Binary-Coded Decimal (BCD) integer of the specified byte length from the bus.
     */
    readBCD(address: number, lengthBytes?: number): number;

    /**
     * Reads a single bit (0..7) from a byte at the specified bus address.
     */
    readBit(address: number, bitIndex: number): boolean;

    /**
     * Reads a contiguous sequence of bytes from the bus.
     */
    readBytes(address: number, length: number): Uint8Array;

    /**
     * Reads and decodes a character-mapped string from the bus until the terminator byte or maxLength is reached.
     */
    readString(
        address: number,
        maxLength: number,
        charMap: Readonly<Record<number, string>>,
        terminator?: number
    ): string;

    /**
     * Reads an 8-bit unsigned integer directly from a flat physical ROM offset.
     */
    readRomU8(offset: number): number;

    /**
     * Reads a contiguous slice of bytes directly from a flat physical ROM offset.
     */
    readRomBytes(offset: number, length: number): Uint8Array;
}

/**
 * MemorySnapshotReader extends MemoryReader with atomic frame metadata.
 */
export interface MemorySnapshotReader extends MemoryReader {
    readonly frameIndex: number;
    readonly timestamp: number;
}

export interface SnapshotMemorySlices {
    readonly wram: Buffer | Uint8Array;
    readonly io: Buffer | Uint8Array;
    readonly hram: Buffer | Uint8Array;
    readonly ie?: number | undefined;
    readonly vram?: Buffer | Uint8Array | undefined;
    readonly sram?: Buffer | Uint8Array | undefined;
    readonly oam?: Buffer | Uint8Array | undefined;
    readonly rom?: Buffer | Uint8Array | undefined;
    readonly frameIndex?: number | undefined;
    readonly timestamp?: number | undefined;
}

/**
 * SnapshotMemoryReader provides zero-copy GB/GBC bus mapping over detached byte buffers.
 */
export class SnapshotMemoryReader implements MemorySnapshotReader {
    public readonly frameIndex: number;
    public readonly timestamp: number;
    private readonly vram: Uint8Array | null;
    private readonly wram: Uint8Array;
    private readonly io: Uint8Array;
    private readonly hram: Uint8Array;
    private readonly ie: number | undefined;
    private readonly sram: Uint8Array | null;
    private readonly oam: Uint8Array | null;
    private readonly rom: Uint8Array;

    constructor(slices: SnapshotMemorySlices) {
        if (!slices || typeof slices !== 'object') {
            throw new TypeError('SnapshotMemoryReader: Expected a valid slices options object.');
        }

        const frameIndex = slices.frameIndex ?? 0;
        const timestamp = slices.timestamp ?? 0;
        if (typeof frameIndex !== 'number' || !Number.isFinite(frameIndex) || frameIndex < 0) {
            throw new TypeError('SnapshotMemoryReader: "frameIndex" must be a non-negative finite number.');
        }
        if (typeof timestamp !== 'number' || !Number.isFinite(timestamp) || timestamp < 0) {
            throw new TypeError('SnapshotMemoryReader: "timestamp" must be a non-negative finite number.');
        }
        this.frameIndex = frameIndex;
        this.timestamp = timestamp;

        const wramSlice = slices.wram;
        const ioSlice = slices.io;
        const hramSlice = slices.hram;
        const vramSlice = slices.vram;
        const sramSlice = slices.sram;
        const oamSlice = slices.oam;
        const romSlice = slices.rom;
        const ieVal = slices.ie;

        if (!wramSlice) {
            throw new TypeError('SnapshotMemoryReader: Mandatory "wram" slice is missing from snapshot.');
        }
        if (!(wramSlice instanceof Uint8Array)) {
            throw new TypeError('SnapshotMemoryReader: "wram" slice must be an instance of Uint8Array or Buffer.');
        }
        if (wramSlice.length < 0x2000) {
            throw new RangeError(`SnapshotMemoryReader: "wram" slice is undersized (${wramSlice.length} bytes, minimum 0x2000 required).`);
        }
        this.wram = wramSlice;

        if (!ioSlice) {
            throw new TypeError('SnapshotMemoryReader: Mandatory "io" slice is missing from snapshot.');
        }
        if (!(ioSlice instanceof Uint8Array)) {
            throw new TypeError('SnapshotMemoryReader: "io" slice must be an instance of Uint8Array or Buffer.');
        }
        if (ioSlice.length < 0x80) {
            throw new RangeError(`SnapshotMemoryReader: "io" slice is undersized (${ioSlice.length} bytes, minimum 0x80 required).`);
        }
        this.io = ioSlice;

        if (!hramSlice) {
            throw new TypeError('SnapshotMemoryReader: Mandatory "hram" slice is missing from snapshot.');
        }
        if (!(hramSlice instanceof Uint8Array)) {
            throw new TypeError('SnapshotMemoryReader: "hram" slice must be an instance of Uint8Array or Buffer.');
        }
        if (hramSlice.length < 0x7F) {
            throw new RangeError(`SnapshotMemoryReader: "hram" slice is undersized (${hramSlice.length} bytes, minimum 0x7F required).`);
        }
        this.hram = hramSlice;

        if (ieVal !== undefined) {
            if (typeof ieVal !== 'number' || !Number.isFinite(ieVal)) {
                throw new TypeError(`SnapshotMemoryReader: "ie" must be a finite number (got ${typeof ieVal}).`);
            }
            if (!Number.isInteger(ieVal) || ieVal < 0 || ieVal > 0xFF) {
                throw new RangeError(`SnapshotMemoryReader: "ie" value 0x${ieVal.toString(16)} out of 8-bit range (0x00..0xFF).`);
            }
            this.ie = ieVal;
        } else {
            this.ie = undefined;
        }

        if (vramSlice !== undefined) {
            if (!(vramSlice instanceof Uint8Array)) {
                throw new TypeError('SnapshotMemoryReader: "vram" slice must be an instance of Uint8Array or Buffer.');
            }
            if (vramSlice.length < 0x2000) {
                throw new RangeError(`SnapshotMemoryReader: "vram" slice is undersized (${vramSlice.length} bytes, minimum 0x2000 required).`);
            }
            this.vram = vramSlice;
        } else {
            this.vram = null;
        }

        if (sramSlice !== undefined) {
            if (!(sramSlice instanceof Uint8Array)) {
                throw new TypeError('SnapshotMemoryReader: "sram" slice must be an instance of Uint8Array or Buffer.');
            }
            if (sramSlice.length < 0x2000) {
                throw new RangeError(`SnapshotMemoryReader: "sram" slice is undersized (${sramSlice.length} bytes, minimum 0x2000 required).`);
            }
            this.sram = sramSlice;
        } else {
            this.sram = null;
        }

        if (oamSlice !== undefined) {
            if (!(oamSlice instanceof Uint8Array)) {
                throw new TypeError('SnapshotMemoryReader: "oam" slice must be an instance of Uint8Array or Buffer.');
            }
            if (oamSlice.length < 0xA0) {
                throw new RangeError(`SnapshotMemoryReader: "oam" slice is undersized (${oamSlice.length} bytes, minimum 0xA0 required).`);
            }
            this.oam = oamSlice;
        } else {
            this.oam = null;
        }

        if (romSlice !== undefined) {
            if (!(romSlice instanceof Uint8Array)) {
                throw new TypeError('SnapshotMemoryReader: "rom" slice must be an instance of Uint8Array or Buffer.');
            }
            this.rom = romSlice;
        } else {
            this.rom = Buffer.alloc(0);
        }
    }

    public static fromObservation(obs: {
        readonly memory?: MemorySnapshotReader | undefined;
    }): MemorySnapshotReader {
        if (!obs || typeof obs !== 'object') {
            throw new TypeError('SnapshotMemoryReader: Expected observation object.');
        }
        if (!obs.memory) {
            throw new TypeError('SnapshotMemoryReader.fromObservation: Observation does not contain a memory reader. Did you request memory in observe()?');
        }
        return obs.memory;
    }

    public readU8(address: number): number {
        if (typeof address !== 'number' || !Number.isFinite(address)) {
            throw new TypeError(`SnapshotMemoryReader: Address must be a finite number (got ${typeof address} ${String(address)}).`);
        }
        if (!Number.isInteger(address) || address < 0 || address > 0xFFFF) {
            throw new RangeError(`SnapshotMemoryReader: Invalid bus address 0x${address.toString(16)}. Must be an integer between 0x0000 and 0xFFFF.`);
        }

        // 0x0000..0x7FFF: ROM
        if (address < 0x8000) {
            if (this.rom.length === 0) {
                throw new Error(`SnapshotMemoryReader: ROM slice is required to read bus address 0x${address.toString(16)}.`);
            }
            if (address >= this.rom.length) {
                throw new RangeError(`SnapshotMemoryReader: ROM address 0x${address.toString(16)} exceeds ROM size 0x${this.rom.length.toString(16)}.`);
            }
            return this.rom[address] ?? 0;
        }

        // 0x8000..0x9FFF: VRAM (8 KB)
        if (address < 0xA000) {
            if (!this.vram) {
                throw new Error(`SnapshotMemoryReader: VRAM slice is required to read bus address 0x${address.toString(16)}.`);
            }
            const offset = address - 0x8000;
            return this.vram[offset] ?? 0;
        }

        // 0xA000..0xBFFF: External Cartridge SRAM (8 KB)
        if (address < 0xC000) {
            if (!this.sram) {
                throw new Error(`SnapshotMemoryReader: SRAM slice is required to read bus address 0x${address.toString(16)}.`);
            }
            const offset = address - 0xA000;
            return this.sram[offset] ?? 0;
        }

        // 0xC000..0xDFFF: WRAM (8 KB)
        if (address < 0xE000) {
            const offset = address - 0xC000;
            return this.wram[offset] ?? 0;
        }

        // 0xE000..0xFDFF: Echo RAM (Mirror of WRAM 0xC000..0xDDFF)
        if (address < 0xFE00) {
            const offset = address - 0xE000;
            return this.wram[offset] ?? 0;
        }

        // 0xFE00..0xFE9F: OAM (Sprite attribute table, 160 bytes)
        if (address < 0xFEA0) {
            if (!this.oam) {
                throw new Error(`SnapshotMemoryReader: OAM slice is required to read bus address 0x${address.toString(16)}.`);
            }
            const offset = address - 0xFE00;
            return this.oam[offset] ?? 0;
        }

        // 0xFEA0..0xFEFF: Not Usable / Prohibited
        if (address < 0xFF00) {
            throw new RangeError(`SnapshotMemoryReader: Address 0x${address.toString(16)} is in the prohibited Game Boy bus region (0xFEA0..0xFEFF).`);
        }

        // 0xFF00..0xFF7F: I/O Registers (128 bytes)
        if (address < 0xFF80) {
            const offset = address - 0xFF00;
            return this.io[offset] ?? 0;
        }

        // 0xFF80..0xFFFE: High RAM (HRAM, 127 bytes)
        if (address < 0xFFFF) {
            const offset = address - 0xFF80;
            return this.hram[offset] ?? 0;
        }

        // 0xFFFF: Interrupt Enable Register (IE)
        if (this.ie === undefined) {
            throw new Error('SnapshotMemoryReader: IE register (0xFFFF) is required but was not provided in snapshot slices.');
        }
        return this.ie;
    }

    private getSingleRegionSlice(address: number, length: number): { slice: Uint8Array; offset: number } | null {
        if (length === 0) {
            return { slice: new Uint8Array(0), offset: 0 };
        }
        const end = address + length;
        if (end <= 0x8000) {
            if (this.rom.length === 0) {
                throw new Error(`SnapshotMemoryReader: ROM slice is required to read bus address 0x${address.toString(16)}.`);
            }
            if (end > this.rom.length) {
                throw new RangeError(`SnapshotMemoryReader: ROM address 0x${end.toString(16)} exceeds ROM size 0x${this.rom.length.toString(16)}.`);
            }
            return { slice: this.rom, offset: address };
        }
        if (address >= 0x8000 && end <= 0xA000) {
            if (!this.vram) {
                throw new Error(`SnapshotMemoryReader: VRAM slice is required to read bus address 0x${address.toString(16)}.`);
            }
            return { slice: this.vram, offset: address - 0x8000 };
        }
        if (address >= 0xA000 && end <= 0xC000) {
            if (!this.sram) {
                throw new Error(`SnapshotMemoryReader: SRAM slice is required to read bus address 0x${address.toString(16)}.`);
            }
            return { slice: this.sram, offset: address - 0xA000 };
        }
        if (address >= 0xC000 && end <= 0xE000) {
            return { slice: this.wram, offset: address - 0xC000 };
        }
        if (address >= 0xE000 && end <= 0xFE00) {
            return { slice: this.wram, offset: address - 0xE000 };
        }
        if (address >= 0xFE00 && end <= 0xFEA0) {
            if (!this.oam) {
                throw new Error(`SnapshotMemoryReader: OAM slice is required to read bus address 0x${address.toString(16)}.`);
            }
            return { slice: this.oam, offset: address - 0xFE00 };
        }
        if (address >= 0xFF00 && end <= 0xFF80) {
            return { slice: this.io, offset: address - 0xFF00 };
        }
        if (address >= 0xFF80 && end <= 0xFFFF) {
            return { slice: this.hram, offset: address - 0xFF80 };
        }
        return null;
    }

    public readU16LE(address: number): number {
        if (typeof address !== 'number' || !Number.isFinite(address)) {
            throw new TypeError(`SnapshotMemoryReader: Address must be a finite number (got ${typeof address} ${String(address)}).`);
        }
        if (!Number.isInteger(address) || address < 0 || address > 0xFFFE) {
            throw new RangeError(`SnapshotMemoryReader: 16-bit read at address 0x${address.toString(16)} exceeds 16-bit bus address space.`);
        }
        const region = this.getSingleRegionSlice(address, 2);
        if (region !== null) {
            const s = region.slice;
            const off = region.offset;
            const b0 = s[off] ?? 0;
            const b1 = s[off + 1] ?? 0;
            return (b0 | (b1 << 8)) >>> 0;
        }
        const b0 = this.readU8(address);
        const b1 = this.readU8(address + 1);
        return (b0 | (b1 << 8)) >>> 0;
    }

    public readU16BE(address: number): number {
        if (typeof address !== 'number' || !Number.isFinite(address)) {
            throw new TypeError(`SnapshotMemoryReader: Address must be a finite number (got ${typeof address} ${String(address)}).`);
        }
        if (!Number.isInteger(address) || address < 0 || address > 0xFFFE) {
            throw new RangeError(`SnapshotMemoryReader: 16-bit read at address 0x${address.toString(16)} exceeds 16-bit bus address space.`);
        }
        const region = this.getSingleRegionSlice(address, 2);
        if (region !== null) {
            const s = region.slice;
            const off = region.offset;
            const b0 = s[off] ?? 0;
            const b1 = s[off + 1] ?? 0;
            return ((b0 << 8) | b1) >>> 0;
        }
        const b0 = this.readU8(address);
        const b1 = this.readU8(address + 1);
        return ((b0 << 8) | b1) >>> 0;
    }

    public readU24LE(address: number): number {
        if (typeof address !== 'number' || !Number.isFinite(address)) {
            throw new TypeError(`SnapshotMemoryReader: Address must be a finite number (got ${typeof address} ${String(address)}).`);
        }
        if (!Number.isInteger(address) || address < 0 || address > 0xFFFD) {
            throw new RangeError(`SnapshotMemoryReader: 24-bit read at address 0x${address.toString(16)} exceeds 16-bit bus address space.`);
        }
        const region = this.getSingleRegionSlice(address, 3);
        if (region !== null) {
            const s = region.slice;
            const off = region.offset;
            const b0 = s[off] ?? 0;
            const b1 = s[off + 1] ?? 0;
            const b2 = s[off + 2] ?? 0;
            return (b0 | (b1 << 8) | (b2 << 16)) >>> 0;
        }
        const b0 = this.readU8(address);
        const b1 = this.readU8(address + 1);
        const b2 = this.readU8(address + 2);
        return (b0 | (b1 << 8) | (b2 << 16)) >>> 0;
    }

    public readU24BE(address: number): number {
        if (typeof address !== 'number' || !Number.isFinite(address)) {
            throw new TypeError(`SnapshotMemoryReader: Address must be a finite number (got ${typeof address} ${String(address)}).`);
        }
        if (!Number.isInteger(address) || address < 0 || address > 0xFFFD) {
            throw new RangeError(`SnapshotMemoryReader: 24-bit read at address 0x${address.toString(16)} exceeds 16-bit bus address space.`);
        }
        const region = this.getSingleRegionSlice(address, 3);
        if (region !== null) {
            const s = region.slice;
            const off = region.offset;
            const b0 = s[off] ?? 0;
            const b1 = s[off + 1] ?? 0;
            const b2 = s[off + 2] ?? 0;
            return ((b0 << 16) | (b1 << 8) | b2) >>> 0;
        }
        const b0 = this.readU8(address);
        const b1 = this.readU8(address + 1);
        const b2 = this.readU8(address + 2);
        return ((b0 << 16) | (b1 << 8) | b2) >>> 0;
    }

    public readU32LE(address: number): number {
        if (typeof address !== 'number' || !Number.isFinite(address)) {
            throw new TypeError(`SnapshotMemoryReader: Address must be a finite number (got ${typeof address} ${String(address)}).`);
        }
        if (!Number.isInteger(address) || address < 0 || address > 0xFFFC) {
            throw new RangeError(`SnapshotMemoryReader: 32-bit read at address 0x${address.toString(16)} exceeds 16-bit bus address space.`);
        }
        const region = this.getSingleRegionSlice(address, 4);
        if (region !== null) {
            const s = region.slice;
            const off = region.offset;
            const b0 = s[off] ?? 0;
            const b1 = s[off + 1] ?? 0;
            const b2 = s[off + 2] ?? 0;
            const b3 = s[off + 3] ?? 0;
            return (b0 | (b1 << 8) | (b2 << 16) | (b3 * 0x1000000)) >>> 0;
        }
        const b0 = this.readU8(address);
        const b1 = this.readU8(address + 1);
        const b2 = this.readU8(address + 2);
        const b3 = this.readU8(address + 3);
        return (b0 | (b1 << 8) | (b2 << 16) | (b3 * 0x1000000)) >>> 0;
    }

    public readU32BE(address: number): number {
        if (typeof address !== 'number' || !Number.isFinite(address)) {
            throw new TypeError(`SnapshotMemoryReader: Address must be a finite number (got ${typeof address} ${String(address)}).`);
        }
        if (!Number.isInteger(address) || address < 0 || address > 0xFFFC) {
            throw new RangeError(`SnapshotMemoryReader: 32-bit read at address 0x${address.toString(16)} exceeds 16-bit bus address space.`);
        }
        const region = this.getSingleRegionSlice(address, 4);
        if (region !== null) {
            const s = region.slice;
            const off = region.offset;
            const b0 = s[off] ?? 0;
            const b1 = s[off + 1] ?? 0;
            const b2 = s[off + 2] ?? 0;
            const b3 = s[off + 3] ?? 0;
            return ((b0 * 0x1000000) | (b1 << 16) | (b2 << 8) | b3) >>> 0;
        }
        const b0 = this.readU8(address);
        const b1 = this.readU8(address + 1);
        const b2 = this.readU8(address + 2);
        const b3 = this.readU8(address + 3);
        return ((b0 * 0x1000000) | (b1 << 16) | (b2 << 8) | b3) >>> 0;
    }

    public readBCD(address: number, lengthBytes = 1): number {
        if (typeof lengthBytes !== 'number' || !Number.isFinite(lengthBytes)) {
            throw new TypeError(`SnapshotMemoryReader: lengthBytes must be a finite number (got ${typeof lengthBytes} ${String(lengthBytes)}).`);
        }
        if (!Number.isInteger(lengthBytes) || lengthBytes < 1 || lengthBytes > 7) {
            throw new RangeError(`SnapshotMemoryReader: Invalid lengthBytes ${String(lengthBytes)}. Must be an integer between 1 and 7.`);
        }
        if (typeof address !== 'number' || !Number.isFinite(address)) {
            throw new TypeError(`SnapshotMemoryReader: Address must be a finite number (got ${typeof address} ${String(address)}).`);
        }
        if (!Number.isInteger(address) || address < 0 || address + lengthBytes - 1 > 0xFFFF) {
            throw new RangeError(`SnapshotMemoryReader: BCD read range [0x${address.toString(16)}..0x${(address + lengthBytes).toString(16)}] exceeds bus address space.`);
        }
        let result = 0;
        for (let i = 0; i < lengthBytes; i++) {
            const byte = this.readU8(address + i);
            const high = (byte >> 4) & 0x0F;
            const low = byte & 0x0F;
            if (high > 9 || low > 9) {
                throw new RangeError(
                    `SnapshotMemoryReader: Invalid BCD byte 0x${byte.toString(16).padStart(2, '0')} at address 0x${(address + i).toString(16)}.`
                );
            }
            result = result * 100 + (high * 10 + low);
        }
        return result;
    }

    public readBit(address: number, bitIndex: number): boolean {
        if (typeof bitIndex !== 'number' || !Number.isFinite(bitIndex)) {
            throw new TypeError(`SnapshotMemoryReader: bitIndex must be a finite number (got ${typeof bitIndex} ${String(bitIndex)}).`);
        }
        if (!Number.isInteger(bitIndex) || bitIndex < 0 || bitIndex > 7) {
            throw new RangeError(`SnapshotMemoryReader: bitIndex must be an integer between 0 and 7 (got ${String(bitIndex)}).`);
        }
        const byte = this.readU8(address);
        return (byte & (1 << bitIndex)) !== 0;
    }

    public readBytes(address: number, length: number): Uint8Array {
        if (typeof address !== 'number' || !Number.isFinite(address)) {
            throw new TypeError(`SnapshotMemoryReader: Address must be a finite number (got ${typeof address} ${String(address)}).`);
        }
        if (!Number.isInteger(address) || address < 0 || address > 0xFFFF) {
            throw new RangeError(`SnapshotMemoryReader: Invalid bus address 0x${address.toString(16)}.`);
        }
        if (typeof length !== 'number' || !Number.isFinite(length)) {
            throw new TypeError(`SnapshotMemoryReader: Length must be a finite number (got ${typeof length} ${String(length)}).`);
        }
        if (!Number.isInteger(length) || length < 0) {
            throw new RangeError(`SnapshotMemoryReader: Invalid length ${String(length)}. Must be a non-negative integer.`);
        }
        if (length === 0) {
            return new Uint8Array(0);
        }
        if (address + length > 0x10000) {
            throw new RangeError(`SnapshotMemoryReader: Byte read range [0x${address.toString(16)}..0x${(address + length).toString(16)}] exceeds bus address space.`);
        }
        const region = this.getSingleRegionSlice(address, length);
        if (region !== null) {
            return region.slice.slice(region.offset, region.offset + length);
        }
        const buf = new Uint8Array(length);
        for (let i = 0; i < length; i++) {
            buf[i] = this.readU8(address + i);
        }
        return buf;
    }

    public readString(
        address: number,
        maxLength: number,
        charMap: Readonly<Record<number, string>>,
        terminator = 0x50
    ): string {
        if (typeof address !== 'number' || !Number.isFinite(address)) {
            throw new TypeError(`SnapshotMemoryReader: Address must be a finite number (got ${typeof address} ${String(address)}).`);
        }
        if (!Number.isInteger(address) || address < 0 || address > 0xFFFF) {
            throw new RangeError(`SnapshotMemoryReader: Invalid bus address 0x${address.toString(16)}.`);
        }
        if (typeof maxLength !== 'number' || !Number.isFinite(maxLength)) {
            throw new TypeError(`SnapshotMemoryReader: maxLength must be a finite number (got ${typeof maxLength} ${String(maxLength)}).`);
        }
        if (!Number.isInteger(maxLength) || maxLength < 0) {
            throw new RangeError(`SnapshotMemoryReader: Invalid maxLength ${String(maxLength)}. Must be a non-negative integer.`);
        }
        if (address + maxLength > 0x10000) {
            throw new RangeError(`SnapshotMemoryReader: String read range [0x${address.toString(16)}..0x${(address + maxLength).toString(16)}] exceeds bus address space.`);
        }
        if (!charMap || typeof charMap !== 'object') {
            throw new TypeError('SnapshotMemoryReader: charMap must be an object.');
        }
        if (typeof terminator !== 'number' || !Number.isFinite(terminator)) {
            throw new TypeError(`SnapshotMemoryReader: terminator must be a finite number (got ${typeof terminator} ${String(terminator)}).`);
        }
        if (!Number.isInteger(terminator) || terminator < 0 || terminator > 0xFF) {
            throw new RangeError(`SnapshotMemoryReader: terminator 0x${terminator.toString(16)} out of 8-bit range (0x00..0xFF).`);
        }
        let text = '';
        for (let i = 0; i < maxLength; i++) {
            const byte = this.readU8(address + i);
            if (byte === terminator) {
                break;
            }
            text += charMap[byte] ?? '?';
        }
        return text;
    }

    public readRomU8(offset: number): number {
        if (typeof offset !== 'number' || !Number.isFinite(offset)) {
            throw new TypeError(`SnapshotMemoryReader: ROM offset must be a finite number (got ${typeof offset} ${String(offset)}).`);
        }
        if (!Number.isInteger(offset) || offset < 0) {
            throw new RangeError(`SnapshotMemoryReader: Invalid ROM offset 0x${offset.toString(16)}.`);
        }
        if (this.rom.length === 0) {
            throw new Error('SnapshotMemoryReader: ROM slice is required for readRomU8.');
        }
        if (offset >= this.rom.length) {
            throw new RangeError(`SnapshotMemoryReader: ROM offset 0x${offset.toString(16)} out of bounds (rom size: 0x${this.rom.length.toString(16)}).`);
        }
        return this.rom[offset] ?? 0;
    }

    public readRomBytes(offset: number, length: number): Uint8Array {
        if (typeof offset !== 'number' || !Number.isFinite(offset)) {
            throw new TypeError(`SnapshotMemoryReader: ROM offset must be a finite number (got ${typeof offset} ${String(offset)}).`);
        }
        if (!Number.isInteger(offset) || offset < 0) {
            throw new RangeError(`SnapshotMemoryReader: Invalid ROM offset 0x${offset.toString(16)}.`);
        }
        if (typeof length !== 'number' || !Number.isFinite(length)) {
            throw new TypeError(`SnapshotMemoryReader: Length must be a finite number (got ${typeof length} ${String(length)}).`);
        }
        if (!Number.isInteger(length) || length < 0) {
            throw new RangeError(`SnapshotMemoryReader: Invalid length ${String(length)}.`);
        }
        if (this.rom.length === 0) {
            throw new Error('SnapshotMemoryReader: ROM slice is required for readRomBytes.');
        }
        if (offset + length > this.rom.length) {
            throw new RangeError(`SnapshotMemoryReader: ROM range [0x${offset.toString(16)}..0x${(offset + length).toString(16)}] out of bounds (rom size: 0x${this.rom.length.toString(16)}).`);
        }
        return this.rom.subarray(offset, offset + length);
    }
}
