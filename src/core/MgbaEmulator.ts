import { NativeMgbaCore } from './NativeMgbaCore.js';
import { KeyframeCollector, type KeyframeCollectorOptions } from './KeyframeCollector.js';
import { PluginRegistry } from './PluginRegistry.js';
import type { EmulatorPlugin } from '../types/EmulatorPlugin.js';
import type { KeyframeSink } from '../types/KeyframeSink.js';
import type { MediaSink, VideoPacket } from '../types/MediaSink.js';
import type { RomInfo } from '../types/RomInfo.js';
import type { TurnResult } from '../types/TurnResult.js';
import type { InputAction } from '../types/InputAction.js';
import {
    DEFAULT_HOLD_FRAMES,
    DEFAULT_RELEASE_FRAMES,
    DEFAULT_POST_STABILIZATION_FRAMES,
    BUTTON_BITMASKS,
    type ButtonName,
    type HeldButtonStatus,
    normalizeButtonName,
    validateInputAction,
    validateStepSequenceOptions,
    type StepSequenceOptions,
} from '../types/InputAction.js';
import { resolveButtonMask } from './InputActionCompiler.js';
import { AbortError } from '../types/errors.js';

export interface MgbaEmulatorOptions {
    readonly collector?: KeyframeCollectorOptions;
}

export type LeanEmulatorOptions = MgbaEmulatorOptions;

export class MgbaEmulator {
    public readonly core: NativeMgbaCore;
    public readonly collector: KeyframeCollector;
    public readonly registry: PluginRegistry;
    private isInitialized = false;
    private currentKeyMask = 0;
    private continuousHeldFrames = new Map<ButtonName, number>();
    private activeToken: object | null = null;
    private cancelledTokens = new Set<object>();

    constructor(options: MgbaEmulatorOptions = {}) {
        this.core = new NativeMgbaCore();
        this.collector = new KeyframeCollector(options.collector ?? {});
        this.registry = new PluginRegistry();
    }

    /**
     * Registers an EmulatorPlugin.
     */
    public use(plugin: EmulatorPlugin<unknown>): this {
        this.registry.registerPlugin(plugin);
        return this;
    }

    /**
     * Registers an emulator plugin.
     */
    public registerPlugin(plugin: EmulatorPlugin<unknown>): this {
        this.registry.registerPlugin(plugin);
        return this;
    }

    /**
     * Registers a keyframe sink.
     */
    public registerKeyframeSink(sink: KeyframeSink): this {
        this.registry.registerKeyframeSink(sink);
        return this;
    }

    public useMediaSink(sink: MediaSink): this {
        this.registry.registerMediaSink(sink);
        return this;
    }

    /**
     * Registers a continuous media sink.
     */
    public registerMediaSink(sink: MediaSink): this {
        this.registry.registerMediaSink(sink);
        return this;
    }

    /**
     * Unregisters a continuous media sink by name.
     */
    public unregisterMediaSink(name: string): this {
        this.registry.unregisterMediaSink(name);
        return this;
    }

    /**
     * Loads a ROM, initializes the collector, and binds matching plugins.
     */
    public async loadROM(romPath: string): Promise<RomInfo> {
        await this.collector.init();
        const romInfo = this.core.loadROM(romPath);
        await this.registry.bindROM(romInfo, this.core);
        this.isInitialized = true;
        this.currentKeyMask = 0;
        return romInfo;
    }

    public isRunning(): boolean {
        return this.isInitialized;
    }

    public getFrameCounter(): number {
        return this.core.getFrameCounter();
    }

