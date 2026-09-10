import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Buffer } from 'node:buffer';
import fs from 'node:fs';
import koffi from 'koffi';
import type { RomInfo, PlatformType, ConsoleModel, CartridgeMetadata } from '../types/RomInfo.js';
import type { MemoryTarget } from '../types/MemoryTarget.js';
import type { VideoPacket, AudioChunk } from '../types/MediaSink.js';
import type {
    MemoryRegionName,
    ReadSpec,
} from '../types/MemoryRegion.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const shimFilename = process.platform === 'win32' ? 'mgba_shim.dll' : 'libmgba_shim.so';
const candidatePaths = [
    path.resolve(__dirname, `../../../native/${shimFilename}`), // Compiled dist/src/core/
    path.resolve(__dirname, `../../native/${shimFilename}`),    // Source src/core/
];
let nativeLibPath = '';
for (const cand of candidatePaths) {
    if (fs.existsSync(cand)) {
        nativeLibPath = cand;
        break;
    }
}
if (!nativeLibPath) {
    throw new Error(
        `Failed to locate ${shimFilename}. Looked in: ${candidatePaths.join(', ')}. ` +
        'Ensure the native library has been built via "pnpm run build:native".',
    );
}

// Load native shared library
const lib = koffi.load(nativeLibPath);

// Opaque handle
const mgba_handle_t = koffi.opaque('mgba_handle_t');
const mgba_handle_ptr = koffi.pointer(mgba_handle_t);

interface NativeRomInfoStruct {
    title: string;
    game_code: string;
    rom_size: number;
    ram_size: number;
    has_battery: number;
    has_rtc: number;
    platform: number;
    model: number;
}

// ROM info struct
const mgba_rom_info_t = koffi.struct('mgba_rom_info_t', {
    title: koffi.array('char', 64),
    game_code: koffi.array('char', 16),
    rom_size: 'uint32_t',
    ram_size: 'uint32_t',
    has_battery: 'uint8_t',
    has_rtc: 'uint8_t',
    platform: 'int',
    model: 'int',
});

// Batch request struct
export interface NativeBatchRequest {
    address: number;
    length: number;
    read_type: number;
    bank: number;
}

const mgba_batch_request_t = koffi.struct('mgba_batch_request_t', {
    address: 'uint32_t',
    length: 'uint16_t',
    bank: 'uint16_t',
    read_type: 'uint8_t',
    _reserved: koffi.array('uint8_t', 3),
});

// C Function Signatures
const mgba_open = lib.func('mgba_open', mgba_handle_ptr, ['string']);
const mgba_close = lib.func('mgba_close', 'void', [mgba_handle_ptr]);
const mgba_reset = lib.func('mgba_reset', 'void', [mgba_handle_ptr]);
const mgba_get_rom_info = lib.func('mgba_get_rom_info', 'bool', [mgba_handle_ptr, koffi.out(koffi.pointer(mgba_rom_info_t))]);
const mgba_get_model = lib.func('mgba_get_model', 'int', [mgba_handle_ptr]);

const mgba_get_video_buffer = lib.func('mgba_get_video_buffer', 'uint8_t *', [
    mgba_handle_ptr,
    koffi.out(koffi.pointer('uint32_t')),
    koffi.out(koffi.pointer('uint32_t')),
    koffi.out(koffi.pointer('uint32_t')),
]);
const mgba_copy_video_buffer = lib.func('mgba_copy_video_buffer', 'size_t', [
    mgba_handle_ptr,
    koffi.out(koffi.pointer('uint8_t')),
    'size_t',
]);

const mgba_get_vram = lib.func('mgba_get_vram', 'uint8_t *', [
    mgba_handle_ptr,
    koffi.out(koffi.pointer('size_t')),
]);
const mgba_copy_vram = lib.func('mgba_copy_vram', 'size_t', [
    mgba_handle_ptr,
    koffi.out(koffi.pointer('uint8_t')),
    'size_t',
]);

