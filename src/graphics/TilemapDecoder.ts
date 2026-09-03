
export interface GbTileEntry {
    readonly tileId: number;
    readonly signedTileIndex?: number | undefined;
    readonly cgbPalette?: number | undefined;
    readonly vramBank?: number | undefined;
    readonly xFlip?: boolean | undefined;
    readonly yFlip?: boolean | undefined;
    readonly priority?: boolean | undefined;
}

export interface GbTilemap {
    readonly model: 'DMG' | 'CGB';
    readonly layer: 'bg' | 'window';
    readonly width: number;  // 32
    readonly height: number; // 32
    readonly scrollX: number;
    readonly scrollY: number;
    readonly tiles: readonly GbTileEntry[][];
}

export interface GbaTileEntry {
    readonly raw: number;
    readonly tileIndex: number;
    readonly xFlip: boolean;
    readonly yFlip: boolean;
    readonly paletteBank: number;
}

export interface GbaBgLayer {
    readonly model: 'AGB';
    readonly layerIndex: number; // 0 to 3
    readonly width: number;
    readonly height: number;
    readonly scrollX: number;
    readonly scrollY: number;
    readonly priority: number;
    readonly tileGrid: readonly GbaTileEntry[][];
}

export interface GbaAffineBgLayer {
    readonly model: 'AGB';
    readonly layerIndex: number;
    readonly type: 'affine';
    readonly width: number;
    readonly height: number;
    readonly tileGrid: readonly number[][];
}

export interface GbaBitmapLayer {
    readonly model: 'AGB';
    readonly mode: 3 | 4 | 5;
    readonly width: number;
    readonly height: number;
    readonly frameIndex?: number | undefined;
    readonly data: Buffer;
}

export type TilemapData = GbTilemap | GbaBgLayer | GbaAffineBgLayer | GbaBitmapLayer;

export class TilemapDecoder {
    public static decodeGb(
        vramBuffer: Buffer | Uint8Array,
        options: {
            layer?: 'bg' | 'window' | undefined;
            mapBaseOffset?: number | undefined; // 0x1800 (for 0x9800) or 0x1C00 (for 0x9C00)
            scrollX?: number | undefined;
            scrollY?: number | undefined;
            isCgb?: boolean | undefined;
            useSignedTileAddressing?: boolean | undefined;
        } = {}
    ): GbTilemap {
        const buf = Buffer.isBuffer(vramBuffer) ? vramBuffer : Buffer.from(vramBuffer);
        const mapOffset = options.mapBaseOffset ?? (options.layer === 'window' ? 0x1C00 : 0x1800);
        const isCgb = options.isCgb ?? (buf.length >= 0x4000);
        const layer = options.layer ?? 'bg';
        const scrollX = options.scrollX ?? 0;
        const scrollY = options.scrollY ?? 0;
        const useSigned = options.useSignedTileAddressing ?? false;

        const grid: GbTileEntry[][] = [];
        for (let row = 0; row < 32; row++) {
            const rowEntries: GbTileEntry[] = [];
            for (let col = 0; col < 32; col++) {
                const idx = row * 32 + col;
                const tileId = (mapOffset + idx < buf.length) ? buf.readUInt8(mapOffset + idx) : 0;
                const signedTileIndex = useSigned ? (tileId > 127 ? tileId - 256 : tileId) : undefined;

                let cgbPalette: number | undefined;
                let vramBank: number | undefined;
                let xFlip: boolean | undefined;
                let yFlip: boolean | undefined;
                let priority: boolean | undefined;

                if (isCgb && 0x2000 + mapOffset + idx < buf.length) {
                    const attr = buf.readUInt8(0x2000 + mapOffset + idx);
                    cgbPalette = attr & 0x07;
                    vramBank = (attr >> 3) & 1;
                    xFlip = (attr & 0x20) !== 0;
                    yFlip = (attr & 0x40) !== 0;
                    priority = (attr & 0x80) !== 0;
                }

                rowEntries.push({
                    tileId,
                    signedTileIndex,
                    cgbPalette,
                    vramBank,
                    xFlip,
                    yFlip,
                    priority,
                });
            }
            grid.push(rowEntries);
        }

        return {
            model: isCgb ? 'CGB' : 'DMG',
            layer,
            width: 32,
            height: 32,
            scrollX,
            scrollY,
            tiles: grid,
        };
    }