    /**
     * Advances emulation by N frames with an optional key mask and AbortSignal.
     */
    public async step(
        frames = 1,
        keyMask?: number,
        options: { signal?: AbortSignal | undefined } = {},
    ): Promise<VideoPacket> {
        this.ensureReady();
        if (keyMask !== undefined) {
            this.currentKeyMask = keyMask;
        }

        const isRoot = !this.activeToken;
        const token = this.activeToken || {};
        if (isRoot) {
            this.activeToken = token;
        }

        try {
            const hasMedia = this.registry.hasMediaSinks();

            for (let i = 0; i < frames; i++) {
                if (this.cancelledTokens.has(token) || options.signal?.aborted) {
                    this.currentKeyMask = 0;
                    const reason = options.signal?.reason;
                    const abortErr = reason instanceof AbortError
                        ? reason
                        : new AbortError(typeof reason === 'string' ? reason : reason?.message || 'Emulation step cancelled or aborted.');
                    throw abortErr;
                }
                this.core.stepFrame(this.currentKeyMask);
                const frameIndex = this.core.getFrameCounter();

                for (const [name, bit] of Object.entries(BUTTON_BITMASKS) as [ButtonName, number][]) {
                    if ((this.currentKeyMask & bit) !== 0) {
                        this.continuousHeldFrames.set(name, (this.continuousHeldFrames.get(name) ?? 0) + 1);
                    } else {
                        this.continuousHeldFrames.delete(name);
                    }
                }

                // Broadcast per-frame event to active plugins
                await this.registry.notifyFrame({
                    frameIndex,
                    currentKeys: this.currentKeyMask,
                });

                const kf = this.collector.sampleFrame(this.core);
                if (kf) {
                    await this.registry.notifyKeyframe(kf);
                }

                if (hasMedia) {
                    const video = this.core.getVideoFrame();
                    await this.registry.notifyVideoFrame(video);

                    const audio = this.core.readAudioFrames();
                    if (audio) {
                        await this.registry.notifyAudioChunk(audio);
                    }
                }

                // Yield periodically to allow incoming IPC messages to be processed
                if ((i + 1) % 8 === 0) {
                    await new Promise((resolve) => setImmediate(resolve));
                }
            }

            const frame = this.core.getVideoFrame();
            if (!hasMedia) {
                await this.registry.notifyVideoFrame(frame);
            }
            return frame;
        } finally {
            if (isRoot) {
                this.activeToken = null;
                this.cancelledTokens.delete(token);
            }
        }
    }

    /**
     * Executes a sequence of structured input actions with in-memory keyframe deduplication.
     */
    public async stepSequence(
        actions: readonly InputAction[] = [],
        options: StepSequenceOptions = {},
    ): Promise<TurnResult> {
        this.ensureReady();

        const validatedActions = actions.map((a, i) => validateInputAction(a, i));
        const validatedOptions = validateStepSequenceOptions(options);

        const isRoot = !this.activeToken;
        const token = this.activeToken || {};
        if (isRoot) {
            this.activeToken = token;
        }

        try {
            const startTime = Date.now();
            const startFrame = this.core.getFrameCounter();
            const defaultHold = validatedOptions.holdFrames ?? DEFAULT_HOLD_FRAMES;
            const defaultRelease = validatedOptions.releaseFrames ?? DEFAULT_RELEASE_FRAMES;
            const postStabilization = validatedOptions.postStabilizationFrames ?? DEFAULT_POST_STABILIZATION_FRAMES;

            this.collector.reset(startFrame);

            // 1. Pre-action anchor frame
            const preAnchor = this.collector.sampleFrame(this.core, { triggerReason: 'pre_action', force: true });
            if (preAnchor) {
                await this.registry.notifyKeyframe(preAnchor);
            }

            let persistentMask = this.currentKeyMask;

            // 2. Execute input actions
            for (const [i, action] of validatedActions.entries()) {
                if (this.cancelledTokens.has(token) || options.signal?.aborted) {
                    this.currentKeyMask = 0;
                    const reason = options.signal?.reason;
                    const abortErr = reason instanceof AbortError
                        ? reason
                        : new AbortError(typeof reason === 'string' ? reason : reason?.message || 'Step sequence cancelled or aborted.');
                    throw abortErr;
                }

                switch (action.type) {
                    case 'press': {
                        const mask = resolveButtonMask(action.button);
                        const hold = action.holdFrames ?? defaultHold;
                        const release = action.releaseFrames ?? defaultRelease;

                        if (hold > 0) {
                            await this.step(hold, persistentMask | mask, { signal: options.signal });
                        }
                        if (release > 0) {
                            await this.step(release, persistentMask, { signal: options.signal });
                        } else {
                            this.currentKeyMask = persistentMask;
                        }
                        break;
                    }
                    case 'hold': {
                        const mask = resolveButtonMask(action.button);
                        persistentMask |= mask;
                        this.currentKeyMask = persistentMask;
                        if (action.frames && action.frames > 0) {
                            await this.step(action.frames, persistentMask, { signal: options.signal });
                        }
                        break;
                    }
                    case 'release': {
                        if (action.button !== undefined) {
                            const mask = resolveButtonMask(action.button);
                            persistentMask &= ~mask;
                        } else {
                            persistentMask = 0;
                        }
                        this.currentKeyMask = persistentMask;
                        break;
                    }
                    case 'wait': {
                        if (action.frames > 0) {
                            await this.step(action.frames, persistentMask, { signal: options.signal });
                        }
                        break;
                    }
                }

                const btnName = 'button' in action && action.button ? `_${action.button}` : '';
                const actionAnchor = this.collector.sampleFrame(this.core, {
                    triggerReason: `action_${i + 1}:${action.type}${btnName}`,
                    force: true,
                });
                if (actionAnchor) {
                    await this.registry.notifyKeyframe(actionAnchor);
                }
            }

            // 3. Post-action stabilization frames
            if (postStabilization > 0) {
                await this.step(postStabilization, persistentMask, { signal: options.signal });
            }
            this.currentKeyMask = persistentMask;

            // 4. Post-action anchor frame
            const postAnchor = this.collector.sampleFrame(this.core, { triggerReason: 'post_action', force: true });
            if (postAnchor) {
                await this.registry.notifyKeyframe(postAnchor);
            }

            const endFrame = this.core.getFrameCounter();
            const durationFrames = endFrame - startFrame;
            const executionTimeMs = Date.now() - startTime;

            const turnResult: TurnResult = {
                keyframes: this.collector.getKeyframes(),
                durationFrames,
                executionTimeMs,
            };

            await this.registry.notifyTurnComplete(turnResult);

            return turnResult;
        } finally {
            if (isRoot) {
                this.activeToken = null;
                this.cancelledTokens.delete(token);
            }
        }
    }

