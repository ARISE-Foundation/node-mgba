import {
    type InputAction,
    DEFAULT_HOLD_FRAMES,
    DEFAULT_RELEASE_FRAMES,
} from '../types/InputAction.js';
import { resolveButtonMask } from './InputActionCompiler.js';

export interface ActiveActionState {
    readonly action: InputAction;
    readonly phase: 'hold' | 'release';
    readonly remainingFrames: number;
    readonly buttonMask: number;
}

export interface ActionStepState {
    readonly activeAction: ActiveActionState | null;
    readonly actionQueue: readonly InputAction[];
    readonly unownedPersistentMask: number;
    readonly sequencePersistentMasks: ReadonlyMap<number, number>;
    readonly actionQueueVersion: number;
}

export interface ActionStepResult {
    readonly mask: number;
    readonly nextActiveState: ActiveActionState | null;
    readonly completedActions: readonly InputAction[];
    readonly consumedFromQueue: number;
    readonly nextUnownedMask: number;
    readonly nextSequenceMasks: Map<number, number>;
    readonly queueVersion: number;
}

/**
 * Pure action queue step planner shared between local loop and worker actor.
 * Plans the next frame step, transitions action phases, updates persistent button masks,
 * and drains consecutive zero-duration actions.
 */
export function planNextActionStep(state: ActionStepState): ActionStepResult {
    let active: ActiveActionState | null = state.activeAction ? { ...state.activeAction } : null;
    let consumedFromQueue = 0;
    let nextUnownedMask = state.unownedPersistentMask;
    const nextSequenceMasks = new Map(state.sequencePersistentMasks);
    const completedActions: InputAction[] = [];

    while (!active && consumedFromQueue < state.actionQueue.length) {
        const next = state.actionQueue[consumedFromQueue];
        consumedFromQueue++;
        if (!next) continue;

        const seqId = next.metadata?.sequenceId;

        switch (next.type) {
            case 'press': {
                const mask = resolveButtonMask(next.button);
                const hold = next.holdFrames ?? DEFAULT_HOLD_FRAMES;
                const release = next.releaseFrames ?? DEFAULT_RELEASE_FRAMES;
                if (hold > 0) {
                    active = {
                        action: next,
                        phase: 'hold',
                        remainingFrames: hold,
                        buttonMask: mask,
                    };
                } else if (release > 0) {
                    active = {
                        action: next,
                        phase: 'release',
                        remainingFrames: release,
                        buttonMask: mask,
                    };
                } else {
                    completedActions.push(next);
                }
                break;
            }
            case 'hold': {
                const mask = resolveButtonMask(next.button);
                const frames = next.frames;
                if (seqId !== undefined) {
                    const prev = nextSequenceMasks.get(seqId) ?? 0;
                    nextSequenceMasks.set(seqId, prev | mask);
                } else {
                    nextUnownedMask |= mask;
                }
                if (frames > 0) {
                    active = {
                        action: next,
                        phase: 'hold',
                        remainingFrames: frames,
                        buttonMask: mask,
                    };
                } else {
                    completedActions.push(next);
                }
                break;
            }
            case 'wait': {
                const frames = next.frames;
                if (frames > 0) {
                    active = {
                        action: next,
                        phase: 'release',
                        remainingFrames: frames,
                        buttonMask: 0,
                    };
                } else {
                    completedActions.push(next);
                }
                break;
            }
            case 'release': {
                if (next.button !== undefined) {
                    const mask = resolveButtonMask(next.button);
                    for (const [sId, sMask] of nextSequenceMasks.entries()) {
                        const updated = sMask & ~mask;
                        if (updated === 0) {
                            nextSequenceMasks.delete(sId);
                        } else {
                            nextSequenceMasks.set(sId, updated);
                        }
                    }
                    nextUnownedMask &= ~mask;
                } else {
                    nextSequenceMasks.clear();
                    nextUnownedMask = 0;
                }
                active = {
                    action: next,
                    phase: 'release',
                    remainingFrames: 1,
                    buttonMask: 0,
                };
                break;
            }
        }
    }

    let runningPersistentMask = nextUnownedMask;
    for (const sm of nextSequenceMasks.values()) {
        runningPersistentMask |= sm;
    }

    if (!active) {
        return {
            mask: runningPersistentMask,
            nextActiveState: null,
            completedActions,
            consumedFromQueue,
            nextUnownedMask,
            nextSequenceMasks,
            queueVersion: state.actionQueueVersion,
        };
    }

    const mask = active.phase === 'hold'
        ? (runningPersistentMask | active.buttonMask)
        : runningPersistentMask;

    const remaining = active.remainingFrames - 1;
    let nextActiveState: ActiveActionState | null;

    if (remaining <= 0) {
        if (active.action.type === 'press' && active.phase === 'hold') {
            const releaseFrames = active.action.releaseFrames ?? DEFAULT_RELEASE_FRAMES;
            if (releaseFrames > 0) {
                nextActiveState = {
                    action: active.action,
                    phase: 'release',
                    remainingFrames: releaseFrames,
                    buttonMask: active.buttonMask,
                };
            } else {
                completedActions.push(active.action);
                nextActiveState = null;
            }
        } else {
            completedActions.push(active.action);
            nextActiveState = null;
        }

        while (!nextActiveState && consumedFromQueue < state.actionQueue.length) {
            const next = state.actionQueue[consumedFromQueue];
            if (!next) {
                consumedFromQueue++;
                continue;
            }

            const seqId = next.metadata?.sequenceId;

            switch (next.type) {
                case 'press': {
                    const btnMask = resolveButtonMask(next.button);
                    const hold = next.holdFrames ?? DEFAULT_HOLD_FRAMES;
                    const release = next.releaseFrames ?? DEFAULT_RELEASE_FRAMES;
                    if (hold > 0) {
                        nextActiveState = { action: next, phase: 'hold', remainingFrames: hold, buttonMask: btnMask };
                    } else if (release > 0) {
                        nextActiveState = { action: next, phase: 'release', remainingFrames: release, buttonMask: btnMask };
                    } else {
                        completedActions.push(next);
                    }
                    consumedFromQueue++;
                    break;
                }
                case 'hold': {
                    const btnMask = resolveButtonMask(next.button);
                    if (seqId !== undefined) {
                        const prev = nextSequenceMasks.get(seqId) ?? 0;
                        nextSequenceMasks.set(seqId, prev | btnMask);
                    } else {
                        nextUnownedMask |= btnMask;
                    }
                    if (next.frames > 0) {
                        nextActiveState = { action: next, phase: 'hold', remainingFrames: next.frames, buttonMask: btnMask };
                    } else {
                        completedActions.push(next);
                    }
                    consumedFromQueue++;
                    break;
                }
                case 'wait': {
                    if (next.frames > 0) {
                        nextActiveState = { action: next, phase: 'release', remainingFrames: next.frames, buttonMask: 0 };
                    } else {
                        completedActions.push(next);
                    }
                    consumedFromQueue++;
                    break;
                }
                case 'release': {
                    if (next.button !== undefined) {
                        const btnMask = resolveButtonMask(next.button);
                        for (const [sId, sMask] of nextSequenceMasks.entries()) {
                            const updated = sMask & ~btnMask;
                            if (updated === 0) nextSequenceMasks.delete(sId);
                            else nextSequenceMasks.set(sId, updated);
                        }
                        nextUnownedMask &= ~btnMask;
                    } else {
                        nextSequenceMasks.clear();
                        nextUnownedMask = 0;
                    }
                    nextActiveState = { action: next, phase: 'release', remainingFrames: 1, buttonMask: 0 };
                    consumedFromQueue++;
                    break;
                }
            }
        }
    } else {
        nextActiveState = {
            ...active,
            remainingFrames: remaining,
        };
    }

    return {
        mask,
        nextActiveState,
        completedActions,
        consumedFromQueue,
        nextUnownedMask,
        nextSequenceMasks,
        queueVersion: state.actionQueueVersion,
    };
}
