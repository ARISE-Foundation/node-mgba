import assert from 'node:assert/strict';
import test from 'node:test';

import { WebAudioPlayer } from '../src/browser/WebAudioPlayer.js';
import type { BrowserAudioPacket } from '../src/browser/types.js';

// Mock Web Audio API for Node.js test environment
class MockAudioBufferSourceNode {
    public buffer: MockAudioBuffer | null = null;
    public playbackRate = { value: 1.0 };
    public onended: (() => void) | null = null;
    public isStarted = false;
    public isStopped = false;
    public isDisconnected = false;
    public startTime = 0;

    public connect(_dest: unknown): void {}
    public disconnect(): void {
        this.isDisconnected = true;
    }
    public start(when = 0): void {
        this.isStarted = true;
        this.startTime = when;
    }
    public stop(): void {
        this.isStopped = true;
        if (this.onended) this.onended();
    }
}

class MockAudioBuffer {
    public readonly length: number;
    public readonly duration: number;
    public readonly sampleRate: number;
    public readonly numberOfChannels: number;
    private channels: Float32Array[];

    constructor(channels: number, length: number, sampleRate: number) {
        this.numberOfChannels = channels;
        this.length = length;
        this.sampleRate = sampleRate;
        this.duration = length / sampleRate;
        this.channels = Array.from({ length: channels }, () => new Float32Array(length));
    }

    public getChannelData(ch: number): Float32Array {
        const channel = this.channels[ch];
        if (!channel) {
            throw new Error(`Channel index ${ch} out of bounds`);
        }
        return channel;
    }
}

class MockGainNode {
    public gain = {
        value: 1.0,
        setValueAtTime(val: number, _time: number): void {
            this.value = val;
        },
    };
    public connect(_dest: unknown): void {}
}

class MockAudioContext {
    public currentTime = 0;
    public sampleRate = 48000;
    public state: 'running' | 'suspended' | 'closed' = 'running';
    public destination = {};
    public createdSourceNodes: MockAudioBufferSourceNode[] = [];

    public createGain(): MockGainNode {
        return new MockGainNode();
    }

    public createBuffer(channels: number, length: number, sampleRate: number): MockAudioBuffer {
        return new MockAudioBuffer(channels, length, sampleRate);
    }

    public createBufferSource(): MockAudioBufferSourceNode {
        const node = new MockAudioBufferSourceNode();
        this.createdSourceNodes.push(node);
        return node;
    }

    public async resume(): Promise<void> {
        this.state = 'running';
    }

    public async close(): Promise<void> {
        this.state = 'closed';
    }
}

