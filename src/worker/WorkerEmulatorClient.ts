import { Worker, MessagePort } from 'node:worker_threads';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import { Buffer } from 'node:buffer';
import type {
    WorkerInboundMessage,
    WorkerOutboundMessage,
    WorkerRequestPayload,
    WorkerResponse,
    WorkerEvent,
    WorkerEmulatorClientOptions,
    ObservationSnapshot,
    WorkerObservationPayload,
    SliceSpec,
    WorkerSerializedError,
    WorkerVideoPacketPayload,
    WorkerAudioChunkPayload,
    WorkerKeyframePayload,
    WorkerTurnResultPayload,
} from './protocol.js';
import type {
    Keyframe,
    VideoPacket,
    AudioChunk,
    TurnResult,
    RomInfo,
    InputAction,
    KeyframeSink,
    MediaSink,
    ReadSpec,
    ReadResultValue,
    MemoryRegionName,
    MemorySnapshotOptions,
    StateHandle,
    HeldButtonStatus,
} from '../types/index.js';
import {
    validateInputAction,
    validateStepSequenceOptions,
    type StepSequenceOptions,
} from '../types/index.js';
import type { MemorySnapshotReader } from '../core/MemoryReader.js';
import { SnapshotMemoryReader } from '../core/MemoryReader.js';
import {
    FatalWorkerError,
    LifecycleError,
    AbortError,
    TimeoutError,
    createAbortError,
} from '../types/errors.js';

function resolveDefaultWorker(): URL {
    const directJs = new URL('./emulator.worker.js', import.meta.url);
    if (fs.existsSync(directJs)) {
        return directJs;
    }
    return new URL('../../dist/src/worker/emulator.worker.js', import.meta.url);
}

interface PendingRequest {
    readonly resolve: (val: unknown) => void;
    readonly reject: (err: Error) => void;
    timeoutTimer: ReturnType<typeof setTimeout> | null;
    readonly requestType: string;
}

export function reconstructWorkerError(rawErr: WorkerSerializedError): Error {
    const message = rawErr.message || 'Worker error';
    let err: Error;
    switch (rawErr.code) {
        case 'ERR_FATAL_WORKER':
            err = new FatalWorkerError(message);
            break;
        case 'ERR_LIFECYCLE':
            err = new LifecycleError(message);
            break;
        case 'ERR_ABORT':
            err = new AbortError(message);
            break;
        case 'ERR_TIMEOUT':
            err = new TimeoutError(message);
            break;
        default:
            err = new Error(message);
            err.name = rawErr.name || 'Error';
            break;
    }
    if (rawErr.stack) {
        err.stack = rawErr.stack;
    }
    return err;
}

function toNodeBuffer(raw: Uint8Array): Buffer {
    return Buffer.isBuffer(raw)
        ? raw
        : Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength);
}

function deserializeVideoPacket(raw: WorkerVideoPacketPayload): VideoPacket {
    return {
        frameIndex: raw.frameIndex,
        pts: raw.pts,
        width: raw.width,
        height: raw.height,
        strideBytes: raw.strideBytes,
        buffer: toNodeBuffer(raw.buffer),
        keys: raw.keys,
    };
}

function deserializeAudioChunk(raw: WorkerAudioChunkPayload): AudioChunk {
    return {
        frameIndex: raw.frameIndex,
        pts: raw.pts,
        sampleRate: raw.sampleRate,
        channels: raw.channels,
        sampleFrames: raw.sampleFrames,
        buffer: toNodeBuffer(raw.buffer),
    };
}

function deserializeKeyframe(raw: WorkerKeyframePayload): Keyframe {
    return {
        frameIndex: raw.frameIndex,
        timestampMs: raw.timestampMs,
        hash: raw.hash,
        width: raw.width,
        height: raw.height,
        triggerReason: raw.triggerReason,
        buffer: toNodeBuffer(raw.buffer),
    };
}

function deserializeTurnResult(
    raw: WorkerTurnResultPayload,
): TurnResult {
    return {
        keyframes: raw.keyframes.map(deserializeKeyframe),
        durationFrames: raw.durationFrames,
        executionTimeMs: raw.executionTimeMs,
    };
}

export class WorkerEmulatorClient extends EventEmitter {
    private worker: Worker | null = null;
    private nextRequestId = 1;
    private pendingRequests: Map<number, PendingRequest> = new Map();
    private registeredMediaSinks = new Map<string, {
        sink: MediaSink;
        videoListener: ((f: VideoPacket) => void) | undefined;
        audioListener: ((c: AudioChunk) => void) | undefined;
    }>();
    private watchdogTimeoutMs: number;
    private isRomLoaded = false;
    private isClosed = false;
    private isClosing = false;
    private isFatal = false;
    private closePromise: Promise<void> | null = null;
    private activeSequences = new Map<number, {
        totalActions: number;
        sessionId: string | null;
        generation: number;
        cleanup: () => void;
        resolve: (val: { sequenceId: number; actionsExecuted: number }) => void;
        reject: (err: Error) => void;
    }>();
    private currentGeneration = 0;
    private currentSessionId: string | null = null;
    private currentRomInfo: RomInfo | null = null;
    private cachedRomPromise: Promise<Buffer> | null = null;

