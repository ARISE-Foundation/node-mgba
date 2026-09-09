import type { HeldButtonStatus, InputAction, StepSequenceOptions } from '../types/InputAction.js';
import type { MemorySnapshotOptions, ReadSpec, MemoryRegionName } from '../types/index.js';
import type { MemorySnapshotReader } from '../core/MemoryReader.js';

export interface BootstrapWorkerRequestBase {
    readonly id: number;
    readonly sessionId?: string | undefined;
    readonly generation?: number | undefined;
}

export interface StatefulWorkerRequestBase {
    readonly id: number;
    readonly sessionId: string;
    readonly generation: number;
}

export type WorkerRequestBase = BootstrapWorkerRequestBase | StatefulWorkerRequestBase;

export interface WorkerVideoPacketPayload {
    readonly frameIndex: number;
    readonly pts: number;
    readonly width: number;
    readonly height: number;
    readonly strideBytes: number;
    readonly buffer: Uint8Array;
    readonly keys: number;
}

export interface WorkerAudioChunkPayload {
    readonly frameIndex: number;
    readonly pts: number;
    readonly sampleRate: number;
    readonly channels: 2;
    readonly sampleFrames: number;
    readonly buffer: Uint8Array;
}

export interface WorkerKeyframePayload {
    readonly frameIndex: number;
    readonly timestampMs: number;
    readonly buffer: Uint8Array;
    readonly hash: string;
    readonly width: number;
    readonly height: number;
    readonly triggerReason: string;
}

export interface WorkerTurnResultPayload {
    readonly keyframes: readonly WorkerKeyframePayload[];
    readonly durationFrames: number;
    readonly executionTimeMs: number;
}

export interface PingRequest extends BootstrapWorkerRequestBase {
    readonly type: 'ping';
}

export interface LoadROMRequest extends BootstrapWorkerRequestBase {
    readonly type: 'loadROM';
    readonly romPath: string;
}

export interface StepRequest extends StatefulWorkerRequestBase {
    readonly type: 'step';
    readonly frames: number;
    readonly keyMask?: number;
}

export interface StepSequenceRequest extends StatefulWorkerRequestBase {
    readonly type: 'stepSequence';
    readonly actions: readonly InputAction[];
    readonly options: StepSequenceOptions;
}

export interface GetFrameCounterRequest extends StatefulWorkerRequestBase {
    readonly type: 'getFrameCounter';
}

export interface SaveStateRequest extends StatefulWorkerRequestBase {
    readonly type: 'saveState';
    readonly filepath: string;
}

export interface LoadStateRequest extends StatefulWorkerRequestBase {
    readonly type: 'loadState';
    readonly filepath: string;
}

export interface SaveStateHandleRequest extends StatefulWorkerRequestBase {
    readonly type: 'saveStateHandle';
}

export interface RestoreStateHandleRequest extends StatefulWorkerRequestBase {
    readonly type: 'restoreStateHandle';
    readonly handleId: string;
}

export interface ResetRequest extends StatefulWorkerRequestBase {
    readonly type: 'reset';
}

export interface ClearActionQueueRequest extends StatefulWorkerRequestBase {
    readonly type: 'clearActionQueue';
}

export interface CancelRequest extends StatefulWorkerRequestBase {
    readonly type: 'cancelRequest';
    readonly targetId: number;
}

export interface CaptureObservationRequest extends StatefulWorkerRequestBase {
    readonly type: 'captureObservation';
    readonly pluginName?: string;
}

export interface ReadBatchRequest extends StatefulWorkerRequestBase {
    readonly type: 'readBatch';
    readonly specs: readonly ReadSpec[];
}

export interface SliceMemoryRequest extends StatefulWorkerRequestBase {
    readonly type: 'sliceMemory';
    readonly addressOrRegion: number | MemoryRegionName | string;
    readonly offset?: number;
    readonly length: number;
}

export interface SliceSpec {
    readonly regionOrAddress: number | MemoryRegionName;
    readonly offset?: number | undefined;
    readonly length?: number | undefined;
    readonly key?: string | undefined;
}

export interface ObserveRequest extends StatefulWorkerRequestBase {
    readonly type: 'observe';
    readonly screen?: boolean | undefined;
    readonly memory?: MemorySnapshotOptions | undefined;
    readonly reads?: readonly ReadSpec[] | undefined;
    readonly slices?: readonly SliceSpec[] | undefined;
}

export interface GetVramRequest extends StatefulWorkerRequestBase {
    readonly type: 'getVram';
}

export interface GetOamRequest extends StatefulWorkerRequestBase {
    readonly type: 'getOam';
}

