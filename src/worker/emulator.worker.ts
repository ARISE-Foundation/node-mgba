import { parentPort, type MessagePort } from 'node:worker_threads';
import { MgbaEmulator } from '../core/MgbaEmulator.js';
import { GB_FPS } from '../core/RealtimeEmulationLoop.js';
import { PcmS16StereoResampler } from '../sinks/ResamplingMediaSink.js';
import {
    validateInputAction,
    validateStepSequenceOptions,
    type InputAction,
} from '../types/InputAction.js';
import {
    compileSequenceActions,
} from '../core/InputActionCompiler.js';
import {
    planNextActionStep,
    type ActiveActionState,
} from '../core/ActionQueueStepPlanner.js';
import {
    isBootstrapRequest,
    type WorkerRequest,
    type WorkerInboundMessage,
    type TelemetryAckMessage,
    type WorkerSerializedError,
    type WorkerErrorCode,
    type MemorySnapshotPayload,
    type WorkerObservationPayload,
    type MemoryChangeEntry,
    type WorkerEvent,
    type SequenceTerminalStatus,
    type WorkerVideoPacketPayload,
    type WorkerAudioChunkPayload,
    type WorkerKeyframePayload,
    type WorkerTurnResultPayload,
} from './protocol.js';
import type { Keyframe, VideoPacket, AudioChunk, TurnResult } from '../types/index.js';
import type { StateHandle } from '../types/StateHandle.js';
import {
    AbortError,
    FatalWorkerError,
    LifecycleError,
    TimeoutError,
} from '../types/errors.js';

if (!parentPort) {
    throw new Error('emulator.worker.ts must be spawned inside a worker thread.');
}

const port = parentPort;
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type WorkerEventPayload = DistributiveOmit<WorkerEvent, 'sessionId' | 'generation'> & {
    sessionId?: string;
    generation?: number;
};

const emulator = new MgbaEmulator();
let currentSessionId = `session_${Date.now()}`;
let currentGeneration = 0;
let activeRequestId: number | null = null;
const cancelledRequestIds = new Set<number>();

// Playback & Action Queue Actor State
let isPlaybackRunning = false;
let playbackFps = GB_FPS;
let playbackTimer: ReturnType<typeof setTimeout> | null = null;
let nextTickTargetTime = 0;
let streamEpoch = 1;
let queueEpoch = 1;

let actionQueue: InputAction[] = [];
let activeAction: ActiveActionState | null = null;
let unownedPersistentMask = 0;
let sequencePersistentMasks: Map<number, number> = new Map();
let manualMask = 0;
let actionQueueVersion = 0;
const activeSequences = new Map<number, { totalActions: number; executedActions: number }>();

let mediaPort: MessagePort | null = null;
const audioResampler = new PcmS16StereoResampler({
    targetSampleRate: 48000,
});

function invalidateAllSequences(status: SequenceTerminalStatus, error?: WorkerSerializedError): void {
    for (const [seqId, seq] of activeSequences.entries()) {
        postWorkerEvent({
            type: 'event',
            event: 'sequenceTerminal',
            sessionId: currentSessionId,
            generation: currentGeneration,
            sequenceId: seqId,
            status,
            actionsExecuted: seq.executedActions,
            error,
        });
    }
    activeSequences.clear();
    actionQueue = [];
    activeAction = null;
    unownedPersistentMask = 0;
    sequencePersistentMasks.clear();
    manualMask = 0;
    actionQueueVersion++;
}

function postStreamReset(): void {
    streamEpoch++;
    emulator.core.clearAudio();
    audioResampler.reset();
    postWorkerEvent({
        type: 'event',
        event: 'streamReset',
        sessionId: currentSessionId,
        generation: currentGeneration,
        streamEpoch,
    });
    if (mediaPort) {
        try {
            mediaPort.postMessage({
                type: 'event',
                event: 'streamReset',
                sessionId: currentSessionId,
                generation: currentGeneration,
                streamEpoch,
            });
        } catch {
            // ignore
        }
    }
}

function postWorkerResponse(id: number, success: boolean, resultOrError: unknown, transferList?: ArrayBuffer[]): void {
    const payload = success
        ? {
            id,
            type: 'response' as const,
            sessionId: currentSessionId,
            generation: currentGeneration,
            success: true as const,
            result: resultOrError,
        }
        : {
            id,
            type: 'response' as const,
            sessionId: currentSessionId,
            generation: currentGeneration,
            success: false as const,
            error: resultOrError as WorkerSerializedError,
        };

    if (transferList && transferList.length > 0) {
        port.postMessage(payload, transferList as unknown as Parameters<typeof port.postMessage>[1]);
    } else {
        port.postMessage(payload);
    }
}

function postWorkerEvent(evt: WorkerEventPayload, transferList?: readonly (ArrayBuffer | MessagePort)[]): void {
    const payload = {
        ...evt,
        sessionId: evt.sessionId ?? currentSessionId,
        generation: evt.generation ?? currentGeneration,
    };
    if (transferList && transferList.length > 0) {
        port.postMessage(payload, transferList as unknown as Parameters<typeof port.postMessage>[1]);
    } else {
        port.postMessage(payload);
    }
}

// Hook keyframe and turn completion event streaming
emulator.registerKeyframeSink({
    name: 'worker-keyframe-broadcaster',
    onKeyframe(keyframe: Keyframe): void {
        const serialized = serializeKeyframe(keyframe);
        postWorkerEvent({
            type: 'event',
            event: 'keyframe',
            sessionId: currentSessionId,
            generation: currentGeneration,
            keyframe: serialized.payload,
        }, serialized.transferList);
    },
    onTurnComplete(turnResult: TurnResult): void {
        const serialized = serializeTurnResult(turnResult);
        postWorkerEvent({
            type: 'event',
            event: 'turnComplete',
            sessionId: currentSessionId,
            generation: currentGeneration,
            turnResult: serialized.payload,
        }, serialized.transferList);
    },
});

