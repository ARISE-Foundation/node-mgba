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
    type StepSequenceOptions,
    type SequenceHandle,
    type MediaSink,
    type VideoPacket,
    type RomInfo,
    type InputAction,
    type ReadSpec,
    type MemoryRegionName,
    type MemorySnapshotOptions,
} from '../types/index.js';
import { expandButtonsToInputActions } from './InputActionCompiler.js';
import {
    MgbaInstance,
    type MgbaScreenApi,
    type MgbaMemoryApi,
    type MgbaControlsApi,
    type MgbaStatesApi,
    type MgbaSymbolsApi,
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

                this.romInfo = romInfo;
                this.instanceValue = new MgbaInstance(this.clientInstance, romInfo);

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
                if (this.instanceValue) {
                    try {
                        await this.instanceValue.disposePlugins();
                    } catch {
                        // Ignore dispose error on reload
                    }
                }
                this.instanceValue = new MgbaInstance(client, info);
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
        const promise = client.stepSequence(actions, stepOpts).then(() => ({
            sequenceId,
            actionsExecuted: actions.length,
        }));
        return {
            sequenceId,
            promise,
            cancel: () => {},
        };
    }

    public pressButtons(
        buttons: readonly string[],
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

    public async saveState(filepath: string): Promise<boolean> {
        const client = this.getActiveClient('saveState');
        return this.operationMutex.runExclusive(async () => {
            return client.saveState(filepath);
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
