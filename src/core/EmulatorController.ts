import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { WorkerEmulatorClient } from '../worker/WorkerEmulatorClient.js';
import type {
    WorkerEmulatorClientOptions,
    ObservationSnapshot,
    SliceSpec,
} from '../worker/protocol.js';
import {
    GB_FPS,
    validateStepSequenceOptions,
    type ExecuteSequenceOptions,
    type PressButtonsOptions,
    type ButtonActionItem,
    type StepSequenceOptions,
    type SequenceHandle,
    type MediaSink,
    type VideoPacket,
    type RomInfo,
    type InputAction,
    type ReadSpec,
    type MemoryRegionName,
    type MemorySnapshotOptions,
    type HeldButtonStatus,
    type CpuState,
    type CpuHealthReport,
    type SaveStateOptions,
} from '../types/index.js';
import { expandButtonsToInputActions, resolveButtonMask } from './InputActionCompiler.js';
import {
    MgbaInstance,
    type MgbaLoadOptions,
    type MgbaScreenApi,
    type MgbaMemoryApi,
    type MgbaControlsApi,
    type MgbaStatesApi,
    type MgbaSymbolsApi,
    type MgbaDiagnosticsApi,
} from '../Mgba.js';
import type { MgbaPlugin } from '../plugins/Plugin.js';
import { LifecycleError, TimeoutError } from '../types/errors.js';

export interface EmulatorControllerOptions {
    readonly romPath?: string;
    readonly fps?: number;
    readonly realtime?: boolean;
    readonly mediaPort?: import('node:worker_threads').MessagePort;
    readonly mediaSinks?: readonly MediaSink[];
    readonly client?: WorkerEmulatorClient;
    readonly workerOptions?: WorkerEmulatorClientOptions;

    /**
     * Standalone cartridge battery save file path (.sav).
     * - String: explicit filepath.
     * - `true`: auto-derive from `romPath` (e.g., `/path/to/game.gb` -> `/path/to/game.sav`).
     * - Omit, `false`, or `undefined`: disabled.
     */
    readonly batterySavePath?: string | boolean;

    /**
     * Automatically flush active cartridge SRAM to `batterySavePath`
     * whenever `saveState()` succeeds. Defaults to `true` when `batterySavePath` is enabled.
     */
    readonly autoFlushBatteryOnSave?: boolean;

    /**
     * Default CPU crash guard policy for `saveState()` calls.
     * When `true`, all `saveState()` calls reject if the CPU is in a deadlocked or corrupted state.
     * Overridable per-call via `saveState(filepath, { guardCrashes: false })`.
     * Defaults to `false`.
     */
    readonly guardCrashes?: boolean;
}

class SimpleAsyncMutex {
    private current = Promise.resolve();

    public async runExclusive<T>(task: () => Promise<T>): Promise<T> {
        let releaseFn!: () => void;
        const next = new Promise<void>((resolve) => {
            releaseFn = resolve;
        });
        const prev = this.current;
        this.current = next;

        await prev;
        try {
            return await task();
        } finally {
            releaseFn();
        }
    }
}

export type ControllerState = 'uninitialized' | 'initializing' | 'ready' | 'closing' | 'closed';

export class EmulatorController extends EventEmitter {
    private clientInstance: WorkerEmulatorClient | null = null;
    private instanceValue: MgbaInstance | null = null;
    private currentState: ControllerState = 'uninitialized';
    private operationMutex = new SimpleAsyncMutex();
    private desiredSinks = new Map<string, MediaSink>();
    private initialMediaPort: import('node:worker_threads').MessagePort | null = null;

    private readonly options: EmulatorControllerOptions;
    private romPath: string | null;
    private romInfo: RomInfo | null = null;
    private targetFps: number;
    private isRealtime: boolean;
    private workerOpts: WorkerEmulatorClientOptions;
    private desiredPlaybackState: 'playing' | 'paused' = 'paused';
    private nextSequenceId = 1;

    private onVideoFrame = (f: VideoPacket) => this.emit('frame', f);
    private onClientError = (e: Error) => {
        if (this.listenerCount('error') > 0) {
            this.emit('error', e);
        }
    };

    private initPromise: Promise<RomInfo> | null = null;
    private closePromise: Promise<void> | null = null;