// Hook video frame and audio chunk event streaming dynamically
const activeMediaSinks = new Set<string>();
const mediaBroadcaster = {
    name: 'worker-media-broadcaster',
    onVideoFrame(frame: VideoPacket): void {
        if (mediaPort && activeMediaSinks.size > 0) {
            const portFrame: VideoPacket = {
                ...frame,
                buffer: Buffer.from(frame.buffer),
            };
            const portSer = serializeVideoPacket(portFrame);
            postWorkerEvent({
                type: 'event',
                event: 'videoFrame',
                sessionId: currentSessionId,
                generation: currentGeneration,
                streamEpoch,
                frame: portSer.payload,
            }, portSer.transferList);

            const mediaSer = serializeVideoPacket(frame);
            mediaPort.postMessage({
                type: 'event',
                event: 'videoFrame',
                sessionId: currentSessionId,
                generation: currentGeneration,
                streamEpoch,
                frame: mediaSer.payload,
            }, mediaSer.transferList);
        } else if (mediaPort) {
            const mediaSer = serializeVideoPacket(frame);
            mediaPort.postMessage({
                type: 'event',
                event: 'videoFrame',
                sessionId: currentSessionId,
                generation: currentGeneration,
                streamEpoch,
                frame: mediaSer.payload,
            }, mediaSer.transferList);
        } else if (activeMediaSinks.size > 0) {
            const portSer = serializeVideoPacket(frame);
            postWorkerEvent({
                type: 'event',
                event: 'videoFrame',
                sessionId: currentSessionId,
                generation: currentGeneration,
                streamEpoch,
                frame: portSer.payload,
            }, portSer.transferList);
        }
    },
    onAudioChunk(chunk: AudioChunk): void {
        if (mediaPort && activeMediaSinks.size > 0) {
            const resampled = audioResampler.process(chunk);
            const portChunk: AudioChunk = {
                ...chunk,
                buffer: Buffer.from(chunk.buffer),
            };
            const portSer = serializeAudioChunk(portChunk);
            postWorkerEvent({
                type: 'event',
                event: 'audioChunk',
                sessionId: currentSessionId,
                generation: currentGeneration,
                streamEpoch,
                chunk: portSer.payload,
            }, portSer.transferList);

            const mediaSer = serializeAudioChunk(resampled);
            mediaPort.postMessage({
                type: 'event',
                event: 'audioChunk',
                sessionId: currentSessionId,
                generation: currentGeneration,
                streamEpoch,
                chunk: mediaSer.payload,
            }, mediaSer.transferList);
        } else if (mediaPort) {
            const resampled = audioResampler.process(chunk);
            const mediaSer = serializeAudioChunk(resampled);
            mediaPort.postMessage({
                type: 'event',
                event: 'audioChunk',
                sessionId: currentSessionId,
                generation: currentGeneration,
                streamEpoch,
                chunk: mediaSer.payload,
            }, mediaSer.transferList);
        } else if (activeMediaSinks.size > 0) {
            const portSer = serializeAudioChunk(chunk);
            postWorkerEvent({
                type: 'event',
                event: 'audioChunk',
                sessionId: currentSessionId,
                generation: currentGeneration,
                streamEpoch,
                chunk: portSer.payload,
            }, portSer.transferList);
        }
    },
};

// In-Memory StateHandle Pool with byte & count bounded LRU
interface StoredStateSnapshot {
    id: string;
    sessionId: string;
    frameIndex: number;
    byteSize: number;
    createdAt: number;
    buffer: Buffer;
}

class StateHandlePool {
    private snapshots = new Map<string, StoredStateSnapshot>();
    private lruList: string[] = [];
    private totalBytes = 0;
    private readonly maxCount: number;
    private readonly maxBytes: number;

    constructor(maxCount = 50, maxBytes = 100 * 1024 * 1024) {
        this.maxCount = maxCount;
        this.maxBytes = maxBytes;
    }

