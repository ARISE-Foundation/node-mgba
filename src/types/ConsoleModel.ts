/**
 * Hardware console models supported by node-mgba.
 * - 'DMG': Original Game Boy (Dot Matrix Game, 1989, 160x144, 4-shade monochrome)
 * - 'CGB': Game Boy Color (Color Game Boy, 1998, 160x144, 32K colors, banked VRAM/WRAM)
 * - 'AGB': Game Boy Advance (Advanced Game Boy, 2001, 240x160, 128 sprites with rotation/scale, 4 BG layers)
 */
export type ConsoleModel = 'DMG' | 'CGB' | 'AGB' | 'SGB';

export type PlatformType = 'GBA' | 'GB/GBC';

export interface CartridgeMetadata {
    readonly title: string;
    readonly gameCode: string;
    readonly romSize: number;
    readonly ramSize: number;
    readonly mbcType?: string;
    readonly hasBattery: boolean;
    readonly hasRtc: boolean;
    readonly model: ConsoleModel;
    readonly platform: PlatformType;
}
