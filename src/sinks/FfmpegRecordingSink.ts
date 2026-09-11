import { spawn, type ChildProcess } from 'node:child_process';
import type { Writable } from 'node:stream';
import path from 'node:path';
import fs from 'node:fs';
import { type MediaSink, type VideoPacket, type AudioChunk, parseSinkIdentity } from '../types/MediaSink.js';

export interface FfmpegRecordingOptions {
    readonly name?: string;
    readonly outputPath: string;
    readonly ffmpegPath?: string;
    readonly width?: number;
    readonly height?: number;
    readonly framerate?: string;
    readonly sampleRate?: number;
    readonly videoBitrate?: string;
    readonly crf?: number;
    readonly preset?: string;
    readonly audioBitrate?: string;
    readonly outputAudioSampleRate?: number;
    readonly overwrite?: boolean;
}

export class FfmpegRecordingSink implements MediaSink {
    public readonly name: string;
    private readonly outputPath: string;
    private readonly ffmpegPath: string;
    private readonly width: number;
    private readonly height: number;
    private readonly framerate: string;
    private readonly sampleRate: number;
    private readonly videoBitrate?: string | undefined;
    private readonly crf: number;
    private readonly preset: string;
    private readonly audioBitrate: string;
    private readonly outputAudioSampleRate: number;
    private readonly overwrite: boolean;

    private proc: ChildProcess | null = null;
    private videoPipe: Writable | null = null;
    private audioPipe: Writable | null = null;
    private stderrLogs: string[] = [];

    private isStarted = false;
    private isClosed = false;
    private isClosing = false;
    private closePromise: Promise<void> | null = null;
    private processExitPromise: Promise<number> | null = null;

    constructor(options: FfmpegRecordingOptions) {
        if (!options || typeof options.outputPath !== 'string' || options.outputPath.trim().length === 0) {
            throw new Error('FfmpegRecordingSink requires a valid outputPath string');
        }

        this.name = parseSinkIdentity(options.name ?? 'ffmpeg-recording-sink');
        this.outputPath = path.resolve(options.outputPath);
        this.ffmpegPath = options.ffmpegPath
            ?? process.env['FFMPEG_PATH']
            ?? (process.platform === 'win32'
                ? 'ffmpeg'
                : (fs.existsSync('/usr/bin/ffmpeg') ? '/usr/bin/ffmpeg' : 'ffmpeg'));
        this.width = options.width ?? 160;
        this.height = options.height ?? 144;
        this.framerate = options.framerate ?? '262144/4389';
        this.sampleRate = options.sampleRate ?? 131072;
        this.videoBitrate = options.videoBitrate;
        this.crf = options.crf ?? 18;
        this.preset = options.preset ?? 'veryfast';
        this.audioBitrate = options.audioBitrate ?? '192k';
        this.outputAudioSampleRate = options.outputAudioSampleRate ?? 48000;
        this.overwrite = options.overwrite ?? true;
    }

