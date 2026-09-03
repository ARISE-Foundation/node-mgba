import { EventEmitter } from 'node:events';
import type { VideoPacket } from '../types/MediaSink.js';
import {
    GB_FPS,
    GB_FRAME_DURATION_MS,
    GB_AUDIO_SAMPLE_RATE,
    validateInputAction,
    validateStepSequenceOptions,
    type InputAction,
    type ExecuteSequenceOptions,
    type SequenceExecutionResult,
    type SequenceHandle,
    type PressButtonsOptions,
} from '../types/InputAction.js';
import {
    LifecycleError,
    TimeoutError,
} from '../types/errors.js';
import {
    expandButtonsToInputActions,
    compileSequenceActions,
} from './InputActionCompiler.js';
import {
    planNextActionStep,
    type ActiveActionState,
} from './ActionQueueStepPlanner.js';

export {
    GB_FPS,
    GB_FRAME_DURATION_MS,
    GB_AUDIO_SAMPLE_RATE,
    type ExecuteSequenceOptions,
    type SequenceExecutionResult,
    type SequenceHandle,
    type PressButtonsOptions,
};

export interface RealtimeEmulationLoopOptions {
    readonly fps?: number;
    readonly getKeyMask?: () => number;
    readonly onFrame?: (frame: VideoPacket) => void | Promise<void>;
    readonly onError?: (err: Error) => void;
}

export interface SteppableEmulator {
    step(frames?: number, keyMask?: number): Promise<VideoPacket>;
}

export class RealtimeEmulationLoop extends EventEmitter {
    private readonly emulator: SteppableEmulator;
    private readonly options: RealtimeEmulationLoopOptions;
    private targetFps: number;
    private isLoopRunning = false;
    private loopGeneration = 0;
    private nextFrameTargetTime = 0;
    private lastFrameTime = 0;
    private loopTimeout: ReturnType<typeof setTimeout> | null = null;
    private currentTickPromise: Promise<void> | null = null;
    private pausePromise: Promise<void> | null = null;

    private actionQueue: InputAction[] = [];
    private activeAction: ActiveActionState | null = null;
    private unownedPersistentMask = 0;
    private sequencePersistentMasks = new Map<number, number>();
    private manualMask = 0;
    private nextSequenceId = 1;
    private actionQueueVersion = 0;

    private activeSequences = new Map<
        number,
        {
            totalActions: number;
            executedActions: number;
            resolve: (res: SequenceExecutionResult) => void;
            reject: (err: Error) => void;
            cleanup: () => void;
        }
    >();

    private calculatedFps = 60;

    constructor(
        emulator: SteppableEmulator,
        options: RealtimeEmulationLoopOptions = {},
    ) {
        super();
        this.emulator = emulator;
        this.options = options;
        const fps = options.fps ?? GB_FPS;
        this.targetFps = fps > 0 && Number.isFinite(fps) ? fps : GB_FPS;
    }

    public get fps(): number {
        return this.targetFps;
    }

    public set fps(newFps: number) {
        if (newFps > 0 && Number.isFinite(newFps)) {
            this.targetFps = newFps;
        }
    }

    public get currentFps(): number {
        return this.calculatedFps;
    }

    public get isRunning(): boolean {
        return this.isLoopRunning;
    }

    public isEmulationRunning(): boolean {
        return this.isLoopRunning;
    }

    public get queuedActionsCount(): number {
        return this.actionQueue.length + (this.activeAction ? 1 : 0);
    }

    public setKeyMask(mask: number): void {
        this.manualMask = mask;
    }

    public queueAction(action: InputAction): void {
        const validated = validateInputAction(action);
        this.actionQueue.push(validated);
        this.actionQueueVersion++;
    }

    public queueActions(actions: readonly InputAction[]): void {
        const validated = actions.map((a, i) => validateInputAction(a, i));
        this.actionQueue.push(...validated);
        this.actionQueueVersion++;
    }

    public clearActions(): void {
        const hadActions = this.actionQueue.length > 0 || this.activeAction !== null;
        this.actionQueue = [];
        this.activeAction = null;
        this.unownedPersistentMask = 0;
        this.sequencePersistentMasks.clear();
        this.manualMask = 0;
        this.actionQueueVersion++;

        for (const [seqId, waiter] of this.activeSequences.entries()) {
            waiter.cleanup();
            waiter.reject(new LifecycleError(`Sequence ${seqId} cleared`));
        }
        this.activeSequences.clear();

        if (hadActions) {
            this.emit('queueEmpty');
        }
    }

    public clearActionQueue(): void {
        this.clearActions();
    }

    public clearButtons(): void {
        this.clearActions();
    }

    public pressKey(mask: number): void {
        this.manualMask |= mask;
    }

    public releaseKey(mask: number): void {
        this.manualMask &= ~mask;
    }