    constructor(options: WorkerEmulatorClientOptions = {}) {
        super();
        this.watchdogTimeoutMs = options.watchdogTimeoutMs ?? 5000;
        const target = options.workerPath ?? resolveDefaultWorker();
        this.worker = new Worker(target);

        this.worker.on('message', (msg: WorkerOutboundMessage) => {
            this.handleWorkerMessage(msg);
        });

        this.worker.on('error', (err: Error) => {
            this.markClientFatal(err);
        });

        this.worker.on('exit', (code: number) => {
            if (!this.isClosed && !this.isClosing) {
                this.markClientFatal(new Error(`Worker thread exited unexpectedly with exit code ${code}`));
            }
        });

        this.on('newListener', (event) => {
            if ((event === 'videoFrame' || event === 'audioChunk') && this.isRomLoaded && this.worker && !this.isClosed && !this.isFatal) {
                this.sendRequest({ type: 'registerMediaSink', name: '__client_event_listener__' }).catch(() => {});
            }
        });
        this.on('removeListener', (event) => {
            if (event === 'videoFrame' || event === 'audioChunk') {
                if (this.listenerCount('videoFrame') === 0 && this.listenerCount('audioChunk') === 0 && this.isRomLoaded && this.worker && !this.isClosed && !this.isFatal) {
                    this.sendRequest({ type: 'unregisterMediaSink', name: '__client_event_listener__' }).catch(() => {});
                }
            }
        });
    }

    public get sessionId(): string | null {
        return this.currentSessionId;
    }

    public get generation(): number {
        return this.currentGeneration;
    }

    public markClientFatal(err: Error): void {
        if (this.isClosed || this.isFatal || this.isClosing) return;
        this.isFatal = true;
        this.isClosed = true;

        // 1. Clear all in-flight request watchdog timers
        for (const req of this.pendingRequests.values()) {
            if (req.timeoutTimer) {
                clearTimeout(req.timeoutTimer);
                req.timeoutTimer = null;
            }
        }

        // 2. Detach worker, attach terminal no-op error handler, and safely terminate
        this.cleanupRegisteredMediaSinks();
        const targetWorker = this.worker;
        this.worker = null;
        if (targetWorker) {
            try {
                targetWorker.removeAllListeners();
                targetWorker.on('error', () => {});
                targetWorker.terminate().catch(() => {});
            } catch {
                // ignore
            }
        }

        // 3. Reject all pending RPCs with FatalWorkerError
        const fatalError = err instanceof FatalWorkerError ? err : new FatalWorkerError(err.message, { cause: err });
        for (const req of this.pendingRequests.values()) {
            req.reject(fatalError);
        }
        this.pendingRequests.clear();

        // 4. Reject all active sequence promises
        for (const seq of this.activeSequences.values()) {
            try {
                seq.cleanup();
                seq.reject(fatalError);
            } catch {
                // ignore
            }
        }
        this.activeSequences.clear();

        // 5. Isolated event emissions
        try {
            this.emit('fatal', fatalError);
        } catch (emitErr) {
            console.error('[WorkerEmulatorClient] Error in fatal event listener:', emitErr);
        }
        if (this.listenerCount('error') > 0) {
            try {
                this.emit('error', fatalError);
            } catch (emitErr) {
                console.error('[WorkerEmulatorClient] Error in error event listener:', emitErr);
            }
        }
    }

    private handleWorkerMessage(msg: WorkerOutboundMessage): void {
        // Discard stale messages from previous generations
        if ('generation' in msg && typeof msg.generation === 'number') {
            if (msg.generation < this.currentGeneration) {
                return;
            }
            if (msg.generation > this.currentGeneration) {
                this.currentGeneration = msg.generation;
            }
        }
        if ('sessionId' in msg && typeof msg.sessionId === 'string') {
            this.currentSessionId = msg.sessionId;
        }

        if ('type' in msg && msg.type === 'event') {
            this.handleWorkerEvent(msg);
            return;
        }

        const res = msg as WorkerResponse;
        const pending = this.pendingRequests.get(res.id);
        if (!pending) return;

        if (pending.timeoutTimer) {
            clearTimeout(pending.timeoutTimer);
            pending.timeoutTimer = null;
        }
        this.pendingRequests.delete(res.id);

        if (res.success) {
            pending.resolve(res.result);
        } else {
            pending.reject(reconstructWorkerError(res.error));
        }
    }