    public getActivePlugins(): readonly EmulatorPlugin<unknown>[] {
        return this.registry.getActivePlugins();
    }

    public getActivePlugin(name: string): EmulatorPlugin<unknown> | null {
        return this.registry.getActivePlugin(name);
    }

    /**
     * Resets the core.
     */
    public reset(): void {
        this.core.reset();
        this.currentKeyMask = 0;
    }

    /**
     * Saves state to file atomically.
     */
    public saveState(filepath: string): boolean {
        return this.core.saveState(filepath);
    }

    /**
     * Loads state from file.
     */
    public loadState(filepath: string): boolean {
        return this.core.loadState(filepath);
    }

    /**
     * Gets the active persistent key mask.
     */
    public getKeyMask(): number {
        return this.currentKeyMask;
    }

    /**
     * Sets the active persistent key mask.
     */
    public setKeyMask(mask: number): void {
        this.currentKeyMask = mask;
        for (const [name, bit] of Object.entries(BUTTON_BITMASKS) as [ButtonName, number][]) {
            if ((this.currentKeyMask & bit) === 0) {
                this.continuousHeldFrames.delete(name);
            }
        }
    }

    /**
     * Restores persistent held buttons and their continuous frame counts.
     */
    public restoreHeldButtons(heldButtons: readonly HeldButtonStatus[]): void {
        let mask = 0;
        this.continuousHeldFrames.clear();
        for (const status of heldButtons) {
            const norm = normalizeButtonName(status.button);
            const bit = BUTTON_BITMASKS[norm];
            mask |= bit;
            this.continuousHeldFrames.set(norm, Math.max(0, status.framesHeld));
        }
        this.currentKeyMask = mask;
    }

    /**
     * Returns currently held buttons with their continuous frame counts.
     */
    public getHeldButtons(): HeldButtonStatus[] {
        const result: HeldButtonStatus[] = [];
        for (const [name, bit] of Object.entries(BUTTON_BITMASKS) as [ButtonName, number][]) {
            if ((this.currentKeyMask & bit) !== 0) {
                const framesHeld = this.continuousHeldFrames.get(name) ?? 0;
                result.push({ button: name, framesHeld });
            }
        }
        return result;
    }

    /**
     * Clears current key mask and active input actions.
     */
    public clearActionQueue(): void {
        this.currentKeyMask = 0;
        this.continuousHeldFrames.clear();
        if (this.activeToken) {
            this.cancelledTokens.add(this.activeToken);
        }
    }

    /**
     * Clears persistent key mask, held frame counts, and active sequence actions.
     */
    public clearButtons(): void {
        this.clearActionQueue();
    }

    /**
     * Releases native core resources and cleanly closes all active media sinks.
     */
    public async close(): Promise<void> {
        await this.registry.closeMediaSinks();
        this.core.close();
        this.isInitialized = false;
        this.currentKeyMask = 0;
    }

    private ensureReady(): void {
        if (!this.isInitialized) {
            throw new Error('loadROM() must be called before executing operations.');
        }
    }
}

export const LeanEmulator = MgbaEmulator;
