import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { EmulatorController, encodeKeyframe, MgbaEmulator, press, wait } from '../src/index.js';
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

    await t.test('4. encodeKeyframe should produce valid PNG buffer', async () => {
        const kf = emulator.collector.sampleFrame(emulator.core, { triggerReason: 'test_sample', force: true });
        assert.ok(kf !== null);
        const png = await encodeKeyframe(kf);
        assert.ok(Buffer.isBuffer(png));
        assert.ok(png.length > 0);
        // PNG header magic bytes: 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A
        assert.deepEqual(
            Array.from(png.subarray(0, 8)),
            [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A],
        );

        const scaledPng = await encodeKeyframe(kf, { scale: 2 });
        const meta = await sharp(scaledPng).metadata();
        assert.equal(meta.width, kf.width * 2);
        assert.equal(meta.height, kf.height * 2);
    });

    await t.test('5. EmulatorController executeSequence and pressButtons forward turnResult and keyframes', async () => {
        const controller = new EmulatorController({
            romPath,
            realtime: false,
        });
        await controller.initialize();

        const handle = controller.pressButtons([{ button: 'A', holdFrames: 8, releaseFrames: 4 }]);
        const result = await handle.promise;

        assert.ok(result.actionsExecuted > 0);
        assert.ok(result.turnResult !== undefined, 'result.turnResult must be defined');
        assert.ok(Array.isArray(result.turnResult.keyframes), 'result.turnResult.keyframes must be an array');
        assert.ok(result.turnResult.keyframes.length >= 2, 'Must capture at least pre_action and post_action');
        assert.equal(result.turnResult.keyframes[0].triggerReason, 'pre_action');

        await controller.close();
    });

    emulator.close();
});