    public put(sessionId: string, frameIndex: number, buffer: Buffer): StateHandle {
        const id = `state_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const byteSize = buffer.length;

        if (byteSize > this.maxBytes) {
            throw new Error(`State snapshot (${byteSize} bytes) exceeds maximum pool budget of ${this.maxBytes} bytes`);
        }

        while (
            this.snapshots.size >= this.maxCount ||
            (this.totalBytes + byteSize > this.maxBytes && this.lruList.length > 0)
        ) {
            const oldestId = this.lruList.shift();
            if (oldestId) {
                const old = this.snapshots.get(oldestId);
                if (old) {
                    this.totalBytes -= old.byteSize;
                    this.snapshots.delete(oldestId);
                }
            }
        }

        const snapshot: StoredStateSnapshot = {
            id,
            sessionId,
            frameIndex,
            byteSize,
            createdAt: Date.now(),
            buffer,
        };

        this.snapshots.set(id, snapshot);
        this.lruList.push(id);
        this.totalBytes += byteSize;

        return {
            id,
            sessionId,
            frameIndex,
            byteSize,
            createdAt: snapshot.createdAt,
        };
    }

    public get(id: string, activeSessionId: string): StoredStateSnapshot {
        const snap = this.snapshots.get(id);
        if (!snap) {
            throw new Error(`StateHandle "${id}" not found or was evicted from in-memory pool`);
        }
        if (snap.sessionId !== activeSessionId) {
            throw new Error(`StateHandle "${id}" belongs to session ${snap.sessionId}, but current session is ${activeSessionId}`);
        }
        const idx = this.lruList.indexOf(id);
        if (idx !== -1) {
            this.lruList.splice(idx, 1);
            this.lruList.push(id);
        }
        return snap;
    }

    public clear(): void {
        this.snapshots.clear();
        this.lruList = [];
        this.totalBytes = 0;
    }
}

const statePool = new StateHandlePool();

// Watch plan manager for frame-boundary change detection
interface CompiledWatch {
    key: string;
    address: number;
    length: number;
    lastValue: Buffer | number;
}

const MAX_WATCH_COUNT = 512;
const MAX_WATCH_TOTAL_BYTES = 64 * 1024;
const MAX_COALESCED_EVENTS = 256;

class WatchPlanManager {
    private watches: CompiledWatch[] = [];

    public setWatches(watches: readonly { key: string; address: number; length?: number | undefined }[]): void {
        if (watches.length > MAX_WATCH_COUNT) {
            throw new Error(`Watch count ${watches.length} exceeds limit of ${MAX_WATCH_COUNT}`);
        }
        let totalBytes = 0;
        for (const w of watches) {
            const len = w.length ?? 1;
            if (len <= 0 || len > 1024) {
                throw new Error(`Watch length ${len} for key "${w.key}" is out of bounds (1..1024)`);
            }
            totalBytes += len;
        }
        if (totalBytes > MAX_WATCH_TOTAL_BYTES) {
            throw new Error(`Total watch byte size ${totalBytes} exceeds limit of ${MAX_WATCH_TOTAL_BYTES}`);
        }

        this.watches = watches.map(w => {
            const len = w.length ?? 1;
            let initialVal: Buffer | number;
            if (emulator.isRunning()) {
                initialVal = len === 1
                    ? emulator.core.busRead8(w.address)
                    : emulator.core.busReadRange(w.address, len);
            } else {
                initialVal = len === 1 ? 0 : Buffer.alloc(len);
            }
            return {
                key: w.key,
                address: w.address,
                length: len,
                lastValue: initialVal,
            };
        });
    }

    public rebaseline(): void {
        for (const w of this.watches) {
            if (emulator.isRunning()) {
                w.lastValue = (w.length === 1)
                    ? emulator.core.busRead8(w.address)
                    : emulator.core.busReadRange(w.address, w.length);
            }
        }
    }

    public clear(): void {
        this.watches = [];
    }

    public sample(frameIndex: number): { frameIndex: number; changes: MemoryChangeEntry[] } | null {
        if (this.watches.length === 0 || !emulator.isRunning()) return null;
        const changes: MemoryChangeEntry[] = [];

        for (const w of this.watches) {
            if (w.length === 1) {
                const current = emulator.core.busRead8(w.address);
                if (current !== w.lastValue) {
                    changes.push({
                        key: w.key,
                        prev: w.lastValue as number,
                        next: current,
                    });
                    w.lastValue = current;
                }
            } else {
                const currentBuf = emulator.core.busReadRange(w.address, w.length);
                const prevBuf = w.lastValue as Buffer;
                if (!currentBuf.equals(prevBuf)) {
                    changes.push({
                        key: w.key,
                        prev: Buffer.from(prevBuf),
                        next: Buffer.from(currentBuf),
                    });
                    w.lastValue = currentBuf;
                }
            }
        }

        if (changes.length === 0) return null;
        return {
            frameIndex,
            changes,
        };
    }
}

interface MutableMemoryChangeEntry {
    key: string;
    prev: number | Uint8Array;
    next: number | Uint8Array;
}

class CoalescedTelemetryBuffer {
    private coalescedChanges = new Map<string, MutableMemoryChangeEntry>();
    private latestFrameIndex = 0;
    public droppedEvents = 0;
    private nextTelemetryId = 1;
    private inFlightTelemetryId: number | null = null;
    private ackTimeout: ReturnType<typeof setTimeout> | null = null;

    public recordChange(change: { frameIndex: number; changes: readonly MemoryChangeEntry[] }): void {
        this.latestFrameIndex = change.frameIndex;
        for (const entry of change.changes) {
            const existing = this.coalescedChanges.get(entry.key);
            if (existing) {
                // Retain initial prev value from start of window, update to latest next
                existing.next = entry.next;
                this.droppedEvents++;
            } else if (this.coalescedChanges.size < MAX_COALESCED_EVENTS) {
                this.coalescedChanges.set(entry.key, {
                    key: entry.key,
                    prev: entry.prev,
                    next: entry.next,
                });
            } else {
                this.droppedEvents++;
            }
        }
    }

    public onAck(ack: TelemetryAckMessage): void {
        if (
            this.inFlightTelemetryId !== null &&
            this.inFlightTelemetryId === ack.telemetryId &&
            ack.sessionId === currentSessionId &&
            ack.generation === currentGeneration
        ) {
            if (this.ackTimeout) {
                clearTimeout(this.ackTimeout);
                this.ackTimeout = null;
            }
            this.inFlightTelemetryId = null;
            if (this.coalescedChanges.size > 0 || this.droppedEvents > 0) {
                this.flush();
            }
        }
    }

    public flush(): void {
        if (this.inFlightTelemetryId !== null) {
            return;
        }
        if (this.coalescedChanges.size === 0 && this.droppedEvents === 0) {
            return;
        }
        const changes = Array.from(this.coalescedChanges.values());
        const dropped = this.droppedEvents;
        this.coalescedChanges.clear();
        this.droppedEvents = 0;

        const telId = this.nextTelemetryId++;
        this.inFlightTelemetryId = telId;

        if (this.ackTimeout) {
            clearTimeout(this.ackTimeout);
            this.ackTimeout = null;
        }
        this.ackTimeout = setTimeout(() => {
            this.inFlightTelemetryId = null;
            this.ackTimeout = null;
            this.flush();
        }, 500);

        postWorkerEvent({
            type: 'event',
            event: 'memoryChange',
            sessionId: currentSessionId,
            generation: currentGeneration,
            telemetryId: telId,
            frameIndex: this.latestFrameIndex || emulator.core.getFrameCounter(),
            changes,
            ...(dropped > 0 ? { droppedEvents: dropped } : {}),
        });
    }

    public clear(): void {
        if (this.ackTimeout) {
            clearTimeout(this.ackTimeout);
            this.ackTimeout = null;
        }
        this.coalescedChanges.clear();
        this.droppedEvents = 0;
        this.latestFrameIndex = 0;
        this.inFlightTelemetryId = null;
    }
}

const watchManager = new WatchPlanManager();
const telemetryBuffer = new CoalescedTelemetryBuffer();

// Register watch manager as an internal plugin to sample every frame losslessly
emulator.registerPlugin({
    name: '__watch_detector__',
    match: () => true,
    onFrame: (frameData: import('../types/EmulatorPlugin.js').FrameEventData) => {
        const change = watchManager.sample(frameData.frameIndex);
        if (change) {
            telemetryBuffer.recordChange(change);
        }
    },
});

function extractTransferableArrayBuffer(buf: Uint8Array): ArrayBuffer | null {
    if (!buf || !buf.buffer) return null;
    const ab = buf.buffer;
    if (ab instanceof ArrayBuffer) {
        if ((ab as { detached?: boolean }).detached || ab.byteLength === 0) {
            return null;
        }
        if (buf.byteOffset === 0 && buf.byteLength === ab.byteLength) {
            return ab;
        }
    }
    return null;
}

function serializeVideoPacket(packet: VideoPacket): { payload: WorkerVideoPacketPayload; transferList: ArrayBuffer[] } {
    const transferList: ArrayBuffer[] = [];
    const buf = extractTransferableArrayBuffer(packet.buffer);
    if (buf) {
        transferList.push(buf);
    }
    return {
        payload: {
            frameIndex: packet.frameIndex,
            pts: packet.pts,
            width: packet.width,
            height: packet.height,
            strideBytes: packet.strideBytes,
            buffer: packet.buffer,
        },
        transferList,
    };
}

function serializeAudioChunk(chunk: AudioChunk): { payload: WorkerAudioChunkPayload; transferList: ArrayBuffer[] } {
    const transferList: ArrayBuffer[] = [];
    const buf = extractTransferableArrayBuffer(chunk.buffer);
    if (buf) {
        transferList.push(buf);
    }
    return {
        payload: {
            frameIndex: chunk.frameIndex,
            pts: chunk.pts,
            sampleRate: chunk.sampleRate,
            channels: chunk.channels,
            sampleFrames: chunk.sampleFrames,
            buffer: chunk.buffer,
        },
        transferList,
    };
}

function serializeKeyframe(kf: Keyframe): { payload: WorkerKeyframePayload; transferList: ArrayBuffer[] } {
    return {
        payload: {
            frameIndex: kf.frameIndex,
            timestampMs: kf.timestampMs,
            hash: kf.hash,
            width: kf.width,
            height: kf.height,
            triggerReason: kf.triggerReason,
            buffer: kf.buffer,
        },
        transferList: [],
    };
}

function serializeTurnResult(result: TurnResult): { payload: WorkerTurnResultPayload; transferList: ArrayBuffer[] } {
    return {
        payload: {
            keyframes: result.keyframes.map((kf) => serializeKeyframe(kf).payload),
            durationFrames: result.durationFrames,
            executionTimeMs: result.executionTimeMs,
        },
        transferList: [],
    };
}

function serializeObservationPayload(obs: WorkerObservationPayload): { payload: WorkerObservationPayload; transferList: ArrayBuffer[] } {
    const transferList: ArrayBuffer[] = [];
    if (obs.screenBuffer) {
        const buf = extractTransferableArrayBuffer(obs.screenBuffer);
        if (buf) transferList.push(buf);
    }
    if (obs.slices) {
        for (const slice of Object.values(obs.slices)) {
            const buf = extractTransferableArrayBuffer(slice);
            if (buf) transferList.push(buf);
        }
    }
    if (obs.data) {
        for (const val of Object.values(obs.data)) {
            if (val instanceof Uint8Array) {
                const buf = extractTransferableArrayBuffer(val);
                if (buf) transferList.push(buf);
            }
        }
    }
    if (obs.memory) {
        const wram = extractTransferableArrayBuffer(obs.memory.wram);
        if (wram) transferList.push(wram);
        const io = extractTransferableArrayBuffer(obs.memory.io);
        if (io) transferList.push(io);
        const hram = extractTransferableArrayBuffer(obs.memory.hram);
        if (hram) transferList.push(hram);
        if (obs.memory.vram) {
            const vram = extractTransferableArrayBuffer(obs.memory.vram);
            if (vram) transferList.push(vram);
        }
        if (obs.memory.oam) {
            const oam = extractTransferableArrayBuffer(obs.memory.oam);
            if (oam) transferList.push(oam);
        }
        if (obs.memory.sram) {
            const sram = extractTransferableArrayBuffer(obs.memory.sram);
            if (sram) transferList.push(sram);
        }
    }
    return { payload: obs, transferList };
}

function serializeMemoryBuffer(buffer: Uint8Array): { payload: Uint8Array; transferList: ArrayBuffer[] } {
    const transferList: ArrayBuffer[] = [];
    const buf = extractTransferableArrayBuffer(buffer);
    if (buf) transferList.push(buf);
    return { payload: buffer, transferList };
}

function serializeError(err: unknown): WorkerSerializedError {
    const error = (err instanceof Error ? err : new Error(String(err))) as Error & { code?: string };
    let code: WorkerErrorCode = 'ERR_UNKNOWN';
    if (error instanceof FatalWorkerError || error.name === 'FatalWorkerError') {
        code = 'ERR_FATAL_WORKER';
    } else if (error instanceof LifecycleError || error.name === 'LifecycleError') {
        code = 'ERR_LIFECYCLE';
    } else if (error instanceof AbortError || error.name === 'AbortError') {
        code = 'ERR_ABORT';
    } else if (error instanceof TimeoutError || error.name === 'TimeoutError') {
        code = 'ERR_TIMEOUT';
    }
    return {
        code,
        name: error.name || 'Error',
        message: error.message || 'Unknown worker error',
        stack: error.stack,
    };
}
async function executeFrameTransaction(): Promise<void> {
    const hadActionsBefore = activeAction !== null || actionQueue.length > 0;
    const preview = planNextActionStep({
        activeAction,
        actionQueue,
        unownedPersistentMask,
        sequencePersistentMasks,
        actionQueueVersion,
    });
    const effectiveMask = preview.mask | manualMask;

    await emulator.step(1, effectiveMask);

    if (preview.queueVersion === actionQueueVersion) {
        if (preview.consumedFromQueue > 0) {
            actionQueue.splice(0, preview.consumedFromQueue);
        }
        activeAction = preview.nextActiveState;
        unownedPersistentMask = preview.nextUnownedMask;
        sequencePersistentMasks = preview.nextSequenceMasks;

        for (const action of preview.completedActions) {
            const seqId = action.metadata?.sequenceId;
            if (seqId !== undefined && !action.metadata?.isPostStabilization) {
                const seq = activeSequences.get(seqId);
                if (seq) {
                    seq.executedActions++;
                }
            }

            const isSequenceComplete = action.metadata?.isTerminal ?? (
                seqId !== undefined
                    ? !actionQueue.some(a => a.metadata?.sequenceId === seqId)
                      && activeAction?.action.metadata?.sequenceId !== seqId
                    : actionQueue.length === 0 && activeAction === null
            );

            if (seqId !== undefined && isSequenceComplete) {
                const seq = activeSequences.get(seqId);
                if (!seq) {
                    throw new Error(`Invariant violation: Sequence ${seqId} completed but was not found in activeSequences`);
                }
                activeSequences.delete(seqId);
                sequencePersistentMasks.delete(seqId);
                postWorkerEvent({
                    type: 'event',
                    event: 'sequenceTerminal',
                    sessionId: currentSessionId,
                    generation: currentGeneration,
                    sequenceId: seqId,
                    status: 'completed',
                    actionsExecuted: seq.executedActions,
                });
            }
        }

        if (hadActionsBefore && activeAction === null && actionQueue.length === 0) {
            postWorkerEvent({
                type: 'event',
                event: 'queueEmpty',
                sessionId: currentSessionId,
                generation: currentGeneration,
                queueEpoch: ++queueEpoch,
            });
        }
    }
}

async function processRequest(req: WorkerRequest): Promise<void> {
    try {
        switch (req.type) {
            case 'loadROM': {
                isPlaybackRunning = false;
                if (playbackTimer !== null) {
                    clearTimeout(playbackTimer);
                    playbackTimer = null;
                }
                invalidateAllSequences('invalidatedByStateRestore');
                currentSessionId = `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
                currentGeneration++;
                statePool.clear();
                telemetryBuffer.clear();
                const romInfo = await emulator.loadROM(req.romPath);
                watchManager.rebaseline();
                postStreamReset();
                postWorkerResponse(req.id, true, romInfo);
                break;
            }
            case 'startPlayback': {
                if (req.fps && req.fps > 0 && Number.isFinite(req.fps)) {
                    playbackFps = req.fps;
                }
                isPlaybackRunning = true;
                nextTickTargetTime = performance.now();
                postWorkerResponse(req.id, true, { fps: playbackFps });
                break;
            }
            case 'pausePlayback': {
                isPlaybackRunning = false;
                if (playbackTimer !== null) {
                    clearTimeout(playbackTimer);
                    playbackTimer = null;
                }
                postWorkerResponse(req.id, true, undefined);
                break;
            }
            case 'enqueueSequence': {
                const seqId = req.sequenceId;
                const options = validateStepSequenceOptions(req.options === undefined ? {} : req.options);
                const validatedActions = req.actions.map((act, idx) => validateInputAction(act, idx));
                if (validatedActions.length === 0) {
                    postWorkerResponse(req.id, true, { sequenceId: seqId, actionsExecuted: 0 });
                    postWorkerEvent({
                        type: 'event',
                        event: 'sequenceTerminal',
                        sessionId: currentSessionId,
                        generation: currentGeneration,
                        sequenceId: seqId,
                        status: 'completed',
                        actionsExecuted: 0,
                    });
                    break;
                }

                const { taggedActions, totalDuration } = compileSequenceActions(
                    validatedActions,
                    options,
                    seqId,
                );

                if (totalDuration === 0) {
                    postWorkerResponse(req.id, true, { sequenceId: seqId, actionsExecuted: validatedActions.length });
                    postWorkerEvent({
                        type: 'event',
                        event: 'sequenceTerminal',
                        sessionId: currentSessionId,
                        generation: currentGeneration,
                        sequenceId: seqId,
                        status: 'completed',
                        actionsExecuted: validatedActions.length,
                    });
                    break;
                }

                activeSequences.set(seqId, { totalActions: validatedActions.length, executedActions: 0 });
                actionQueue.push(...taggedActions);
                actionQueueVersion++;
                postWorkerResponse(req.id, true, { sequenceId: seqId, queuedActions: validatedActions.length });
                break;
            }
            case 'cancelSequence': {
                const seqId = req.sequenceId;
                const hadActions = actionQueue.length > 0 || activeAction !== null;
                actionQueue = actionQueue.filter(a => a.metadata?.sequenceId !== seqId);
                if (activeAction?.action.metadata?.sequenceId === seqId) {
                    activeAction = null;
                }
                sequencePersistentMasks.delete(seqId);
                actionQueueVersion++;
                if (activeSequences.has(seqId)) {
                    const seq = activeSequences.get(seqId);
                    if (!seq) {
                        throw new Error(`Invariant violation: Sequence ${seqId} cancelled but was not found in activeSequences`);
                    }
                    activeSequences.delete(seqId);
                    postWorkerEvent({
                        type: 'event',
                        event: 'sequenceTerminal',
                        sessionId: currentSessionId,
                        generation: currentGeneration,
                        sequenceId: seqId,
                        status: 'cancelled',
                        actionsExecuted: seq.executedActions,
                    });
                }
                if (hadActions && actionQueue.length === 0 && activeAction === null) {
                    postWorkerEvent({
                        type: 'event',
                        event: 'queueEmpty',
                        sessionId: currentSessionId,
                        generation: currentGeneration,
                        queueEpoch: ++queueEpoch,
                    });
                }
                postWorkerResponse(req.id, true, undefined);
                break;
            }
            case 'clearActionQueue': {
                invalidateAllSequences('cleared');
                postWorkerEvent({
                    type: 'event',
                    event: 'queueEmpty',
                    sessionId: currentSessionId,
                    generation: currentGeneration,
                    queueEpoch: ++queueEpoch,
                });
                postWorkerResponse(req.id, true, undefined);
                break;
            }
            case 'initMediaPort': {
                if (mediaPort && mediaPort !== req.port) {
                    try {
                        mediaPort.close();
                    } catch {
                        // ignore
                    }
                }
                mediaPort = req.port;
                if (mediaPort) {
                    if (activeMediaSinks.size === 0) {
                        emulator.registerMediaSink(mediaBroadcaster);
                    }
                } else if (activeMediaSinks.size === 0) {
                    emulator.unregisterMediaSink(mediaBroadcaster.name);
                }
                postWorkerResponse(req.id, true, undefined);
                break;
            }
            case 'step': {
                const totalFrames = req.frames ?? 1;
                if (isPlaybackRunning && totalFrames > 1) {
                    throw new LifecycleError('Cannot execute multi-frame manual step() while autonomous playback is active. Pause playback before stepping multiple frames.');
                }
                const packet = await emulator.step(totalFrames, req.keyMask);
                if (isPlaybackRunning) {
                    nextTickTargetTime = performance.now() + (1000 / playbackFps);
                }
                const serialized = serializeVideoPacket(packet);
                postWorkerResponse(req.id, true, serialized.payload, serialized.transferList);
                break;
            }
            case 'stepSequence': {
                const validatedOptions = validateStepSequenceOptions(req.options === undefined ? {} : req.options);
                const turnResult = await emulator.stepSequence(req.actions, validatedOptions);
                const serialized = serializeTurnResult(turnResult);
                postWorkerResponse(req.id, true, serialized.payload, serialized.transferList);
                break;
            }
            case 'readBatch': {
                const results = emulator.core.readBatch([...req.specs]);
                postWorkerResponse(req.id, true, results);
                break;
            }
            case 'sliceMemory': {
                let result: Buffer;
                if (typeof req.addressOrRegion === 'string') {
                    const str = req.addressOrRegion.trim();
                    const hexMatch = str.match(/^(?:0x|\$)?([0-9a-fA-F]+)$/);
                    try {
                        result = emulator.core.readRegion(str, req.offset ?? 0, req.length);
                    } catch (err) {
                        if (hexMatch && hexMatch[1] && (str.startsWith('0x') || str.startsWith('$') || /^[0-9a-fA-F]+$/i.test(str))) {
                            const parsedAddr = parseInt(hexMatch[1], 16);
                            result = emulator.core.busReadRange(parsedAddr, req.length);
                        } else {
                            throw err;
                        }
                    }
                } else {
                    result = emulator.core.busReadRange(req.addressOrRegion, req.length);
                }
                const serialized = serializeMemoryBuffer(result);
                postWorkerResponse(req.id, true, serialized.payload, serialized.transferList);
                break;
            }
            case 'observe': {
                const frameIndex = emulator.core.getFrameCounter();
                const timestamp = Date.now();
                let screenBuffer: Uint8Array | undefined;
                let width: number | undefined;
                let height: number | undefined;

                if (req.screen) {
                    const vid = emulator.core.getVideoFrame();
                    screenBuffer = vid.buffer;
                    width = vid.width;
                    height = vid.height;
                }

                let memorySnapshot: MemorySnapshotPayload | undefined;
                if (req.memory) {
                    const platform = emulator.core.getRomInfo()?.platform;
                    if (platform === 'GBA') {
                        throw new Error('Memory snapshot reader currently supports Game Boy (DMG/CGB/SGB) models. GBA memory snapshots are not yet supported.');
                    }
                    const wram = emulator.core.getWramBuffer();
                    const io = emulator.core.getIoBuffer();
                    const hram = emulator.core.getHramBuffer();
                    const [ieVal] = emulator.core.readBatch([{ address: 0xFFFF, type: 'u8' }]);
                    const ie = typeof ieVal === 'number' ? ieVal : undefined;
                    const vram = req.memory.vram ? emulator.core.getVramBuffer() : undefined;
                    const oam = req.memory.oam ? emulator.core.getOamBuffer() : undefined;
                    const sram = req.memory.sram ? emulator.core.getSramBuffer() : undefined;

                    memorySnapshot = {
                        frameIndex,
                        timestamp,
                        wram,
                        io,
                        hram,
                        ie,
                        vram,
                        oam,
                        sram,
                    };
                }

                const data: Record<string, number | Uint8Array> = {};
                const readsList = req.reads;
                if (readsList && readsList.length > 0) {
                    const results = emulator.core.readBatch([...readsList]);
                    for (let i = 0; i < readsList.length; i++) {
                        const currentSpec = readsList[i];
                        if (!currentSpec) continue;
                        const key = currentSpec.key ?? `read_${i}`;
                        const resVal = results[i];
                        if (resVal !== undefined) {
                            data[key] = resVal;
                        }
                    }
                }

                let slices: Record<string, Buffer> | undefined;
                const slicesList = req.slices;
                if (slicesList && slicesList.length > 0) {
                    slices = {};
                    for (let i = 0; i < slicesList.length; i++) {
                        const spec = slicesList[i];
                        if (!spec) continue;
                        const key = spec.key ?? `slice_${i}`;
                        let sliceBuf: Buffer;
                        if (typeof spec.regionOrAddress === 'string') {
                            const length = spec.length ?? 0x2000;
                            sliceBuf = emulator.core.readRegion(spec.regionOrAddress, spec.offset ?? 0, length);
                        } else {
                            const length = spec.length ?? 1;
                            sliceBuf = emulator.core.busReadRange(spec.regionOrAddress, length);
                        }
                        slices[key] = sliceBuf;
                    }
                }

                const snapshot: WorkerObservationPayload = {
                    frameIndex,
                    timestamp,
                    screenBuffer,
                    width,
                    height,
                    memory: memorySnapshot,
                    data,
                    slices,
                };
                const serialized = serializeObservationPayload(snapshot);
                postWorkerResponse(req.id, true, serialized.payload, serialized.transferList);
                break;
            }
            case 'getVram': {
                const vram = emulator.core.getVramBuffer();
                const serialized = serializeMemoryBuffer(vram);
                postWorkerResponse(req.id, true, serialized.payload, serialized.transferList);
                break;
            }
            case 'getOam': {
                const oam = emulator.core.getOamBuffer();
                const serialized = serializeMemoryBuffer(oam);
                postWorkerResponse(req.id, true, serialized.payload, serialized.transferList);
                break;
            }
            case 'saveStateHandle': {
                const stateBuf = emulator.core.saveStateBuffer();
                const frameIndex = emulator.core.getFrameCounter();
                const handle = statePool.put(currentSessionId, frameIndex, stateBuf);
                postWorkerResponse(req.id, true, handle);
                break;
            }
            case 'restoreStateHandle': {
                invalidateAllSequences('invalidatedByStateRestore');
                const snap = statePool.get(req.handleId, currentSessionId);
                const ok = emulator.core.loadStateBuffer(snap.buffer);
                if (ok) {
                    postWorkerEvent({
                        type: 'event',
                        event: 'stateRestore',
                        sessionId: currentSessionId,
                        generation: currentGeneration,
                        frameIndex: snap.frameIndex,
                        handleId: req.handleId,
                    });
                    postStreamReset();
                }
                postWorkerResponse(req.id, true, ok);
                break;
            }
            case 'busWrite8': {
                emulator.core.busWrite8(req.address, req.value);
                postWorkerResponse(req.id, true, undefined);
                break;
            }
            case 'bankWrite8': {
                const ok = emulator.core.bankWrite8(req.spaceId, req.bank, req.offset, req.value);
                if (!ok) {
                    throw new Error(`Failed to write to banked space ${req.spaceId}, bank ${req.bank} at offset 0x${req.offset.toString(16)}`);
                }
                postWorkerResponse(req.id, true, undefined);
                break;
            }
            case 'setWatchPlan': {
                watchManager.setWatches(req.watches);
                postWorkerResponse(req.id, true, undefined);
                break;
            }
            case 'waitFor': {
                const { condition, maxFrames = 600 } = req;
                const op = condition.op ?? 'eq';
                const addr = condition.address;
                const targetVal = condition.value;
                let elapsed = 0;
                let matched = false;

                const readCurrentValue = (): number => {
                    if (condition.bank !== undefined) {
                        const [val] = emulator.core.readBatch([{ address: addr, bank: condition.bank, type: 'u8' }]);
                        return typeof val === 'number' ? val : 0;
                    }
                    return emulator.core.busRead8(addr);
                };

                const checkMatches = (val: number): boolean => {
                    if (op === 'eq') return val === targetVal;
                    if (op === 'neq') return val !== targetVal;
                    if (op === 'gt') return val > targetVal;
                    if (op === 'lt') return val < targetVal;
                    return false;
                };

                if (checkMatches(readCurrentValue())) {
                    matched = true;
                } else {
                    while (elapsed < maxFrames) {
                        if (cancelledRequestIds.has(req.id)) {
                            cancelledRequestIds.delete(req.id);
                            return;
                        }

                        await emulator.step(1);
                        elapsed++;
                        if (checkMatches(readCurrentValue())) {
                            matched = true;
                            break;
                        }

                        if (elapsed % 8 === 0) {
                            await new Promise<void>((resolve) => setImmediate(resolve));
                            if (cancelledRequestIds.has(req.id)) {
                                cancelledRequestIds.delete(req.id);
                                return;
                            }
                        }
                    }
                }

                if (cancelledRequestIds.has(req.id)) {
                    cancelledRequestIds.delete(req.id);
                    return;
                }

                if (!matched) {
                    throw new TimeoutError(`waitFor condition timed out after ${maxFrames} frames (target=0x${addr.toString(16)}, value=${targetVal})`);
                }
                postWorkerResponse(req.id, true, { framesWaited: elapsed });
                break;
            }
            case 'registerMediaSink': {
                if (activeMediaSinks.size === 0 && !mediaPort) {
                    emulator.registerMediaSink(mediaBroadcaster);
                }
                activeMediaSinks.add(req.name);
                postWorkerResponse(req.id, true, undefined);
                break;
            }
            case 'unregisterMediaSink': {
                activeMediaSinks.delete(req.name);
                if (activeMediaSinks.size === 0 && !mediaPort) {
                    emulator.unregisterMediaSink(mediaBroadcaster.name);
                }
                postWorkerResponse(req.id, true, undefined);
                break;
            }