const mgba_get_oam = lib.func('mgba_get_oam', 'uint8_t *', [
    mgba_handle_ptr,
    koffi.out(koffi.pointer('size_t')),
]);
const mgba_copy_oam = lib.func('mgba_copy_oam', 'size_t', [
    mgba_handle_ptr,
    koffi.out(koffi.pointer('uint8_t')),
    'size_t',
]);

const mgba_step_frame = lib.func('mgba_step_frame', 'void', [mgba_handle_ptr, 'uint32_t']);
const mgba_get_frame_counter = lib.func('mgba_get_frame_counter', 'uint32_t', [mgba_handle_ptr]);

const mgba_bus_read8 = lib.func('mgba_bus_read8', 'uint8_t', [mgba_handle_ptr, 'uint32_t']);
const mgba_bus_read16 = lib.func('mgba_bus_read16', 'uint16_t', [mgba_handle_ptr, 'uint32_t']);
const mgba_bus_read32 = lib.func('mgba_bus_read32', 'uint32_t', [mgba_handle_ptr, 'uint32_t']);
const mgba_bus_write8 = lib.func('mgba_bus_write8', 'void', [mgba_handle_ptr, 'uint32_t', 'uint8_t']);
const mgba_bus_write16 = lib.func('mgba_bus_write16', 'void', [mgba_handle_ptr, 'uint32_t', 'uint16_t']);
const mgba_bus_write32 = lib.func('mgba_bus_write32', 'void', [mgba_handle_ptr, 'uint32_t', 'uint32_t']);
const mgba_bus_read_range = lib.func('mgba_bus_read_range', 'bool', [mgba_handle_ptr, 'uint32_t', koffi.out(koffi.pointer('uint8_t')), 'size_t']);

const mgba_rom_read8 = lib.func('mgba_rom_read8', 'uint8_t', [mgba_handle_ptr, 'uint32_t']);
const mgba_rom_read_range = lib.func('mgba_rom_read_range', 'bool', [mgba_handle_ptr, 'uint32_t', koffi.out(koffi.pointer('uint8_t')), 'size_t']);
const mgba_bank_read8 = lib.func('mgba_bank_read8', 'uint8_t', [mgba_handle_ptr, 'int', 'int', 'uint32_t']);
const mgba_bank_write8 = lib.func('mgba_bank_write8', 'bool', [mgba_handle_ptr, 'int', 'int', 'uint32_t', 'uint8_t']);
const mgba_read_region = lib.func('mgba_read_region', 'bool', [mgba_handle_ptr, 'int', 'uint32_t', koffi.out(koffi.pointer('uint8_t')), 'size_t']);
const mgba_read_batch = lib.func('mgba_read_batch', 'bool', [
    mgba_handle_ptr,
    koffi.pointer(mgba_batch_request_t),
    'size_t',
    koffi.out(koffi.pointer('uint8_t')),
    'size_t',
]);

const mgba_save_state = lib.func('mgba_save_state', 'bool', [mgba_handle_ptr, 'string']);
const mgba_load_state = lib.func('mgba_load_state', 'bool', [mgba_handle_ptr, 'string']);
const mgba_save_state_buffer = lib.func('mgba_save_state_buffer', 'size_t', [mgba_handle_ptr, koffi.out(koffi.pointer('uint8_t')), 'size_t']);
const mgba_load_state_buffer = lib.func('mgba_load_state_buffer', 'bool', [mgba_handle_ptr, koffi.pointer('uint8_t'), 'size_t']);

const mgba_get_audio_sample_rate = lib.func('mgba_get_audio_sample_rate', 'uint32_t', [mgba_handle_ptr]);
const mgba_read_audio_frames = lib.func('mgba_read_audio_frames', 'size_t', [
    mgba_handle_ptr,
    koffi.out(koffi.pointer('int16_t')),
    'size_t',
]);
const mgba_clear_audio = lib.func('mgba_clear_audio', 'void', [mgba_handle_ptr]);

import { BUTTON_BITMASKS, resolveButtonMask } from './InputActionCompiler.js';
export { BUTTON_BITMASKS as KEY_MASKS, resolveButtonMask };