export interface RegisterMediaSinkRequest extends BootstrapWorkerRequestBase {
    readonly type: 'registerMediaSink';
    readonly name: string;
}

export interface UnregisterMediaSinkRequest extends BootstrapWorkerRequestBase {
    readonly type: 'unregisterMediaSink';
    readonly name: string;
}

export interface BusWrite8Request extends StatefulWorkerRequestBase {
    readonly type: 'busWrite8';
    readonly address: number;
    readonly value: number;
}

export interface BankWrite8Request extends StatefulWorkerRequestBase {
    readonly type: 'bankWrite8';
    readonly spaceId: number;
    readonly bank: number;
    readonly offset: number;
    readonly value: number;
}

export interface SetWatchPlanRequest extends StatefulWorkerRequestBase {
    readonly type: 'setWatchPlan';
    readonly watches: readonly { key: string; address: number; length?: number | undefined }[];
}

export interface StartPlaybackRequest extends StatefulWorkerRequestBase {
    readonly type: 'startPlayback';
    readonly fps?: number | undefined;
}

export interface PausePlaybackRequest extends StatefulWorkerRequestBase {
    readonly type: 'pausePlayback';
}

export interface SetKeyMaskRequest extends StatefulWorkerRequestBase {
    readonly type: 'setKeyMask';
    readonly mask: number;
}

export interface GetKeyMaskRequest extends StatefulWorkerRequestBase {
    readonly type: 'getKeyMask';
}

export interface GetHeldButtonsRequest extends StatefulWorkerRequestBase {
    readonly type: 'getHeldButtons';
}

export interface RestoreHeldButtonsRequest extends StatefulWorkerRequestBase {
    readonly type: 'restoreHeldButtons';
    readonly heldButtons: readonly HeldButtonStatus[];
}

export interface EnqueueSequenceRequest extends StatefulWorkerRequestBase {
    readonly type: 'enqueueSequence';
    readonly sequenceId: number;
    readonly actions: readonly InputAction[];
    readonly options?: StepSequenceOptions | undefined;
}

export interface CancelSequenceRequest extends StatefulWorkerRequestBase {
    readonly type: 'cancelSequence';
    readonly sequenceId: number;
}

export interface InitMediaPortRequest extends BootstrapWorkerRequestBase {
    readonly type: 'initMediaPort';
    readonly port: import('node:worker_threads').MessagePort;
}

export interface CloseRequest extends BootstrapWorkerRequestBase {
    readonly type: 'close';
}

export interface MemorySnapshotPayload {
    readonly frameIndex: number;
    readonly timestamp: number;
    readonly wram: Uint8Array;
    readonly io: Uint8Array;
    readonly hram: Uint8Array;
    readonly ie?: number | undefined;
    readonly vram?: Uint8Array | undefined;
    readonly oam?: Uint8Array | undefined;
    readonly sram?: Uint8Array | undefined;
}

export interface WorkerObservationPayload {
    readonly frameIndex: number;
    readonly timestamp: number;
    readonly screenBuffer?: Uint8Array | undefined;
    readonly width?: number | undefined;
    readonly height?: number | undefined;
    readonly memory?: MemorySnapshotPayload | undefined;
    readonly data: Record<string, number | Uint8Array>;
    readonly slices?: Record<string, Uint8Array> | undefined;
}

export interface ObservationSnapshot {
    readonly frameIndex: number;
    readonly timestamp: number;
    readonly screenBuffer?: Buffer | undefined;
    readonly width?: number | undefined;
    readonly height?: number | undefined;
    readonly memory?: MemorySnapshotReader | undefined;
    readonly data: Record<string, number | Buffer>;
    readonly slices?: Record<string, Buffer> | undefined;
}

export interface WaitForRequest extends StatefulWorkerRequestBase {
    readonly type: 'waitFor';
    readonly condition: {
        readonly address: number;
        readonly bank?: number | undefined;
        readonly value: number;
        readonly op?: 'eq' | 'neq' | 'gt' | 'lt' | undefined;
    };
    readonly maxFrames?: number | undefined;
}

