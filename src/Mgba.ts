import sharp from 'sharp';
import { Buffer } from 'node:buffer';
import { EventEmitter } from 'node:events';
import { WorkerEmulatorClient } from './worker/WorkerEmulatorClient.js';
import type {
    RomInfo,
    ConsoleModel,
    PlatformType,
    CartridgeMetadata,
    StateHandle,
    MemoryRegionName,
    ReadSpec,
    ReadResultValue,
    MemorySnapshotOptions,
    InputAction,
    ButtonName,
    TurnResult,
    VideoPacket,
    AudioChunk,
    MediaSink,
    KeyframeSink,
    StepSequenceOptions,
} from './types/index.js';
import type {
    ObservationSnapshot,
    SliceSpec,
    MemoryChangeEntry,
    WorkerMemoryChangeEvent,
    WorkerStateRestoreEvent,
} from './worker/protocol.js';
import { SpriteDecoder, type Sprite } from './graphics/SpriteDecoder.js';
import { TilemapDecoder, type TilemapData } from './graphics/TilemapDecoder.js';
import { SymbolManager, type SymbolRecord, bankedToPhysicalOffset } from './symbols/SymbolManager.js';
import type { MgbaPlugin } from './plugins/Plugin.js';
import { TimeoutError, throwIfAborted } from './types/errors.js';

import type { MemorySnapshotReader } from './core/MemoryReader.js';

export type { MemorySnapshotOptions };

export interface MgbaLoadOptions {
    readonly watchdogTimeoutMs?: number | undefined;
    readonly workerPath?: string | URL | undefined;
    readonly mediaSinks?: readonly MediaSink[] | undefined;
    readonly keyframeSinks?: readonly KeyframeSink[] | undefined;
    readonly symPath?: string | undefined;
}

export interface WaitForDeclarativeSpec {
    readonly symbol?: string | undefined;
    readonly address?: number | undefined;
    readonly op?: 'eq' | 'neq' | 'gt' | 'lt' | undefined;
    readonly value: number;
}

export interface WaitForOptions {
    readonly timeoutFrames?: number | undefined;
    readonly checkIntervalFrames?: number | undefined;
    readonly signal?: AbortSignal | undefined;
}

export interface MgbaConsoleApi {
    readonly model: ConsoleModel;
    readonly platform: PlatformType;
    readonly title: string;
    readonly gameCode: string;
    readonly romSize: number;
    readonly width: number;
    readonly height: number;
    readonly cartridge: CartridgeMetadata;
    readonly getFrameCounter: () => Promise<number>;
}

export interface MgbaScreenApi {
    readonly width: number;
    readonly height: number;
    readonly frame: () => Promise<VideoPacket>;
    readonly toPng: (options?: { scale?: number }) => Promise<Buffer>;
    readonly toWebp: (options?: { quality?: number }) => Promise<Buffer>;
    readonly crop: (box: { x: number; y: number; width: number; height: number; scale?: number }, format?: 'png' | 'raw') => Promise<Buffer>;
    readonly sprites: (options?: { is8x16GbMode?: boolean }) => Promise<readonly Sprite[]>;
    readonly vram: () => Promise<Buffer>;
    readonly oam: () => Promise<Buffer>;
    readonly tilemap: (options?: {
        layer?: 'bg' | 'window';
        mapBaseOffset?: number;
        layerIndex?: number;
        scrollX?: number;
        scrollY?: number;
        mode?: 'text' | 'affine' | 'bitmap';
        bitmapMode?: 3 | 4 | 5;
        dimension?: 16 | 32 | 64 | 128;
        frameIndex?: 0 | 1;
    }) => Promise<TilemapData>;
    readonly inspect: (options?: { is8x16GbMode?: boolean }) => Promise<{
        sprites: readonly Sprite[];
        bgTilemap: TilemapData;
        windowTilemap?: TilemapData | undefined;
    }>;
}

