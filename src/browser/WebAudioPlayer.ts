import type { BrowserAudioPacket, WebAudioPlayerMode, WebAudioPlayerOptions } from './types.js';

export class WebAudioPlayer {
    public readonly mode: WebAudioPlayerMode;
    private audioCtx: AudioContext | null = null;
    private masterGain: GainNode | null = null;
    private nextPlayTime = 0;
    private readonly activeNodes = new Set<AudioBufferSourceNode>();
    private readonly jitterBufferSeconds: number;
    private readonly enableLogging: boolean;
    private readonly maxLeadSeconds: number | null;
    private readonly adaptiveRate: boolean;
    private currentVolume: number;
    private fractionalPhase = 0;
    private prevL = 0;
    private prevR = 0;
    private hasPrevSample = false;
    private lastInputRate = 0;

    private underrunCount = 0;
    private excessiveLeadCount = 0;
    private chunkCount = 0;
    private lastStatsTime = 0;
    private decodeBuffer: Uint8Array | null = null;
    private tempLeft: Float32Array | null = null;
    private tempRight: Float32Array | null = null;

    constructor(options: WebAudioPlayerOptions = {}) {
        this.mode = options.mode ?? 'realtime';
        this.jitterBufferSeconds = options.jitterBufferSeconds ?? (this.mode === 'buffered' ? 0.04 : 0.15);
        this.currentVolume = Math.max(0, Math.min(1, options.defaultVolume ?? 1.0));
        this.enableLogging = options.enableLogging ?? false;
        this.maxLeadSeconds = options.maxLeadSeconds !== undefined
            ? options.maxLeadSeconds
            : (this.mode === 'buffered' ? null : 0.35);
        this.adaptiveRate = options.adaptiveRate !== undefined
            ? options.adaptiveRate
            : (this.mode === 'realtime');
    }

    public get volume(): number {
        return this.currentVolume;
    }

    public setVolume(newVolume: number): void {
        this.currentVolume = Math.max(0, Math.min(1, newVolume));
        if (this.masterGain && this.audioCtx) {
            this.masterGain.gain.setValueAtTime(this.currentVolume, this.audioCtx.currentTime);
        }
    }

    public async unlock(): Promise<boolean> {
        const ctx = this.getAudioContext();
        if (!ctx) return false;
        if ((ctx.state as AudioContextState) === 'suspended') {
            try {
                await ctx.resume();
            } catch {
                return false;
            }
        }
        return (ctx.state as AudioContextState) === 'running';
    }

    public getAudioContext(): AudioContext | null {
        if (typeof window === 'undefined') return null;
        if (!this.audioCtx) {
            const AudioContextClass =
                window.AudioContext
                || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
            if (AudioContextClass) {
                this.audioCtx = new AudioContextClass();
                this.masterGain = this.audioCtx.createGain();
                this.masterGain.gain.setValueAtTime(this.currentVolume, this.audioCtx.currentTime);
                this.masterGain.connect(this.audioCtx.destination);
            }
        }
        return this.audioCtx;
    }

    public reset(): void {
        this.stop();
        this.fractionalPhase = 0;
        this.prevL = 0;
        this.prevR = 0;
        this.hasPrevSample = false;
        this.lastInputRate = 0;
    }

    public handleStreamReset(): void {
        this.reset();
    }

    public stop(): void {
        this.activeNodes.forEach((node) => {
            try {
                node.stop();
                node.disconnect();
            } catch {
                // ignore
            }
        });
        this.activeNodes.clear();
        this.nextPlayTime = 0;
        this.fractionalPhase = 0;
        this.prevL = 0;
        this.prevR = 0;
        this.hasPrevSample = false;
    }

