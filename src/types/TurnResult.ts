import type { Keyframe } from './Keyframe.js';

export interface TurnResult {
    readonly keyframes: readonly Keyframe[];
    readonly durationFrames: number;
    readonly executionTimeMs: number;
}