export function normalizeMemoryRegion(region: string): MemoryRegionName {
    if (typeof region !== 'string') {
        throw new Error(`Invalid memory region: expected string, received ${typeof region}`);
    }
    const upper = region.trim().toUpperCase() as MemoryRegionName;
    switch (upper) {
        case 'ROM':
        case 'WRAM':
        case 'EWRAM':
        case 'VRAM':
        case 'SRAM':
        case 'OAM':
        case 'HRAM':
        case 'IWRAM':
        case 'IO':
        case 'PALETTE':
        case 'BIOS':
            return upper;
        default:
            throw new Error(`Unknown memory region: ${String(region)}`);
    }
}

export function normalizeMemorySpace(space: string): 'bus' | 'rom' | 'wram' | 'vram' | 'sram' {
    if (typeof space !== 'string') {
        throw new Error(`Invalid memory space: expected string, received ${typeof space}`);
    }
    const lower = space.trim().toLowerCase();
    switch (lower) {
        case 'bus':
        case 'rom':
        case 'wram':
        case 'vram':
        case 'sram':
            return lower as 'bus' | 'rom' | 'wram' | 'vram' | 'sram';
        default:
            throw new Error(`Unsupported memory space: ${String(space)}`);
    }
}

export function parseRegionId(region: MemoryRegionName | string): number {
    const canonical = normalizeMemoryRegion(region);
    switch (canonical) {
        case 'ROM': return 0;
        case 'WRAM':
        case 'EWRAM': return 1;
        case 'VRAM': return 2;
        case 'SRAM': return 3;
        case 'OAM': return 4;
        case 'HRAM':
        case 'IWRAM': return 5;
        case 'IO': return 6;
        case 'PALETTE': return 7;
        case 'BIOS': return 8;
    }
}

export class NativeMgbaCore {
    private handle: unknown = null;
    private romPath: string | null = null;
    private romInfo: RomInfo | null = null;
    private videoMeta: { width: number; height: number; strideBytes: number } = {
        width: 160,
        height: 144,
        strideBytes: 160 * 4,
    };
    private sampleRate = 0;
    private audioStagingBuffer: Buffer = Buffer.allocUnsafe(16384 * 4);
    private lastKeys = 0;

    /**
     * Loads and initializes a ROM headlessly.
     */
    public loadROM(romPath: string): RomInfo {
        if (this.handle) {
            this.close();
        }

        const handle = mgba_open(romPath);
        if (!handle) {
            throw new Error(`Failed to initialize mGBA core for ROM: ${romPath}`);
        }

        this.handle = handle;
        this.romPath = romPath;

        const infoOut: Partial<NativeRomInfoStruct> = {};
        const success = mgba_get_rom_info(this.handle, infoOut);

        const platform: PlatformType = infoOut.platform === 0 ? 'GBA' : 'GB/GBC';
        const modelNum = infoOut.model ?? 0;
        const model: ConsoleModel = modelNum === 3 ? 'SGB' : (modelNum === 2 ? 'AGB' : (modelNum === 1 ? 'CGB' : 'DMG'));
        const title = (infoOut.title ?? '').replace(/\0/g, '').trim();
        const gameCode = (infoOut.game_code ?? '').replace(/\0/g, '').trim();
        const romSize = infoOut.rom_size ?? 0;
        const ramSize = infoOut.ram_size ?? 0;
        const hasBattery = (infoOut.has_battery ?? 0) !== 0;
        const hasRtc = (infoOut.has_rtc ?? 0) !== 0;

        const cartridge: CartridgeMetadata = {
            title,
            gameCode,
            romSize,
            ramSize,
            hasBattery,
            hasRtc,
            platform,
            model,
        };

        this.romInfo = {
            title,
            gameCode,
            romSize,
            ramSize,
            hasBattery,
            hasRtc,
            platform,
            model,
            cartridge,
        };

        if (!success) {
            throw new Error(`Failed to read ROM header info for: ${romPath}`);
        }

        // Initialize video metadata
        const w = [0];
        const h = [0];
        const stride = [0];
        mgba_get_video_buffer(this.handle, w, h, stride);
        this.videoMeta = {
            width: w[0] ?? (model === 'AGB' ? 240 : 160),
            height: h[0] ?? (model === 'AGB' ? 160 : 144),
            strideBytes: stride[0] ?? ((w[0] ?? 160) * 4),
        };

        this.updateSampleRate();

        return this.romInfo;
    }

