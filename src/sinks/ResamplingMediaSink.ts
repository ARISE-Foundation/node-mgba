import { Buffer } from 'node:buffer';
import type { AudioChunk, MediaSink, VideoPacket } from '../types/MediaSink.js';

export interface ResamplerOptions {
    readonly inputSampleRate?: number;
    readonly targetSampleRate?: number;
}

export class PcmS16StereoResampler {
    private inputRate: number;
    private targetRate: number;
    private fractionalPhase = 0;
    private prevL = 0;
    private prevR = 0;
    private hasPrevSample = false;

    constructor(options: ResamplerOptions = {}) {
        this.inputRate = options.inputSampleRate ?? 131072;
        this.targetRate = options.targetSampleRate ?? 48000;
    }

    public get targetSampleRate(): number {
        return this.targetRate;
    }

    public reset(): void {
        this.fractionalPhase = 0;
        this.prevL = 0;
        this.prevR = 0;
        this.hasPrevSample = false;
    }

    public process(chunk: AudioChunk): AudioChunk {
        const inputRate = chunk.sampleRate > 0 ? chunk.sampleRate : this.inputRate;
        const targetRate = this.targetRate;

        if (inputRate !== this.inputRate) {
            this.inputRate = inputRate;
            this.reset();
        }

        if (inputRate === targetRate) {
            return chunk;
        }

        const resampleRatio = inputRate / targetRate;
        const inputSampleFrames = chunk.sampleFrames;
        const rawBuf = chunk.buffer;
        const int16View = new Int16Array(
            rawBuf.buffer,
            rawBuf.byteOffset,
            Math.floor(rawBuf.byteLength / 2),
        );

        if (inputSampleFrames <= 0 || int16View.length < 2) {
            return chunk;
        }

        // Allocate maximum possible output frames for this input chunk
        const maxOutputFrames = Math.ceil((inputSampleFrames + Math.max(0, -this.fractionalPhase) + 2) / resampleRatio) + 2;
        const outBuffer = Buffer.allocUnsafe(maxOutputFrames * 4); // 2 channels * 2 bytes
        const outInt16 = new Int16Array(
            outBuffer.buffer,
            outBuffer.byteOffset,
            maxOutputFrames * 2,
        );

        let outputCount = 0;
        let pos = this.fractionalPhase;

        while (pos < inputSampleFrames) {
            const idx0 = Math.floor(pos);
            const idx1 = idx0 + 1;

            // Need valid samples at idx0 and idx1
            if (idx0 < -1 || idx1 >= inputSampleFrames) {
                break;
            }

            const l0 = idx0 === -1 ? (this.hasPrevSample ? this.prevL : (int16View[0] ?? 0)) : (int16View[idx0 * 2] ?? 0);
            const r0 = idx0 === -1 ? (this.hasPrevSample ? this.prevR : (int16View[1] ?? 0)) : (int16View[idx0 * 2 + 1] ?? 0);

            const l1 = int16View[idx1 * 2] ?? 0;
            const r1 = int16View[idx1 * 2 + 1] ?? 0;

            const frac = pos - idx0;
            const interpolatedL = Math.round(l0 + frac * (l1 - l0));
            const interpolatedR = Math.round(r0 + frac * (r1 - r0));

            outInt16[outputCount * 2] = Math.max(-32768, Math.min(32767, interpolatedL));
            outInt16[outputCount * 2 + 1] = Math.max(-32768, Math.min(32767, interpolatedR));
            outputCount++;

            pos += resampleRatio;
        }

        // Save last input sample for cross-chunk interpolation with next chunk
        const lastIdx = inputSampleFrames - 1;
        this.prevL = int16View[lastIdx * 2] ?? 0;
        this.prevR = int16View[lastIdx * 2 + 1] ?? 0;
        this.hasPrevSample = true;

        // Carry fractional phase into the next chunk's coordinate system
        this.fractionalPhase = pos - inputSampleFrames;

        const trimmedBuffer = Buffer.allocUnsafe(outputCount * 4);
        outBuffer.copy(trimmedBuffer, 0, 0, outputCount * 4);

        return {
            frameIndex: chunk.frameIndex,
            pts: chunk.pts,
            sampleRate: targetRate,
            channels: 2,
            sampleFrames: outputCount,
            buffer: trimmedBuffer,
        };
    }
}

export interface ResamplingMediaSinkOptions {
    readonly targetSampleRate?: number;
}

export class ResamplingMediaSink implements MediaSink {
    public readonly name: string;
    private readonly resampler: PcmS16StereoResampler;

    constructor(
        private readonly innerSink: MediaSink,
        options: ResamplingMediaSinkOptions = {},
    ) {
        this.name = `resampled-${innerSink.name}`;
        this.resampler = new PcmS16StereoResampler({
            targetSampleRate: options.targetSampleRate ?? 48000,
        });
    }

    public async onVideoFrame(packet: VideoPacket): Promise<void> {
        if (this.innerSink.onVideoFrame) {
            await this.innerSink.onVideoFrame(packet);
        }
    }

    public async onAudioChunk(chunk: AudioChunk): Promise<void> {
        if (this.innerSink.onAudioChunk) {
            const resampled = this.resampler.process(chunk);
            await this.innerSink.onAudioChunk(resampled);
        }
    }

    public reset(): void {
        this.resampler.reset();
    }

    public async close(): Promise<void> {
        this.resampler.reset();
        if (this.innerSink.close) {
            await this.innerSink.close();
        }
    }
}
