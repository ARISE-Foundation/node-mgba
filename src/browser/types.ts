export interface BrowserFramePacket {
    readonly type: 'frame';
    readonly width: number;
    readonly height: number;
    readonly strideBytes: number;
    readonly frameIndex: number;
    readonly pts?: number;
    readonly bufferBase64?: string;
    readonly buffer?: Uint8Array | ArrayBuffer;
}

export interface BrowserAudioPacket {
    readonly type: 'audio';
    readonly frameIndex: number;
    readonly pts: number;
    readonly sampleRate: number;
    readonly channels: 2;
    readonly sampleFrames: number;
    readonly bufferBase64?: string;
    readonly buffer?: Uint8Array | ArrayBuffer;
}

export interface CanvasStreamRendererOptions {
    readonly defaultWidth?: number;
    readonly defaultHeight?: number;
}

export type WebAudioPlayerMode = 'realtime' | 'buffered';

export interface WebAudioPlayerOptions {
    readonly mode?: WebAudioPlayerMode;
    readonly jitterBufferSeconds?: number;
    readonly defaultVolume?: number;
    readonly enableLogging?: boolean;
    readonly maxLeadSeconds?: number | null;
    readonly adaptiveRate?: boolean;
}