    constructor(options: EmulatorControllerOptions = {}) {
        super();
        this.options = options;
        this.romPath = options.romPath || null;
        this.targetFps = options.fps && options.fps > 0 ? options.fps : GB_FPS;
        this.isRealtime = options.realtime !== false;
        this.workerOpts = options.workerOptions || {};
        this.initialMediaPort = options.mediaPort ?? null;

        if (options.mediaSinks) {
            for (const sink of options.mediaSinks) {
                if (!sink || typeof sink.name !== 'string' || !sink.name.trim()) {
                    throw new TypeError('Invalid mediaSink in EmulatorControllerOptions: name string is required.');
                }
                this.desiredSinks.set(sink.name, sink);
            }
        }

        if (options.client) {
            this.clientInstance = options.client;
        }
    }

    private resolveBatterySavePath(romPath?: string): string | null {
        if (!this.options.batterySavePath) {
            return null;
        }
        if (typeof this.options.batterySavePath === 'string') {
            return this.options.batterySavePath;
        }
        if (this.options.batterySavePath === true) {
            const targetRom = romPath ?? this.romPath;
            if (!targetRom) {
                throw new Error('Cannot auto-derive batterySavePath: romPath was not provided');
            }
            const parsed = path.parse(targetRom);
            return path.join(parsed.dir, `${parsed.name}.sav`);
        }
        return null;
    }

    public get batterySavePath(): string | null {
        return this.resolveBatterySavePath();
    }

    public get state(): ControllerState {
        return this.currentState;
    }

    public get instance(): MgbaInstance | null {
        return this.instanceValue;
    }

    private assertReady(operationName: string): void {
        if (this.currentState !== 'ready') {
            throw new LifecycleError(
                `Cannot call ${operationName}() when EmulatorController state is "${this.currentState}". Await controller.initialize() first.`
            );
        }
    }

    private getActiveInstance(operationName: string): MgbaInstance {
        this.assertReady(operationName);
        if (!this.instanceValue) {
            throw new LifecycleError(`Instance value is missing in ready state for ${operationName}.`);
        }
        return this.instanceValue;
    }

    public async use<TPluginApi>(plugin: MgbaPlugin<TPluginApi>): Promise<TPluginApi> {
        return this.getActiveInstance('use').use(plugin);
    }

    public get screen(): MgbaScreenApi {
        return this.getActiveInstance('screen').screen;
    }

    public get memory(): MgbaMemoryApi {
        return this.getActiveInstance('memory').memory;
    }

    public get controls(): MgbaControlsApi {
        return this.getActiveInstance('controls').controls;
    }

    public get states(): MgbaStatesApi {
        return this.getActiveInstance('states').states;
    }

    public get symbols(): MgbaSymbolsApi {
        return this.getActiveInstance('symbols').symbols;
    }

    public get diagnostics(): MgbaDiagnosticsApi {
        return this.getActiveInstance('diagnostics').diagnostics;
    }

    public get client(): WorkerEmulatorClient | null {
        return this.clientInstance;
    }

    public get isRunning(): boolean {
        return this.desiredPlaybackState === 'playing';
    }

    public isPlaybackRunning(): boolean {
        return this.isRunning;
    }

    public isEmulationRunning(): boolean {
        return this.isRunning;
    }

    public get currentFps(): number {
        return this.desiredPlaybackState === 'playing' ? this.targetFps : 0;
    }

    public get fps(): number {
        return this.targetFps;
    }

    public set fps(newFps: number) {
        if (newFps > 0 && Number.isFinite(newFps)) {
            this.targetFps = newFps;
            if (this.clientInstance && this.desiredPlaybackState === 'playing') {
                void this.clientInstance.startPlayback(newFps);
            }
        }
    }

    private getActiveClient(operationName = 'operation'): WorkerEmulatorClient {
        this.assertReady(operationName);
        if (!this.clientInstance) {
            throw new LifecycleError(`Worker client instance is missing in ready state for ${operationName}.`);
        }
        return this.clientInstance;
    }