            case 'getFrameCounter': {
                const counter = emulator.getFrameCounter();
                postWorkerResponse(req.id, true, counter);
                break;
            }
            case 'saveState': {
                const ok = await emulator.saveState(req.filepath);
                postWorkerResponse(req.id, true, ok);
                break;
            }
            case 'loadState': {
                invalidateAllSequences('invalidatedByStateRestore');
                const ok = await emulator.loadState(req.filepath);
                if (ok) {
                    postStreamReset();
                }
                postWorkerResponse(req.id, true, ok);
                break;
            }
            case 'reset': {
                invalidateAllSequences('invalidatedByStateRestore');
                emulator.reset();
                postStreamReset();
                postWorkerResponse(req.id, true, undefined);
                break;
            }
            case 'close': {
                isPlaybackRunning = false;
                if (playbackTimer !== null) {
                    clearTimeout(playbackTimer);
                    playbackTimer = null;
                }
                invalidateAllSequences('cancelled');
                await emulator.close();
                statePool.clear();
                watchManager.clear();
                telemetryBuffer.clear();
                postWorkerResponse(req.id, true, undefined);
                if (mediaPort) {
                    try {
                        mediaPort.close();
                    } catch {
                        // ignore
                    }
                    mediaPort = null;
                }
                port.close();
                break;
            }
            case 'ping': {
                postWorkerResponse(req.id, true, 'pong');
                break;
            }
            default: {
                const unknownReq = req as { id: number; type: string };
                postWorkerResponse(
                    unknownReq.id,
                    false,
                    serializeError(new Error(`Unsupported worker request type: ${unknownReq.type}`))
                );
                break;
            }
        }
    } finally {
        telemetryBuffer.flush();
    }
}

