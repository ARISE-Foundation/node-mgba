import type { MediaSink, VideoPacket, AudioChunk } from '../types/MediaSink.js';

export interface WebSocketClientLike {
    readonly readyState: number;
    readonly bufferedAmount?: number;
    send(data: string | Buffer | Uint8Array, cb?: (err?: Error) => void): void;
}

export interface WebSocketMediaSinkOptions {
    readonly name?: string;
    readonly clients: Iterable<WebSocketClientLike> | (() => Iterable<WebSocketClientLike>);
    readonly filterClient?: ((client: WebSocketClientLike, type: 'video' | 'audio') => boolean) | undefined;
    readonly maxVideoBufferedBytes?: number;
    readonly maxAudioBufferedBytes?: number;
    readonly formatAudioPayload?: (chunk: AudioChunk) => unknown;
    readonly formatVideoPayload?: ((packet: VideoPacket) => unknown) | undefined;
}

export class WebSocketMediaSink implements MediaSink {
    public readonly name: string;
    private readonly clientsSource: Iterable<WebSocketClientLike> | (() => Iterable<WebSocketClientLike>);
    private readonly filterClient?: ((client: WebSocketClientLike, type: 'video' | 'audio') => boolean) | undefined;
    private readonly maxVideoBufferedBytes: number;
    private readonly maxAudioBufferedBytes: number;
    private readonly formatAudioPayload: (chunk: AudioChunk) => unknown;
    private readonly formatVideoPayload?: ((packet: VideoPacket) => unknown) | undefined;

    constructor(options: WebSocketMediaSinkOptions) {
        this.name = options.name ?? 'websocket-media-sink';
        this.clientsSource = options.clients;
        this.filterClient = options.filterClient;

        this.maxVideoBufferedBytes = options.maxVideoBufferedBytes ?? 512 * 1024; // 512 KB default
        this.maxAudioBufferedBytes = options.maxAudioBufferedBytes ?? 1024 * 1024; // 1 MB default

        this.formatAudioPayload =
            options.formatAudioPayload ??
            ((chunk: AudioChunk) => ({
                type: 'audio',
                frameIndex: chunk.frameIndex,
                pts: chunk.pts,
                sampleRate: chunk.sampleRate,
                channels: chunk.channels,
                sampleFrames: chunk.sampleFrames,
                bufferBase64: chunk.buffer.toString('base64'),
            }));

        this.formatVideoPayload = options.formatVideoPayload;
    }

    private getClients(): Iterable<WebSocketClientLike> {
        if (typeof this.clientsSource === 'function') {
            return this.clientsSource();
        }
        return this.clientsSource;
    }

    public onAudioChunk(chunk: AudioChunk): void {
        let eligibleClients: WebSocketClientLike[] | null = null;

        try {
            for (const client of this.getClients()) {
                try {
                    if (client.readyState !== 1) continue; // 1 = OPEN
                    if (client.bufferedAmount !== undefined && client.bufferedAmount > this.maxAudioBufferedBytes) {
                        console.warn(`[${this.name}] Dropped audio chunk: client bufferedAmount (${client.bufferedAmount} bytes) exceeded threshold (${this.maxAudioBufferedBytes} bytes)`);
                        continue;
                    }
                    if (this.filterClient && !this.filterClient(client, 'audio')) {
                        continue;
                    }
                    if (!eligibleClients) eligibleClients = [];
                    eligibleClients.push(client);
                } catch (clientErr) {
                    console.warn(`[${this.name}] Error inspecting audio client:`, clientErr);
                }
            }
        } catch (err) {
            console.warn(`[${this.name}] Error determining eligible audio clients:`, err);
            return;
        }

        if (!eligibleClients || eligibleClients.length === 0) return;

        let payloadStr: string;
        try {
            const payloadObj = this.formatAudioPayload(chunk);
            if (payloadObj === null || payloadObj === undefined) return;
            payloadStr = typeof payloadObj === 'string' ? payloadObj : JSON.stringify(payloadObj);
        } catch (err) {
            console.warn(`[${this.name}] Error formatting audio chunk:`, err);
            return;
        }

        for (const client of eligibleClients) {
            try {
                client.send(payloadStr, (err?: Error) => {
                    if (err) {
                        console.warn(`[${this.name}] WebSocket audio send error:`, err.message);
                    }
                });
            } catch (err) {
                console.warn(`[${this.name}] WebSocket audio send exception:`, err);
            }
        }
    }

    public onVideoFrame(packet: VideoPacket): void {
        if (!this.formatVideoPayload) return;

        let eligibleClients: WebSocketClientLike[] | null = null;

        try {
            for (const client of this.getClients()) {
                try {
                    if (client.readyState !== 1) continue;
                    if (client.bufferedAmount !== undefined && client.bufferedAmount > this.maxVideoBufferedBytes) {
                        continue;
                    }
                    if (this.filterClient && !this.filterClient(client, 'video')) {
                        continue;
                    }
                    if (!eligibleClients) eligibleClients = [];
                    eligibleClients.push(client);
                } catch (clientErr) {
                    console.warn(`[${this.name}] Error inspecting video client:`, clientErr);
                }
            }
        } catch (err) {
            console.warn(`[${this.name}] Error determining eligible video clients:`, err);
            return;
        }

        if (!eligibleClients || eligibleClients.length === 0) return;

        let payloadStr: string;
        try {
            const payloadObj = this.formatVideoPayload(packet);
            if (payloadObj === null || payloadObj === undefined) return;
            payloadStr = typeof payloadObj === 'string' ? payloadObj : JSON.stringify(payloadObj);
        } catch (err) {
            console.warn(`[${this.name}] Error formatting video packet:`, err);
            return;
        }

        for (const client of eligibleClients) {
            try {
                client.send(payloadStr, (err?: Error) => {
                    if (err) {
                        console.warn(`[${this.name}] WebSocket video send error:`, err.message);
                    }
                });
            } catch (err) {
                console.warn(`[${this.name}] WebSocket video send exception:`, err);
            }
        }
    }

    public close(): void {
        // No persistent resources to release
    }
}