export interface MgbaAudioApi {
    readonly onChunk: (listener: (chunk: AudioChunk) => void) => () => void;
}

export interface MgbaMemoryApi {
    readonly read8: (address: number) => Promise<number>;
    readonly read16LE: (address: number) => Promise<number>;
    readonly read32LE: (address: number) => Promise<number>;
    readonly write8: (address: number, value: number) => Promise<void>;
    readonly slice: (addressOrRegion: number | MemoryRegionName | string, length: number, offset?: number) => Promise<Buffer>;
    readonly readRegion: (region: MemoryRegionName | string, offset: number, length: number) => Promise<Buffer>;
    readonly readBatch: (specs: readonly ReadSpec[]) => Promise<ReadResultValue[]>;
    readonly readMultiple: (addressesOrSymbols: readonly (number | string)[]) => Promise<ReadResultValue[]>;
    readonly snapshot: (options?: MemorySnapshotOptions) => Promise<MemorySnapshotReader>;
}

export interface MgbaControlsApi {
    readonly press: (button: ButtonName | string | readonly (ButtonName | string)[], durationFrames?: number) => Promise<TurnResult>;
    readonly hold: (button: ButtonName | string | readonly (ButtonName | string)[]) => Promise<void>;
    readonly release: (button: ButtonName | string | readonly (ButtonName | string)[]) => Promise<void>;
    readonly sequence: (actions: readonly InputAction[], options?: StepSequenceOptions) => Promise<TurnResult>;
    readonly tick: (frames?: number) => Promise<VideoPacket>;
    readonly wait: (frames: number) => Promise<void>;
}

export interface MgbaDiagnosticsApi {
    readonly ping: () => Promise<string>;
    readonly onVideoFrame: (listener: (frame: VideoPacket) => void) => () => void;
    readonly onAudioChunk: (listener: (chunk: AudioChunk) => void) => () => void;
    readonly onKeyframe: (listener: (kf: Keyframe) => void) => () => void;
    readonly onTurnComplete: (listener: (res: TurnResult) => void) => () => void;
    readonly onMemoryChange: (listener: (evt: WorkerMemoryChangeEvent) => void) => () => void;
    readonly onStateRestore: (listener: (evt: WorkerStateRestoreEvent) => void) => () => void;
    readonly setWatches: (watches: readonly { key: string; address: number; length?: number }[]) => Promise<void>;
}

export interface MgbaStatesApi {
    readonly save: () => Promise<StateHandle>;
    readonly restore: (handle: StateHandle | string) => Promise<boolean>;
    readonly saveToFile: (filepath: string) => Promise<boolean>;
    readonly loadFromFile: (filepath: string) => Promise<boolean>;
}

export interface MgbaSymbolsApi {
    readonly loadRgbdsSymFile: (filepath: string) => Promise<void>;
    readonly parseRgbdsSym: (content: string) => Promise<void>;
    readonly loadGnuMapFile: (filepath: string) => Promise<void>;
    readonly parseGnuMap: (content: string) => Promise<void>;
    readonly read: (name: string) => Promise<number>;
    readonly read16LE: (name: string) => Promise<number>;
    readonly readBytes: (name: string, length: number) => Promise<Buffer>;
    readonly write: (name: string, value: number) => Promise<void>;
    readonly resolve: (name: string) => SymbolRecord | undefined;
    readonly manager: SymbolManager;
}

export class MgbaInstance extends EventEmitter {
    public readonly client: WorkerEmulatorClient;
    public readonly symbolManager: SymbolManager;
    private romInfo: RomInfo;
    private activePlugins = new Map<string, { pluginClass: unknown; instance: unknown }>();
    private eventCleanups: Array<() => void> = [];