    private handleWorkerEvent(evt: WorkerEvent): void {
        switch (evt.event) {
            case 'keyframe': {
                this.emit('keyframe', deserializeKeyframe(evt.keyframe));
                break;
            }
            case 'videoFrame': {
                this.emit('videoFrame', deserializeVideoPacket(evt.frame));
                break;
            }
            case 'audioChunk': {
                this.emit('audioChunk', deserializeAudioChunk(evt.chunk));
                break;
            }
            case 'turnComplete': {
                this.emit('turnComplete', deserializeTurnResult(evt.turnResult));
                break;
            }
            case 'sequenceTerminal': {
                this.emit('sequenceTerminal', evt);
                const waiter = this.activeSequences.get(evt.sequenceId);
                if (waiter) {
                    if (waiter.sessionId !== evt.sessionId || waiter.generation !== evt.generation) {
                        break;
                    }
                    this.activeSequences.delete(evt.sequenceId);
                    waiter.cleanup();
                    if (evt.status === 'completed') {
                        waiter.resolve({ sequenceId: evt.sequenceId, actionsExecuted: evt.actionsExecuted });
                    } else if (evt.status === 'cancelled') {
                        waiter.reject(new LifecycleError(`Sequence ${evt.sequenceId} cancelled`));
                    } else if (evt.status === 'cleared') {
                        waiter.reject(new LifecycleError('Actions cleared'));
                    } else if (evt.status === 'invalidatedByStateRestore') {
                        waiter.reject(new LifecycleError(`Sequence ${evt.sequenceId} invalidated by state restore`));
                    } else {
                        waiter.reject(evt.error ? reconstructWorkerError(evt.error) : new Error(`Sequence ${evt.sequenceId} failed`));
                    }
                }
                break;
            }
            case 'queueEmpty': {
                this.emit('queueEmpty', evt);
                break;
            }
            case 'streamReset': {
                this.emit('streamReset', evt);
                break;
            }
            case 'memoryChange': {
                try {
                    if (evt.droppedEvents && evt.droppedEvents > 0) {
                        this.emit('memoryDropped', { count: evt.droppedEvents, frameIndex: evt.frameIndex });
                    }
                    this.emit('memoryChange', evt);
                } finally {
                    try {
                        this.worker?.postMessage({
                            type: 'telemetryAck',
                            telemetryId: evt.telemetryId,
                            sessionId: evt.sessionId,
                            generation: evt.generation,
                        });
                    } catch {
                        // Ignore ack post error if worker is shutting down
                    }
                }
                break;
            }
            case 'stateRestore': {
                this.emit('stateRestore', evt);
                break;
            }
            case 'fatalError': {
                const fatalErr = reconstructWorkerError(evt.error);
                this.markClientFatal(fatalErr);
                break;
            }
        }
    }

    private cleanupRegisteredMediaSinks(): void {
        for (const entry of this.registeredMediaSinks.values()) {
            if (entry.videoListener) {
                this.off('videoFrame', entry.videoListener);
            }
            if (entry.audioListener) {
                this.off('audioChunk', entry.audioListener);
            }
            try {
                const closeRes = entry.sink.close?.();
                if (closeRes instanceof Promise) {
                    closeRes.catch(() => {});
                }
            } catch {
                // Ignore sink close error
            }
        }
        this.registeredMediaSinks.clear();
    }

    private sendRequest<TResult>(
        req: WorkerRequestPayload,
        customTimeoutMs?: number,
        signal?: AbortSignal,
        transferList?: readonly (ArrayBuffer | MessagePort)[],
    ): Promise<TResult> {
        if (this.isClosed || this.isFatal || !this.worker || (this.isClosing && req.type !== 'close')) {
            return Promise.reject(new LifecycleError('WorkerEmulatorClient is closed.'));
        }

        if (signal?.aborted) {
            return Promise.reject(createAbortError(signal, 'Operation aborted.'));
        }

        const id = this.nextRequestId++;
        const timeoutMs = customTimeoutMs ?? this.watchdogTimeoutMs;

        return new Promise<TResult>((resolve, reject) => {
            let onAbort: (() => void) | null = null;
            const timeoutTimer = setTimeout(() => {
                if (onAbort && signal) {
                    signal.removeEventListener('abort', onAbort);
                }
                const pending = this.pendingRequests.get(id);
                if (pending) {
                    this.pendingRequests.delete(id);
                }
                const timeoutError = new TimeoutError(
                    `Worker request "${req.type}" (id: ${id}) timed out after ${timeoutMs}ms. Terminating worker.`,
                );
                reject(timeoutError);

                // Terminate poisoned worker and reject remaining pending requests with FatalWorkerError
                this.markClientFatal(timeoutError);
            }, timeoutMs);

            if (signal) {
                const abortHandler = () => {
                    clearTimeout(timeoutTimer);
                    this.pendingRequests.delete(id);
                    signal.removeEventListener('abort', abortHandler);
                    try {
                        this.worker?.postMessage({
                            id: this.nextRequestId++,
                            type: 'cancelRequest',
                            targetId: id,
                            sessionId: this.currentSessionId,
                            generation: this.currentGeneration,
                        });
                    } catch {
                        // ignore worker post error on abort
                    }
                    reject(createAbortError(signal, 'Operation aborted.'));
                };
                onAbort = abortHandler;
                signal.addEventListener('abort', abortHandler, { once: true });
            }

            this.pendingRequests.set(id, {
                resolve: ((val: unknown) => {
                    if (onAbort && signal) signal.removeEventListener('abort', onAbort);
                    (resolve as (val: unknown) => void)(val);
                }),
                reject: ((err: unknown) => {
                    if (onAbort && signal) signal.removeEventListener('abort', onAbort);
                    reject(err);
                }),
                timeoutTimer,
                requestType: req.type,
            });

            const message: WorkerInboundMessage = {
                ...req,
                id,
                sessionId: this.currentSessionId ?? undefined,
                generation: this.currentGeneration,
            } as WorkerInboundMessage;

            try {
                if (transferList && transferList.length > 0) {
                    this.worker?.postMessage(message, transferList as unknown as Parameters<NonNullable<typeof this.worker>['postMessage']>[1]);
                } else {
                    this.worker?.postMessage(message);
                }
            } catch (err: unknown) {
                clearTimeout(timeoutTimer);
                if (onAbort && signal) signal.removeEventListener('abort', onAbort);
                this.pendingRequests.delete(id);
                reject(err instanceof Error ? err : new Error(String(err)));
            }
        });
    }

