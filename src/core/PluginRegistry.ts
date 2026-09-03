import type { EmulatorPlugin, FrameEventData } from '../types/EmulatorPlugin.js';
import type { KeyframeSink } from '../types/KeyframeSink.js';
import { type MediaSink, type VideoPacket, type AudioChunk, parseSinkIdentity } from '../types/MediaSink.js';
import type { RomInfo } from '../types/RomInfo.js';
import type { Keyframe } from '../types/Keyframe.js';
import type { TurnResult } from '../types/TurnResult.js';
import type { NativeMgbaCore } from './NativeMgbaCore.js';

const DISALLOWED_PLUGIN_NAMES = new Set(['__proto__', 'prototype', 'constructor']);

export class PluginRegistry {
    private plugins: Map<string, EmulatorPlugin<unknown>> = new Map();
    private activePlugins: Map<string, EmulatorPlugin<unknown>> = new Map();
    private keyframeSinks: KeyframeSink[] = [];
    private mediaSinks: MediaSink[] = [];

    public registerPlugin(plugin: EmulatorPlugin<unknown>): void {
        if (!plugin || typeof plugin.name !== 'string') {
            throw new Error('Plugin must have a valid string name');
        }

        if (plugin.name.length === 0 || plugin.name.trim() !== plugin.name) {
            throw new Error('Plugin name cannot be empty or contain leading/trailing whitespace');
        }

        if (!/^[a-z0-9_.-]+$/i.test(plugin.name)) {
            throw new Error(`Plugin name "${plugin.name}" is invalid. Must match /^[a-z0-9_.-]+$/i.`);
        }

        const lowerName = plugin.name.toLowerCase();
        if (DISALLOWED_PLUGIN_NAMES.has(lowerName)) {
            throw new Error(`Plugin name "${plugin.name}" is not allowed`);
        }

        if (this.plugins.has(plugin.name)) {
            throw new Error(`Plugin with name "${plugin.name}" is already registered`);
        }

        this.plugins.set(plugin.name, plugin);
    }

    public registerKeyframeSink(sink: KeyframeSink): void {
        this.keyframeSinks.push(sink);
    }

    public registerMediaSink(sink: MediaSink): void {
        if (!sink || typeof sink !== 'object') {
            throw new Error('Media sink must be an object');
        }
        const sinkName = parseSinkIdentity(sink.name);
        if (this.mediaSinks.some(s => s.name === sinkName)) {
            throw new Error(`Media sink with name "${sinkName}" is already registered`);
        }
        if (typeof sink.onVideoFrame !== 'function' && typeof sink.onAudioChunk !== 'function') {
            throw new Error(`Media sink "${sinkName}" must provide at least onVideoFrame or onAudioChunk callback`);
        }
        this.mediaSinks.push(sink);
    }

    public unregisterMediaSink(name: string): void {
        const sinkName = parseSinkIdentity(name);
        const idx = this.mediaSinks.findIndex(s => s.name === sinkName);
        if (idx === -1) {
            throw new Error(`Media sink "${sinkName}" is not registered`);
        }
        this.mediaSinks.splice(idx, 1);
    }

    public hasMediaSinks(): boolean {
        return this.mediaSinks.length > 0;
    }

    public getMediaSinks(): readonly MediaSink[] {
        return [...this.mediaSinks];
    }

    /**
     * Atomically binds all matching and universal plugins for the loaded ROM.
     */
    public async bindROM(romInfo: RomInfo, core: NativeMgbaCore): Promise<void> {
        const candidatePlugins: EmulatorPlugin<unknown>[] = [];

        for (const plugin of this.plugins.values()) {
            const isMatch = typeof plugin.match !== 'function' || plugin.match(romInfo);
            if (isMatch) {
                candidatePlugins.push(plugin);
            }
        }

        // Initialize candidate plugins first
        for (const plugin of candidatePlugins) {
            if (typeof plugin.onInit === 'function') {
                await plugin.onInit(core);
            }
        }

        // Commit active plugins atomically
        this.activePlugins.clear();
        for (const plugin of candidatePlugins) {
            this.activePlugins.set(plugin.name, plugin);
        }
    }

    public getActivePlugins(): readonly EmulatorPlugin<unknown>[] {
        return Array.from(this.activePlugins.values());
    }

    public getActivePlugin(name: string): EmulatorPlugin<unknown> | null {
        return this.activePlugins.get(name) ?? null;
    }

    public async notifyFrame(frameData: FrameEventData): Promise<void> {
        for (const plugin of this.activePlugins.values()) {
            if (typeof plugin.onFrame === 'function') {
                try {
                    await plugin.onFrame(frameData);
                } catch (err) {
                    console.error(`[PluginRegistry] Error in plugin "${plugin.name}" onFrame:`, err);
                }
            }
        }
    }

    public async notifyKeyframe(keyframe: Keyframe): Promise<void> {
        for (const sink of this.keyframeSinks) {
            if (typeof sink.onKeyframe === 'function') {
                try {
                    await sink.onKeyframe(keyframe);
                } catch (err) {
                    console.error(`[PluginRegistry] Error in keyframe sink "${sink.name}":`, err);
                }
            }
        }
    }

    public async notifyTurnComplete(result: TurnResult): Promise<void> {
        for (const sink of this.keyframeSinks) {
            if (typeof sink.onTurnComplete === 'function') {
                try {
                    await sink.onTurnComplete(result);
                } catch (err) {
                    console.error(`[PluginRegistry] Error in turn complete sink "${sink.name}":`, err);
                }
            }
        }
    }

    public async notifyVideoFrame(packet: VideoPacket): Promise<void> {
        for (const sink of this.mediaSinks) {
            if (typeof sink.onVideoFrame === 'function') {
                await sink.onVideoFrame(packet);
            }
        }
    }

    public async notifyAudioChunk(chunk: AudioChunk): Promise<void> {
        for (const sink of this.mediaSinks) {
            if (typeof sink.onAudioChunk === 'function') {
                await sink.onAudioChunk(chunk);
            }
        }
    }

    public async closeMediaSinks(): Promise<void> {
        for (const sink of this.mediaSinks) {
            if (typeof sink.close === 'function') {
                await sink.close();
            }
        }
        this.mediaSinks = [];
    }
}