    constructor(client: WorkerEmulatorClient, romInfo: RomInfo) {
        super();
        this.client = client;
        this.romInfo = romInfo;
        this.symbolManager = new SymbolManager();

        // Forward worker events to instance EventEmitter
        const onFrame = (f: VideoPacket) => this.emit('frame', f);
        const onAudio = (c: AudioChunk) => this.emit('audio', c);
        const onTurn = (t: TurnResult) => this.emit('turnComplete', t);
        const onMem = (evt: { frameIndex: number; changes: readonly MemoryChangeEntry[] }) => this.emit('memoryChange', evt);
        const onRestore = (evt: { frameIndex: number; handleId: string }) => this.emit('stateRestore', evt);

        this.client.on('videoFrame', onFrame);
        this.client.on('audioChunk', onAudio);
        this.client.on('turnComplete', onTurn);
        this.client.on('memoryChange', onMem);
        this.client.on('stateRestore', onRestore);

        this.eventCleanups = [
            () => this.client.off('videoFrame', onFrame),
            () => this.client.off('audioChunk', onAudio),
            () => this.client.off('turnComplete', onTurn),
            () => this.client.off('memoryChange', onMem),
            () => this.client.off('stateRestore', onRestore),
        ];
    }

    /**
     * Display and console hardware metadata.
     */
    public get console(): MgbaConsoleApi {
        return {
            model: this.romInfo.model,
            platform: this.romInfo.platform,
            title: this.romInfo.title,
            gameCode: this.romInfo.gameCode,
            romSize: this.romInfo.romSize,
            width: this.romInfo.platform === 'GBA' ? 240 : 160,
            height: this.romInfo.platform === 'GBA' ? 160 : 144,
            cartridge: this.romInfo.cartridge,
            getFrameCounter: () => this.client.getFrameCounter(),
        };
    }

