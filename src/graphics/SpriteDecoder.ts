import type { ConsoleModel } from '../types/ConsoleModel.js';

export interface GbSpriteAttributes {
    readonly cgbPalette: number;
    readonly vramBank: number;
    readonly dmgPalette: 0 | 1;
    readonly xFlip: boolean;
    readonly yFlip: boolean;
    readonly priority: boolean; // true = behind non-zero BG colors
}

export interface GbaAffineMatrix {
    readonly pa: number;
    readonly pb: number;
    readonly pc: number;
    readonly pd: number;
}

export interface GbaSpriteAttributes {
    readonly shape: 'square' | 'wide' | 'tall';
    readonly size: number;
    readonly isAffine: boolean;
    readonly isDoubleSize: boolean;
    readonly isHidden: boolean;
    readonly colorMode: '16-color' | '256-color';
    readonly mosaic: boolean;
    readonly objMode: 'normal' | 'semi-transparent' | 'obj-window' | 'invalid';
    readonly xFlip: boolean;
    readonly yFlip: boolean;
    readonly affineParamIndex: number;
    readonly affineMatrix?: GbaAffineMatrix | undefined;
    readonly priority: number; // 0 (highest) to 3 (lowest)
    readonly paletteBank: number;
}

export interface Sprite {
    readonly id: number;
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
    readonly tileId: number;
    readonly enabled: boolean;
    readonly intersectsViewport: boolean;
    readonly gb?: GbSpriteAttributes | undefined;
    readonly gba?: GbaSpriteAttributes | undefined;
}

// GBA OBJ Shapes and Sizes: [width, height] in pixels
const GBA_SPRITE_DIMENSIONS: Record<string, readonly [number, number]> = {
    square_0: [8, 8],
    square_1: [16, 16],
    square_2: [32, 32],
    square_3: [64, 64],
    wide_0: [16, 8],
    wide_1: [32, 8],
    wide_2: [32, 16],
    wide_3: [64, 32],
    tall_0: [8, 16],
    tall_1: [8, 32],
    tall_2: [16, 32],
    tall_3: [32, 64],
};

export class SpriteDecoder {
    public static decode(oamBuffer: Buffer | Uint8Array, model: ConsoleModel, is8x16GbMode = false): Sprite[] {
        if (model === 'AGB') {
            return this.decodeGba(oamBuffer);
        }
        return this.decodeGb(oamBuffer, is8x16GbMode, model === 'CGB');
    }

    public static decodeGb(oamBuffer: Buffer | Uint8Array, is8x16 = false, isCgb = false): Sprite[] {
        const sprites: Sprite[] = [];
        const count = Math.min(40, Math.floor(oamBuffer.length / 4));
        const height = is8x16 ? 16 : 8;
        const width = 8;
        const buf = Buffer.isBuffer(oamBuffer) ? oamBuffer : Buffer.from(oamBuffer);

        for (let i = 0; i < count; i++) {
            const offset = i * 4;
            const y = buf.readUInt8(offset) - 16;
            const x = buf.readUInt8(offset + 1) - 8;
            let tileId = buf.readUInt8(offset + 2);
            if (is8x16) {
                tileId &= 0xFE; // In 8x16 mode, bit 0 is ignored
            }
            const flags = buf.readUInt8(offset + 3);

            const enabled = y > -16 && y < 144 && x > -8 && x < 160;
            const intersectsViewport = x < 160 && x + width > 0 && y < 144 && y + height > 0;

            const gbAttr: GbSpriteAttributes = {
                cgbPalette: isCgb ? (flags & 0x07) : 0,
                vramBank: isCgb ? ((flags >> 3) & 1) : 0,
                dmgPalette: ((flags >> 4) & 1) as (0 | 1),
                xFlip: (flags & 0x20) !== 0,
                yFlip: (flags & 0x40) !== 0,
                priority: (flags & 0x80) !== 0,
            };

            sprites.push({
                id: i,
                x,
                y,
                width,
                height,
                tileId,
                enabled,
                intersectsViewport,
                gb: gbAttr,
            });
        }

        return sprites;
    }