interface QueuedRequestItem {
    req: WorkerRequest;
    resolve: () => void;
    reject: (err: unknown) => void;
}

const pendingRequestQueue: QueuedRequestItem[] = [];
let isActorBusy = false;

function scheduleActorWork(): void {
    if (isActorBusy) return;
    isActorBusy = true;
    runActorLoop().catch((err: unknown) => {
        isPlaybackRunning = false;
        if (playbackTimer !== null) {
            clearTimeout(playbackTimer);
            playbackTimer = null;
        }
        postWorkerEvent({
            type: 'event',
            event: 'fatalError',
            sessionId: currentSessionId,
            generation: currentGeneration,
            error: serializeError(err),
        });
    });
}

async function runActorLoop(): Promise<void> {
    try {
        while (true) {
            // 1. Process pending control or RPC requests first to prevent starvation
            if (pendingRequestQueue.length > 0) {
                const item = pendingRequestQueue.shift();
                if (item) {
                    const { req, resolve, reject } = item;

                    if (cancelledRequestIds.has(req.id)) {
                        cancelledRequestIds.delete(req.id);
                        postWorkerResponse(req.id, false, serializeError(new AbortError(`Request ${req.id} was aborted before execution.`)));
                        resolve();
                    } else {
                        activeRequestId = req.id;
                        try {
                            await processRequest(req);
                            resolve();
                        } catch (err: unknown) {
                            postWorkerResponse(req.id, false, serializeError(err));
                            reject(err);
                        } finally {
                            activeRequestId = null;
                            cancelledRequestIds.delete(req.id);
                        }
                    }
                    continue;
                }
            }

            // 2. Check if a frame step is due if playback is running
            if (isPlaybackRunning && emulator.isRunning()) {
                const now = performance.now();
                if (now >= nextTickTargetTime) {
                    try {
                        await executeFrameTransaction();
                    } catch (frameErr: unknown) {
                        isPlaybackRunning = false;
                        if (playbackTimer !== null) {
                            clearTimeout(playbackTimer);
                            playbackTimer = null;
                        }
                        invalidateAllSequences('failed', serializeError(frameErr));
                        postWorkerEvent({
                            type: 'event',
                            event: 'fatalError',
                            sessionId: currentSessionId,
                            generation: currentGeneration,
                            error: serializeError(frameErr),
                        });
                        break;
                    }
                    const frameIntervalMs = 1000 / playbackFps;
                    nextTickTargetTime += frameIntervalMs;
                    if (now - nextTickTargetTime > 3 * frameIntervalMs) {
                        nextTickTargetTime = now + frameIntervalMs;
                    }

                    // Yield to event loop so port.on('message') can receive incoming IPC requests
                    await new Promise((resolve) => setImmediate(resolve));
                    continue;
                }
            }

            // 3. No pending requests and no frame immediately due
            break;
        }
    } finally {
        isActorBusy = false;
        if (isPlaybackRunning && emulator.isRunning() && playbackTimer === null) {
            const now = performance.now();
            const delayMs = Math.max(0, Math.round(nextTickTargetTime - now));
            playbackTimer = setTimeout(() => {
                playbackTimer = null;
                scheduleActorWork();
            }, delayMs);
        }
    }
}