    /**
     * Ergonomic screen and graphics decoders.
     */
    public get screen(): MgbaScreenApi {
        const isGba = this.romInfo.platform === 'GBA';
        return {
            width: isGba ? 240 : 160,
            height: isGba ? 160 : 144,
            frame: async (): Promise<VideoPacket> => {
                const obs = await this.client.observe({ screen: true });
                if (!obs.screen) {
                    throw new Error('Screen buffer not available in observation');
                }
                const { width, height, buffer } = obs.screen;
                return {
                    frameIndex: obs.frameIndex,
                    pts: obs.frameIndex / (262144 / 4389),
                    width,
                    height,
                    strideBytes: width * 4,
                    buffer,
                    keys: 0,
                };
            },

            toPng: async (options?: { scale?: number }): Promise<Buffer> => {
                const obs = await this.client.observe({ screen: true });
                if (!obs.screen) {
                    throw new Error('Screen buffer not available in observation');
                }
                const { width, height, buffer } = obs.screen;

                let pipeline = sharp(buffer, {
                    raw: { width, height, channels: 4 },
                });

                if (options?.scale && options.scale > 1) {
                    pipeline = pipeline.resize({
                        width: Math.round(width * options.scale),
                        height: Math.round(height * options.scale),
                        kernel: 'nearest',
                    });
                }

                return pipeline.png().toBuffer();
            },

            crop: async (box: { x: number; y: number; width: number; height: number; scale?: number }, format: 'png' | 'raw' = 'png'): Promise<Buffer> => {
                const obs = await this.client.observe({ screen: true });
                if (!obs.screen) {
                    throw new Error('Screen buffer not available in observation');
                }
                const { width, height, buffer } = obs.screen;

                const clampedX = Math.max(0, Math.min(box.x, width - 1));
                const clampedY = Math.max(0, Math.min(box.y, height - 1));
                const clampedWidth = Math.max(1, Math.min(box.width, width - clampedX));
                const clampedHeight = Math.max(1, Math.min(box.height, height - clampedY));

                let sharpInstance = sharp(buffer, {
                    raw: { width, height, channels: 4 },
                }).extract({
                    left: clampedX,
                    top: clampedY,
                    width: clampedWidth,
                    height: clampedHeight,
                });

                if (box.scale && box.scale > 1) {
                    sharpInstance = sharpInstance.resize({
                        width: Math.round(clampedWidth * box.scale),
                        kernel: 'nearest',
                    });
                }

                if (format === 'raw') {
                    return sharpInstance.raw().toBuffer();
                }
                return sharpInstance.png().toBuffer();
            },

            toWebp: async ({ quality = 80 }: { quality?: number } = {}): Promise<Buffer> => {
                const obs = await this.client.observe({ screen: true });
                if (!obs.screen) {
                    throw new Error('Screen buffer not available in observation');
                }
                const { width, height, buffer } = obs.screen;

                return sharp(buffer, {
                    raw: { width, height, channels: 4 },
                })
                    .webp({ quality })
                    .toBuffer();
            },

            vram: async (): Promise<Buffer> => {
                return this.client.getVram();
            },

            oam: async (): Promise<Buffer> => {
                return this.client.getOam();
            },

            sprites: async (options: { is8x16GbMode?: boolean } = {}): Promise<readonly Sprite[]> => {
                const oam = await this.client.getOam();
                return SpriteDecoder.decode(oam, this.console.model, options.is8x16GbMode ?? false);
            },

            tilemap: async (options: {
                layer?: 'bg' | 'window';
                mapBaseOffset?: number;
                layerIndex?: number;
                scrollX?: number;
                scrollY?: number;
                mode?: 'text' | 'affine' | 'bitmap';
                bitmapMode?: 3 | 4 | 5;
                dimension?: 16 | 32 | 64 | 128;
                frameIndex?: 0 | 1;
            } = {}): Promise<TilemapData> => {
                const vram = await this.client.getVram();
                if (this.console.model === 'AGB') {
                    if (options.mode === 'bitmap' || options.bitmapMode !== undefined) {
                        return TilemapDecoder.decodeGbaBitmap(vram, options.bitmapMode ?? 3, { frameIndex: options.frameIndex });
                    }
                    if (options.mode === 'affine') {
                        return TilemapDecoder.decodeGbaAffine(vram, options.layerIndex ?? 0, {
                            mapBaseOffset: options.mapBaseOffset,
                            dimension: options.dimension,
                        });
                    }
                    return TilemapDecoder.decodeGba(vram, options.layerIndex ?? 0, options);
                }
                return TilemapDecoder.decodeGb(vram, {
                    layer: options.layer ?? 'bg',
                    mapBaseOffset: options.mapBaseOffset,
                    scrollX: options.scrollX,
                    scrollY: options.scrollY,
                    isCgb: this.console.model === 'CGB',
                });
            },

            inspect: async (options: { is8x16GbMode?: boolean } = {}) => {
                const [sprites, bgTilemap, windowTilemap] = await Promise.all([
                    this.screen.sprites(options),
                    this.screen.tilemap({ layer: 'bg' }),
                    this.console.platform === 'GB/GBC' ? this.screen.tilemap({ layer: 'window' }) : Promise.resolve(undefined),
                ]);
                return {
                    sprites,
                    bgTilemap,
                    windowTilemap,
                };
            },
        };
    }

