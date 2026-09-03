import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import {
    PcmS16StereoResampler,
    ResamplingMediaSink,
    type AudioChunk,
    type MediaSink,
} from '../src/index.js';

test('PcmS16StereoResampler & ResamplingMediaSink Suite', async (t) => {
    await t.test('1. PcmS16StereoResampler resamples 131072 Hz to 48000 Hz with accurate sample length', () => {
        const resampler = new PcmS16StereoResampler({
            inputSampleRate: 131072,
            targetSampleRate: 48000,
        });

        // 131072 Hz, 1 frame at 60 FPS = ~2184.5 samples. Let's create a chunk of 2185 stereo samples.
        const inputFrames = 2185;
        const inBuf = Buffer.alloc(inputFrames * 4);
        const int16 = new Int16Array(inBuf.buffer, inBuf.byteOffset, inputFrames * 2);

        // Fill with a sine wave test signal
        for (let i = 0; i < inputFrames; i++) {
            const sampleVal = Math.round(Math.sin((i / inputFrames) * Math.PI * 4) * 16000);
            int16[i * 2] = sampleVal;
            int16[i * 2 + 1] = sampleVal;
        }

        const chunk: AudioChunk = {
            frameIndex: 1,
            pts: 0,
            sampleRate: 131072,
            channels: 2,
            sampleFrames: inputFrames,
            buffer: inBuf,
        };

        const resampled = resampler.process(chunk);

        assert.equal(resampled.sampleRate, 48000);
        assert.equal(resampled.channels, 2);
        // Expected output frames: Math.floor(2185 / (131072 / 48000)) = ~800 frames (48000 / 60)
        assert.ok(resampled.sampleFrames >= 799 && resampled.sampleFrames <= 801);
        assert.equal(resampled.buffer.byteLength, resampled.sampleFrames * 4);

        // Process a second consecutive chunk to verify multi-chunk phase continuity
        const chunk2: AudioChunk = {
            frameIndex: 2,
            pts: 16.74,
            sampleRate: 131072,
            channels: 2,
            sampleFrames: inputFrames,
            buffer: inBuf,
        };

        const resampled2 = resampler.process(chunk2);
        assert.equal(resampled2.sampleRate, 48000);
        assert.ok(resampled2.sampleFrames >= 799 && resampled2.sampleFrames <= 801);
    });

    await t.test('2. ResamplingMediaSink decorates inner sink and delivers resampled audio chunks', async () => {
        const receivedChunks: AudioChunk[] = [];
        const innerSink: MediaSink = {
            name: 'test-sink',
            onAudioChunk: (chunk) => {
                receivedChunks.push(chunk);
            },
            onVideoFrame: () => {},
        };

        const resamplingSink = new ResamplingMediaSink(innerSink, { targetSampleRate: 44100 });

        const inBuf = Buffer.alloc(1000 * 4);
        await resamplingSink.onAudioChunk({
            frameIndex: 1,
            pts: 0,
            sampleRate: 131072,
            channels: 2,
            sampleFrames: 1000,
            buffer: inBuf,
        });

        assert.equal(receivedChunks.length, 1);
        const first = receivedChunks[0];
        assert.ok(first);
        assert.equal(first.sampleRate, 44100);

        await resamplingSink.close();
    });

    await t.test('3. PcmS16StereoResampler preserves continuous constant signal across many consecutive chunks', () => {
        const resampler = new PcmS16StereoResampler({
            inputSampleRate: 131072,
            targetSampleRate: 48000,
        });

        const inputFrames = 2185;
        const inBuf = Buffer.alloc(inputFrames * 4);
        const int16 = new Int16Array(inBuf.buffer, inBuf.byteOffset, inputFrames * 2);
        int16.fill(10000);

        for (let chunkIdx = 0; chunkIdx < 10; chunkIdx++) {
            const resampled = resampler.process({
                frameIndex: chunkIdx + 1,
                pts: chunkIdx * 16.7,
                sampleRate: 131072,
                channels: 2,
                sampleFrames: inputFrames,
                buffer: inBuf,
            });

            const outInt16 = new Int16Array(resampled.buffer.buffer, resampled.buffer.byteOffset, resampled.sampleFrames * 2);
            for (let i = 0; i < outInt16.length; i++) {
                assert.equal(outInt16[i], 10000, `Sample at index ${i} in chunk ${chunkIdx} deviated from 10000 (got ${outInt16[i]})`);
            }
        }
    });

    await t.test('4. Cumulative long-stream resampler throughput matches exact mathematical expectation over 1000 chunks', () => {
        const resampler = new PcmS16StereoResampler({
            inputSampleRate: 131072,
            targetSampleRate: 48000,
        });

        // Alternating 2194 and 2195 samples (real Game Boy 131,072 Hz / ~59.7275 FPS)
        let totalInputFrames = 0;
        let totalOutputFrames = 0;

        for (let i = 0; i < 1000; i++) {
            const inputFrames = i % 2 === 0 ? 2194 : 2195;
            totalInputFrames += inputFrames;
            const inBuf = Buffer.alloc(inputFrames * 4);

            const resampled = resampler.process({
                frameIndex: i + 1,
                pts: i * 16.74,
                sampleRate: 131072,
                channels: 2,
                sampleFrames: inputFrames,
                buffer: inBuf,
            });

            totalOutputFrames += resampled.sampleFrames;
        }

        const expectedTotalOutput = Math.floor(totalInputFrames * 48000 / 131072);
        assert.ok(
            Math.abs(totalOutputFrames - expectedTotalOutput) <= 1,
            `Total output frames (${totalOutputFrames}) deviated from expected (${expectedTotalOutput}) by more than 1 sample`,
        );
    });

    await t.test('5. Continuous sinusoidal signal across chunk boundaries produces smooth continuous waveform', () => {
        const resampler = new PcmS16StereoResampler({
            inputSampleRate: 131072,
            targetSampleRate: 48000,
        });

        // Generate a 440 Hz continuous sine wave across 5 chunks
        const frequency = 440;
        const inputRate = 131072;
        let globalSampleIndex = 0;
        const allOutputSamples: number[] = [];

        for (let chunkIdx = 0; chunkIdx < 5; chunkIdx++) {
            const inputFrames = 2194;
            const inBuf = Buffer.alloc(inputFrames * 4);
            const int16 = new Int16Array(inBuf.buffer, inBuf.byteOffset, inputFrames * 2);

            for (let i = 0; i < inputFrames; i++) {
                const tSec = (globalSampleIndex + i) / inputRate;
                const sampleVal = Math.round(Math.sin(2 * Math.PI * frequency * tSec) * 20000);
                int16[i * 2] = sampleVal;
                int16[i * 2 + 1] = sampleVal;
            }
            globalSampleIndex += inputFrames;

            const resampled = resampler.process({
                frameIndex: chunkIdx + 1,
                pts: chunkIdx * 16.74,
                sampleRate: inputRate,
                channels: 2,
                sampleFrames: inputFrames,
                buffer: inBuf,
            });

            const outInt16 = new Int16Array(resampled.buffer.buffer, resampled.buffer.byteOffset, resampled.sampleFrames * 2);
            for (let i = 0; i < resampled.sampleFrames; i++) {
                allOutputSamples.push(outInt16[i * 2] ?? 0);
            }
        }

        // Verify there are no sudden sharp discontinuities (first difference max delta) across the entire stream
        for (let i = 1; i < allOutputSamples.length; i++) {
            const prev = allOutputSamples[i - 1] ?? 0;
            const curr = allOutputSamples[i] ?? 0;
            const delta = Math.abs(curr - prev);
            // For a 440Hz wave sampled at 48kHz with amplitude 20000, max delta per sample is ~1,150
            assert.ok(delta < 2000, `Excessive sample discontinuity at index ${i}: delta=${delta} (prev=${prev}, curr=${curr})`);
        }
    });
});