    public getRomInfo(): RomInfo | null {
        return this.romInfo;
    }

    public getModel(): ConsoleModel {
        this.ensureOpen();
        const modelNum = mgba_get_model(this.handle);
        return modelNum === 2 ? 'AGB' : (modelNum === 1 ? 'CGB' : 'DMG');
    }

    public getRomPath(): string | null {
        return this.romPath;
    }

    public close(): void {
        if (this.handle) {
            mgba_close(this.handle);
            this.handle = null;
            this.romPath = null;
            this.romInfo = null;
            this.sampleRate = 0;
        }
    }

    public reset(): void {
        this.ensureOpen();
        this.lastKeys = 0;
        mgba_reset(this.handle);
        this.updateSampleRate();
    }

    public stepFrame(keys = 0): void {
        this.ensureOpen();
        this.lastKeys = keys;
        mgba_step_frame(this.handle, keys);
    }

    public getFrameCounter(): number {
        this.ensureOpen();
        return mgba_get_frame_counter(this.handle);
    }

    public getVideoFrame(): VideoPacket {
        this.ensureOpen();
        const width = this.videoMeta.width;
        const height = this.videoMeta.height;
        const strideBytes = width * 4;
        const totalBytes = height * strideBytes;
        const buf = Buffer.allocUnsafe(totalBytes);
        const copied = mgba_copy_video_buffer(this.handle, buf, totalBytes);
        if (copied !== totalBytes) {
            throw new Error(`Failed to copy video frame: expected ${totalBytes} bytes, copied ${copied}`);
        }
        const frameIndex = mgba_get_frame_counter(this.handle);

        return {
            frameIndex,
            pts: frameIndex / (262144 / 4389),
            width,
            height,
            strideBytes,
            buffer: buf,
            keys: this.lastKeys,
        };
    }

    public getVramBuffer(): Buffer {
        this.ensureOpen();
        const sizeOut = [0];
        const ptr = mgba_get_vram(this.handle, sizeOut);
        const size = sizeOut[0] ?? 0;
        if (!ptr || size === 0) return Buffer.alloc(0);
        const buf = Buffer.allocUnsafe(size);
        const copied = mgba_copy_vram(this.handle, buf, size);
        if (copied !== size) return Buffer.alloc(0);
        return buf;
    }

    public getOamBuffer(): Buffer {
        this.ensureOpen();
        const sizeOut = [0];
        const ptr = mgba_get_oam(this.handle, sizeOut);
        const size = sizeOut[0] ?? 0;
        if (!ptr || size === 0) return Buffer.alloc(0);
        const buf = Buffer.allocUnsafe(size);
        const copied = mgba_copy_oam(this.handle, buf, size);
        if (copied !== size) return Buffer.alloc(0);
        return buf;
    }

    public getSramBuffer(): Buffer {
        this.ensureOpen();
        const ramSize = this.romInfo?.cartridge.ramSize ?? 0;
        if (ramSize <= 0) {
            return Buffer.alloc(0);
        }
        return this.readRegion('SRAM', 0, ramSize);
    }

    public getWramBuffer(length?: number): Buffer {
        this.ensureOpen();
        const wramLength = length ?? 0x2000;
        return this.readRegion('WRAM', 0, wramLength);
    }

    public getIoBuffer(): Buffer {
        this.ensureOpen();
        return this.readRegion('IO', 0, 0x80);
    }

    public getHramBuffer(): Buffer {
        this.ensureOpen();
        return this.readRegion('HRAM', 0, 0x7F);
    }

    public getAudioSampleRate(): number {
        this.updateSampleRate();
        return this.sampleRate;
    }