    /**
     * Memory reading, writing, batching, and slicing.
     */
    public get memory(): MgbaMemoryApi {
        return {
            read8: async (address: number): Promise<number> => {
                const [val] = await this.client.readBatch([{ address, type: 'u8' }]);
                return typeof val === 'number' ? val : 0;
            },

            read16LE: async (address: number): Promise<number> => {
                const [val] = await this.client.readBatch([{ address, type: 'u16le' }]);
                return typeof val === 'number' ? val : 0;
            },

            read32LE: async (address: number): Promise<number> => {
                const [val] = await this.client.readBatch([{ address, type: 'u32le' }]);
                return typeof val === 'number' ? val : 0;
            },

            write8: async (address: number, value: number): Promise<void> => {
                await this.client.busWrite8(address, value);
            },

            slice: async (addressOrRegion: number | MemoryRegionName | string, length: number, offset?: number): Promise<Buffer> => {
                return this.client.sliceMemory(addressOrRegion, length, offset);
            },

            readRegion: async (region: MemoryRegionName | string, offset: number, length: number): Promise<Buffer> => {
                return this.client.sliceMemory(region, length, offset);
            },

            readBatch: async (specs: readonly ReadSpec[]): Promise<ReadResultValue[]> => {
                return this.client.readBatch(specs);
            },

            readMultiple: async (addressesOrSymbols: readonly (number | string)[]) => {
                const specs: ReadSpec[] = addressesOrSymbols.map(target => {
                    if (typeof target === 'string') {
                        const sym = this.symbolManager.get(target);
                        return {
                            address: sym.address,
                            type: 'u8',
                            key: target,
                            ...(sym.bank !== undefined ? { bank: sym.bank } : {}),
                        };
                    }
                    return { address: target, type: 'u8' };
                });
                return this.client.readBatch(specs);
            },

            snapshot: async (options?: MemorySnapshotOptions): Promise<MemorySnapshotReader> => {
                const obs = await this.observe({ screen: false, memory: options ?? {} });
                if (!obs.memory) {
                    throw new Error('Memory snapshot failed: Emulator returned observation without memory reader.');
                }
                return obs.memory;
            },
        };
    }

    /**
     * Game controls, button presses, sequences, and stepping.
     */
    public get controls(): MgbaControlsApi {
        return {
            press: async (
                button: ButtonName | string | readonly (ButtonName | string)[],
                durationFrames = 8,
            ): Promise<TurnResult> => {
                const btnArray = Array.isArray(button) ? button : [button];
                const actions: InputAction[] = [
                    ...btnArray.map(b => ({ type: 'press' as const, button: b, holdFrames: durationFrames })),
                    { type: 'wait' as const, frames: 10 },
                ];
                return this.client.stepSequence(actions);
            },

            hold: async (button: ButtonName | string | readonly (ButtonName | string)[]): Promise<void> => {
                const btnArray = Array.isArray(button) ? button : [button];
                const actions: InputAction[] = btnArray.map(b => ({ type: 'hold' as const, button: b, frames: 1 }));
                await this.client.stepSequence(actions);
            },

            release: async (button: ButtonName | string | readonly (ButtonName | string)[]): Promise<void> => {
                const btnArray = Array.isArray(button) ? button : [button];
                const actions: InputAction[] = btnArray.map(b => ({ type: 'release' as const, button: b }));
                await this.client.stepSequence(actions);
            },

            sequence: async (actions: readonly InputAction[], options?: StepSequenceOptions): Promise<TurnResult> => {
                return this.client.stepSequence(actions, options);
            },

            tick: async (frames = 1): Promise<VideoPacket> => {
                return this.client.step(frames);
            },

            wait: async (frames: number): Promise<void> => {
                await this.client.step(frames);
            },
        };
    }

    /**
     * Diagnostic and streaming controls.
     */
    public get diagnostics(): MgbaDiagnosticsApi {
        return {
            ping: async (): Promise<string> => this.client.ping(),
            onVideoFrame: (listener: (frame: VideoPacket) => void) => {
                this.client.on('videoFrame', listener);
                return () => this.client.off('videoFrame', listener);
            },
            onAudioChunk: (listener: (chunk: AudioChunk) => void) => {
                this.client.on('audioChunk', listener);
                return () => this.client.off('audioChunk', listener);
            },
            onKeyframe: (listener: (kf: Keyframe) => void) => {
                this.client.on('keyframe', listener);
                return () => this.client.off('keyframe', listener);
            },
            onTurnComplete: (listener: (res: TurnResult) => void) => {
                this.client.on('turnComplete', listener);
                return () => this.client.off('turnComplete', listener);
            },
            onMemoryChange: (listener: (evt: WorkerMemoryChangeEvent) => void) => {
                this.client.on('memoryChange', listener);
                return () => this.client.off('memoryChange', listener);
            },
            onStateRestore: (listener: (evt: WorkerStateRestoreEvent) => void) => {
                this.client.on('stateRestore', listener);
                return () => this.client.off('stateRestore', listener);
            },
            setWatches: async (watches: readonly { key: string; address: number; length?: number }[]): Promise<void> => {
                return this.client.setWatchPlan(watches);
            },
        };
    }