    public playChunk(packet: BrowserAudioPacket): void {
        const ctx = this.getAudioContext();
        if (!ctx || !this.masterGain) return;

        // Clear and drop if context is not running to prevent stale burst playback upon resume
        if (ctx.state !== 'running') {
            this.stop();
            return;
        }

        try {
            let int16View: Int16Array;

            if (packet.buffer instanceof Uint8Array) {
                int16View = new Int16Array(
                    packet.buffer.buffer,
                    packet.buffer.byteOffset,
                    Math.floor(packet.buffer.byteLength / 2),
                );
            } else if (packet.buffer instanceof ArrayBuffer) {
                int16View = new Int16Array(packet.buffer, 0, Math.floor(packet.buffer.byteLength / 2));
            } else if (typeof packet.bufferBase64 === 'string') {
                const binaryString = atob(packet.bufferBase64);
                const len = binaryString.length;
                if (!this.decodeBuffer || this.decodeBuffer.length < len) {
                    this.decodeBuffer = new Uint8Array(len);
                }
                const bytes = this.decodeBuffer;
                for (let i = 0; i < len; i++) {
                    bytes[i] = binaryString.charCodeAt(i);
                }
                int16View = new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(len / 2));
            } else {
                return;
            }

            const inputSampleFrames = packet.sampleFrames;
            const inputRate = packet.sampleRate > 0 ? packet.sampleRate : 131072;
            const targetRate = ctx.sampleRate; // usually 44100 or 48000

            if (inputRate !== this.lastInputRate) {
                this.lastInputRate = inputRate;
                this.fractionalPhase = 0;
                this.prevL = 0;
                this.prevR = 0;
                this.hasPrevSample = false;
            }

            const resampleRatio = inputRate / targetRate;
            let audioBuffer: AudioBuffer;

            // Fast-path: matching sample rates with no residual phase offset
            if (inputRate === targetRate && this.fractionalPhase === 0) {
                audioBuffer = ctx.createBuffer(2, inputSampleFrames, targetRate);
                const leftChannel = audioBuffer.getChannelData(0);
                const rightChannel = audioBuffer.getChannelData(1);

                for (let i = 0; i < inputSampleFrames; i++) {
                    leftChannel[i] = (int16View[i * 2] ?? 0) / 32768.0;
                    rightChannel[i] = (int16View[i * 2 + 1] ?? 0) / 32768.0;
                }
            } else {
                const maxOutputFrames = Math.ceil((inputSampleFrames + Math.max(0, -this.fractionalPhase) + 2) / resampleRatio) + 2;
                if (!this.tempLeft || this.tempLeft.length < maxOutputFrames || !this.tempRight || this.tempRight.length < maxOutputFrames) {
                    this.tempLeft = new Float32Array(maxOutputFrames);
                    this.tempRight = new Float32Array(maxOutputFrames);
                }
                const tempLeft = this.tempLeft;
                const tempRight = this.tempRight;

                let outputCount = 0;
                let pos = this.fractionalPhase;

                while (pos < inputSampleFrames) {
                    const idx0 = Math.floor(pos);
                    const idx1 = idx0 + 1;

                    if (idx0 < -1 || idx1 >= inputSampleFrames) {
                        break;
                    }

                    const l0 = (idx0 === -1 ? (this.hasPrevSample ? this.prevL : (int16View[0] ?? 0)) : (int16View[idx0 * 2] ?? 0)) / 32768.0;
                    const r0 = (idx0 === -1 ? (this.hasPrevSample ? this.prevR : (int16View[1] ?? 0)) : (int16View[idx0 * 2 + 1] ?? 0)) / 32768.0;

                    const l1 = (int16View[idx1 * 2] ?? 0) / 32768.0;
                    const r1 = (int16View[idx1 * 2 + 1] ?? 0) / 32768.0;

                    const frac = pos - idx0;
                    tempLeft[outputCount] = l0 + frac * (l1 - l0);
                    tempRight[outputCount] = r0 + frac * (r1 - r0);
                    outputCount++;

                    pos += resampleRatio;
                }

                if (inputSampleFrames > 0) {
                    const lastIdx = inputSampleFrames - 1;
                    this.prevL = int16View[lastIdx * 2] ?? 0;
                    this.prevR = int16View[lastIdx * 2 + 1] ?? 0;
                    this.hasPrevSample = true;
                }

                this.fractionalPhase = pos - inputSampleFrames;

                if (outputCount === 0) {
                    return;
                }

                audioBuffer = ctx.createBuffer(2, outputCount, targetRate);
                audioBuffer.getChannelData(0).set(tempLeft.subarray(0, outputCount));
                audioBuffer.getChannelData(1).set(tempRight.subarray(0, outputCount));
            }

            const sourceNode = ctx.createBufferSource();
            sourceNode.buffer = audioBuffer;
            sourceNode.connect(this.masterGain);

            const now = ctx.currentTime;
            const targetLead = this.jitterBufferSeconds;
            const currentLead = this.nextPlayTime - now;

            let playbackRate = 1.0;
            let scheduleTime: number;

            if (this.nextPlayTime === 0 || currentLead < -0.100) {
                // Initial cold start or long pause gap (>100ms) during AI turn
                if (currentLead < -0.100 && this.nextPlayTime > 0) {
                    this.underrunCount++;
                    if (this.enableLogging) {
                        console.warn(`[WebAudioPlayer] Extended gap (${(currentLead * 1000).toFixed(1)}ms). Rebuilding buffer to ${(targetLead * 1000).toFixed(0)}ms`);
                    }
                }
                scheduleTime = now + targetLead;
                playbackRate = 1.0;
            } else if (this.maxLeadSeconds !== null && currentLead > this.maxLeadSeconds) {
                // Excessive latency accumulation: drop old schedule and restart
                this.excessiveLeadCount++;
                console.warn(
                    `[WebAudioPlayer] Audio lead accumulated ${(currentLead * 1000).toFixed(1)}ms > ${(this.maxLeadSeconds * 1000).toFixed(0)}ms and was reset to minimize interactive latency. If you are streaming batched turns or AI actions, initialize with { mode: 'buffered' }.`
                );
                this.activeNodes.forEach((node) => {
                    try {
                        node.stop();
                        node.disconnect();
                    } catch {
                        // ignore
                    }
                });
                this.activeNodes.clear();
                scheduleTime = now + targetLead;
                playbackRate = 1.0;
            } else if (currentLead < 0) {
                // Minor underrun (-100ms <= currentLead < 0): Play IMMEDIATELY at `now` without inserting silence gaps!
                this.underrunCount++;
                scheduleTime = now;
                playbackRate = this.adaptiveRate ? 0.996 : 1.0;
            } else {
                // Normal continuous playback: schedule back-to-back
                scheduleTime = this.nextPlayTime;
                // Adaptive clock drift compensation: smoothly nudge playback rate within inaudible range (±0.4% / ~7 cents)
                // Only compensate drift when adaptiveRate is enabled (realtime stream). In buffered mode, preserve exact 1.000x rate.
                if (this.adaptiveRate) {
                    const error = currentLead - targetLead;
                    if (error > 0.020) {
                        playbackRate = Math.min(1.004, 1.0 + (error - 0.020) * 0.08);
                    } else if (error < -0.020) {
                        playbackRate = Math.max(0.996, 1.0 + (error + 0.020) * 0.08);
                    } else {
                        playbackRate = 1.0;
                    }
                } else {
                    playbackRate = 1.0;
                }
            }

            sourceNode.playbackRate.value = playbackRate;
            sourceNode.start(scheduleTime);
            this.nextPlayTime = scheduleTime + audioBuffer.duration / playbackRate;

            this.chunkCount++;
            if (this.enableLogging && (this.lastStatsTime === 0 || now - this.lastStatsTime >= 3.0)) {
                this.lastStatsTime = now;
                console.info(`[WebAudioPlayer] buffer=${(currentLead * 1000).toFixed(1)}ms (target: ${(targetLead * 1000).toFixed(0)}ms) | rate=${playbackRate.toFixed(4)} | nodes=${this.activeNodes.size} | underruns=${this.underrunCount} | resets=${this.excessiveLeadCount}`);
            }

            this.activeNodes.add(sourceNode);
            sourceNode.onended = () => {
                this.activeNodes.delete(sourceNode);
                sourceNode.disconnect();
            };
        } catch (err) {
            console.warn('[WebAudioPlayer] Error playing audio chunk:', err);
        }
    }

    public close(): void {
        this.stop();
        if (this.audioCtx) {
            this.audioCtx.close().catch(() => {});
            this.audioCtx = null;
            this.masterGain = null;
        }
        this.decodeBuffer = null;
        this.tempLeft = null;
        this.tempRight = null;
    }
}