    /**
     * Registers a keyframe sink with this client.
     */
    public registerKeyframeSink(sink: KeyframeSink): this {
        if (sink.onKeyframe) {
            this.on('keyframe', (keyframe: Keyframe) => {
                try {
                    const res = sink.onKeyframe?.(keyframe);
                    if (res instanceof Promise) {
                        res.catch((err: unknown) => {
                            console.error(`[WorkerEmulatorClient] Error in keyframe sink "${sink.name}":`, err);
                        });
                    }
                } catch (err) {
                    console.error(`[WorkerEmulatorClient] Sync error in keyframe sink "${sink.name}":`, err);
                }
            });
        }
        if (sink.onTurnComplete) {
            this.on('turnComplete', (turnResult: TurnResult) => {
                try {
                    const res = sink.onTurnComplete?.(turnResult);
                    if (res instanceof Promise) {
                        res.catch((err: unknown) => {
                            console.error(`[WorkerEmulatorClient] Error in turn sink "${sink.name}":`, err);
                        });
                    }
                } catch (err) {
                    console.error(`[WorkerEmulatorClient] Sync error in turn sink "${sink.name}":`, err);
                }
            });
        }
        return this;
    }

    public registerMediaSink(sink: MediaSink): this {
        if (!sink || typeof sink.name !== 'string' || !sink.name.trim()) {
            throw new TypeError('Invalid mediaSink: name string is required.');
        }
        const existing = this.registeredMediaSinks.get(sink.name);
        if (existing) {
            if (existing.sink === sink) {
                return this;
            }
            throw new Error(
                `MediaSink "${sink.name}" is already registered with a different object definition.`
            );
        }

        let videoListener: ((f: VideoPacket) => void) | undefined;
        if (sink.onVideoFrame) {
            videoListener = (frame: VideoPacket) => {
                try {
                    const res = sink.onVideoFrame?.(frame);
                    if (res instanceof Promise) {
                        res.catch((err: unknown) => {
                            console.error(`[WorkerEmulatorClient] Error in media sink "${sink.name}":`, err);
                        });
                    }
                } catch (err) {
                    console.error(`[WorkerEmulatorClient] Sync error in media sink "${sink.name}":`, err);
                }
            };
            this.on('videoFrame', videoListener);
        }

        let audioListener: ((c: AudioChunk) => void) | undefined;
        if (sink.onAudioChunk) {
            audioListener = (chunk: AudioChunk) => {
                try {
                    const res = sink.onAudioChunk?.(chunk);
                    if (res instanceof Promise) {
                        res.catch((err: unknown) => {
                            console.error(`[WorkerEmulatorClient] Error in media sink "${sink.name}":`, err);
                        });
                    }
                } catch (err) {
                    console.error(`[WorkerEmulatorClient] Sync error in media sink "${sink.name}":`, err);
                }
            };
            this.on('audioChunk', audioListener);
        }

        this.registeredMediaSinks.set(sink.name, { sink, videoListener, audioListener });

        if (this.worker && this.isRomLoaded && !this.isClosed && !this.isFatal && !this.isClosing) {
            this.sendRequest({ type: 'registerMediaSink', name: sink.name }).catch((err) => {
                if (!(err instanceof LifecycleError) && !this.isClosed && !this.isClosing) {
                    console.error(`[WorkerEmulatorClient] Failed to register media sink "${sink.name}" with worker:`, err);
                }
            });
        }

        return this;
    }

