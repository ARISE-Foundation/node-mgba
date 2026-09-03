export const GB_FPS = 59.7275005696;
export const GB_FRAME_DURATION_MS = 1000 / GB_FPS; // ~16.7426147 ms
export const GB_AUDIO_SAMPLE_RATE = 131072;

export const DEFAULT_HOLD_FRAMES = 16;
export const DEFAULT_RELEASE_FRAMES = 8;
export const DEFAULT_POST_STABILIZATION_FRAMES = 16;

export interface ExecuteSequenceOptions {
    readonly timeoutMs?: number | undefined;
    readonly signal?: AbortSignal | undefined;
    readonly holdFrames?: number | undefined;
    readonly releaseFrames?: number | undefined;
    readonly postStabilizationFrames?: number | undefined;
}

export type StepSequenceOptions = ExecuteSequenceOptions;

export interface SequenceExecutionResult {
    readonly sequenceId: number;
    readonly actionsExecuted: number;
}

export interface SequenceHandle {
    readonly sequenceId: number;
    readonly promise: Promise<SequenceExecutionResult>;
    cancel(reason?: string | Error): void;
}

export interface PressButtonsOptions extends ExecuteSequenceOptions {
    readonly waitFrames?: number | undefined;
}

export type ButtonName =
    | 'A'
    | 'B'
    | 'SELECT'
    | 'START'
    | 'RIGHT'
    | 'LEFT'
    | 'UP'
    | 'DOWN'
    | 'R'
    | 'L';

export interface InputActionMetadata {
    readonly sequenceId?: number;
    readonly isTerminal?: boolean;
    readonly isPostStabilization?: boolean;
    readonly actionIndex?: number;
}

export interface InputActionBase {
    readonly metadata?: InputActionMetadata;
}

export interface InputPressAction extends InputActionBase {
    readonly type: 'press';
    readonly button: ButtonName | number;
    readonly holdFrames?: number;
    readonly releaseFrames?: number;
}

export interface InputWaitAction extends InputActionBase {
    readonly type: 'wait';
    readonly frames: number;
}

export interface InputHoldAction extends InputActionBase {
    readonly type: 'hold';
    readonly button: ButtonName | number;
    readonly frames: number;
}

export interface InputReleaseAction extends InputActionBase {
    readonly type: 'release';
    readonly button?: ButtonName | number;
}

export type InputAction =
    | InputPressAction
    | InputWaitAction
    | InputHoldAction
    | InputReleaseAction;

export function press(
    button: ButtonName | number,
    holdFrames = DEFAULT_HOLD_FRAMES,
    releaseFrames = DEFAULT_RELEASE_FRAMES,
    metadata?: InputActionMetadata,
): InputPressAction {
    return {
        type: 'press',
        button,
        holdFrames,
        releaseFrames,
        ...(metadata ? { metadata } : {}),
    };
}

export function wait(frames: number, metadata?: InputActionMetadata): InputWaitAction {
    return {
        type: 'wait',
        frames,
        ...(metadata ? { metadata } : {}),
    };
}

export function hold(
    button: ButtonName | number,
    frames: number,
    metadata?: InputActionMetadata,
): InputHoldAction {
    return {
        type: 'hold',
        button,
        frames,
        ...(metadata ? { metadata } : {}),
    };
}

export function release(
    button?: ButtonName | number,
    metadata?: InputActionMetadata,
): InputReleaseAction {
    return {
        type: 'release',
        ...(button !== undefined ? { button } : {}),
        ...(metadata ? { metadata } : {}),
    };
}

export const BUTTON_BITMASKS: Readonly<Record<ButtonName, number>> = Object.freeze({
    A: 1 << 0,        // 1
    B: 1 << 1,        // 2
    SELECT: 1 << 2,   // 4
    START: 1 << 3,    // 8
    RIGHT: 1 << 4,    // 16
    LEFT: 1 << 5,     // 32
    UP: 1 << 6,       // 64
    DOWN: 1 << 7,     // 128
    R: 1 << 8,        // 256
    L: 1 << 9,        // 512
});

export const ALL_VALID_BUTTON_BITS = (1 << 10) - 1; // 0x3FF

