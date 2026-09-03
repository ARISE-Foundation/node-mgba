import test from 'node:test';
import assert from 'node:assert/strict';
import { MgbaEmulator, press, wait } from '../src/index.js';
import { getTestRomPath, hasTestRom } from './helpers/rom.js';

test('Keyframe Pipeline & Action Anchor Invariants', async (t) => {
    if (!hasTestRom()) {
        t.skip('Test ROM fixture not found (set ROM_PATH to run)');
        return;
    }
    const romPath = getTestRomPath();
    const emulator = new MgbaEmulator({
        collector: { maxKeyframes: 24, minIntervalFrames: 12 },
    });
    await emulator.loadROM(romPath);

    await t.test('1. Should guarantee exact 160x144 dimensions, 92160-byte buffers, and opaque alpha', async () => {
        const frame = emulator.core.getVideoFrame();
        assert.equal(frame.width, 160);
        assert.equal(frame.height, 144);
        assert.equal(frame.strideBytes, 640); // 160 * 4 bytes
        assert.equal(frame.buffer.length, 92160);

        // Verify all pixels have Alpha = 255
        for (let i = 3; i < frame.buffer.length; i += 4) {
            assert.equal(frame.buffer[i], 255, `Pixel at index ${i} has non-opaque alpha: ${frame.buffer[i]}`);
        }
    });

    await t.test('2. Should preserve action boundary anchors in strict sequence order', async () => {
        // Step into game to reach active screen
        await emulator.step(400);

        const actions = [
            press('START', 16, 8),
            wait(10),
            press('A', 16, 8),
            press('B', 16, 8),
        ];

        const turnResult = await emulator.stepSequence(actions, {
            postStabilizationFrames: 16,
        });

        assert.ok(turnResult.keyframes.length >= 5, `Expected at least 5 keyframes, got ${turnResult.keyframes.length}`);

        // Verify first and last anchors
        const firstKf = turnResult.keyframes[0];
        const lastKf = turnResult.keyframes[turnResult.keyframes.length - 1];

        assert.ok(firstKf !== undefined);
        assert.ok(lastKf !== undefined);
        assert.equal(firstKf.triggerReason, 'pre_action');
        assert.equal(lastKf.triggerReason, 'post_action');
        assert.equal(firstKf.timestampMs, 0, `Pre-action anchor timestamp must be 0ms relative to sequence start (got ${firstKf.timestampMs}ms)`);
        assert.ok(lastKf.timestampMs > 0, 'Post-action anchor timestamp must be positive');
        assert.ok(
            lastKf.timestampMs <= Math.ceil(turnResult.durationFrames * 17),
            `Post-action anchor timestamp (${lastKf.timestampMs}ms) exceeds sequence duration (${turnResult.durationFrames} frames)`,
        );

        // Verify action anchor triggers exist
        const reasons = turnResult.keyframes.map(k => k.triggerReason);
        assert.ok(reasons.includes('action_1:press_START'), 'Missing action_1:press_START anchor');
        assert.ok(reasons.includes('action_2:wait'), 'Missing action_2:wait anchor');
        assert.ok(reasons.includes('action_3:press_A'), 'Missing action_3:press_A anchor');
        assert.ok(reasons.includes('action_4:press_B'), 'Missing action_4:press_B anchor');

        // Verify strictly non-decreasing frame counters and timestamps
        for (let i = 0; i < turnResult.keyframes.length - 1; i++) {
            const curr = turnResult.keyframes[i];
            const next = turnResult.keyframes[i + 1];
            assert.ok(curr !== undefined && next !== undefined);
            assert.ok(
                next.frameIndex >= curr.frameIndex,
                `Frame index out of order: #${next.frameIndex} < #${curr.frameIndex}`,
            );
            assert.ok(
                next.timestampMs >= curr.timestampMs,
                `Timestamp out of order: ${next.timestampMs} < ${curr.timestampMs}`,
            );
        }

        // Verify buffer specifications across every keyframe
        for (const kf of turnResult.keyframes) {
            assert.equal(kf.width, 160);
            assert.equal(kf.height, 144);
            assert.equal(kf.buffer.length, 92160);
            assert.equal(typeof kf.hash, 'string');
            assert.ok(kf.hash.length >= 8);
        }
    });

    await t.test('3. Should not produce redundant consecutive visual_change and action anchor keyframes with identical hashes', async () => {
        const turnResult = await emulator.stepSequence([
            press('START', 16, 8),
            wait(20),
        ]);

        for (let i = 0; i < turnResult.keyframes.length - 1; i++) {
            const curr = turnResult.keyframes[i];
            const next = turnResult.keyframes[i + 1];
            if (curr && next && curr.triggerReason === 'visual_change') {
                assert.notEqual(
                    curr.hash,
                    next.hash,
                    `Redundant visual_change keyframe #${curr.frameIndex} matches succeeding anchor #${next.frameIndex} (${next.triggerReason}) with hash ${curr.hash}`,
                );
            }
        }
    });

    emulator.close();
});