    public async initialize(): Promise<RomInfo> {
        if (this.currentState === 'closed' || this.currentState === 'closing') {
            throw new LifecycleError(`Cannot initialize EmulatorController in "${this.currentState}" state`);
        }
        if (this.currentState === 'ready' && this.romInfo) {
            return this.romInfo;
        }
        if (this.initPromise) {
            return this.initPromise;
        }

        this.currentState = 'initializing';

        this.initPromise = (async () => {
            try {
                if (!this.clientInstance) {
                    this.clientInstance = new WorkerEmulatorClient(this.workerOpts);
                }

                // Register desired media sinks
                for (const sink of this.desiredSinks.values()) {
                    this.clientInstance.registerMediaSink(sink);
                }

                // Connect initial media port if specified
                if (this.initialMediaPort) {
                    await this.clientInstance.initMediaPort(this.initialMediaPort);
                    this.initialMediaPort = null;
                }

                let romInfo: RomInfo;
                if (this.romPath) {
                    romInfo = await this.clientInstance.loadROM(this.romPath);
                    if (!romInfo || typeof romInfo !== 'object') {
                        throw new LifecycleError(
                            `Worker failed to return valid ROM metadata when loading "${this.romPath}".`
                        );
                    }
                } else if (this.romInfo) {
                    romInfo = this.romInfo;
                    await this.clientInstance.syncMediaSinks();
                } else {
                    const clientRomInfo = this.clientInstance.getRomInfo();
                    if (clientRomInfo) {
                        romInfo = clientRomInfo;
                        await this.clientInstance.syncMediaSinks();
                    } else {
                        throw new LifecycleError(
                            'ROM path is required to initialize EmulatorController (or injected client must have loaded a ROM)'
                        );
                    }
                }

                const batteryPath = this.resolveBatterySavePath(this.romPath ?? undefined);
                if (batteryPath && fs.existsSync(batteryPath)) {
                    const loaded = await this.clientInstance.loadBatteryFile(batteryPath);
                    if (!loaded) {
                        throw new Error('Failed to load existing battery save file: ' + batteryPath);
                    }
                }

                const instanceOptions: MgbaLoadOptions = {
                    batterySavePath: batteryPath ?? undefined,
                    autoFlushBatteryOnSave: this.options.autoFlushBatteryOnSave,
                    guardCrashes: this.options.guardCrashes,
                };

                this.romInfo = romInfo;
                this.instanceValue = new MgbaInstance(this.clientInstance, romInfo, instanceOptions);

                this.clientInstance.on('videoFrame', this.onVideoFrame);
                this.clientInstance.on('error', this.onClientError);

                if (this.isRealtime) {
                    this.desiredPlaybackState = 'playing';
                    await this.clientInstance.startPlayback(this.targetFps);
                }

                if (this.currentState === 'closing' || this.currentState === 'closed') {
                    throw new LifecycleError('EmulatorController was closed during initialization');
                }

                this.currentState = 'ready';
                if (this.isRealtime) {
                    this.emit('start');
                }
                return romInfo;
            } catch (err) {
                this.currentState = 'closed';
                if (this.clientInstance) {
                    try {
                        this.clientInstance.forceTerminateWorker();
                    } catch {
                        // ignore
                    }
                    this.clientInstance = null;
                }
                throw err;
            }
        })();

        return this.initPromise;
    }

    public async initMediaPort(port: import('node:worker_threads').MessagePort): Promise<void> {
        const client = this.getActiveClient('initMediaPort');
        return client.initMediaPort(port);
    }

    public async loadROM(romPath: string): Promise<RomInfo> {
        this.assertReady('loadROM');
        this.romPath = romPath;
        return this.operationMutex.runExclusive(async () => {
            const wasRunning = this.desiredPlaybackState === 'playing';
            if (wasRunning) {
                await this.pausePlayback();
            }
            await this.clearButtons();
            try {
                const client = this.getActiveClient('loadROM');
                const info = await client.loadROM(romPath);
                this.romInfo = info;
                const batteryPath = this.resolveBatterySavePath(romPath);
                if (batteryPath && fs.existsSync(batteryPath)) {
                    const loaded = await client.loadBatteryFile(batteryPath);
                    if (!loaded) {
                        throw new Error('Failed to load existing battery save file: ' + batteryPath);
                    }
                }
                if (this.instanceValue) {
                    try {
                        await this.instanceValue.disposePlugins();
                    } catch {
                        // Ignore dispose error on reload
                    }
                }
                const instanceOptions: MgbaLoadOptions = {
                    batterySavePath: batteryPath ?? undefined,
                    autoFlushBatteryOnSave: this.options.autoFlushBatteryOnSave,
                    guardCrashes: this.options.guardCrashes,
                };
                this.instanceValue = new MgbaInstance(client, info, instanceOptions);
                return info;
            } finally {
                if (wasRunning) {
                    await this.startPlayback();
                }
            }
        });
    }

