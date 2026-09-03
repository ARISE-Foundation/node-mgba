export type MemoryTarget =
    | { readonly space: 'bus'; readonly address: number; readonly length?: number }
    | { readonly space: 'rom'; readonly offset: number; readonly length?: number }
    | { readonly space: 'wram'; readonly bank: number; readonly offset: number }
    | { readonly space: 'vram'; readonly bank: number; readonly offset: number }
    | { readonly space: 'sram'; readonly bank: number; readonly offset: number };