    public static decodeGba(oamBuffer: Buffer | Uint8Array): Sprite[] {
        const sprites: Sprite[] = [];
        const count = Math.min(128, Math.floor(oamBuffer.length / 8));
        const buf = Buffer.isBuffer(oamBuffer) ? oamBuffer : Buffer.from(oamBuffer);

        for (let i = 0; i < count; i++) {
            const offset = i * 8;
            const attr0 = buf.readUInt16LE(offset);
            const attr1 = buf.readUInt16LE(offset + 2);
            const attr2 = buf.readUInt16LE(offset + 4);

            // Attribute 0
            let y = attr0 & 0xFF;
            if (y >= 160) y -= 256; // 8-bit signed wrap

            const isAffine = (attr0 & (1 << 8)) !== 0;
            const isDoubleSize = isAffine && ((attr0 & (1 << 9)) !== 0);
            const isHidden = !isAffine && ((attr0 & (1 << 9)) !== 0);

            const objModeRaw = (attr0 >> 10) & 3;
            const objMode = objModeRaw === 0 ? 'normal' : objModeRaw === 1 ? 'semi-transparent' : objModeRaw === 2 ? 'obj-window' : 'invalid';
            const mosaic = (attr0 & (1 << 12)) !== 0;
            const colorMode = (attr0 & (1 << 13)) !== 0 ? '256-color' : '16-color';
            const shapeCode = (attr0 >> 14) & 3;
            const shape = shapeCode === 0 ? 'square' : shapeCode === 1 ? 'wide' : shapeCode === 2 ? 'tall' : 'square';

            // Attribute 1
            let x = attr1 & 0x1FF;
            if (x >= 256) x -= 512; // 9-bit signed wrap

            const sizeCode = (attr1 >> 14) & 3;
            const dims = GBA_SPRITE_DIMENSIONS[`${shape}_${sizeCode}`] ?? [8, 8];
            const width = isDoubleSize ? dims[0] * 2 : dims[0];
            const height = isDoubleSize ? dims[1] * 2 : dims[1];

            const xFlip = !isAffine && ((attr1 & (1 << 12)) !== 0);
            const yFlip = !isAffine && ((attr1 & (1 << 13)) !== 0);
            const affineParamIndex = isAffine ? ((attr1 >> 9) & 0x1F) : 0;

            let affineMatrix: GbaAffineMatrix | undefined;
            if (isAffine) {
                const matrixBase = affineParamIndex * 32;
                if (matrixBase + 30 < buf.length) {
                    affineMatrix = {
                        pa: buf.readInt16LE(matrixBase + 6) / 256,
                        pb: buf.readInt16LE(matrixBase + 14) / 256,
                        pc: buf.readInt16LE(matrixBase + 22) / 256,
                        pd: buf.readInt16LE(matrixBase + 30) / 256,
                    };
                }
            }

            // Attribute 2
            const tileId = attr2 & 0x3FF;
            const priority = (attr2 >> 10) & 3;
            const paletteBank = (attr2 >> 12) & 0xF;

            const enabled = !isHidden;
            const intersectsViewport = x < 240 && x + width > 0 && y < 160 && y + height > 0;

            const gbaAttr: GbaSpriteAttributes = {
                shape,
                size: sizeCode,
                isAffine,
                isDoubleSize,
                isHidden,
                colorMode,
                mosaic,
                objMode,
                xFlip,
                yFlip,
                affineParamIndex,
                affineMatrix,
                priority,
                paletteBank,
            };

            sprites.push({
                id: i,
                x,
                y,
                width,
                height,
                tileId,
                enabled,
                intersectsViewport,
                gba: gbaAttr,
            });
        }

        return sprites;
    }
}