    /**
     * Unregisters a continuous media sink from this client and notifies the worker.
     */
    public unregisterMediaSink(name: string): this {
        if (typeof name !== 'string' || !name.trim()) {
            throw new TypeError('Invalid mediaSink name string.');
        }
        const entry = this.registeredMediaSinks.get(name);
        if (!entry) {
            return this;
        }

        if (entry.videoListener) {
            this.off('videoFrame', entry.videoListener);
        }
        if (entry.audioListener) {
            this.off('audioChunk', entry.audioListener);
        }
        this.registeredMediaSinks.delete(name);

        if (this.worker && this.isRomLoaded && !this.isClosed && !this.isFatal && !this.isClosing) {
            this.sendRequest({ type: 'unregisterMediaSink', name }).catch((err) => {
                if (!(err instanceof LifecycleError) && !this.isClosed && !this.isClosing) {
                    console.error(`[WorkerEmulatorClient] Failed to unregister media sink "${name}" with worker:`, err);
                }
            });
        }

        return this;
    }

    /**
     * Alias for registerMediaSink to match MgbaEmulator interface.
     */
    public useMediaSink(sink: MediaSink): this {
        return this.registerMediaSink(sink);
    }

    /**
     * Synchronizes all registered media sinks and client event listeners to the worker.
     */
    public async syncMediaSinks(): Promise<void> {
        if (!this.worker || this.isClosed || this.isFatal || this.isClosing) {
            return;
        }
        for (const [name] of this.registeredMediaSinks) {
            await this.sendRequest({ type: 'registerMediaSink', name });
        }
        if (this.listenerCount('videoFrame') > 0 || this.listenerCount('audioChunk') > 0) {
            await this.sendRequest({ type: 'registerMediaSink', name: '__client_event_listener__' });
        }
    }

    public get romInfo(): RomInfo | null {
        return this.currentRomInfo;
    }

    public getRomInfo(): RomInfo | null {
        return this.currentRomInfo;
    }

    /**
     * Loads a ROM inside the worker thread and syncs any pre-registered media sinks.
     */
    public async loadROM(romPath: string): Promise<RomInfo> {
        this.cachedRomPromise = null;
        this.currentRomInfo = null;
        const romInfo = await this.sendRequest<RomInfo>({ type: 'loadROM', romPath });
        this.currentRomInfo = romInfo;
        this.isRomLoaded = true;
        await this.syncMediaSinks();
        return romInfo;
    }