port.on('message', (msg: WorkerInboundMessage) => {
    if (msg.type === 'telemetryAck') {
        telemetryBuffer.onAck(msg);
        return;
    }

    const req = msg;
    if (!isBootstrapRequest(req)) {
        if (!req.sessionId || req.sessionId !== currentSessionId) {
            postWorkerResponse(
                req.id,
                false,
                serializeError(new LifecycleError(`Request session mismatch: got "${req.sessionId ?? 'undefined'}", expected "${currentSessionId}"`))
            );
            return;
        }
        if (req.generation === undefined || req.generation !== currentGeneration) {
            postWorkerResponse(
                req.id,
                false,
                serializeError(new LifecycleError(`Request generation mismatch: got ${req.generation}, expected ${currentGeneration}`))
            );
            return;
        }
    }

    if (req.type === 'cancelRequest') {
        cancelledRequestIds.add(req.targetId);
        if (activeRequestId === req.targetId) {
            emulator.clearActionQueue();
        }
        if (req.id !== undefined) {
            postWorkerResponse(req.id, true, undefined);
        }
        return;
    }

    new Promise<void>((resolve, reject) => {
        pendingRequestQueue.push({ req, resolve, reject });
        scheduleActorWork();
    }).catch(() => {
        // Error handled via postWorkerResponse
    });
});
