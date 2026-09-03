import type { BrowserFramePacket, CanvasStreamRendererOptions } from './types.js';

export class CanvasStreamRenderer {
    private canvas: HTMLCanvasElement | null = null;
    private ctx: CanvasRenderingContext2D | null = null;
    private imgData: ImageData | null = null;
    private lastRenderedFrameIndex = -1;
    private rafId: number | null = null;
    private pendingFrame: BrowserFramePacket | null = null;
    private isRunning = false;
    private decodeBuffer: Uint8Array | null = null;

    private readonly defaultWidth: number;
    private readonly defaultHeight: number;

    constructor(options: CanvasStreamRendererOptions = {}) {
        this.defaultWidth = options.defaultWidth ?? 160;
        this.defaultHeight = options.defaultHeight ?? 144;
    }

    public attach(canvas: HTMLCanvasElement): void {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d', { alpha: false });
        if (this.ctx) {
            this.ctx.imageSmoothingEnabled = false;
        }
        this.startLoop();
    }

    public detach(): void {
        this.stopLoop();
        this.canvas = null;
        this.ctx = null;
        this.imgData = null;
        this.pendingFrame = null;
        this.lastRenderedFrameIndex = -1;
        this.decodeBuffer = null;
    }

    public reset(): void {
        this.pendingFrame = null;
        this.lastRenderedFrameIndex = -1;
    }

    public submitFrame(frame: BrowserFramePacket): void {
        this.pendingFrame = frame;
    }

    private startLoop(): void {
        if (this.isRunning) return;
        this.isRunning = true;

        const render = () => {
            if (!this.isRunning) return;
            this.renderPendingFrame();
            this.rafId = requestAnimationFrame(render);
        };

        this.rafId = requestAnimationFrame(render);
    }

    private stopLoop(): void {
        this.isRunning = false;
        if (this.rafId !== null) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }
    }

    private renderPendingFrame(): void {
        if (!this.pendingFrame || !this.canvas) {
            return;
        }

        const frame = this.pendingFrame;
        if (frame.frameIndex === this.lastRenderedFrameIndex && this.imgData) {
            return;
        }

        if (!this.ctx) {
            this.ctx = this.canvas.getContext('2d', { alpha: false });
            if (this.ctx) {
                this.ctx.imageSmoothingEnabled = false;
            }
        }
        if (!this.ctx) {
            return;
        }

        const width = frame.width || this.defaultWidth;
        const height = frame.height || this.defaultHeight;

        if (!this.imgData || this.imgData.width !== width || this.imgData.height !== height) {
            this.canvas.width = width;
            this.canvas.height = height;
            this.imgData = this.ctx.createImageData(width, height);
        }

        try {
            let rawBytes: Uint8Array;

            if (frame.buffer instanceof Uint8Array) {
                rawBytes = frame.buffer;
            } else if (frame.buffer instanceof ArrayBuffer) {
                rawBytes = new Uint8Array(frame.buffer);
            } else if (typeof frame.bufferBase64 === 'string') {
                const binaryString = atob(frame.bufferBase64);
                const len = binaryString.length;
                if (!this.decodeBuffer || this.decodeBuffer.length < len) {
                    this.decodeBuffer = new Uint8Array(len);
                }
                rawBytes = this.decodeBuffer;
                for (let i = 0; i < len; i++) {
                    rawBytes[i] = binaryString.charCodeAt(i);
                }
            } else {
                return;
            }

            const stride = frame.strideBytes ?? width * 4;
            const { data } = this.imgData;

            if (stride === width * 4 && rawBytes.length >= width * height * 4) {
                for (let i = 0; i < width * height * 4; i += 4) {
                    data[i] = rawBytes[i] ?? 0;
                    data[i + 1] = rawBytes[i + 1] ?? 0;
                    data[i + 2] = rawBytes[i + 2] ?? 0;
                    data[i + 3] = 255;
                }
            } else {
                // Unpack row-by-row respecting stride
                for (let y = 0; y < height; y++) {
                    const srcRowOffset = y * stride;
                    const dstRowOffset = y * width * 4;
                    for (let x = 0; x < width; x++) {
                        const srcIdx = srcRowOffset + x * 4;
                        const dstIdx = dstRowOffset + x * 4;
                        data[dstIdx] = rawBytes[srcIdx] ?? 0;
                        data[dstIdx + 1] = rawBytes[srcIdx + 1] ?? 0;
                        data[dstIdx + 2] = rawBytes[srcIdx + 2] ?? 0;
                        data[dstIdx + 3] = 255;
                    }
                }
            }

            this.ctx.putImageData(this.imgData, 0, 0);
            this.lastRenderedFrameIndex = frame.frameIndex;
        } catch (err) {
            console.warn('[CanvasStreamRenderer] Error rendering frame:', err);
        }
    }
}