    private startProcess(): void {
        if (this.isStarted) return;
        this.isStarted = true;

        const dir = path.dirname(this.outputPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        const args: string[] = [
            '-hide_banner',
            '-loglevel', 'warning',
            ...(this.overwrite ? ['-y'] : ['-n']),
            // Input Video: pipe:3
            '-f', 'rawvideo',
            '-pix_fmt', 'rgba',
            '-s', `${this.width}x${this.height}`,
            '-framerate', this.framerate,
            '-thread_queue_size', '1024',
            '-i', 'pipe:3',
            // Input Audio: pipe:4
            '-f', 's16le',
            '-ar', String(this.sampleRate),
            '-ac', '2',
            '-thread_queue_size', '1024',
            '-i', 'pipe:4',
            // Video Output Encoding
            '-c:v', 'libx264',
            '-preset', this.preset,
            '-crf', String(this.crf),
            ...(this.videoBitrate ? ['-b:v', this.videoBitrate] : []),
            '-pix_fmt', 'yuv420p',
            // Audio Output Encoding
            '-c:a', 'aac',
            '-ar', String(this.outputAudioSampleRate),
            '-b:a', this.audioBitrate,
            '-movflags', '+faststart',
            this.outputPath,
        ];

        const proc = spawn(this.ffmpegPath, args, {
            shell: false,
            stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'],
        });

        this.proc = proc;
        this.videoPipe = proc.stdio[3] as Writable;
        this.audioPipe = proc.stdio[4] as Writable;

        if (this.videoPipe) {
            this.videoPipe.on('error', () => {
                // Ignore pipe errors after/during process exit
            });
        }

        if (this.audioPipe) {
            this.audioPipe.on('error', () => {
                // Ignore pipe errors after/during process exit
            });
        }

        if (proc.stderr) {
            proc.stderr.on('error', () => {
                // Ignore pipe errors on stderr
            });
            proc.stderr.setEncoding('utf8');
            proc.stderr.on('data', (chunk: string) => {
                const lines = chunk.split('\n').filter(Boolean);
                for (const l of lines) {
                    this.stderrLogs.push(l);
                    if (this.stderrLogs.length > 50) {
                        this.stderrLogs.shift();
                    }
                }
            });
        }

        this.processExitPromise = new Promise<number>((resolve, reject) => {
            proc.on('error', (err: Error) => {
                reject(new Error(`FFmpeg process failed to spawn: ${err.message}`));
            });

            proc.on('close', (code: number | null) => {
                const exitCode = code ?? 0;
                if (exitCode === 0) {
                    resolve(0);
                } else {
                    const tail = this.stderrLogs.join('\n');
                    reject(new Error(`FFmpeg exited with non-zero exit code ${exitCode}. Stderr:\n${tail}`));
                }
            });
        });
    }

    public onVideoFrame(packet: VideoPacket): void {
        if (this.isClosed || this.isClosing) {
            throw new Error('Cannot write video frame to closed FfmpegRecordingSink');
        }

        if (packet.width !== this.width || packet.height !== this.height) {
            throw new Error(
                `VideoPacket dimension mismatch: expected ${this.width}x${this.height}, received ${packet.width}x${packet.height}`,
            );
        }

        if (packet.strideBytes !== this.width * 4) {
            throw new Error(
                `VideoPacket stride mismatch: expected ${this.width * 4} tightly-packed bytes, received ${packet.strideBytes}`,
            );
        }

        if (!this.isStarted) {
            this.startProcess();
        }

        const pipe = this.videoPipe;
        if (!pipe || pipe.destroyed) {
            throw new Error('FFmpeg video input pipe is not writable');
        }

        pipe.write(packet.buffer);
    }

    public onAudioChunk(chunk: AudioChunk): void {
        if (this.isClosed || this.isClosing) {
            throw new Error('Cannot write audio chunk to closed FfmpegRecordingSink');
        }

        if (chunk.channels !== 2) {
            throw new Error(`AudioChunk channel mismatch: expected 2 channels, received ${chunk.channels}`);
        }

        if (chunk.sampleRate !== this.sampleRate) {
            throw new Error(
                `AudioChunk sample rate mismatch: expected ${this.sampleRate} Hz, received ${chunk.sampleRate} Hz`,
            );
        }

        const expectedBytes = chunk.sampleFrames * 4;
        if (chunk.buffer.length !== expectedBytes) {
            throw new Error(
                `AudioChunk buffer length mismatch: expected ${expectedBytes} bytes for ${chunk.sampleFrames} sample frames, received ${chunk.buffer.length}`,
            );
        }

        if (!this.isStarted) {
            this.startProcess();
        }

        const pipe = this.audioPipe;
        if (!pipe || pipe.destroyed) {
            throw new Error('FFmpeg audio input pipe is not writable');
        }

        pipe.write(chunk.buffer);
    }

    public async close(): Promise<void> {
        if (this.closePromise) return this.closePromise;

        this.isClosing = true;
        this.closePromise = (async () => {
            try {
                if (!this.isStarted || !this.proc) {
                    return;
                }

                // End video and audio input streams
                if (this.videoPipe && !this.videoPipe.destroyed) {
                    this.videoPipe.end();
                }
                if (this.audioPipe && !this.audioPipe.destroyed) {
                    this.audioPipe.end();
                }

                // Await process exit with 5s timeout
                if (this.processExitPromise) {
                    let timer: ReturnType<typeof setTimeout> | null = null;
                    const timeoutPromise = new Promise<never>((_, reject) => {
                        timer = setTimeout(() => {
                            if (this.proc && !this.proc.killed) {
                                this.proc.kill('SIGKILL');
                            }
                            reject(new Error('FFmpeg process termination timed out after 5000ms'));
                        }, 5000);
                    });

                    try {
                        await Promise.race([this.processExitPromise, timeoutPromise]);
                    } finally {
                        if (timer) clearTimeout(timer);
                    }
                }
            } finally {
                this.isClosing = false;
                this.isClosed = true;
                this.proc = null;
                this.videoPipe = null;
                this.audioPipe = null;
            }
        })();

        return this.closePromise;
    }
}