    public async startPlayback(fps?: number): Promise<void> {
        this.assertReady('startPlayback');
        if (fps && fps > 0 && Number.isFinite(fps)) {
            this.targetFps = fps;
        }
        const client = this.getActiveClient('startPlayback');
        if (this.clientInstance && !this.clientInstance.listeners('videoFrame').includes(this.onVideoFrame)) {
            this.clientInstance.on('videoFrame', this.onVideoFrame);
        }
        if (this.clientInstance && !this.clientInstance.listeners('error').includes(this.onClientError)) {
            this.clientInstance.on('error', this.onClientError);
        }
        await client.startPlayback(this.targetFps);
        const wasRunning = this.desiredPlaybackState === 'playing';
        this.desiredPlaybackState = 'playing';
        if (!wasRunning) {
            this.emit('start');
        }
    }

    public async pausePlayback(): Promise<void> {
        this.assertReady('pausePlayback');
        const client = this.getActiveClient('pausePlayback');
        await client.pausePlayback();
        const wasRunning = this.desiredPlaybackState === 'playing';
        this.desiredPlaybackState = 'paused';
        if (wasRunning) {
            this.emit('pause');
        }
    }

    public async setKeyMask(mask: number): Promise<void> {
        const client = this.getActiveClient('setKeyMask');
        return client.setKeyMask(mask);
    }

    public async getKeyMask(): Promise<number> {
        const client = this.getActiveClient('getKeyMask');
        return client.getKeyMask();
    }

    public async getHeldButtons(): Promise<HeldButtonStatus[]> {
        const client = this.getActiveClient('getHeldButtons');
        return client.getHeldButtons();
    }

    public async holdButtons(buttons: readonly string[]): Promise<void> {
        const client = this.getActiveClient('holdButtons');
        let maskToAdd = 0;
        for (const b of buttons) {
            maskToAdd |= resolveButtonMask(b);
        }
        const currentMask = await client.getKeyMask();
        await client.setKeyMask(currentMask | maskToAdd);
    }

    public async releaseButtons(buttons?: readonly string[]): Promise<void> {
        const client = this.getActiveClient('releaseButtons');
        if (!buttons || buttons.length === 0) {
            await client.setKeyMask(0);
            return;
        }
        let maskToRemove = 0;
        for (const b of buttons) {
            maskToRemove |= resolveButtonMask(b);
        }
        const currentMask = await client.getKeyMask();
        await client.setKeyMask(currentMask & ~maskToRemove);
    }

    public async restoreHeldButtons(heldButtons: readonly HeldButtonStatus[]): Promise<void> {
        const client = this.getActiveClient('restoreHeldButtons');
        await client.restoreHeldButtons(heldButtons);
    }

    public executeSequence(
        actions: readonly InputAction[],
        options: ExecuteSequenceOptions = {},
    ): SequenceHandle {
        const client = this.getActiveClient();
        if (this.isPlaybackRunning()) {
            return client.enqueueSequence(actions, options);
        }
        const sequenceId = this.nextSequenceId++;
        const stepOpts: StepSequenceOptions = {
            ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
            ...(options.signal !== undefined ? { signal: options.signal } : {}),
            ...(options.holdFrames !== undefined ? { holdFrames: options.holdFrames } : {}),
            ...(options.releaseFrames !== undefined ? { releaseFrames: options.releaseFrames } : {}),
            ...(options.postStabilizationFrames !== undefined ? { postStabilizationFrames: options.postStabilizationFrames } : {}),
        };
        const promise = client.stepSequence(actions, stepOpts).then((turnResult) => ({
            sequenceId,
            actionsExecuted: actions.length,
            turnResult,
        }));
        return {
            sequenceId,
            promise,
            cancel: () => {},
        };
    }

