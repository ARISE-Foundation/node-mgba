import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { MgbaEmulator } from '../src/core/MgbaEmulator.js';
import { FfmpegRecordingSink } from '../src/sinks/FfmpegRecordingSink.js';
import type { VideoPacket, AudioChunk, MediaSink } from '../src/types/MediaSink.js';
import { getTestRom, hasTestRom } from './helpers/rom.js';

const execFileAsync = promisify(execFile);

interface FfprobeStream {
    codec_type: string;
    codec_name: string;
    width?: number;
    height?: number;
    r_frame_rate?: string;
    sample_rate?: string;
    channels?: number;
}

interface FfprobeOutput {
    streams?: FfprobeStream[];
    format?: {
        duration?: string;
    };
}

function resolveFfmpegBin(): string {
    if (process.env['FFMPEG_PATH']) return process.env['FFMPEG_PATH'];
    if (process.platform === 'win32') return 'ffmpeg';
    return fs.existsSync('/usr/bin/ffmpeg') ? '/usr/bin/ffmpeg' : 'ffmpeg';
}

function resolveFfprobeBin(): string {
    if (process.env['FFPROBE_PATH']) return process.env['FFPROBE_PATH'];
    if (process.platform === 'win32') return 'ffprobe';
    return fs.existsSync('/usr/bin/ffprobe') ? '/usr/bin/ffprobe' : 'ffprobe';
}

async function isBinaryAvailable(bin: string): Promise<boolean> {
    try {
        await execFileAsync(bin, ['-version']);
        return true;
    } catch {
        return false;
    }
}