    public readAudioFrames(): AudioChunk | null {
        this.ensureOpen();
        const maxFrames = 16384;
        const framesRead = mgba_read_audio_frames(this.handle, this.audioStagingBuffer, maxFrames);
        if (framesRead === 0) return null;

        this.updateSampleRate();

        const byteLength = framesRead * 4;
        const chunkBuffer = Buffer.allocUnsafe(byteLength);
        this.audioStagingBuffer.copy(chunkBuffer, 0, 0, byteLength);

        const frameIndex = this.getFrameCounter();
        const pts = frameIndex / (262144 / 4389);

        return {
            frameIndex,
            pts,
            sampleRate: this.sampleRate,
            channels: 2,
            sampleFrames: framesRead,
            buffer: chunkBuffer,
        };
    }

    public clearAudio(): void {
        if (!this.handle) return;
        mgba_clear_audio(this.handle);
    }

    public read(target: MemoryTarget): number | Buffer {
        this.ensureOpen();
        const space = normalizeMemorySpace(target.space);

        switch (space) {
            case 'bus': {
                const addr = target.space === 'bus' ? target.address : 0;
                const len = target.space === 'bus' ? target.length : undefined;
                if (len !== undefined && len > 1) {
                    return this.busReadRange(addr, len);
                }
                return mgba_bus_read8(this.handle, addr);
            }
            case 'rom': {
                const offset = target.space === 'rom' ? target.offset : 0;
                const len = target.space === 'rom' ? target.length : undefined;
                if (len !== undefined && len > 1) {
                    return this.romReadRange(offset, len);
                }
                return mgba_rom_read8(this.handle, offset);
            }
            case 'wram': {
                const t = target as { bank: number; offset: number };
                return mgba_bank_read8(this.handle, 1, t.bank, t.offset);
            }
            case 'vram': {
                const t = target as { bank: number; offset: number };
                return mgba_bank_read8(this.handle, 2, t.bank, t.offset);
            }
            case 'sram': {
                const t = target as { bank: number; offset: number };
                return mgba_bank_read8(this.handle, 3, t.bank, t.offset);
            }
            default:
                throw new Error(`Unsupported memory space: ${String(space)}`);
        }
    }

    public bankWrite8(spaceId: number, bank: number, offset: number, value: number): boolean {
        this.ensureOpen();
        return mgba_bank_write8(this.handle, spaceId, bank, offset >>> 0, value & 0xFF);
    }

    public readRegion(region: MemoryRegionName | string, offset: number, length: number): Buffer {
        this.ensureOpen();
        if (!Number.isInteger(length) || length <= 0 || length > 32 * 1024 * 1024) {
            throw new Error(`Invalid region read length: ${length}`);
        }
        const buf = Buffer.alloc(length);
        const regionId = parseRegionId(region);
        const ok = mgba_read_region(this.handle, regionId, offset >>> 0, buf, length);
        if (!ok) {
            throw new Error(`Failed to read region ${region} at offset 0x${offset.toString(16)} (length: ${length})`);
        }
        return buf;
    }

