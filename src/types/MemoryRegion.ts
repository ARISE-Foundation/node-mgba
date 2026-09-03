export type GbMemoryRegion =
    | 'ROM'
    | 'VRAM'
    | 'SRAM'
    | 'WRAM'
    | 'OAM'
    | 'HRAM'
    | 'IO';

export type GbaMemoryRegion =
    | 'BIOS'
    | 'EWRAM'
    | 'IWRAM'
    | 'IO'
    | 'PALETTE'
    | 'VRAM'
    | 'OAM'
    | 'ROM'
    | 'SRAM';

export type MemoryRegionName = GbMemoryRegion | GbaMemoryRegion;

export type ReadSpecType = 'u8' | 'u16le' | 'u32le' | 'bytes';

export interface ReadSpec {
    readonly region?: MemoryRegionName | undefined;
    readonly address?: number | undefined;
    readonly offset?: number | undefined;
    readonly length?: number | undefined;
    readonly type?: ReadSpecType | undefined;
    readonly key?: string | undefined;
    readonly bank?: number | undefined;
}

export type ReadResultValue = number | Uint8Array;

export interface MemorySnapshotOptions {
    readonly vram?: boolean | undefined;
    readonly sram?: boolean | undefined;
    readonly oam?: boolean | undefined;
}
