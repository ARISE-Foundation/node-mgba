import type { Buffer } from 'node:buffer';

export interface RenderBackgroundLayersOptions {
    /** Layer indices to exclude from composition. Default: [0] (to strip dialogue/text) */
    readonly excludeLayers?: readonly number[] | undefined;
    /** Include specific layers only. Overrides excludeLayers if provided. */
    readonly includeLayers?: readonly number[] | undefined;
}

export interface BackgroundRenderResult {
    readonly width: number;         // e.g. 256 for standard 32x32 tile buffer
    readonly height: number;        // e.g. 256 for standard 32x32 tile buffer
    readonly buffer: Buffer;        // 32-bit RGBA pixel buffer
    readonly scrollX: number;       // Hardware camera scroll X
    readonly scrollY: number;       // Hardware camera scroll Y
    readonly meanLuminance: number; // 0.0 to 1.0 (mean pixel luminance for fade detection)
    readonly isTiledMode: boolean;  // True if GBA Mode 0 or GB background enabled
    readonly layersRendered: readonly number[]; // e.g. [1, 2, 3]
}