    public readBatch(specs: ReadSpec[]): (number | Buffer)[] {
        this.ensureOpen();
        if (specs.length === 0) return [];
        if (specs.length > 65536) {
            throw new Error(`Exceeded maximum batch size (max 65536 descriptors, got ${specs.length})`);
        }

        let totalBytes = 0;
        const nativeRequests: NativeBatchRequest[] = [];

        for (let i = 0; i < specs.length; i++) {
            const spec = specs[i];
            if (!spec) continue;
            const rawType = spec.type ?? 'u8';
            const type = typeof rawType === 'string' ? rawType.trim().toLowerCase() : rawType;
            let len: number;
            if (type === 'u8') len = 1;
            else if (type === 'u16le') len = 2;
            else if (type === 'u32le') len = 4;
            else if (type === 'bytes') {
                len = spec.length ?? 1;
                if (!Number.isInteger(len) || len <= 0 || len > 65535) {
                    throw new Error(`Invalid byte length at batch descriptor index ${i}: ${len}`);
                }
            } else {
                throw new Error(`Unsupported batch read type at index ${i}: ${String(spec.type)}`);
            }

            let readType = 0; // Bus
            let address: number;
            let bank = spec.bank ?? 0;

            if (spec.region) {
                readType = 5; // Region
                address = spec.offset ?? 0;
                bank = parseRegionId(spec.region);
            } else {
                address = spec.address ?? 0;
                if (spec.bank !== undefined) {
                    if (spec.bank < 0 || spec.bank > 511 || !Number.isInteger(spec.bank)) {
                        throw new Error(`Invalid bank at batch descriptor index ${i}: ${spec.bank}`);
                    }
                    // Check if address is in banked ROM, WRAM, VRAM, or SRAM
                    if (address >= 0x4000 && address < 0x8000) {
                        readType = 6; // Banked ROM
                        address = (address - 0x4000) >>> 0;
                    } else if (address < 0x4000 && spec.bank === 0) {
                        readType = 6; // Banked ROM Bank 0
                        address = address >>> 0;
                    } else if (address >= 0x8000 && address < 0xA000) {
                        readType = 3; // Banked VRAM
                        address = (address - 0x8000) >>> 0;
                    } else if (address >= 0xA000 && address < 0xC000) {
                        readType = 4; // Banked SRAM
                        address = (address - 0xA000) >>> 0;
                    } else if (address >= 0xD000 && address < 0xE000) {
                        readType = 2; // Banked WRAM (0xD000..0xDFFF is bank 1 on DMG or switchable 1..7 on CGB)
                        bank = spec.bank === 0 ? 1 : spec.bank;
                        address = (address - 0xD000) >>> 0;
                    } else if (address >= 0xC000 && address < 0xD000) {
                        readType = 2; // Banked WRAM (0xC000..0xCFFF is fixed bank 0)
                        bank = 0;
                        address = (address - 0xC000) >>> 0;
                    }
                }
            }

            if (!Number.isInteger(address) || address < 0 || address > 0xFFFFFFFF) {
                throw new Error(`Invalid address at batch descriptor index ${i}: ${address}`);
            }

            nativeRequests.push({
                address: address >>> 0,
                length: len,
                read_type: readType,
                bank,
            });
            totalBytes += len;
        }

        if (totalBytes > 32 * 1024 * 1024) {
            throw new Error(`Total batch size exceeds 32 MiB limit: ${totalBytes} bytes`);
        }

        const outBuffer = Buffer.alloc(totalBytes);
        const ok = mgba_read_batch(this.handle, nativeRequests, nativeRequests.length, outBuffer, totalBytes);
        if (!ok) {
            throw new Error(`Failed to execute native read_batch for ${specs.length} descriptors`);
        }

        const results: (number | Buffer)[] = [];
        let cursor = 0;

        for (let i = 0; i < specs.length; i++) {
            const spec = specs[i];
            if (!spec) continue;
            const type = spec.type ?? 'u8';
            if (type === 'u8') {
                results.push(outBuffer.readUInt8(cursor));
                cursor += 1;
            } else if (type === 'u16le') {
                results.push(outBuffer.readUInt16LE(cursor));
                cursor += 2;
            } else if (type === 'u32le') {
                results.push(outBuffer.readUInt32LE(cursor));
                cursor += 4;
            } else {
                const len = spec.length ?? 1;
                const sliceBuf = Buffer.alloc(len);
                outBuffer.copy(sliceBuf, 0, cursor, cursor + len);
                results.push(sliceBuf);
                cursor += len;
            }
        }

        return results;
    }

    private validateBusAddress(address: number, size = 1): number {
        this.ensureOpen();
        if (!Number.isInteger(address) || address < 0 || address > 0xFFFFFFFF) {
            throw new RangeError(`Invalid bus address: ${address}`);
        }
        const isGb = this.romInfo?.platform === 'GB/GBC';
        const maxAddr = isGb ? 0x10000 : 0x10000000;
        if (address + size > maxAddr) {
            throw new RangeError(`Address 0x${address.toString(16)} (size ${size}) exceeds ${isGb ? 'GB' : 'GBA'} bus bounds (max: 0x${maxAddr.toString(16)})`);
        }
        return address >>> 0;
    }

    public busRead8(address: number): number {
        const addr = this.validateBusAddress(address, 1);
        return mgba_bus_read8(this.handle, addr);
    }

