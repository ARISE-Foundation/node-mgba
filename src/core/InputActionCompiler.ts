import {
    type ButtonName,
    type InputAction,
    type ExecuteSequenceOptions,
    type PressButtonsOptions,
    BUTTON_BITMASKS,
    ALL_VALID_BUTTON_BITS,
    normalizeButtonName,
    DEFAULT_HOLD_FRAMES,
    DEFAULT_RELEASE_FRAMES,
    DEFAULT_POST_STABILIZATION_FRAMES,
    press,
    wait,
} from '../types/InputAction.js';

export { BUTTON_BITMASKS, ALL_VALID_BUTTON_BITS };

/**
 * Resolves a ButtonName, case-insensitive string, or raw numeric mask to a canonical 32-bit unsigned button bitmask.
 */
export function resolveButtonMask(button: ButtonName | number | string): number {
    if (typeof button === 'number') {
        if (!Number.isInteger(button) || !Number.isFinite(button) || button < 0 || (button & ~ALL_VALID_BUTTON_BITS) !== 0) {
            throw new Error(`Invalid numeric button mask: ${button}`);
        }
        return button;
    }
    const canonical = normalizeButtonName(String(button));
    const mask = BUTTON_BITMASKS[canonical];
    if (mask === undefined) {
        throw new Error(`Unknown canonical button: "${String(button)}"`);
    }
    return mask;
}

/**
 * Expands a list of button strings (including 'WAIT') into structured InputAction objects.
 */
export function expandButtonsToInputActions(
    buttons: readonly string[],
    options: PressButtonsOptions = {},
): InputAction[] {
    const hold = options.holdFrames ?? DEFAULT_HOLD_FRAMES;
    const release = options.releaseFrames ?? DEFAULT_RELEASE_FRAMES;
    const waitFrames = options.waitFrames ?? 0;

    const actions: InputAction[] = [];
    for (const rawBtn of buttons) {
        if (typeof rawBtn !== 'string') {
            throw new Error(`Invalid button input: expected string, received ${typeof rawBtn}`);
        }
        const trimmed = rawBtn.trim();
        if (trimmed.toUpperCase() === 'WAIT') {
            actions.push(wait(hold));
        } else {
            const canonical = normalizeButtonName(trimmed);
            actions.push(press(canonical, hold, release));
        }
    }
    if (waitFrames > 0) {
        actions.push(wait(waitFrames));
    }
    return actions;
}

export interface CompiledSequence {
    readonly normalizedActions: readonly InputAction[];
    readonly taggedActions: readonly InputAction[];
    readonly totalDuration: number;
}

/**
 * Compiles and normalizes a sequence of InputActions:
 * 1. Assigns default hold/release frames to press actions
 * 2. Sanitizes user metadata to prevent forging isPostStabilization
 * 3. Injects synthetic post-stabilization wait action if configured
 * 4. Tags actions with sequenceId, actionIndex, and isTerminal flags
 * 5. Computes exact frame duration
 */
export function compileSequenceActions(
    actions: readonly InputAction[],
    options: ExecuteSequenceOptions = {},
    sequenceId?: number,
): CompiledSequence {
    const defaultHold = options.holdFrames ?? DEFAULT_HOLD_FRAMES;
    const defaultRelease = options.releaseFrames ?? DEFAULT_RELEASE_FRAMES;
    const postStabilization = options.postStabilizationFrames ?? DEFAULT_POST_STABILIZATION_FRAMES;

    const normalizedActions: InputAction[] = [];
    for (const [i, act] of actions.entries()) {
        const userMetadata = { ...act.metadata };
        delete (userMetadata as Record<string, unknown>)['isPostStabilization'];
        if (act.type === 'press') {
            normalizedActions.push({
                type: 'press',
                button: act.button,
                holdFrames: act.holdFrames ?? defaultHold,
                releaseFrames: act.releaseFrames ?? defaultRelease,
                metadata: {
                    ...userMetadata,
                    ...(sequenceId !== undefined ? { sequenceId, actionIndex: i } : {}),
                },
            });
        } else {
            normalizedActions.push({
                ...act,
                metadata: {
                    ...userMetadata,
                    ...(sequenceId !== undefined ? { sequenceId, actionIndex: i } : {}),
                },
            } as InputAction);
        }
    }

    if (postStabilization > 0) {
        normalizedActions.push({
            type: 'wait',
            frames: postStabilization,
            metadata: {
                ...(sequenceId !== undefined ? { sequenceId } : {}),
                isPostStabilization: true,
            },
        });
    }

    const totalDuration = normalizedActions.reduce((sum, act) => {
        if (act.type === 'press') return sum + (act.holdFrames ?? defaultHold) + (act.releaseFrames ?? defaultRelease);
        if (act.type === 'hold' || act.type === 'wait') return sum + act.frames;
        if (act.type === 'release') return sum + 1;
        return sum;
    }, 0);

    const taggedActions: InputAction[] = normalizedActions.map((act, index) => ({
        ...act,
        metadata: {
            ...act.metadata,
            ...(sequenceId !== undefined ? { sequenceId, actionIndex: index } : {}),
            isTerminal: index === normalizedActions.length - 1,
            isPostStabilization: Boolean(act.metadata?.isPostStabilization),
        },
    }));

    return {
        normalizedActions,
        taggedActions,
        totalDuration,
    };
}