    /**
     * Savestate operations (Cycle-accurate in-memory StateHandles & file export).
     */
    public get states(): MgbaStatesApi {
        return {
            save: async (): Promise<StateHandle> => {
                return this.client.saveStateHandle();
            },

            restore: async (handle: StateHandle | string): Promise<boolean> => {
                const handleId = typeof handle === 'string' ? handle : handle.id;
                return this.client.restoreStateHandle(handleId);
            },

            saveToFile: async (filepath: string): Promise<boolean> => {
                return this.client.saveState(filepath);
            },

            loadFromFile: async (filepath: string): Promise<boolean> => {
                return this.client.loadState(filepath);
            },
        };
    }

    /**
     * Symbol lookup and symbol-based memory access.
     */
    public get symbols(): MgbaSymbolsApi {
        return {
            loadRgbdsSymFile: async (filepath: string): Promise<void> => {
                this.symbolManager.loadRgbdsSymFile(filepath);
            },

            parseRgbdsSym: async (content: string): Promise<void> => {
                this.symbolManager.parseRgbdsSym(content);
            },

            loadGnuMapFile: async (filepath: string): Promise<void> => {
                this.symbolManager.loadGnuMapFile(filepath);
            },

            parseGnuMap: async (content: string): Promise<void> => {
                this.symbolManager.parseGnuMap(content);
            },

            read: async (name: string): Promise<number> => {
                const sym = this.symbolManager.get(name);
                const spec: ReadSpec = {
                    address: sym.address,
                    type: 'u8',
                    ...(sym.bank !== undefined ? { bank: sym.bank } : {}),
                };
                const [val] = await this.client.readBatch([spec]);
                return typeof val === 'number' ? val : 0;
            },

            read16LE: async (name: string): Promise<number> => {
                const sym = this.symbolManager.get(name);
                const spec: ReadSpec = {
                    address: sym.address,
                    type: 'u16le',
                    ...(sym.bank !== undefined ? { bank: sym.bank } : {}),
                };
                const [val] = await this.client.readBatch([spec]);
                return typeof val === 'number' ? val : 0;
            },

            readBytes: async (name: string, length: number): Promise<Buffer> => {
                const sym = this.symbolManager.get(name);
                if (sym.bank !== undefined) {
                    if (sym.address >= 0x4000 && sym.address < 0x8000) {
                        const physicalOffset = bankedToPhysicalOffset(sym.address, sym.bank, 0x4000, 0x4000);
                        return this.client.sliceMemory('ROM', length, physicalOffset);
                    }
                    if (sym.address < 0x4000 && sym.bank === 0) {
                        return this.client.sliceMemory('ROM', length, sym.address);
                    }
                    if (sym.address >= 0xD000 && sym.address < 0xE000) {
                        const physicalOffset = bankedToPhysicalOffset(sym.address, sym.bank, 0x1000, 0xD000);
                        return this.client.sliceMemory('WRAM', length, physicalOffset);
                    }
                    if (sym.address >= 0x8000 && sym.address < 0xA000) {
                        const physicalOffset = bankedToPhysicalOffset(sym.address, sym.bank, 0x2000, 0x8000);
                        return this.client.sliceMemory('VRAM', length, physicalOffset);
                    }
                    if (sym.address >= 0xA000 && sym.address < 0xC000) {
                        const physicalOffset = bankedToPhysicalOffset(sym.address, sym.bank, 0x2000, 0xA000);
                        return this.client.sliceMemory('SRAM', length, physicalOffset);
                    }
                }
                return this.client.sliceMemory(sym.address, length);
            },

            write: async (name: string, value: number): Promise<void> => {
                const sym = this.symbolManager.get(name);
                if (!sym.writable) {
                    throw new Error(`Symbol "${name}" at 0x${sym.address.toString(16)} is in read-only region (${sym.region}).`);
                }
                if (sym.bank !== undefined) {
                    if (sym.address >= 0xD000 && sym.address < 0xE000) {
                        const bank = sym.bank === 0 ? 1 : sym.bank;
                        await this.client.bankWrite8(1, bank, (sym.address - 0xD000) >>> 0, value);
                        return;
                    }
                    if (sym.address >= 0xC000 && sym.address < 0xD000) {
                        await this.client.bankWrite8(1, 0, (sym.address - 0xC000) >>> 0, value);
                        return;
                    }
                    if (sym.address >= 0x8000 && sym.address < 0xA000) {
                        await this.client.bankWrite8(2, sym.bank, (sym.address - 0x8000) >>> 0, value);
                        return;
                    }
                    if (sym.address >= 0xA000 && sym.address < 0xC000) {
                        await this.client.bankWrite8(3, sym.bank, (sym.address - 0xA000) >>> 0, value);
                        return;
                    }
                }
                await this.client.busWrite8(sym.address, value);
            },

            resolve: (name: string): SymbolRecord | undefined => {
                return this.symbolManager.resolve(name);
            },

            manager: this.symbolManager,
        };
    }