export type WorkerRequest =
    | PingRequest
    | LoadROMRequest
    | StepRequest
    | StepSequenceRequest
    | StartPlaybackRequest
    | PausePlaybackRequest
    | SetKeyMaskRequest
    | GetKeyMaskRequest
    | GetHeldButtonsRequest
    | RestoreHeldButtonsRequest
    | EnqueueSequenceRequest
    | CancelSequenceRequest
    | InitMediaPortRequest
    | GetFrameCounterRequest
    | SaveStateRequest
    | LoadStateRequest
    | SaveStateHandleRequest
    | RestoreStateHandleRequest
    | ResetRequest
    | ClearActionQueueRequest
    | CancelRequest
    | ReadBatchRequest
    | SliceMemoryRequest
    | ObserveRequest
    | GetVramRequest
    | GetOamRequest
    | BusWrite8Request
    | BankWrite8Request
    | RegisterMediaSinkRequest
    | UnregisterMediaSinkRequest
    | SetWatchPlanRequest
    | WaitForRequest
    | CloseRequest;

export type BootstrapWorkerRequest =
    | PingRequest
    | LoadROMRequest
    | InitMediaPortRequest
    | RegisterMediaSinkRequest
    | UnregisterMediaSinkRequest
    | CloseRequest;

export type StatefulWorkerRequest = Exclude<WorkerRequest, BootstrapWorkerRequest>;

export const BOOTSTRAP_REQUEST_TYPES: ReadonlySet<BootstrapWorkerRequest['type']> = new Set([
    'ping',
    'loadROM',
    'close',
    'initMediaPort',
    'registerMediaSink',
    'unregisterMediaSink',
]);

/**
 * Returns true if the request is a bootstrap request that does not require
 * an active emulation session or generation check.
 */
export function isBootstrapRequest(req: WorkerRequest): req is BootstrapWorkerRequest {
    return BOOTSTRAP_REQUEST_TYPES.has(req.type as BootstrapWorkerRequest['type']);
}

export type WorkerRequestPayload =
    | { readonly type: 'ping' }
    | { readonly type: 'loadROM'; readonly romPath: string }
    | { readonly type: 'step'; readonly frames: number; readonly keyMask?: number | undefined }
    | { readonly type: 'stepSequence'; readonly actions: readonly InputAction[]; readonly options: StepSequenceOptions }
    | { readonly type: 'startPlayback'; readonly fps?: number | undefined }
    | { readonly type: 'pausePlayback' }
    | { readonly type: 'setKeyMask'; readonly mask: number }
    | { readonly type: 'getKeyMask' }
    | { readonly type: 'getHeldButtons' }
    | { readonly type: 'restoreHeldButtons'; readonly heldButtons: readonly HeldButtonStatus[] }
    | { readonly type: 'enqueueSequence'; readonly sequenceId: number; readonly actions: readonly InputAction[]; readonly options?: StepSequenceOptions | undefined }
    | { readonly type: 'cancelSequence'; readonly sequenceId: number }
    | { readonly type: 'initMediaPort'; readonly port: import('node:worker_threads').MessagePort }
    | { readonly type: 'getFrameCounter' }
    | { readonly type: 'saveState'; readonly filepath: string }
    | { readonly type: 'loadState'; readonly filepath: string }
    | { readonly type: 'saveStateHandle' }
    | { readonly type: 'restoreStateHandle'; readonly handleId: string }
    | { readonly type: 'reset' }
    | { readonly type: 'clearActionQueue' }
    | { readonly type: 'cancelRequest'; readonly targetId: number }
    | { readonly type: 'readBatch'; readonly specs: readonly ReadSpec[] }
    | { readonly type: 'sliceMemory'; readonly addressOrRegion: number | MemoryRegionName | string; readonly offset?: number | undefined; readonly length: number }
    | { readonly type: 'observe'; readonly screen?: boolean | undefined; readonly memory?: MemorySnapshotOptions | undefined; readonly reads?: readonly ReadSpec[] | undefined; readonly slices?: readonly SliceSpec[] | undefined }
    | { readonly type: 'getVram' }
    | { readonly type: 'getOam' }
    | { readonly type: 'busWrite8'; readonly address: number; readonly value: number }
    | { readonly type: 'bankWrite8'; readonly spaceId: number; readonly bank: number; readonly offset: number; readonly value: number }
    | { readonly type: 'registerMediaSink'; readonly name: string }
    | { readonly type: 'unregisterMediaSink'; readonly name: string }
    | { readonly type: 'setWatchPlan'; readonly watches: readonly { key: string; address: number; length?: number | undefined }[] }
    | { readonly type: 'waitFor'; readonly condition: { readonly address: number; readonly bank?: number | undefined; readonly value: number; readonly op?: 'eq' | 'neq' | 'gt' | 'lt' | undefined }; readonly maxFrames?: number | undefined }
    | { readonly type: 'close' };

export type WorkerErrorCode =
    | 'ERR_FATAL_WORKER'
    | 'ERR_LIFECYCLE'
    | 'ERR_ABORT'
    | 'ERR_TIMEOUT'
    | 'ERR_UNKNOWN';

