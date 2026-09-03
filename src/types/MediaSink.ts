import type { Buffer } from 'node:buffer';

export interface VideoPacket {
    readonly frameIndex: number;
    readonly pts: number;
    readonly width: number;
    readonly height: number;
    readonly strideBytes: number;
    readonly buffer: Buffer | Uint8Array;
}

export interface AudioChunk {
    readonly frameIndex: number;
    readonly pts: number;
    readonly sampleRate: number;
    readonly channels: 2;
    readonly sampleFrames: number;
    readonly buffer: Buffer | Uint8Array;
}

export interface MediaSink {
    readonly name: string;
    onVideoFrame?(packet: VideoPacket): Promise<void> | void;
    onAudioChunk?(chunk: AudioChunk): Promise<void> | void;
    close?(): Promise<void> | void;
}

export function parseSinkIdentity(name: unknown): string {
    if (typeof name !== 'string') {
        throw new Error(`MediaSink identity must be a string, received ${typeof name}`);
    }
    const trimmed = name.trim();
    if (trimmed.length === 0 || trimmed.length > 128) {
        throw new Error(`MediaSink identity must be between 1 and 128 characters, received "${name}" (${trimmed.length} chars)`);
    }
    for (let i = 0; i < trimmed.length; i++) {
        const code = trimmed.charCodeAt(i);
        if (code <= 0x1F || code === 0x7F) {
            throw new Error(`MediaSink identity cannot contain control characters: "${name}"`);
        }
    }
    return trimmed;
}