export function normalizeButtonName(button: string, index?: number): ButtonName {
    if (typeof button !== 'string') {
        const atIndex = index !== undefined ? ` at index ${index}` : '';
        throw new Error(`Invalid action${atIndex}: 'button' must be a string or number, received ${typeof button}`);
    }
    const upper = button.trim().toUpperCase() as ButtonName;
    if (upper in BUTTON_BITMASKS) {
        return upper;
    }
    const atIndex = index !== undefined ? ` at index ${index}` : '';
    throw new Error(`Unrecognized button name: ${button}${atIndex}`);
}

function validateNonNegativeInteger(val: unknown, fieldName: string, index?: number, allowUndefined = false): void {
    if (allowUndefined && val === undefined) {
        return;
    }
    if (typeof val !== 'number' || !Number.isInteger(val) || val < 0 || !Number.isFinite(val)) {
        const atIndex = index !== undefined ? ` at index ${index}` : '';
        throw new Error(
            `Invalid action${atIndex}: '${fieldName}' must be a non-negative finite integer, received ${String(val)}`,
        );
    }
}

function validateButton(button: unknown, index?: number): ButtonName | number {
    if (typeof button === 'string') {
        return normalizeButtonName(button, index);
    }
    if (typeof button === 'number') {
        if (!Number.isInteger(button) || !Number.isFinite(button) || button < 0 || (button & ~ALL_VALID_BUTTON_BITS) !== 0) {
            const atIndex = index !== undefined ? ` at index ${index}` : '';
            throw new Error(
                `Invalid action${atIndex}: numeric 'button' must be a valid non-negative button bitmask integer (0..${ALL_VALID_BUTTON_BITS}), received ${String(button)}`,
            );
        }
        return button;
    }
    const atIndex = index !== undefined ? ` at index ${index}` : '';
    throw new Error(`Invalid action${atIndex}: 'button' must be a string or number, received ${typeof button}`);
}

export function validateStepSequenceOptions<T extends ExecuteSequenceOptions>(options: T): T {
    if (!options || typeof options !== 'object') {
        throw new Error(`Expected options to be an object, received ${typeof options}`);
    }
    const opts = options as Record<string, unknown>;
    if (opts['holdFrames'] !== undefined) {
        validateNonNegativeInteger(opts['holdFrames'], 'holdFrames');
    }
    if (opts['releaseFrames'] !== undefined) {
        validateNonNegativeInteger(opts['releaseFrames'], 'releaseFrames');
    }
    if (opts['waitFrames'] !== undefined) {
        validateNonNegativeInteger(opts['waitFrames'], 'waitFrames');
    }
    if (opts['postStabilizationFrames'] !== undefined) {
        validateNonNegativeInteger(opts['postStabilizationFrames'], 'postStabilizationFrames');
    }
    if (opts['timeoutMs'] !== undefined) {
        validateNonNegativeInteger(opts['timeoutMs'], 'timeoutMs');
    }
    return options;
}

export function validateInputAction(action: unknown, index?: number): InputAction {
    if (!action || typeof action !== 'object') {
        throw new Error(`Invalid action at index ${index ?? 'unknown'}: expected an object, received ${typeof action}`);
    }
    const act = action as Record<string, unknown>;
    if (typeof act['type'] !== 'string') {
        throw new Error(`Invalid action at index ${index ?? 'unknown'}: missing or non-string action 'type'`);
    }
    switch (act['type']) {
        case 'press': {
            const btn = validateButton(act['button'], index);
            validateNonNegativeInteger(act['holdFrames'], 'holdFrames', index, true);
            validateNonNegativeInteger(act['releaseFrames'], 'releaseFrames', index, true);
            return {
                ...(action as InputPressAction),
                button: btn,
            };
        }
        case 'hold': {
            const btn = validateButton(act['button'], index);
            validateNonNegativeInteger(act['frames'], 'frames', index, false);
            return {
                ...(action as InputHoldAction),
                button: btn,
            };
        }
        case 'release': {
            if (act['button'] !== undefined) {
                const btn = validateButton(act['button'], index);
                return {
                    ...(action as InputReleaseAction),
                    button: btn,
                };
            }
            return action as InputAction;
        }
        case 'wait': {
            validateNonNegativeInteger(act['frames'], 'frames', index, false);
            return action as InputAction;
        }
        default:
            throw new Error(`Invalid action at index ${index ?? 'unknown'}: unknown action type '${String(act['type'])}'`);
    }
}