    public pressButtons(
        buttons: readonly ButtonActionItem[],
        options: PressButtonsOptions = {},
    ): SequenceHandle {
        const validatedOptions = validateStepSequenceOptions(options);
        const actions = expandButtonsToInputActions(buttons, validatedOptions);
        return this.executeSequence(actions, validatedOptions);
    }

    public async clearButtons(): Promise<void> {
        const client = this.getActiveClient('clearButtons');
        await client.clearActionQueue();
        await client.setKeyMask(0);
    }

    public async observe(options: {
        screen?: boolean | undefined;
        memory?: MemorySnapshotOptions | undefined;
        reads?: readonly ReadSpec[] | undefined;
        slices?: readonly SliceSpec[] | undefined;
    } = {}): Promise<ObservationSnapshot> {
        const client = this.getActiveClient('observe');
        return client.observe(options);
    }

    public async sliceMemory(addressOrRegion: number | MemoryRegionName, length: number, offset?: number): Promise<Buffer> {
        const client = this.getActiveClient('sliceMemory');
        return client.sliceMemory(addressOrRegion, length, offset);
    }

    public async getVram(): Promise<Buffer> {
        const client = this.getActiveClient('getVram');
        return client.getVram();
    }

    public async getOam(): Promise<Buffer> {
        const client = this.getActiveClient('getOam');
        return client.getOam();
    }

    public async busWrite8(address: number, value: number): Promise<void> {
        const client = this.getActiveClient('busWrite8');
        return client.busWrite8(address, value);
    }

    public async bankWrite8(spaceId: number, bank: number, offset: number, value: number): Promise<void> {
        const client = this.getActiveClient('bankWrite8');
        return client.bankWrite8(spaceId, bank, offset, value);
    }

    public async step(
        frames = 1,
        keyMask?: number,
        options: { timeoutMs?: number; signal?: AbortSignal } = {},
    ): Promise<VideoPacket> {
        const client = this.getActiveClient('step');
        return client.step(frames, keyMask, options);
    }

    public async saveState(filepath: string, options?: SaveStateOptions): Promise<boolean> {
        const client = this.getActiveClient('saveState');
        return this.operationMutex.runExclusive(async () => {
            const guard = options?.guardCrashes ?? this.options.guardCrashes ?? false;
            const saved = await client.saveState(filepath, { ...options, guardCrashes: guard });
            if (saved && this.options.autoFlushBatteryOnSave !== false) {
                const batteryPath = this.resolveBatterySavePath();
                if (batteryPath) {
                    await client.saveBatteryFile(batteryPath);
                }
            }
            return saved;
        });
    }

    public async saveBatteryFile(filepath: string): Promise<boolean> {
        const client = this.getActiveClient('saveBatteryFile');
        return this.operationMutex.runExclusive(async () => {
            return client.saveBatteryFile(filepath);
        });
    }

    public async loadBatteryFile(filepath: string): Promise<boolean> {
        const client = this.getActiveClient('loadBatteryFile');
        return this.operationMutex.runExclusive(async () => {
            return client.loadBatteryFile(filepath);
        });
    }

    public async getSram(): Promise<Buffer> {
        const client = this.getActiveClient('getSram');
        return this.operationMutex.runExclusive(async () => {
            return client.getSram();
        });
    }

    public async setSram(buffer: Buffer | Uint8Array): Promise<boolean> {
        const client = this.getActiveClient('setSram');
        return this.operationMutex.runExclusive(async () => {
            return client.setSram(buffer);
        });
    }

    public async getCpuState(): Promise<CpuState> {
        const client = this.getActiveClient('getCpuState');
        return this.operationMutex.runExclusive(async () => {
            return client.getCpuState();
        });
    }

    public async checkCpuHealth(): Promise<CpuHealthReport> {
        const client = this.getActiveClient('checkCpuHealth');
        return this.operationMutex.runExclusive(async () => {
            return client.checkCpuHealth();
        });
    }

    public async loadState(filepath: string): Promise<boolean> {
        const client = this.getActiveClient('loadState');
        return this.operationMutex.runExclusive(async () => {
            return client.loadState(filepath);
        });
    }