    /**
     * Retrieves the physical ROM buffer with one-time client caching.
     */
    public async getRomBuffer(): Promise<Buffer> {
        if (!this.cachedRomPromise) {
            this.cachedRomPromise = (async () => {
                const romSize = this.currentRomInfo?.romSize ?? 0x100000;
                const raw = await this.sliceMemory('ROM', romSize, 0);
                return Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength);
            })().catch((err) => {
                this.cachedRomPromise = null;
                throw err;
            });
        }
        return this.cachedRomPromise;
    }

    /**
     * Advances emulation by N frames inside the worker thread.
     */
    public async step(
        frames = 1,
        keyMask?: number,
        options: { timeoutMs?: number | undefined; signal?: AbortSignal | undefined } = {},
    ): Promise<VideoPacket> {
        const payload: WorkerRequestPayload = keyMask !== undefined
            ? { type: 'step', frames, keyMask }
            : { type: 'step', frames };
        const raw = await this.sendRequest<WorkerVideoPacketPayload>(payload, options.timeoutMs, options.signal);
        return deserializeVideoPacket(raw);
    }

    /**
     * Executes a batch sequence of input actions inside the worker thread.
     */
    public async stepSequence(
        actions: readonly InputAction[] = [],
        options: StepSequenceOptions = {},
    ): Promise<TurnResult> {
        const validatedActions = actions.map((a, i) => validateInputAction(a, i));
        const validatedOptions = validateStepSequenceOptions(options);
        const payload: WorkerRequestPayload = {
            type: 'stepSequence',
            actions: validatedActions,
            options: validatedOptions,
        };
        const raw = await this.sendRequest<WorkerTurnResultPayload>(
            payload,
            validatedOptions.timeoutMs,
            validatedOptions.signal,
        );
        return deserializeTurnResult(raw);
    }

    /**
     * Clears pending actions and current input keymask in the worker thread.
     */
    public async clearActionQueue(): Promise<void> {
        const err = new LifecycleError('Actions cleared');
        const waiters = Array.from(this.activeSequences.values());
        this.activeSequences.clear();
        for (const active of waiters) {
            try {
                active.cleanup();
                active.reject(err);
            } catch {
                // ignore
            }
        }
        await this.sendRequest<void>({ type: 'clearActionQueue' });
    }

    /**
     * Starts autonomous real-time frame pacing inside the worker thread.
     */
    public async startPlayback(fps?: number): Promise<{ fps: number }> {
        return this.sendRequest<{ fps: number }>({ type: 'startPlayback', fps });
    }

    /**
     * Pauses autonomous real-time frame pacing inside the worker thread.
     */
    public async pausePlayback(): Promise<void> {
        return this.sendRequest<void>({ type: 'pausePlayback' });
    }

    /**
     * Sets the persistent manual button keymask inside the worker thread.
     */
    public async setKeyMask(mask: number): Promise<void> {
        return this.sendRequest<void>({ type: 'setKeyMask', mask });
    }

    /**
     * Gets the active persistent key mask inside the worker thread.
     */
    public async getKeyMask(): Promise<number> {
        return this.sendRequest<number>({ type: 'getKeyMask' });
    }

    /**
     * Returns currently held buttons with their continuous frame counts from the worker thread.
     */
    public async getHeldButtons(): Promise<HeldButtonStatus[]> {
        return this.sendRequest<HeldButtonStatus[]>({ type: 'getHeldButtons' });
    }

    /**
     * Restores persistent held buttons and continuous frame counts inside the worker thread.
     */
    public async restoreHeldButtons(heldButtons: readonly HeldButtonStatus[]): Promise<void> {
        return this.sendRequest<void>({ type: 'restoreHeldButtons', heldButtons });
    }

    /**
     * Enqueues an input action sequence for autonomous execution inside the worker thread actor.
     */
    public enqueueSequence(
        actions: readonly InputAction[],
        options: StepSequenceOptions & { timeoutMs?: number | undefined; signal?: AbortSignal | undefined } = {},
    ): { sequenceId: number; promise: Promise<{ sequenceId: number; actionsExecuted: number }>; cancel(reason?: string | Error): void } {
        const validatedOptions = validateStepSequenceOptions(options);
        const validatedActions = actions.map((a, i) => validateInputAction(a, i));

        if (validatedOptions.signal?.aborted) {
            const sequenceId = this.nextRequestId++;
            return {
                sequenceId,
                promise: Promise.reject(createAbortError(validatedOptions.signal, 'Sequence execution aborted')),
                cancel: () => {},
            };
        }

        const sequenceId = this.nextRequestId++;
        if (validatedActions.length === 0) {
            return {
                sequenceId,
                promise: Promise.resolve({ sequenceId, actionsExecuted: 0 }),
                cancel: () => {},
            };
        }

        let timeoutTimer: ReturnType<typeof setTimeout> | null = null;

        const promise = new Promise<{ sequenceId: number; actionsExecuted: number }>((resolve, reject) => {
            const cleanup = () => {
                if (timeoutTimer) {
                    clearTimeout(timeoutTimer);
                    timeoutTimer = null;
                }
                if (options.signal) {
                    options.signal.removeEventListener('abort', onAbort);
                }
                this.activeSequences.delete(sequenceId);
            };

            const waiter = {
                totalActions: validatedActions.length,
                sessionId: this.currentSessionId,
                generation: this.currentGeneration,
                cleanup,
                resolve: (res: { sequenceId: number; actionsExecuted: number }) => {
                    cleanup();
                    resolve(res);
                },
                reject: (err: Error) => {
                    cleanup();
                    reject(err);
                },
            };

            this.activeSequences.set(sequenceId, waiter);

            const onAbort = () => {
                waiter.reject(createAbortError(options.signal, 'Sequence execution aborted'));
                void this.cancelSequence(sequenceId).catch(() => {});
            };

            if (options.signal) {
                options.signal.addEventListener('abort', onAbort);
            }

            if (options.timeoutMs && options.timeoutMs > 0) {
                timeoutTimer = setTimeout(() => {
                    waiter.reject(new TimeoutError(`Sequence ${sequenceId} timed out after ${options.timeoutMs}ms`));
                    void this.cancelSequence(sequenceId).catch(() => {});
                }, options.timeoutMs);
            }

            this.sendRequest<{ sequenceId: number; queuedActions: number }>({
                type: 'enqueueSequence',
                sequenceId,
                actions: validatedActions,
                options,
            }).catch((err) => {
                waiter.reject(err instanceof Error ? err : new Error(String(err)));
            });
        });

        return {
            sequenceId,
            promise,
            cancel: (reason?: string | Error) => {
                const err = reason instanceof Error
                    ? reason
                    : new LifecycleError(typeof reason === 'string' ? reason : `Sequence ${sequenceId} cancelled`);
                const waiter = this.activeSequences.get(sequenceId);
                if (waiter) {
                    waiter.reject(err);
                }
                void this.cancelSequence(sequenceId).catch(() => {});
            },
        };
    }

    /**
     * Cancels a specific in-flight sequence in the worker thread.
     */
    public async cancelSequence(sequenceId: number): Promise<void> {
        const waiter = this.activeSequences.get(sequenceId);
        if (waiter) {
            this.activeSequences.delete(sequenceId);
            waiter.cleanup();
            waiter.reject(new LifecycleError(`Sequence ${sequenceId} cancelled`));
        }
        return this.sendRequest<void>({
            type: 'cancelSequence',
            sequenceId,
        });
    }

    /**
     * Initializes a direct MessagePort with the worker thread for zero-copy media streaming.
     */
    public async initMediaPort(mediaPort: MessagePort): Promise<void> {
        return this.sendRequest<void>(
            {
                type: 'initMediaPort',
                port: mediaPort,
            },
            undefined,
            undefined,
            [mediaPort],
        );
    }

    public async getFrameCounter(): Promise<number> {
        return this.sendRequest<number>({ type: 'getFrameCounter' });
    }


    public async readBatch(specs: readonly ReadSpec[]): Promise<ReadResultValue[]> {
        const res = await this.sendRequest<ReadResultValue[]>({ type: 'readBatch', specs });
        return res.map((v) => (typeof v === 'number' ? v : Buffer.from(v)));
    }

    public async sliceMemory(addressOrRegion: number | MemoryRegionName | string, length: number, offset?: number): Promise<Buffer> {
        const res = await this.sendRequest<Uint8Array>({ type: 'sliceMemory', addressOrRegion, offset, length });
        return toNodeBuffer(res);
    }

    public async observe(options: {
        screen?: boolean | undefined;
        memory?: MemorySnapshotOptions | undefined;
        reads?: readonly ReadSpec[] | undefined;
        slices?: readonly SliceSpec[] | undefined;
    } = {}): Promise<ObservationSnapshot> {
        const res = await this.sendRequest<WorkerObservationPayload>({
            type: 'observe',
            screen: options.screen,
            memory: options.memory,
            reads: options.reads,
            slices: options.slices,
        });

        const screen = res.screen
            ? {
                buffer: toNodeBuffer(res.screen.buffer),
                width: res.screen.width,
                height: res.screen.height,
            }
            : undefined;
        let memoryReader: MemorySnapshotReader | undefined;

        if (res.memory) {
            if (res.memory.frameIndex !== res.frameIndex) {
                throw new Error(`Observation metadata invariant violation: memory.frameIndex (${res.memory.frameIndex}) !== root frameIndex (${res.frameIndex})`);
            }
            if (res.memory.timestamp !== res.timestamp) {
                throw new Error(`Observation metadata invariant violation: memory.timestamp (${res.memory.timestamp}) !== root timestamp (${res.timestamp})`);
            }
            const rom = await this.getRomBuffer();

            memoryReader = new SnapshotMemoryReader({
                wram: toNodeBuffer(res.memory.wram),
                io: toNodeBuffer(res.memory.io),
                hram: toNodeBuffer(res.memory.hram),
                ie: res.memory.ie,
                vram: res.memory.vram ? toNodeBuffer(res.memory.vram) : undefined,
                oam: res.memory.oam ? toNodeBuffer(res.memory.oam) : undefined,
                sram: res.memory.sram ? toNodeBuffer(res.memory.sram) : undefined,
                rom,
                frameIndex: res.memory.frameIndex,
                timestamp: res.memory.timestamp,
            });
        }

        const data: Record<string, number | Buffer> = {};
        for (const [key, val] of Object.entries(res.data)) {
            data[key] = typeof val === 'number' ? val : toNodeBuffer(val);
        }

        let slices: Record<string, Buffer> | undefined;
        if (res.slices) {
            slices = {};
            for (const [key, sliceVal] of Object.entries(res.slices)) {
                slices[key] = toNodeBuffer(sliceVal);
            }
        }

        return {
            frameIndex: res.frameIndex,
            timestamp: res.timestamp,
            screen,
            memory: memoryReader,
            data,
            slices,
        };
    }

    public async getVram(): Promise<Buffer> {
        const res = await this.sendRequest<Uint8Array>({ type: 'getVram' });
        return toNodeBuffer(res);
    }

    public async getOam(): Promise<Buffer> {
        const res = await this.sendRequest<Uint8Array>({ type: 'getOam' });
        return toNodeBuffer(res);
    }

    public async saveStateHandle(): Promise<StateHandle> {
        return this.sendRequest<StateHandle>({ type: 'saveStateHandle' });
    }

    public async restoreStateHandle(handle: StateHandle | string): Promise<boolean> {
        const handleId = typeof handle === 'string' ? handle : handle.id;
        return this.sendRequest<boolean>({ type: 'restoreStateHandle', handleId });
    }

    public async setWatchPlan(watches: readonly { key: string; address: number; length?: number }[]): Promise<void> {
        return this.sendRequest<void>({ type: 'setWatchPlan', watches });
    }

    /**
     * Saves emulator state atomically to a file from the worker thread.
     */
    public async saveState(filepath: string): Promise<boolean> {
        return this.sendRequest<boolean>({ type: 'saveState', filepath });
    }

    /**
     * Loads emulator state from a file in the worker thread.
     */
    public async loadState(filepath: string): Promise<boolean> {
        return this.sendRequest<boolean>({ type: 'loadState', filepath });
    }

    /**
     * Resets the emulator core inside the worker thread.
     */
    public async reset(): Promise<void> {
        return this.sendRequest<void>({ type: 'reset' });
    }

    /**
     * Directly writes a byte to the hardware CPU bus inside the worker thread.
     */
    public async busWrite8(address: number, value: number): Promise<void> {
        return this.sendRequest<void>({ type: 'busWrite8', address, value });
    }

    /**
     * Writes a byte directly into banked memory space inside the worker thread.
     * spaceId: 1 = WRAM, 2 = VRAM, 3 = SRAM
     */
    public async bankWrite8(spaceId: number, bank: number, offset: number, value: number): Promise<void> {
        return this.sendRequest<void>({ type: 'bankWrite8', spaceId, bank, offset, value });
    }

    /**
     * Lossless frame-by-frame declarative condition wait evaluated inside worker thread.
     */
    public async waitFor(
        condition: { address: number; bank?: number | undefined; value: number; op?: 'eq' | 'neq' | 'gt' | 'lt' | undefined },
        maxFrames?: number,
        signal?: AbortSignal
    ): Promise<{ framesWaited: number }> {
        return this.sendRequest<{ framesWaited: number }>({
            type: 'waitFor',
            condition,
            maxFrames,
        }, undefined, signal);
    }

    /**
     * Diagnostic ping health check.
     */
    public async ping(customTimeoutMs?: number): Promise<string> {
        return this.sendRequest<string>({ type: 'ping' }, customTimeoutMs);
    }

    /**
     * Forcefully and immediately terminates the underlying worker thread.
     */
    public forceTerminateWorker(): void {
        this.cleanupRegisteredMediaSinks();
        const targetWorker = this.worker;
        this.worker = null;
        this.isClosed = true;
        this.isClosing = false;
        this.isFatal = true;

        for (const req of this.pendingRequests.values()) {
            if (req.timeoutTimer) {
                clearTimeout(req.timeoutTimer);
                req.timeoutTimer = null;
            }
            req.reject(new LifecycleError('Worker terminated forcefully.'));
        }
        this.pendingRequests.clear();

        for (const seq of this.activeSequences.values()) {
            try {
                seq.cleanup();
                seq.reject(new LifecycleError('Worker terminated forcefully.'));
            } catch {
                // ignore
            }
        }
        this.activeSequences.clear();

        if (targetWorker) {
            try {
                targetWorker.removeAllListeners();
                targetWorker.on('error', () => {});
                targetWorker.terminate().catch(() => {});
            } catch {
                // Ignore termination error
            }
        }
    }

    /**
     * Closes and terminates the worker emulator client and its worker thread cleanly.
     * Idempotent and safely awaitable across concurrent callers.
     */
    public close(timeoutMs = 1000): Promise<void> {
        if (this.closePromise) return this.closePromise;

        this.isClosing = true;
        this.closePromise = (async () => {
            let closeRequestId: number | null = null;
            let closeTimeoutTimer: ReturnType<typeof setTimeout> | null = null;

            try {
                // Reject all pending application requests immediately with LifecycleError
                for (const req of this.pendingRequests.values()) {
                    if (req.timeoutTimer) {
                        clearTimeout(req.timeoutTimer);
                        req.timeoutTimer = null;
                    }
                    req.reject(new LifecycleError('WorkerEmulatorClient is closed.'));
                }
                this.pendingRequests.clear();

                for (const seq of this.activeSequences.values()) {
                    try {
                        seq.cleanup();
                        seq.reject(new LifecycleError('WorkerEmulatorClient is closed.'));
                    } catch {
                        // ignore
                    }
                }
                this.activeSequences.clear();

                if (this.worker && !this.isClosed && !this.isFatal) {
                    const closePromise = new Promise<void>((resolve, reject) => {
                        closeRequestId = this.nextRequestId++;
                        closeTimeoutTimer = setTimeout(() => {
                            reject(new TimeoutError('Close RPC timed out'));
                        }, timeoutMs);

                        this.pendingRequests.set(closeRequestId, {
                            resolve: () => resolve(),
                            reject: (err: Error) => reject(err),
                            timeoutTimer: closeTimeoutTimer,
                            requestType: 'close',
                        });

                        try {
                            this.worker?.postMessage({
                                id: closeRequestId,
                                type: 'close',
                                sessionId: this.currentSessionId ?? undefined,
                                generation: this.currentGeneration,
                            });
                        } catch (postErr) {
                            reject(postErr);
                        }
                    });

                    await closePromise.catch(() => {});
                }
            } finally {
                if (closeTimeoutTimer) {
                    clearTimeout(closeTimeoutTimer);
                    closeTimeoutTimer = null;
                }
                if (closeRequestId !== null) {
                    this.pendingRequests.delete(closeRequestId);
                }
                for (const req of this.pendingRequests.values()) {
                    if (req.timeoutTimer) {
                        clearTimeout(req.timeoutTimer);
                        req.timeoutTimer = null;
                    }
                }
                this.pendingRequests.clear();
                this.cleanupRegisteredMediaSinks();

                const targetWorker = this.worker;
                this.worker = null;
                this.isClosed = true;
                this.isClosing = false;

                if (targetWorker) {
                    try {
                        targetWorker.removeAllListeners();
                        targetWorker.on('error', () => {});
                        await targetWorker.terminate().catch(() => {});
                    } catch {
                        // Ignore termination error
                    }
                }
            }
        })();

        return this.closePromise;
    }
}