    public cancelSequence(sequenceId: number): void {
        const waiter = this.activeSequences.get(sequenceId);
        if (waiter) {
            this.activeSequences.delete(sequenceId);
            waiter.cleanup();
            waiter.reject(new LifecycleError(`Sequence ${sequenceId} cancelled`));
        }

        const hadActions = this.actionQueue.length > 0 || this.activeAction !== null;
        this.actionQueue = this.actionQueue.filter(a => a.metadata?.sequenceId !== sequenceId);
        if (this.activeAction?.action.metadata?.sequenceId === sequenceId) {
            this.activeAction = null;
        }
        this.sequencePersistentMasks.delete(sequenceId);
        this.actionQueueVersion++;

        if (hadActions && this.actionQueue.length === 0 && this.activeAction === null) {
            this.emit('queueEmpty');
        }
    }

    public executeSequence(
        actions: readonly InputAction[],
        options: ExecuteSequenceOptions = {},
    ): SequenceHandle {
        const validatedActions = actions.map((a, i) => validateInputAction(a, i));
        const validatedOptions = validateStepSequenceOptions(options);

        if (options.signal?.aborted) {
            const reason = options.signal.reason;
            const abortErr = reason instanceof Error
                ? reason
                : new LifecycleError(typeof reason === 'string' ? reason : 'Sequence aborted prior to execution');
            return {
                sequenceId: this.nextSequenceId++,
                promise: Promise.reject(abortErr),
                cancel: () => {},
            };
        }

        const sequenceId = this.nextSequenceId++;
        if (validatedActions.length === 0) {
            return {
                sequenceId,
                promise: Promise.resolve({ sequenceId, actionsExecuted: 0 }),
                cancel: () => {},
            };
        }

        const { normalizedActions, taggedActions, totalDuration } = compileSequenceActions(
            validatedActions,
            validatedOptions,
            sequenceId,
        );

        if (totalDuration === 0) {
            for (const [idx, act] of normalizedActions.entries()) {
                this.emit('actionComplete', act, idx === normalizedActions.length - 1);
            }
            return {
                sequenceId,
                promise: Promise.resolve({ sequenceId, actionsExecuted: validatedActions.length }),
                cancel: () => {},
            };
        }

        let timeoutTimer: ReturnType<typeof setTimeout> | null = null;

        const promise = new Promise<SequenceExecutionResult>((resolve, reject) => {
            const cleanup = () => {
                if (timeoutTimer) {
                    clearTimeout(timeoutTimer);
                    timeoutTimer = null;
                }
                if (options.signal) {
                    options.signal.removeEventListener('abort', onAbort);
                }
            };

            const onAbort = () => {
                cleanup();
                this.cancelSequence(sequenceId);
                const reason = options.signal?.reason;
                const err = reason instanceof Error
                    ? reason
                    : new LifecycleError(typeof reason === 'string' ? reason : 'Sequence aborted');
                reject(err);
            };

            if (options.signal) {
                options.signal.addEventListener('abort', onAbort, { once: true });
            }

            if (options.timeoutMs && options.timeoutMs > 0) {
                timeoutTimer = setTimeout(() => {
                    cleanup();
                    this.cancelSequence(sequenceId);
                    reject(new TimeoutError(`Sequence ${sequenceId} timed out after ${options.timeoutMs}ms`));
                }, options.timeoutMs);
            }

            this.activeSequences.set(sequenceId, {
                totalActions: validatedActions.length,
                executedActions: 0,
                resolve: (res) => {
                    cleanup();
                    resolve(res);
                },
                reject: (err) => {
                    cleanup();
                    reject(err);
                },
                cleanup,
            });

            this.actionQueue.push(...taggedActions);
            this.actionQueueVersion++;

            if (this.isLoopRunning && this.activeAction === null && this.actionQueue.length === taggedActions.length) {
                this.nextFrameTargetTime = performance.now();
                if (this.loopTimeout) {
                    clearTimeout(this.loopTimeout);
                    this.loopTimeout = null;
                }
                void this.tick(this.loopGeneration);
            }
        });

        return {
            sequenceId,
            promise,
            cancel: (reason?: string | Error) => {
                const err = reason instanceof Error
                    ? reason
                    : new LifecycleError(typeof reason === 'string' ? reason : `Sequence ${sequenceId} cancelled`);
                const waiter = this.activeSequences.get(sequenceId);
                this.cancelSequence(sequenceId);
                if (waiter) {
                    waiter.reject(err);
                }
            },
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

    public start(): void {
        if (this.isLoopRunning) return;
        this.isLoopRunning = true;
        const currentGen = ++this.loopGeneration;
        this.nextFrameTargetTime = performance.now();
        this.lastFrameTime = this.nextFrameTargetTime;

        this.emit('start');
        void this.tick(currentGen);
    }

    public async pause(): Promise<void> {
        if (!this.isLoopRunning && !this.pausePromise) return;
        if (!this.isLoopRunning && this.pausePromise) return this.pausePromise;

        this.isLoopRunning = false;
        const pauseGen = ++this.loopGeneration;

        if (this.loopTimeout) {
            clearTimeout(this.loopTimeout);
            this.loopTimeout = null;
        }

        let currentPause: Promise<void> | null = null;
        currentPause = (async () => {
            if (this.currentTickPromise) {
                try {
                    await this.currentTickPromise;
                } catch {
                    // Handled in tick()
                }
            }
            if (this.pausePromise === currentPause) {
                this.pausePromise = null;
            }
            if (pauseGen === this.loopGeneration && !this.isLoopRunning) {
                this.emit('pause');
            }
        })();

        this.pausePromise = currentPause;
        return this.pausePromise;
    }

    public async stop(): Promise<void> {
        await this.pause();
        this.clearActions();
    }

    public async toggle(): Promise<void> {
        if (this.isLoopRunning) {
            await this.pause();
        } else {
            this.start();
        }
    }

    private async tick(generation: number): Promise<void> {
        if (!this.isLoopRunning || generation !== this.loopGeneration) return;

        const intervalMs = 1000 / this.targetFps;

        if (!this.currentTickPromise) {
            const tickTask = (async () => {
                try {
                    const hadActionsBefore = this.activeAction !== null || this.actionQueue.length > 0;
                    const preview = planNextActionStep({
                        activeAction: this.activeAction,
                        actionQueue: this.actionQueue,
                        unownedPersistentMask: this.unownedPersistentMask,
                        sequencePersistentMasks: this.sequencePersistentMasks,
                        actionQueueVersion: this.actionQueueVersion,
                    });
                    const dynamicManualMask = this.options.getKeyMask ? this.options.getKeyMask() : 0;
                    const effectiveMask = preview.mask | this.manualMask | dynamicManualMask;

                    const frame = await this.emulator.step(1, effectiveMask);

                    if (this.options.onFrame) {
                        try {
                            await this.options.onFrame(frame);
                        } catch (cbErr) {
                            const cbError = cbErr instanceof Error ? cbErr : new Error(String(cbErr));
                            console.error('[RealtimeEmulationLoop] Error in onFrame callback:', cbError);
                        }
                    }

                    const now = performance.now();
                    const delta = now - this.lastFrameTime;
                    this.lastFrameTime = now;
                    this.calculatedFps = delta > 0 ? 1000 / delta : this.targetFps;

                    this.emit('frame', frame);

                    // Commit action state, persistent mask, and queue consumption ONLY if queue version matches
                    if (preview.queueVersion === this.actionQueueVersion) {
                        if (preview.consumedFromQueue > 0) {
                            this.actionQueue.splice(0, preview.consumedFromQueue);
                        }
                        this.activeAction = preview.nextActiveState;
                        this.unownedPersistentMask = preview.nextUnownedMask;
                        this.sequencePersistentMasks = preview.nextSequenceMasks;

                        for (const action of preview.completedActions) {
                            const seqId = action.metadata?.sequenceId;
                            if (seqId !== undefined && !action.metadata?.isPostStabilization) {
                                const active = this.activeSequences.get(seqId);
                                if (active) {
                                    active.executedActions++;
                                }
                            }

                            const isSequenceComplete = action.metadata?.isTerminal ?? (
                                seqId !== undefined
                                    ? !this.actionQueue.some(a => a.metadata?.sequenceId === seqId)
                                      && this.activeAction?.action.metadata?.sequenceId !== seqId
                                    : this.actionQueue.length === 0 && this.activeAction === null
                            );
                            this.emit('actionComplete', action, isSequenceComplete);

                            if (seqId !== undefined && isSequenceComplete) {
                                const active = this.activeSequences.get(seqId);
                                if (active) {
                                    this.activeSequences.delete(seqId);
                                    this.sequencePersistentMasks.delete(seqId);
                                    active.resolve({ sequenceId: seqId, actionsExecuted: active.executedActions });
                                }
                            }
                        }
                        if (hadActionsBefore && this.activeAction === null && this.actionQueue.length === 0) {
                            this.emit('queueEmpty');
                        }
                    }
                } catch (err) {
                    // Only pause loop if error occurred on active generation
                    if (generation !== this.loopGeneration) return;

                    this.isLoopRunning = false;
                    this.loopGeneration++;

                    const error = err instanceof Error ? err : new Error(String(err));

                    // Reject all active sequence promises immediately BEFORE emitting 'error'
                    const waiters = Array.from(this.activeSequences.values());
                    this.activeSequences.clear();
                    for (const active of waiters) {
                        try {
                            active.reject(error);
                        } catch {
                            // ignore
                        }
                    }

                    try {
                        if (this.options.onError) {
                            this.options.onError(error);
                        }
                        if (this.listenerCount('error') > 0) {
                            this.emit('error', error);
                        }
                    } catch (handlerErr) {
                        console.error('[RealtimeEmulationLoop] Error in error handler:', handlerErr);
                    }

                    this.emit('pause');
                    return;
                } finally {
                    this.currentTickPromise = null;
                }
            })();

            this.currentTickPromise = tickTask;
            await tickTask;
        }

        if (this.isLoopRunning && generation === this.loopGeneration) {
            this.nextFrameTargetTime += intervalMs;
            const now = performance.now();
            if (this.nextFrameTargetTime < now - 100) {
                this.nextFrameTargetTime = now;
            }
            const delay = Math.max(0, this.nextFrameTargetTime - now);
            this.loopTimeout = setTimeout(() => {
                void this.tick(generation);
            }, delay);
        }
    }
}

export default RealtimeEmulationLoop;
