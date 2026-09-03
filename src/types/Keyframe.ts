import type { Buffer } from 'node:buffer';

export interface Keyframe {
    readonly frameIndex: number;
    readonly timestampMs: number;
    readonly buffer: Buffer;
    readonly hash: string;
    readonly width: number;
    readonly height: number;
    readonly triggerReason: string;
}