test('WebAudioPlayer Suite', async (t) => {
    let originalWindow: unknown;

    t.beforeEach(() => {
        originalWindow = (globalThis as Record<string, unknown>)['window'];
        (globalThis as Record<string, unknown>)['window'] = {
            AudioContext: MockAudioContext,
        };
    });

    t.afterEach(() => {
        (globalThis as Record<string, unknown>)['window'] = originalWindow;
    });

    await t.test('1. Should initialize with default and custom volume / jitter options', () => {
        const player = new WebAudioPlayer({ defaultVolume: 0.8, jitterBufferSeconds: 0.04 });
        assert.equal(player.volume, 0.8);

        player.setVolume(0.5);
        assert.equal(player.volume, 0.5);

        player.setVolume(1.5); // Should clamp to 1.0
        assert.equal(player.volume, 1.0);

        player.setVolume(-0.2); // Should clamp to 0.0
        assert.equal(player.volume, 0.0);
    });

    await t.test('2. Should fast-path 48kHz audio chunks with accurate PCM float values', () => {
        const player = new WebAudioPlayer({ defaultVolume: 1.0, jitterBufferSeconds: 0.04 });
        const ctx = player.getAudioContext() as unknown as MockAudioContext;
        assert.ok(ctx);

        // 48kHz stereo chunk with 480 samples (10ms)
        const sampleFrames = 480;
        const int16 = new Int16Array(sampleFrames * 2);
        for (let i = 0; i < sampleFrames; i++) {
            int16[i * 2] = 16384;     // Left channel ~ 0.5
            int16[i * 2 + 1] = -16384; // Right channel ~ -0.5
        }

        const packet: BrowserAudioPacket = {
            type: 'audio',
            frameIndex: 1,
            pts: 0.016,
            sampleRate: 48000,
            channels: 2,
            sampleFrames,
            buffer: new Uint8Array(int16.buffer),
        };

        player.playChunk(packet);

        assert.equal(ctx.createdSourceNodes.length, 1);
        const node = ctx.createdSourceNodes[0];
        assert.ok(node);
        assert.equal(node.isStarted, true);
        assert.equal(node.playbackRate.value, 1.0);
        assert.equal(node.startTime, 0.04); // currentTime(0) + jitterBuffer(0.04)

        const buf = node.buffer;
        assert.ok(buf);
        assert.equal(buf.length, sampleFrames);
        const ch0 = buf.getChannelData(0)[0];
        const ch1 = buf.getChannelData(1)[0];
        assert.ok(ch0 !== undefined && Math.abs(ch0 - 0.5) < 0.01);
        assert.ok(ch1 !== undefined && Math.abs(ch1 - (-0.5)) < 0.01);
    });

    await t.test('3. Should adaptively nudge playbackRate on buffer queue accumulation', () => {
        const player = new WebAudioPlayer({ defaultVolume: 1.0, jitterBufferSeconds: 0.04 });
        const ctx = player.getAudioContext() as unknown as MockAudioContext;

        const sampleFrames = 480; // 10ms chunk
        const int16 = new Int16Array(sampleFrames * 2);
        const packet: BrowserAudioPacket = {
            type: 'audio',
            frameIndex: 1,
            pts: 0.016,
            sampleRate: 48000,
            channels: 2,
            sampleFrames,
            buffer: new Uint8Array(int16.buffer),
        };

        // Feed 10 chunks while ctx.currentTime stays at 0 (simulating burst arriving faster than real-time)
        for (let i = 0; i < 10; i++) {
            player.playChunk(packet);
        }

        // The queue has accumulated ~140ms lead (target is 40ms, error ~ 100ms)
        const lastNode = ctx.createdSourceNodes[ctx.createdSourceNodes.length - 1];
        assert.ok(lastNode);
        assert.ok(lastNode.playbackRate.value > 1.0, `Playback rate (${lastNode.playbackRate.value}) should be > 1.0 to drain lead`);
        assert.ok(lastNode.playbackRate.value <= 1.02, `Playback rate (${lastNode.playbackRate.value}) should be bounded <= 1.02`);
    });

    await t.test('4. Should resynchronize cleanly upon buffer starvation / pause gap', () => {
        const player = new WebAudioPlayer({ defaultVolume: 1.0, jitterBufferSeconds: 0.04 });
        const ctx = player.getAudioContext() as unknown as MockAudioContext;

        const packet: BrowserAudioPacket = {
            type: 'audio',
            frameIndex: 1,
            pts: 0.016,
            sampleRate: 48000,
            channels: 2,
            sampleFrames: 480,
            buffer: new Uint8Array(960),
        };

        // Initial chunk at t = 0
        player.playChunk(packet);
        const firstNode = ctx.createdSourceNodes[0];
        assert.ok(firstNode);
        assert.equal(firstNode.startTime, 0.04);

        // Advance simulated time by 5 seconds (simulating AI reasoning pause)
        ctx.currentTime = 5.0;

        // Next chunk arrives after pause
        player.playChunk(packet);
        const secondNode = ctx.createdSourceNodes[1];
        assert.ok(secondNode);
        assert.equal(secondNode.startTime, 5.04); // Must cleanly resync to currentTime + jitterBuffer
        assert.equal(secondNode.playbackRate.value, 1.0);
    });

    await t.test('5. Should cleanly reset and close active nodes without throwing', () => {
        const player = new WebAudioPlayer();
        const ctx = player.getAudioContext() as unknown as MockAudioContext;
        const packet: BrowserAudioPacket = {
            type: 'audio',
            frameIndex: 1,
            pts: 0.016,
            sampleRate: 48000,
            channels: 2,
            sampleFrames: 480,
            buffer: new Uint8Array(960),
        };

        player.playChunk(packet);
        player.reset();
        player.close();
        assert.equal(ctx.state, 'closed');
    });

    await t.test('6. Excessive queue lead (>350ms) should stop and disconnect previously queued active nodes', () => {
        const player = new WebAudioPlayer({ defaultVolume: 1.0, jitterBufferSeconds: 0.04 });
        const ctx = player.getAudioContext() as unknown as MockAudioContext;

        const packet: BrowserAudioPacket = {
            type: 'audio',
            frameIndex: 1,
            pts: 0.016,
            sampleRate: 48000,
            channels: 2,
            sampleFrames: 4800, // 100ms chunk
            buffer: new Uint8Array(4800 * 4),
        };

        // Schedule 4 chunks of 100ms each while currentTime = 0 (queue lead becomes 400ms > 350ms)
        player.playChunk(packet);
        player.playChunk(packet);
        player.playChunk(packet);
        player.playChunk(packet);

        const initialNodes = [...ctx.createdSourceNodes];
        assert.equal(initialNodes.length, 4);

        // Send 5th chunk which triggers excessive lead (>350ms) resync
        player.playChunk(packet);

        // Previous nodes must be stopped and disconnected to avoid overlapping playback
        for (const node of initialNodes) {
            assert.equal(node.isStopped, true, 'Old active node should be stopped on excessive lead resync');
            assert.equal(node.isDisconnected, true, 'Old active node should be disconnected on excessive lead resync');
        }

        const fifthNode = ctx.createdSourceNodes[4];
        assert.ok(fifthNode);
        assert.equal(fifthNode.startTime, 0.04); // Resynchronized cleanly to now + jitterBuffer
    });

    await t.test('7. Should accurately resample 48kHz chunks for 44.1kHz AudioContext across boundaries', () => {
        const player = new WebAudioPlayer({ defaultVolume: 1.0, jitterBufferSeconds: 0.04 });
        const ctx = player.getAudioContext() as unknown as MockAudioContext;
        ctx.sampleRate = 44100; // Client soundcard at 44.1kHz

        const sampleFrames = 480; // 10ms chunk at 48kHz
        const int16 = new Int16Array(sampleFrames * 2);
        int16.fill(12000);

        const packet: BrowserAudioPacket = {
            type: 'audio',
            frameIndex: 1,
            pts: 0.016,
            sampleRate: 48000,
            channels: 2,
            sampleFrames,
            buffer: new Uint8Array(int16.buffer),
        };

        player.playChunk(packet);

        assert.equal(ctx.createdSourceNodes.length, 1);
        const node = ctx.createdSourceNodes[0];
        assert.ok(node);
        const buf = node.buffer;
        assert.ok(buf);
        assert.equal(buf.sampleRate, 44100);
        // Expected ~441 frames (44.1kHz for 10ms)
        const ch0 = buf.getChannelData(0)[0];
        assert.ok(ch0 !== undefined && Math.abs(ch0 - (12000 / 32768.0)) < 0.01);
    });

    await t.test('8. Suspended AudioContext should clear queued schedule and drop incoming chunks', () => {
        const player = new WebAudioPlayer({ defaultVolume: 1.0, jitterBufferSeconds: 0.04 });
        const ctx = player.getAudioContext() as unknown as MockAudioContext;

        const packet: BrowserAudioPacket = {
            type: 'audio',
            frameIndex: 1,
            pts: 0.016,
            sampleRate: 48000,
            channels: 2,
            sampleFrames: 480,
            buffer: new Uint8Array(960),
        };

        // Queue one chunk while running
        player.playChunk(packet);
        assert.equal(ctx.createdSourceNodes.length, 1);

        // Suspend context
        ctx.state = 'suspended';
        player.playChunk(packet);

        // No new nodes should be scheduled while suspended
        assert.equal(ctx.createdSourceNodes.length, 1);
    });

    await t.test('9. mode: "buffered" should retain all chunks in a fast burst without dropping lead or altering playbackRate', () => {
        const player = new WebAudioPlayer({ mode: 'buffered', defaultVolume: 1.0 });
        const ctx = player.getAudioContext() as unknown as MockAudioContext;

        const packet: BrowserAudioPacket = {
            type: 'audio',
            frameIndex: 1,
            pts: 0.016,
            sampleRate: 48000,
            channels: 2,
            sampleFrames: 4800, // 100ms chunk
            buffer: new Uint8Array(4800 * 4),
        };

        // Schedule 10 chunks of 100ms each in a fast burst (total 1000ms lead)
        for (let i = 0; i < 10; i++) {
            player.playChunk(packet);
        }

        // All 10 nodes must be created and active (none stopped or disconnected)
        assert.equal(ctx.createdSourceNodes.length, 10);
        for (const node of ctx.createdSourceNodes) {
            assert.equal(node.isStopped, false, 'Node in buffered mode must not be stopped');
            assert.equal(node.playbackRate.value, 1.0, 'Playback rate in buffered mode must remain exactly 1.0');
        }
    });
});