    /**
     * Captures an atomic visual + memory snapshot on the exact same completed frame.
     */
    public async observe(schema: {
        screen?: boolean | undefined;
        memory?: MemorySnapshotOptions | undefined;
        reads?: readonly ReadSpec[] | undefined;
        slices?: readonly SliceSpec[] | undefined;
        symbols?: readonly string[] | undefined;
    } = {}): Promise<ObservationSnapshot> {
        const combinedReads: ReadSpec[] = [...(schema.reads ?? [])];
        if (schema.symbols) {
            for (const symName of schema.symbols) {
                const sym = this.symbolManager.get(symName);
                combinedReads.push({
                    address: sym.address,
                    type: 'u8',
                    key: symName,
                    ...(sym.bank !== undefined ? { bank: sym.bank } : {}),
                });
            }
        }

        return this.client.observe({
            screen: schema.screen ?? true,
            memory: schema.memory,
            reads: combinedReads,
            slices: schema.slices,
        });
    }

    /**
     * Lossless declarative wait for a condition or predicate.
     */
    public async waitFor(
        specOrPredicate: WaitForDeclarativeSpec | ((emu: MgbaInstance) => boolean | Promise<boolean>),
        options: WaitForOptions = {}
    ): Promise<void> {
        const timeoutFrames = options.timeoutFrames ?? 600;
        const checkInterval = options.checkIntervalFrames ?? 1;

        if (!Number.isFinite(timeoutFrames) || !Number.isInteger(timeoutFrames) || timeoutFrames <= 0) {
            throw new RangeError(`Invalid timeoutFrames: ${timeoutFrames}. Must be a positive integer.`);
        }
        if (!Number.isFinite(checkInterval) || !Number.isInteger(checkInterval) || checkInterval <= 0) {
            throw new RangeError(`Invalid checkIntervalFrames: ${checkInterval}. Must be a positive integer.`);
        }

        if (typeof specOrPredicate === 'function') {
            let elapsedFrames = 0;
            throwIfAborted(options.signal, 'waitFor aborted by signal.');

            while (elapsedFrames < timeoutFrames) {
                throwIfAborted(options.signal, 'waitFor aborted by signal.');
                const match = await specOrPredicate(this);
                if (match) return;

                throwIfAborted(options.signal, 'waitFor aborted by signal.');

                const frames = Math.min(checkInterval, timeoutFrames - elapsedFrames);
                await this.client.step(frames, undefined, { signal: options.signal });
                elapsedFrames += frames;
            }

            throwIfAborted(options.signal, 'waitFor aborted by signal.');

            if (await specOrPredicate(this)) return;

            throw new TimeoutError(`waitFor predicate timed out after ${timeoutFrames} frames`);
        }

        const spec = specOrPredicate;
        let targetAddress = spec.address;
        let targetBank: number | undefined;
        if (targetAddress === undefined && spec.symbol) {
            const resolvedSym = this.symbols.resolve(spec.symbol);
            targetAddress = resolvedSym?.address;
            targetBank = resolvedSym?.bank;
        }

        if (targetAddress === undefined) {
            throw new Error('waitFor: Either address or valid symbol must be specified');
        }

        await this.client.waitFor({
            address: targetAddress,
            bank: targetBank,
            value: spec.value,
            op: spec.op,
        }, timeoutFrames, options.signal);
    }