export interface WorkerSerializedError {
    readonly code: WorkerErrorCode;
    readonly name: string;
    readonly message: string;
    readonly stack?: string | undefined;
}

export interface WorkerSuccessResponse {
    readonly id: number;
    readonly type: 'response';
    readonly sessionId: string;
    readonly generation: number;
    readonly success: true;
    readonly result: unknown;
}

export interface WorkerErrorResponse {
    readonly id: number;
    readonly type: 'response';
    readonly sessionId: string;
    readonly generation: number;
    readonly success: false;
    readonly error: WorkerSerializedError;
}

export type WorkerResponse = WorkerSuccessResponse | WorkerErrorResponse;

export interface WorkerKeyframeEvent {
    readonly type: 'event';
    readonly event: 'keyframe';
    readonly sessionId: string;
    readonly generation: number;
    readonly keyframe: WorkerKeyframePayload;
}

export interface WorkerVideoFrameEvent {
    readonly type: 'event';
    readonly event: 'videoFrame';
    readonly sessionId: string;
    readonly generation: number;
    readonly streamEpoch: number;
    readonly frame: WorkerVideoPacketPayload;
}

export interface WorkerAudioChunkEvent {
    readonly type: 'event';
    readonly event: 'audioChunk';
    readonly sessionId: string;
    readonly generation: number;
    readonly streamEpoch: number;
    readonly chunk: WorkerAudioChunkPayload;
}

export interface WorkerTurnCompleteEvent {
    readonly type: 'event';
    readonly event: 'turnComplete';
    readonly sessionId: string;
    readonly generation: number;
    readonly turnResult: WorkerTurnResultPayload;
}

export interface MemoryChangeEntry {
    readonly key: string;
    readonly prev: number | Uint8Array;
    readonly next: number | Uint8Array;
}

export interface WorkerMemoryChangeEvent {
    readonly type: 'event';
    readonly event: 'memoryChange';
    readonly sessionId: string;
    readonly generation: number;
    readonly telemetryId: number;
    readonly frameIndex: number;
    readonly changes: readonly MemoryChangeEntry[];
    readonly droppedEvents?: number | undefined;
}

export interface WorkerStateRestoreEvent {
    readonly type: 'event';
    readonly event: 'stateRestore';
    readonly sessionId: string;
    readonly generation: number;
    readonly frameIndex: number;
    readonly handleId: string;
}

export type SequenceTerminalStatus =
    | 'completed'
    | 'cancelled'
    | 'cleared'
    | 'invalidatedByStateRestore'
    | 'failed';

export interface WorkerSequenceTerminalEvent {
    readonly type: 'event';
    readonly event: 'sequenceTerminal';
    readonly sessionId: string;
    readonly generation: number;
    readonly sequenceId: number;
    readonly status: SequenceTerminalStatus;
    readonly actionsExecuted: number;
    readonly error?: WorkerSerializedError | undefined;
}

export interface WorkerQueueEmptyEvent {
    readonly type: 'event';
    readonly event: 'queueEmpty';
    readonly sessionId: string;
    readonly generation: number;
    readonly queueEpoch: number;
}

export interface WorkerStreamResetEvent {
    readonly type: 'event';
    readonly event: 'streamReset';
    readonly sessionId: string;
    readonly generation: number;
    readonly streamEpoch: number;
}

export interface WorkerFatalErrorEvent {
    readonly type: 'event';
    readonly event: 'fatalError';
    readonly sessionId: string;
    readonly generation: number;
    readonly error: WorkerSerializedError;
}

export type WorkerEvent =
    | WorkerKeyframeEvent
    | WorkerVideoFrameEvent
    | WorkerAudioChunkEvent
    | WorkerTurnCompleteEvent
    | WorkerMemoryChangeEvent
    | WorkerStateRestoreEvent
    | WorkerSequenceTerminalEvent
    | WorkerQueueEmptyEvent
    | WorkerStreamResetEvent
    | WorkerFatalErrorEvent;

export interface TelemetryAckMessage {
    readonly type: 'telemetryAck';
    readonly telemetryId: number;
    readonly sessionId: string;
    readonly generation: number;
}

export type WorkerInboundMessage = WorkerRequest | TelemetryAckMessage;
export type WorkerOutboundMessage = WorkerResponse | WorkerEvent;

export interface WorkerEmulatorClientOptions {
    readonly watchdogTimeoutMs?: number | undefined;
    readonly workerPath?: string | URL | undefined;
}