    public static decodeGba(
        vramBuffer: Buffer | Uint8Array,
        layerIndex: number,
        options: {
            mapBaseOffset?: number | undefined;
            widthTiles?: number | undefined;
            heightTiles?: number | undefined;
            scrollX?: number | undefined;
            scrollY?: number | undefined;
            priority?: number | undefined;
        } = {}
    ): GbaBgLayer {
        const buf = Buffer.isBuffer(vramBuffer) ? vramBuffer : Buffer.from(vramBuffer);
        const mapOffset = options.mapBaseOffset ?? (layerIndex * 0x800);
        const width = options.widthTiles ?? 32;
        const height = options.heightTiles ?? 32;
        const scrollX = options.scrollX ?? 0;
        const scrollY = options.scrollY ?? 0;
        const priority = options.priority ?? layerIndex;

        const grid: GbaTileEntry[][] = [];
        for (let row = 0; row < height; row++) {
            const rowEntries: GbaTileEntry[] = [];
            for (let col = 0; col < width; col++) {
                // Compute screen block index (for 32x32, 64x32, 32x64, 64x64)
                const blockX = Math.floor(col / 32);
                const blockY = Math.floor(row / 32);
                const blockIndex = blockY * Math.ceil(width / 32) + blockX;
                const localCol = col % 32;
                const localRow = row % 32;
                const localOffset = (localRow * 32 + localCol) * 2;
                const totalOffset = mapOffset + blockIndex * 0x800 + localOffset;

                const raw = (totalOffset + 1 < buf.length) ? buf.readUInt16LE(totalOffset) : 0;
                const tileIndex = raw & 0x3FF;
                const xFlip = (raw & 0x0400) !== 0;
                const yFlip = (raw & 0x0800) !== 0;
                const paletteBank = (raw >> 12) & 0xF;

                rowEntries.push({
                    raw,
                    tileIndex,
                    xFlip,
                    yFlip,
                    paletteBank,
                });
            }
            grid.push(rowEntries);
        }

        return {
            model: 'AGB',
            layerIndex,
            width,
            height,
            scrollX,
            scrollY,
            priority,
            tileGrid: grid,
        };
    }

    public static decodeGbaAffine(
        vramBuffer: Buffer | Uint8Array,
        layerIndex: number,
        options: {
            mapBaseOffset?: number | undefined;
            dimension?: 16 | 32 | 64 | 128 | undefined; // in tiles (16x16, 32x32, 64x64, 128x128)
        } = {}
    ): GbaAffineBgLayer {
        const buf = Buffer.isBuffer(vramBuffer) ? vramBuffer : Buffer.from(vramBuffer);
        const mapOffset = options.mapBaseOffset ?? (layerIndex * 0x800);
        const dim = options.dimension ?? 32;

        const grid: number[][] = [];
        for (let row = 0; row < dim; row++) {
            const rowEntries: number[] = [];
            for (let col = 0; col < dim; col++) {
                const offset = mapOffset + (row * dim + col);
                const tileIndex = (offset < buf.length) ? buf.readUInt8(offset) : 0;
                rowEntries.push(tileIndex);
            }
            grid.push(rowEntries);
        }

        return {
            model: 'AGB',
            layerIndex,
            type: 'affine',
            width: dim,
            height: dim,
            tileGrid: grid,
        };
    }

    public static decodeGbaBitmap(
        vramBuffer: Buffer | Uint8Array,
        mode: 3 | 4 | 5,
        options: { frameIndex?: 0 | 1 | undefined } = {}
    ): GbaBitmapLayer {
        const buf = Buffer.isBuffer(vramBuffer) ? vramBuffer : Buffer.from(vramBuffer);
        const frame = options.frameIndex ?? 0;
        let width = 240;
        let height = 160;
        let offset = 0;
        let length = 76800; // Mode 3: 240 * 160 * 2

        if (mode === 3) {
            width = 240;
            height = 160;
            offset = 0;
            length = 240 * 160 * 2;
        } else if (mode === 4) {
            width = 240;
            height = 160;
            offset = frame === 1 ? 0xA000 : 0x0000;
            length = 240 * 160; // 8-bit indexed
        } else if (mode === 5) {
            width = 160;
            height = 128;
            offset = frame === 1 ? 0xA000 : 0x0000;
            length = 160 * 128 * 2;
        }

        const outData = Buffer.alloc(length);
        if (offset < buf.length) {
            buf.copy(outData, 0, offset, Math.min(buf.length, offset + length));
        }

        return {
            model: 'AGB',
            mode,
            width,
            height,
            frameIndex: mode !== 3 ? frame : undefined,
            data: outData,
        };
    }
}