test('Media Pipeline & Continuous A/V Recording (Slice 4)', async (t) => {
    if (!hasTestRom()) {
        t.skip('Test ROM fixture not found (set ROM_PATH to run)');
        return;
    }
    const testRom = getTestRom();
    let tempDir: string | null = null;
    try {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'node-mgba-test-'));
    } catch (err: unknown) {
        const error = err as { code?: string };
        if (error.code === 'EROFS' || error.code === 'EACCES') {
            tempDir = null;
        } else {
            throw err;
        }
    }

    t.after(() => {
        if (tempDir && fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    await t.test('1. Should dynamically extract native APU sample rate and frame-synchronized S16 stereo PCM', async () => {
        const emulator = new MgbaEmulator();
        try {
            await emulator.loadROM(testRom.path);

            const sampleRate = emulator.core.getAudioSampleRate();
            assert.equal(typeof sampleRate, 'number');
            assert.ok(sampleRate > 0, `Expected positive sample rate, got ${sampleRate}`);
            assert.equal(sampleRate, 131072, 'Expected GB hardware APU rate of 131072 Hz');

            // Step 10 frames and check audio packet format
            let totalAudioFrames = 0;
            for (let i = 0; i < 10; i++) {
                await emulator.step(1);
                const chunk = emulator.core.readAudioFrames();
                if (chunk) {
                    assert.equal(chunk.channels, 2, 'Must be stereo (2 channels)');
                    assert.equal(chunk.sampleRate, 131072);
                    assert.ok(chunk.sampleFrames > 0, 'Must produce sample frames');
                    assert.equal(chunk.buffer.length, chunk.sampleFrames * 4, 'Buffer size must equal sampleFrames * 4 bytes');
                    totalAudioFrames += chunk.sampleFrames;
                }
            }

            assert.ok(totalAudioFrames > 5000, `Expected > 5000 sample frames over 10 video frames, got ${totalAudioFrames}`);
        } finally {
            await emulator.close();
        }
    });

    await t.test('2. Should stream frame-synchronized video packets and audio chunks to registered MediaSinks', async () => {
        const emulator = new MgbaEmulator();
        const capturedVideos: VideoPacket[] = [];
        const capturedAudios: AudioChunk[] = [];

        const testSink: MediaSink = {
            name: 'test-collector-sink',
            onVideoFrame(packet: VideoPacket): void {
                capturedVideos.push(packet);
            },
            onAudioChunk(chunk: AudioChunk): void {
                capturedAudios.push(chunk);
            },
        };

        try {
            emulator.useMediaSink(testSink);
            await emulator.loadROM(testRom.path);

            await emulator.step(60);

            assert.equal(capturedVideos.length, 60, 'Must receive exactly 60 video packets');
            assert.ok(capturedAudios.length >= 55 && capturedAudios.length <= 65, `Expected ~60 audio chunks, got ${capturedAudios.length}`);

            for (const v of capturedVideos) {
                assert.equal(v.width, 160);
                assert.equal(v.height, 144);
                assert.equal(v.strideBytes, 640);
                assert.equal(v.buffer.length, 160 * 144 * 4);
            }

            for (const a of capturedAudios) {
                assert.equal(a.channels, 2);
                assert.equal(a.sampleRate, 131072);
                assert.equal(a.buffer.length, a.sampleFrames * 4);
            }

            // Test unregistering
            emulator.unregisterMediaSink('test-collector-sink');
            await emulator.step(10);
            assert.equal(capturedVideos.length, 60, 'Should not receive frames after unregistering');
        } finally {
            await emulator.close();
        }
    });

    await t.test('3. Should record a valid H.264/AAC MP4 video with synchronized audio via FfmpegRecordingSink', async (st) => {
        if (!tempDir) {
            st.skip('Skipping MP4 file recording test in read-only environment');
            return;
        }

        const ffmpegBin = resolveFfmpegBin();
        const ffprobeBin = resolveFfprobeBin();
        if (!(await isBinaryAvailable(ffmpegBin)) || !(await isBinaryAvailable(ffprobeBin))) {
            st.skip('Skipping: ffmpeg or ffprobe binary not available in environment');
            return;
        }

        const mp4Path = path.join(tempDir, 'test_slice4_recording.mp4');
        if (fs.existsSync(mp4Path)) {
            fs.unlinkSync(mp4Path);
        }

        const emulator = new MgbaEmulator();
        try {
            await emulator.loadROM(testRom.path);

            // Load savestate if available to guarantee in-game audio playback
            const ssPath = path.resolve('fixtures/turn_state.ss0');
            if (fs.existsSync(ssPath)) {
                emulator.loadState(ssPath);
            }

            const sampleRate = emulator.core.getAudioSampleRate();
            const recordingSink = new FfmpegRecordingSink({
                outputPath: mp4Path,
                sampleRate,
                overwrite: true,
                outputAudioSampleRate: 48000,
                ffmpegPath: ffmpegBin,
            });

            emulator.useMediaSink(recordingSink);

            // Record 180 frames (~3.01 seconds)
            await emulator.step(180);

            // Close emulator (which cleanly flushes and closes recordingSink)
            await emulator.close();

            assert.ok(fs.existsSync(mp4Path), 'MP4 output file must exist');
            const stats = fs.statSync(mp4Path);
            assert.ok(stats.size > 10000, `MP4 file too small: ${stats.size} bytes`);

            // Probe with ffprobe to verify valid container streams
            const { stdout } = await execFileAsync(ffprobeBin, [
                '-v', 'error',
                '-show_entries', 'stream=codec_type,codec_name,width,height,r_frame_rate,sample_rate,channels',
                '-show_entries', 'format=duration',
                '-of', 'json',
                mp4Path,
            ]);

            const probe = JSON.parse(stdout) as FfprobeOutput;
            assert.ok(probe.streams && probe.streams.length >= 2, 'Must contain video and audio streams');

            const videoStream = probe.streams.find(s => s.codec_type === 'video');
            const audioStream = probe.streams.find(s => s.codec_type === 'audio');

            assert.ok(videoStream, 'Missing video stream in MP4');
            assert.equal(videoStream.codec_name, 'h264');
            assert.equal(videoStream.width, 160);
            assert.equal(videoStream.height, 144);

            assert.ok(audioStream, 'Missing audio stream in MP4');
            assert.equal(audioStream.codec_name, 'aac');
            assert.equal(audioStream.channels, 2);
            assert.equal(audioStream.sample_rate, '48000');

            const duration = parseFloat(probe.format?.duration ?? '0');
            assert.ok(duration >= 2.5 && duration <= 3.5, `Expected ~3.0s duration, got ${duration}s`);
        } finally {
            if (fs.existsSync(mp4Path)) {
                fs.unlinkSync(mp4Path);
            }
            await emulator.close();
        }
    });

    await t.test('4. Should propagate media sink errors fail-fast during stepping', async () => {
        const emulator = new MgbaEmulator();
        const failingSink: MediaSink = {
            name: 'failing-sink',
            onVideoFrame(): void {
                throw new Error('Simulated media pipeline failure');
            },
        };

        try {
            emulator.useMediaSink(failingSink);
            await emulator.loadROM(testRom.path);

            await assert.rejects(
                async () => {
                    await emulator.step(1);
                },
                /Simulated media pipeline failure/,
            );
        } finally {
            await emulator.close();
        }
    });

    await t.test('5. Should enforce strict validation on media sink registration', async () => {
        const emulator = new MgbaEmulator();
        try {
            await emulator.loadROM(testRom.path);

            // 1. Invalid names
            assert.throws(() => {
                emulator.useMediaSink({ name: 'invalid\x00sink', onVideoFrame(): void {} });
            }, /MediaSink identity cannot contain control characters/i);

            // 2. Missing callbacks
            assert.throws(() => {
                emulator.useMediaSink({ name: 'empty-sink' });
            }, /must provide at least onVideoFrame or onAudioChunk/i);

            // 3. Duplicate registration
            const validSink: MediaSink = {
                name: 'valid-sink',
                onVideoFrame(): void {},
            };
            emulator.useMediaSink(validSink);
            assert.throws(() => {
                emulator.useMediaSink(validSink);
            }, /already registered/i);

            // 4. Unregister unknown sink
            assert.throws(() => {
                emulator.unregisterMediaSink('unknown-sink');
            }, /not registered/i);
        } finally {
            await emulator.close();
        }
    });
});

