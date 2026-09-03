import { Buffer } from 'node:buffer';
import xxhash, { type XXHashAPI } from 'xxhash-wasm';
import type { NativeMgbaCore } from './NativeMgbaCore.js';
import type { Keyframe } from '../types/Keyframe.js';
import { GB_FRAME_DURATION_MS } from '../types/InputAction.js';

let hasherInstance: XXHashAPI | null = null;

async function getHasher(): Promise<XXHashAPI> {
    if (!hasherInstance) {
        hasherInstance = await xxhash();
    }
    return hasherInstance;
}

export interface KeyframeCollectorOptions {
    readonly maxKeyframes?: number;
    readonly minIntervalFrames?: number;
}

export class KeyframeCollector {
    private readonly maxKeyframes: number;
    private readonly minIntervalFrames: number;
    private keyframes: Keyframe[] = [];
    private lastHash: string | null = null;
    private lastSampledFrameIndex = -1;
    private hasher: XXHashAPI | null = null;
    private baseFrameIndex = -1;

    constructor(options: KeyframeCollectorOptions = {}) {
        this.maxKeyframes = options.maxKeyframes ?? 24;
        this.minIntervalFrames = options.minIntervalFrames ?? 12;
    }

    public async init(): Promise<void> {
        if (!this.hasher) {
            this.hasher = await getHasher();
        }
    }

    public reset(baseFrameIndex = -1): void {
        this.keyframes = [];
        this.lastHash = null;
        this.lastSampledFrameIndex = -1;
        this.baseFrameIndex = baseFrameIndex;
    }

    /**
     * Samples the current frame from the core and captures it if unique or forced.
     */
    public sampleFrame(
        core: NativeMgbaCore,
        options: { readonly triggerReason?: string; readonly force?: boolean } = {},
    ): Keyframe | null {
        if (!this.hasher) {
            throw new Error('KeyframeCollector must be initialized via await collector.init() before sampling');
        }

        const frame = core.getVideoFrame();
        const frameIndex = core.getFrameCounter();

        // Calculate 64-bit hash over the buffer
        const hash = this.hasher.h64Raw(frame.buffer).toString(16);
        const isDuplicate = hash === this.lastHash;

        // For non-forced intermediate frames, enforce minimum frame interval and deduplication
        if (options.force !== true) {
            if (isDuplicate) {
                return null;
            }
            if (this.lastSampledFrameIndex >= 0 && (frameIndex - this.lastSampledFrameIndex) < this.minIntervalFrames) {
                return null;
            }
        }

        if (this.baseFrameIndex < 0) {
            this.baseFrameIndex = frameIndex;
        }

        const relativeFrames = Math.max(0, frameIndex - this.baseFrameIndex);

        const keyframe: Keyframe = {
            frameIndex,
            timestampMs: Math.round(relativeFrames * GB_FRAME_DURATION_MS),
            buffer: Buffer.from(frame.buffer),
            hash,
            width: frame.width,
            height: frame.height,
            triggerReason: options.triggerReason ?? (isDuplicate ? 'force' : 'visual_change'),
        };

        if (options.force === true && this.keyframes.length > 0) {
            const prevKf = this.keyframes[this.keyframes.length - 1];
            if (prevKf && prevKf.hash === hash && prevKf.triggerReason === 'visual_change') {
                this.keyframes[this.keyframes.length - 1] = keyframe;
                this.lastHash = hash;
                this.lastSampledFrameIndex = frameIndex;
                return keyframe;
            }
        }

        if (this.keyframes.length < this.maxKeyframes) {
            this.keyframes.push(keyframe);
        } else if (options.force === true) {
            this.keyframes.push(keyframe);
        }

        this.lastHash = hash;
        this.lastSampledFrameIndex = frameIndex;
        return keyframe;
    }

    /**
     * Returns all collected keyframes.
     */
    public getKeyframes(): readonly Keyframe[] {
        return this.keyframes;
    }
}