    public async reset(): Promise<boolean> {
        const client = this.getActiveClient('reset');
        return this.operationMutex.runExclusive(async () => {
            await client.reset();
            return true;
        });
    }

    public registerMediaSink(sink: MediaSink): this {
        if (!sink || typeof sink.name !== 'string' || !sink.name.trim()) {
            throw new TypeError('Invalid mediaSink: name string is required.');
        }
        const existing = this.desiredSinks.get(sink.name);
        if (existing) {
            if (existing === sink) {
                return this;
            }
            throw new Error(
                `MediaSink "${sink.name}" is already registered with a different object definition.`
            );
        }
        this.desiredSinks.set(sink.name, sink);
        if (this.clientInstance && this.currentState === 'ready') {
            this.clientInstance.registerMediaSink(sink);
        }
        return this;
    }

    public unregisterMediaSink(name: string): this {
        if (typeof name !== 'string' || !name.trim()) {
            throw new TypeError('Invalid mediaSink name string.');
        }
        this.desiredSinks.delete(name);
        if (this.clientInstance && this.currentState === 'ready') {
            this.clientInstance.unregisterMediaSink(name);
        }
        return this;
    }

    public forceTerminate(): void {
        this.currentState = 'closed';
        this.desiredPlaybackState = 'paused';
        if (this.initialMediaPort) {
            try {
                this.initialMediaPort.close();
            } catch {
                // ignore
            }
            this.initialMediaPort = null;
        }
        if (this.instanceValue) {
            this.instanceValue.disposePlugins().catch(() => {});
            this.instanceValue = null;
        }
        this.desiredSinks.clear();
        if (this.clientInstance) {
            this.clientInstance.off('videoFrame', this.onVideoFrame);
            this.clientInstance.off('error', this.onClientError);
            try {
                this.clientInstance.forceTerminateWorker();
            } catch {
                // ignore
            }
            this.clientInstance = null;
        }
        this.initPromise = null;
        this.closePromise = null;
    }

    public async close(options: { timeoutMs?: number } = {}): Promise<void> {
        if (this.currentState === 'closed') {
            return this.closePromise || Promise.resolve();
        }
        if (this.closePromise) {
            return this.closePromise;
        }

        this.currentState = 'closing';
        this.desiredPlaybackState = 'paused';
        const timeoutMs = options.timeoutMs ?? 2000;

        this.closePromise = this.operationMutex.runExclusive(async () => {
            if (this.initPromise) {
                try {
                    await this.initPromise;
                } catch {
                    // ignore
                }
            }

            if (this.clientInstance && !this.clientInstance.isDestroyed) {
                try {
                    const batteryPath = this.resolveBatterySavePath();
                    if (batteryPath) {
                        await this.clientInstance.saveBatteryFile(batteryPath);
                    }
                } catch {
                    // ignore
                }
            }

            if (this.initialMediaPort) {
                try {
                    this.initialMediaPort.close();
                } catch {
                    // ignore
                }
                this.initialMediaPort = null;
            }

            if (this.instanceValue) {
                try {
                    await this.instanceValue.disposePlugins();
                } catch {
                    // ignore
                }
                this.instanceValue = null;
            }

            this.desiredSinks.clear();

            const clientToClose = this.clientInstance;
            this.clientInstance = null;

            try {
                if (clientToClose) {
                    clientToClose.off('videoFrame', this.onVideoFrame);
                    clientToClose.off('error', this.onClientError);

                    let timeoutTimer: ReturnType<typeof setTimeout> | null = null;
                    const timeoutPromise = new Promise((_, reject) => {
                        timeoutTimer = setTimeout(() => {
                            reject(new TimeoutError('Close timeout'));
                        }, timeoutMs);
                    });

                    try {
                        await Promise.race([
                            clientToClose.close(timeoutMs),
                            timeoutPromise,
                        ]);
                    } catch {
                        clientToClose.forceTerminateWorker();
                    } finally {
                        if (timeoutTimer) clearTimeout(timeoutTimer);
                    }
                }
            } finally {
                this.currentState = 'closed';
            }
        });

        return this.closePromise;
    }
}

export default EmulatorController;