    /**
     * Installs a single-file host-resident plugin.
     */
    public async use<TPluginInstance>(plugin: MgbaPlugin<TPluginInstance>): Promise<TPluginInstance> {
        if (!plugin || typeof plugin !== 'function') {
            throw new TypeError('Plugin must be a PluginClass constructor.');
        }

        const pluginName = plugin.pluginName;
        if (!pluginName || typeof pluginName !== 'string') {
            throw new Error('PluginClass must declare a static pluginName string.');
        }

        if (plugin.supportedModels && !plugin.supportedModels.includes(this.console.model)) {
            throw new Error(`Plugin "${pluginName}" does not support console model "${this.console.model}". Supported models: ${plugin.supportedModels.join(', ')}`);
        }

        const existing = this.activePlugins.get(pluginName);
        if (existing) {
            if (existing.pluginClass === plugin) {
                return existing.instance as TPluginInstance;
            }
            throw new Error(`Plugin "${pluginName}" is already installed with a different class definition.`);
        }

        const instance = new plugin(this);
        this.activePlugins.set(pluginName, { pluginClass: plugin, instance });
        return instance;
    }

    /**
     * Resets the core.
     */
    public async reset(): Promise<void> {
        return this.client.reset();
    }

    /**
     * Disposes installed plugins and detaches event listeners without closing the underlying worker client.
     */
    public async disposePlugins(): Promise<void> {
        for (const cleanup of this.eventCleanups) {
            cleanup();
        }
        this.eventCleanups = [];
        for (const entry of this.activePlugins.values()) {
            const pluginInstance = entry.instance;
            if (pluginInstance && typeof (pluginInstance as { dispose?: unknown }).dispose === 'function') {
                try {
                    await (pluginInstance as { dispose(): void | Promise<void> }).dispose();
                } catch {
                    // Ignore disposal errors
                }
            }
        }
        this.activePlugins.clear();
        this.removeAllListeners();
    }

    /**
     * Closes the instance and cleans up installed plugins and the worker client.
     */
    public async close(): Promise<void> {
        await this.disposePlugins();
        await this.client.close();
    }
}

export class Mgba {
    /**
     * Loads a ROM and returns a modernized MgbaInstance.
     */
    public static async load(romPath: string, options: MgbaLoadOptions = {}): Promise<MgbaInstance> {
        const client = new WorkerEmulatorClient({
            watchdogTimeoutMs: options.watchdogTimeoutMs,
            workerPath: options.workerPath,
        });

        try {
            if (options.mediaSinks) {
                for (const sink of options.mediaSinks) {
                    client.registerMediaSink(sink);
                }
            }
            if (options.keyframeSinks) {
                for (const sink of options.keyframeSinks) {
                    client.registerKeyframeSink(sink);
                }
            }

            const romInfo = await client.loadROM(romPath);
            const instance = new MgbaInstance(client, romInfo);

            if (options.symPath) {
                await instance.symbols.loadRgbdsSymFile(options.symPath);
            }

            return instance;
        } catch (err) {
            client.forceTerminateWorker();
            throw err;
        }
    }
}
