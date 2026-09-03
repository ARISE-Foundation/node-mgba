import { Buffer } from 'node:buffer';
import sharp from 'sharp';
import type { VideoPacket } from '../types/MediaSink.js';

export interface ImageEncodeOptions {
    readonly format?: 'png' | 'webp' | 'jpeg';
    readonly lossless?: boolean;
    readonly quality?: number;
    readonly effort?: number;
}

export async function encodeVideoPacket(
    packet: VideoPacket,
    options: ImageEncodeOptions = {},
): Promise<Buffer> {
    const rawFormat = options.format ?? 'png';
    const format = typeof rawFormat === 'string' ? rawFormat.trim().toLowerCase() : rawFormat;
    const width = packet.width || 160;
    const height = packet.height || 144;
    const stride = packet.strideBytes ?? width * 4;

    let rawBuffer: Uint8Array = packet.buffer;
    if (stride !== width * 4 && rawBuffer.byteLength >= height * stride) {
        const contiguous = new Uint8Array(width * height * 4);
        for (let y = 0; y < height; y++) {
            const row = rawBuffer.subarray(y * stride, y * stride + width * 4);
            contiguous.set(row, y * width * 4);
        }
        rawBuffer = contiguous;
    }

    const pipeline = sharp(rawBuffer, {
        raw: {
            width,
            height,
            channels: 4,
        },
    });

    switch (format) {
        case 'webp':
            return pipeline
                .webp({
                    lossless: options.lossless ?? true,
                    quality: options.quality ?? 80,
                    effort: options.effort ?? 4,
                })
                .toBuffer();
        case 'jpeg':
            return pipeline
                .jpeg({
                    quality: options.quality ?? 80,
                })
                .toBuffer();
        case 'png':
            return pipeline
                .png({
                    effort: options.effort ?? 4,
                })
                .toBuffer();
        default:
            throw new Error(`Unsupported image format: ${String(options.format)}`);
    }
}
