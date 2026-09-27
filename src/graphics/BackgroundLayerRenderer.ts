import { Buffer } from 'node:buffer';
import type { NativeMgbaCore } from '../core/NativeMgbaCore.js';
import type {
    RenderBackgroundLayersOptions,
    BackgroundRenderResult,
} from '../types/graphics.js';

export interface GbaBackgroundRegisters {
    readonly dispcnt: number;
    readonly bgCnt: readonly [number, number, number, number];
    readonly bgHofs: readonly [number, number, number, number];
    readonly bgVofs: readonly [number, number, number, number];
}

export interface GbBackgroundRegisters {
    readonly lcdc: number;
    readonly scx: number;
    readonly scy: number;
    readonly bgp: number;
}

/**
 * Calculates mean pixel luminance across a 32-bit RGBA buffer according to the standard
 * formula: (0.299 * R + 0.587 * G + 0.114 * B) / 255 averaged across all pixels.
 */
export function computeMeanLuminance(buffer: Buffer | Uint8Array): number {
    if (buffer.length === 0) return 0;
    const pixelCount = buffer.length / 4;
    let totalLum = 0;
    for (let i = 0; i < buffer.length; i += 4) {
        const r = buffer[i] ?? 0;
        const g = buffer[i + 1] ?? 0;
        const b = buffer[i + 2] ?? 0;
        totalLum += (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    }
    return totalLum / pixelCount;
}

function parseGbaRegisters(io: Buffer | Uint8Array | GbaBackgroundRegisters): GbaBackgroundRegisters {
    if ('dispcnt' in io && 'bgCnt' in io) {
        return io;
    }
    const buf = Buffer.isBuffer(io) ? io : Buffer.from(io.buffer, io.byteOffset, io.byteLength);
    const dispcnt = buf.length >= 2 ? buf.readUInt16LE(0) : 0;
    const bgCnt: [number, number, number, number] = [
        buf.length >= 0x0A ? buf.readUInt16LE(0x08) : 0,
        buf.length >= 0x0C ? buf.readUInt16LE(0x0A) : 0,
        buf.length >= 0x0E ? buf.readUInt16LE(0x0C) : 0,
        buf.length >= 0x10 ? buf.readUInt16LE(0x0E) : 0,
    ];
    const bgHofs: [number, number, number, number] = [
        buf.length >= 0x12 ? buf.readUInt16LE(0x10) & 0x1FF : 0,
        buf.length >= 0x16 ? buf.readUInt16LE(0x14) & 0x1FF : 0,
        buf.length >= 0x1A ? buf.readUInt16LE(0x18) & 0x1FF : 0,
        buf.length >= 0x1E ? buf.readUInt16LE(0x1C) & 0x1FF : 0,
    ];
    const bgVofs: [number, number, number, number] = [
        buf.length >= 0x14 ? buf.readUInt16LE(0x12) & 0x1FF : 0,
        buf.length >= 0x18 ? buf.readUInt16LE(0x16) & 0x1FF : 0,
        buf.length >= 0x1C ? buf.readUInt16LE(0x1A) & 0x1FF : 0,
        buf.length >= 0x20 ? buf.readUInt16LE(0x1E) & 0x1FF : 0,
    ];

    return { dispcnt, bgCnt, bgHofs, bgVofs };
}

function parseGbRegisters(io: Buffer | Uint8Array | GbBackgroundRegisters): GbBackgroundRegisters {
    if ('lcdc' in io && 'scx' in io) {
        return io;
    }
    const buf = Buffer.isBuffer(io) ? io : Buffer.from(io.buffer, io.byteOffset, io.byteLength);
    return {
        lcdc: buf[0x40] ?? 0,
        scy: buf[0x42] ?? 0,
        scx: buf[0x43] ?? 0,
        bgp: buf[0x47] ?? 0,
    };
}

export class BackgroundLayerRenderer {
    /**
     * Renders background layers from the emulator core by detecting console model
     * (AGB vs DMG/CGB) and extracting VRAM, palette memory, and IO registers.
     */
    public static render(
        core: NativeMgbaCore,
        options: RenderBackgroundLayersOptions = {},
    ): BackgroundRenderResult {
        const model = core.getModel();

        if (model === 'AGB') {
            const vram = core.getVramBuffer();
            const palette = core.readRegion('PALETTE', 0, 512);
            const io = core.readRegion('IO', 0, 0x60);
            return this.renderGba(vram, palette, io, options);
        }

        const vram = core.getVramBuffer();
        const io = core.readRegion('IO', 0, 0x80);

        if (model === 'CGB') {
            const cgbPalette = Buffer.alloc(64);
            const oldBcps = core.busRead8(0xFF68);
            for (let i = 0; i < 64; i++) {
                core.busWrite8(0xFF68, i);
                cgbPalette[i] = core.busRead8(0xFF69);
            }
            core.busWrite8(0xFF68, oldBcps);
            return this.renderGb(vram, io, { ...options, isCgb: true, cgbPalette });
        }

        return this.renderGb(vram, io, { ...options, isCgb: false });
    }

    /**
     * Renders GBA Mode 0 background layers from VRAM, Palette RAM, and IO registers.
     */
    public static renderGba(
        vramBuffer: Buffer | Uint8Array,
        paletteBuffer: Buffer | Uint8Array,
        ioRegisters: Buffer | Uint8Array | GbaBackgroundRegisters,
        options: RenderBackgroundLayersOptions = {},
    ): BackgroundRenderResult {
        const vram = Buffer.isBuffer(vramBuffer) ? vramBuffer : Buffer.from(vramBuffer.buffer, vramBuffer.byteOffset, vramBuffer.byteLength);
        const palette = Buffer.isBuffer(paletteBuffer) ? paletteBuffer : Buffer.from(paletteBuffer.buffer, paletteBuffer.byteOffset, paletteBuffer.byteLength);
        const regs = parseGbaRegisters(ioRegisters);

        const bgMode = regs.dispcnt & 0x07;
        const isTiledMode = (bgMode === 0);

        if (!isTiledMode) {
            return {
                width: 256,
                height: 256,
                buffer: Buffer.alloc(256 * 256 * 4),
                scrollX: 0,
                scrollY: 0,
                meanLuminance: 0,
                isTiledMode: false,
                layersRendered: [],
            };
        }

        const candidateLayers: {
            layerIndex: number;
            priority: number;
            charBaseOffset: number;
            screenBaseOffset: number;
            is256Color: boolean;
            screenSize: number;
            tilesW: number;
            tilesH: number;
            width: number;
            height: number;
            scrollX: number;
            scrollY: number;
        }[] = [];

        const defaultExclude = [0];
        for (let n = 0; n < 4; n++) {
            const enabled = (regs.dispcnt & (1 << (8 + n))) !== 0;
            if (!enabled) continue;

            let included: boolean;
            if (options.includeLayers !== undefined) {
                included = options.includeLayers.includes(n);
            } else {
                const exclude = options.excludeLayers ?? defaultExclude;
                included = !exclude.includes(n);
            }
            if (!included) continue;

            const cnt = regs.bgCnt[n] ?? 0;
            const priority = cnt & 0x03;
            const charBaseBlock = (cnt >> 2) & 0x03;
            const charBaseOffset = charBaseBlock * 0x4000;
            const is256Color = (cnt & 0x80) !== 0;
            const screenBaseBlock = (cnt >> 8) & 0x1F;
            const screenBaseOffset = screenBaseBlock * 0x800;
            const screenSize = (cnt >> 14) & 0x03;
            const tilesW = (screenSize === 1 || screenSize === 3) ? 64 : 32;
            const tilesH = (screenSize === 2 || screenSize === 3) ? 64 : 32;
            const scrollX = regs.bgHofs[n] ?? 0;
            const scrollY = regs.bgVofs[n] ?? 0;

            candidateLayers.push({
                layerIndex: n,
                priority,
                charBaseOffset,
                screenBaseOffset,
                is256Color,
                screenSize,
                tilesW,
                tilesH,
                width: tilesW * 8,
                height: tilesH * 8,
                scrollX,
                scrollY,
            });
        }

        if (candidateLayers.length === 0) {
            return {
                width: 256,
                height: 256,
                buffer: Buffer.alloc(256 * 256 * 4),
                scrollX: 0,
                scrollY: 0,
                meanLuminance: 0,
                isTiledMode: false,
                layersRendered: [],
            };
        }

        const canvasWidth = Math.max(...candidateLayers.map(l => l.width), 256);
        const canvasHeight = Math.max(...candidateLayers.map(l => l.height), 256);
        const canvasBuffer = Buffer.alloc(canvasWidth * canvasHeight * 4);

        // Sort layers so lowest priority renders first (background), highest priority renders last (foreground).
        // In GBA: priority 0 is highest, priority 3 is lowest. Higher layer index is behind lower layer index.
        const sortedLayers = [...candidateLayers].sort((a, b) => {
            if (a.priority !== b.priority) {
                return b.priority - a.priority;
            }
            return b.layerIndex - a.layerIndex;
        });

        for (const layer of sortedLayers) {
            for (let tr = 0; tr < layer.tilesH; tr++) {
                for (let tc = 0; tc < layer.tilesW; tc++) {
                    let screenBlockIndex = 0;
                    if (layer.screenSize === 1) {
                        screenBlockIndex = Math.floor(tc / 32);
                    } else if (layer.screenSize === 2) {
                        screenBlockIndex = Math.floor(tr / 32);
                    } else if (layer.screenSize === 3) {
                        screenBlockIndex = Math.floor(tr / 32) * 2 + Math.floor(tc / 32);
                    }
                    const localTc = tc % 32;
                    const localTr = tr % 32;
                    const tilemapOffset = layer.screenBaseOffset + screenBlockIndex * 0x800 + (localTr * 32 + localTc) * 2;
                    if (tilemapOffset + 1 >= vram.length) continue;

                    const entry = vram.readUInt16LE(tilemapOffset);
                    const tileIndex = entry & 0x3FF;
                    const xFlip = (entry & 0x0400) !== 0;
                    const yFlip = (entry & 0x0800) !== 0;
                    const paletteBank = (entry >> 12) & 0x0F;

                    if (!layer.is256Color) {
                        const tileByteOffset = layer.charBaseOffset + tileIndex * 32;
                        if (tileByteOffset + 32 > vram.length) continue;

                        for (let py = 0; py < 8; py++) {
                            const actualPy = yFlip ? 7 - py : py;
                            const rowOffset = tileByteOffset + actualPy * 4;
                            for (let px = 0; px < 8; px++) {
                                const actualPx = xFlip ? 7 - px : px;
                                const byteVal = vram[rowOffset + (actualPx >> 1)] ?? 0;
                                const colorIndex = (actualPx & 1) === 0 ? (byteVal & 0x0F) : ((byteVal >> 4) & 0x0F);
                                if (colorIndex === 0) continue; // transparent

                                const palOffset = (paletteBank * 16 + colorIndex) * 2;
                                if (palOffset + 1 >= palette.length) continue;

                                const rawColor = palette.readUInt16LE(palOffset);
                                const r = Math.round(((rawColor & 0x1F) * 255) / 31);
                                const g = Math.round((((rawColor >> 5) & 0x1F) * 255) / 31);
                                const b = Math.round((((rawColor >> 10) & 0x1F) * 255) / 31);

                                const destX = tc * 8 + px;
                                const destY = tr * 8 + py;
                                const destOffset = (destY * canvasWidth + destX) * 4;
                                canvasBuffer[destOffset] = r;
                                canvasBuffer[destOffset + 1] = g;
                                canvasBuffer[destOffset + 2] = b;
                                canvasBuffer[destOffset + 3] = 255;
                            }
                        }
                    } else {
                        const tileByteOffset = layer.charBaseOffset + tileIndex * 64;
                        if (tileByteOffset + 64 > vram.length) continue;

                        for (let py = 0; py < 8; py++) {
                            const actualPy = yFlip ? 7 - py : py;
                            const rowOffset = tileByteOffset + actualPy * 8;
                            for (let px = 0; px < 8; px++) {
                                const actualPx = xFlip ? 7 - px : px;
                                const colorIndex = vram[rowOffset + actualPx] ?? 0;
                                if (colorIndex === 0) continue; // transparent

                                const palOffset = colorIndex * 2;
                                if (palOffset + 1 >= palette.length) continue;

                                const rawColor = palette.readUInt16LE(palOffset);
                                const r = Math.round(((rawColor & 0x1F) * 255) / 31);
                                const g = Math.round((((rawColor >> 5) & 0x1F) * 255) / 31);
                                const b = Math.round((((rawColor >> 10) & 0x1F) * 255) / 31);

                                const destX = tc * 8 + px;
                                const destY = tr * 8 + py;
                                const destOffset = (destY * canvasWidth + destX) * 4;
                                canvasBuffer[destOffset] = r;
                                canvasBuffer[destOffset + 1] = g;
                                canvasBuffer[destOffset + 2] = b;
                                canvasBuffer[destOffset + 3] = 255;
                            }
                        }
                    }
                }
            }
        }

        const layersRendered = candidateLayers.map(l => l.layerIndex).sort((a, b) => a - b);
        const firstLayer = candidateLayers[0];

        return {
            width: canvasWidth,
            height: canvasHeight,
            buffer: canvasBuffer,
            scrollX: firstLayer?.scrollX ?? 0,
            scrollY: firstLayer?.scrollY ?? 0,
            meanLuminance: computeMeanLuminance(canvasBuffer),
            isTiledMode: true,
            layersRendered,
        };
    }

    /**
     * Renders Game Boy (DMG or CGB) background tilemap from VRAM and IO registers.
     */
    public static renderGb(
        vramBuffer: Buffer | Uint8Array,
        ioRegisters: Buffer | Uint8Array | GbBackgroundRegisters,
        options: RenderBackgroundLayersOptions & {
            isCgb?: boolean | undefined;
            cgbPalette?: Buffer | Uint8Array | undefined;
        } = {},
    ): BackgroundRenderResult {
        const vram = Buffer.isBuffer(vramBuffer) ? vramBuffer : Buffer.from(vramBuffer.buffer, vramBuffer.byteOffset, vramBuffer.byteLength);
        const regs = parseGbRegisters(ioRegisters);

        const isTiledMode = (regs.lcdc & 0x80) !== 0 && (regs.lcdc & 0x01) !== 0;

        if (!isTiledMode) {
            return {
                width: 256,
                height: 256,
                buffer: Buffer.alloc(256 * 256 * 4),
                scrollX: 0,
                scrollY: 0,
                meanLuminance: 0,
                isTiledMode: false,
                layersRendered: [],
            };
        }

        // On GB, layer 0 is the scenery background layer
        if (options.includeLayers !== undefined && !options.includeLayers.includes(0)) {
            return {
                width: 256,
                height: 256,
                buffer: Buffer.alloc(256 * 256 * 4),
                scrollX: 0,
                scrollY: 0,
                meanLuminance: 0,
                isTiledMode: false,
                layersRendered: [],
            };
        }
        if (options.excludeLayers !== undefined && options.excludeLayers.includes(0)) {
            return {
                width: 256,
                height: 256,
                buffer: Buffer.alloc(256 * 256 * 4),
                scrollX: 0,
                scrollY: 0,
                meanLuminance: 0,
                isTiledMode: false,
                layersRendered: [],
            };
        }

        const bgTilemapBase = (regs.lcdc & 0x08) !== 0 ? 0x1C00 : 0x1800;
        const isUnsignedTileAddressing = (regs.lcdc & 0x10) !== 0;
        const isCgb = options.isCgb ?? (vram.length >= 0x4000);
        const cgbPalette = options.cgbPalette ? (Buffer.isBuffer(options.cgbPalette) ? options.cgbPalette : Buffer.from(options.cgbPalette.buffer, options.cgbPalette.byteOffset, options.cgbPalette.byteLength)) : undefined;

        const canvasWidth = 256;
        const canvasHeight = 256;
        const canvasBuffer = Buffer.alloc(canvasWidth * canvasHeight * 4);

        for (let tr = 0; tr < 32; tr++) {
            for (let tc = 0; tc < 32; tc++) {
                const tilemapOffset = bgTilemapBase + tr * 32 + tc;
                const tileId = (tilemapOffset < vram.length) ? (vram[tilemapOffset] ?? 0) : 0;

                let cgbPal = 0;
                let vramBank = 0;
                let xFlip = false;
                let yFlip = false;
                if (isCgb && 0x2000 + tilemapOffset < vram.length) {
                    const attr = vram[0x2000 + tilemapOffset] ?? 0;
                    cgbPal = attr & 0x07;
                    vramBank = (attr >> 3) & 1;
                    xFlip = (attr & 0x20) !== 0;
                    yFlip = (attr & 0x40) !== 0;
                }

                const baseTileOffset = isUnsignedTileAddressing
                    ? tileId * 16
                    : 0x1000 + (tileId > 127 ? tileId - 256 : tileId) * 16;
                const tileByteOffset = (vramBank === 1 ? 0x2000 : 0) + baseTileOffset;

                for (let py = 0; py < 8; py++) {
                    const actualPy = yFlip ? 7 - py : py;
                    const rowOffset = tileByteOffset + actualPy * 2;
                    const byte1 = (rowOffset < vram.length) ? (vram[rowOffset] ?? 0) : 0;
                    const byte2 = (rowOffset + 1 < vram.length) ? (vram[rowOffset + 1] ?? 0) : 0;

                    for (let px = 0; px < 8; px++) {
                        const actualPx = xFlip ? 7 - px : px;
                        const bit = 7 - actualPx;
                        const colorIndex = (((byte2 >> bit) & 1) << 1) | ((byte1 >> bit) & 1);

                        let r: number;
                        let g: number;
                        let b: number;

                        if (isCgb && cgbPalette && cgbPalette.length >= 64) {
                            const palOffset = (cgbPal * 4 + colorIndex) * 2;
                            const rawColor = cgbPalette.readUInt16LE(palOffset);
                            r = Math.round(((rawColor & 0x1F) * 255) / 31);
                            g = Math.round((((rawColor >> 5) & 0x1F) * 255) / 31);
                            b = Math.round((((rawColor >> 10) & 0x1F) * 255) / 31);
                        } else {
                            const shade = (regs.bgp >> (colorIndex * 2)) & 0x03;
                            const gray = 255 - shade * 85;
                            r = gray;
                            g = gray;
                            b = gray;
                        }

                        const destX = tc * 8 + px;
                        const destY = tr * 8 + py;
                        const destOffset = (destY * 256 + destX) * 4;
                        canvasBuffer[destOffset] = r;
                        canvasBuffer[destOffset + 1] = g;
                        canvasBuffer[destOffset + 2] = b;
                        canvasBuffer[destOffset + 3] = 255;
                    }
                }
            }
        }

        return {
            width: canvasWidth,
            height: canvasHeight,
            buffer: canvasBuffer,
            scrollX: regs.scx & 0xFF,
            scrollY: regs.scy & 0xFF,
            meanLuminance: computeMeanLuminance(canvasBuffer),
            isTiledMode: true,
            layersRendered: [0],
        };
    }
}