    public busWrite8(address: number, value: number): void {
        const addr = this.validateBusAddress(address, 1);
        mgba_bus_write8(this.handle, addr, value & 0xFF);
    }

    public busRead16LE(address: number): number {
        const addr = this.validateBusAddress(address, 2);
        return mgba_bus_read16(this.handle, addr);
    }

    public busRead16BE(address: number): number {
        const addr = this.validateBusAddress(address, 2);
        const b1 = mgba_bus_read8(this.handle, addr);
        const b2 = mgba_bus_read8(this.handle, (addr + 1) >>> 0);
        return (b1 << 8) | b2;
    }

    public busWrite16LE(address: number, value: number): void {
        const addr = this.validateBusAddress(address, 2);
        mgba_bus_write16(this.handle, addr, value & 0xFFFF);
    }

    public busRead32LE(address: number): number {
        const addr = this.validateBusAddress(address, 4);
        return mgba_bus_read32(this.handle, addr);
    }

    public busWrite32LE(address: number, value: number): void {
        const addr = this.validateBusAddress(address, 4);
        mgba_bus_write32(this.handle, addr, value >>> 0);
    }

    public busReadRange(address: number, length: number): Buffer {
        this.ensureOpen();
        if (!Number.isInteger(length) || length <= 0 || length > 32 * 1024 * 1024) {
            throw new Error(`Invalid bus read length: ${length}`);
        }
        const buf = Buffer.alloc(length);
        const ok = mgba_bus_read_range(this.handle, address >>> 0, buf, length);
        if (!ok) {
            throw new Error(`Failed to read bus range at address 0x${address.toString(16)} (length: ${length})`);
        }
        return buf;
    }

    public romRead8(offset: number): number {
        this.ensureOpen();
        return mgba_rom_read8(this.handle, offset >>> 0);
    }

    public romReadRange(offset: number, length: number): Buffer {
        this.ensureOpen();
        if (!Number.isInteger(length) || length <= 0 || length > 32 * 1024 * 1024) {
            throw new Error(`Invalid ROM read length: ${length}`);
        }
        const buf = Buffer.alloc(length);
        const ok = mgba_rom_read_range(this.handle, offset >>> 0, buf, length);
        if (!ok) {
            throw new Error(`Failed to read ROM range at offset 0x${offset.toString(16)} (length: ${length})`);
        }
        return buf;
    }

    public saveState(filepath: string): boolean {
        this.ensureOpen();
        return mgba_save_state(this.handle, filepath);
    }

    public loadState(filepath: string): boolean {
        this.ensureOpen();
        const success = mgba_load_state(this.handle, filepath);
        if (success) {
            this.updateSampleRate();
        }
        return success;
    }

    public saveStateBuffer(initialMaxSize = 2 * 1024 * 1024): Buffer {
        this.ensureOpen();
        let size = initialMaxSize;
        for (let attempt = 0; attempt < 3; attempt++) {
            const tempBuf = Buffer.alloc(size);
            const written = mgba_save_state_buffer(this.handle, tempBuf, size);
            if (written > 0 && written <= size) {
                const stateBuf = Buffer.allocUnsafe(written);
                tempBuf.copy(stateBuf, 0, 0, written);
                return stateBuf;
            }
            size *= 2;
        }
        throw new Error('Failed to serialize savestate into buffer (buffer size exceeded)');
    }

    public loadStateBuffer(stateBuffer: Buffer | Uint8Array): boolean {
        this.ensureOpen();
        const success = mgba_load_state_buffer(this.handle, stateBuffer, stateBuffer.length);
        if (success) {
            this.updateSampleRate();
        }
        return success;
    }

    private updateSampleRate(): void {
        if (this.handle) {
            const rate = mgba_get_audio_sample_rate(this.handle);
            if (rate > 0) {
                this.sampleRate = rate;
            }
        }
    }

    private ensureOpen(): void {
        if (!this.handle) {
            throw new Error('NativeMgbaCore: Core is not initialized or ROM is not loaded');
        }
    }
}
