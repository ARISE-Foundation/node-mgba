import test from 'node:test';
import assert from 'node:assert/strict';
import { Mgba, MgbaInstance, SnapshotMemoryReader, GamePlugin, type MemoryReader } from '../src/index.js';
import { getTestRomPath, hasTestRom } from './helpers/rom.js';

test('Mgba Public Modernized Facade Suite', async (t) => {
    if (!hasTestRom()) {
        t.skip('Test ROM fixture not found (set ROM_PATH to run)');
        return;
    }
    const romPath = getTestRomPath();

    await t.test('1. Mgba.load should initialize and expose console hardware metadata', async () => {
        const emu = await Mgba.load(romPath);
        try {
            assert.ok(['DMG', 'CGB', 'AGB'].includes(emu.console.model));
            assert.ok(emu.console.title.length > 0);
            assert.equal(typeof emu.console.width, 'number');
            assert.equal(typeof emu.console.height, 'number');
            assert.ok(emu.console.width === 160 || emu.console.width === 240);
        } finally {
            await emu.close();
        }
    });

    await t.test('2. emu.screen should provide raw frames, PNG encoding, and VRAM/OAM buffers', async () => {
        const emu = await Mgba.load(romPath);
        try {
            await emu.controls.tick(5);
            const frame = await emu.screen.frame();
            assert.equal(frame.frameIndex, 5);
            assert.ok(Buffer.isBuffer(frame.buffer));

            const pngBuffer = await emu.screen.toPng();
            assert.ok(Buffer.isBuffer(pngBuffer));
            assert.ok(pngBuffer.length > 100);
            // Verify PNG magic bytes
            assert.equal(pngBuffer[0], 0x89);
            assert.equal(pngBuffer[1], 0x50);
            assert.equal(pngBuffer[2], 0x4E);
            assert.equal(pngBuffer[3], 0x47);

            const vram = await emu.screen.vram();
            assert.ok(Buffer.isBuffer(vram));
            assert.ok(vram.length >= 0x2000);

            const oam = await emu.screen.oam();
            assert.ok(Buffer.isBuffer(oam));
            assert.ok(oam.length >= 160);

            const sprites = await emu.screen.sprites();
            assert.ok(sprites.length >= 40);
        } finally {
            await emu.close();
        }
    });

    await t.test('3. emu.memory should support atomic reads, batch reads, and slicing', async () => {
        const emu = await Mgba.load(romPath);
        try {
            await emu.controls.tick(5);
            const byte = await emu.memory.read8(0x0100);
            assert.equal(typeof byte, 'number');

            const batch = await emu.memory.readBatch([
                { address: 0x0100, type: 'u8' },
                { address: 0x0104, type: 'u32le' },
            ]);
            assert.equal(batch.length, 2);
            assert.equal(typeof batch[0], 'number');
            assert.equal(typeof batch[1], 'number');

            const slice = await emu.memory.slice(0x0100, 16);
            assert.ok(Buffer.isBuffer(slice));
            assert.equal(slice.length, 16);
        } finally {
            await emu.close();
        }
    });

    await t.test('4. emu.states should support in-memory StateHandles and restore safely', async () => {
        const emu = await Mgba.load(romPath);
        try {
            await emu.controls.tick(10);
            const handle10 = await emu.states.save();
            assert.ok(handle10.id.startsWith('state_'));
            assert.equal(handle10.frameIndex, 10);
            assert.ok(handle10.byteSize > 1000);

            await emu.controls.tick(20);
            const currentFrame = await emu.console.getFrameCounter();
            assert.equal(currentFrame, 30);

            const restored = await emu.states.restore(handle10);
            assert.equal(restored, true);
            const restoredFrame = await emu.console.getFrameCounter();
            assert.equal(restoredFrame, 10);
        } finally {
            await emu.close();
        }
    });

    await t.test('5. emu.observe should capture synchronized screen + memory descriptors', async () => {
        const emu = await Mgba.load(romPath);
        try {
            await emu.controls.tick(10);
            const obs = await emu.observe({
                screen: true,
                reads: [
                    { address: 0x0100, type: 'u8', key: 'entryPoint' },
                ],
            });
            assert.equal(obs.frameIndex, 10);
            assert.ok(obs.screenBuffer);
            assert.equal(typeof obs.data['entryPoint'], 'number');
        } finally {
            await emu.close();
        }
    });

    await t.test('6. emu.use should install host single-file plugins', async () => {
        const emu = await Mgba.load(romPath);
        try {
            let disposed = false;
            class CustomTestPlugin {
                public static readonly pluginName = 'custom-test-plugin';
                constructor(private instance: MgbaInstance) {}

                async getMagicValue() {
                    return this.instance.memory.read8(0x0100);
                }

                dispose() {
                    disposed = true;
                }
            }

            const api = await emu.use(CustomTestPlugin);
            const magic = await api.getMagicValue();
            assert.equal(typeof magic, 'number');

            await emu.close();
            assert.equal(disposed, true);
        } catch (err) {
            await emu.close();
            throw err;
        }
    });

    await t.test('6b. emu.use should support GamePlugin subclasses with automatic getState and snapshotting', async () => {
        const emu = await Mgba.load(romPath);
        try {
            interface TestGameState {
                entryByte: number;
            }

            class CustomGamePlugin extends GamePlugin<TestGameState> {
                public static override readonly pluginName = 'custom-game-plugin';
                public static override readonly supportedModels = ['DMG', 'CGB', 'SGB'] as const;

                public static decode(mem: MemoryReader): TestGameState {
                    return {
                        entryByte: mem.readU8(0x0100),
                    };
                }
            }

            const gamePlugin = await emu.use(CustomGamePlugin);
            const state = await gamePlugin.getState();
            assert.equal(typeof state.entryByte, 'number');

            await emu.close();
        } catch (err) {
            await emu.close();
            throw err;
        }
    });

    await t.test('7. emu.memory.write8 should directly write byte to WRAM', async () => {
        const emu = await Mgba.load(romPath);
        try {
            await emu.controls.tick(5);
            // Write to WRAM at 0xC500
            await emu.memory.write8(0xC500, 0x42);
            const readVal = await emu.memory.read8(0xC500);
            assert.equal(readVal, 0x42);

            await emu.memory.write8(0xC500, 0x99);
            const readVal2 = await emu.memory.read8(0xC500);
            assert.equal(readVal2, 0x99);
        } finally {
            await emu.close();
        }
    });

    await t.test('8. emu.screen.inspect should return combined sprites and tilemaps', async () => {
        const emu = await Mgba.load(romPath);
        try {
            await emu.controls.tick(10);
            const inspection = await emu.screen.inspect();
            assert.ok(Array.isArray(inspection.sprites));
            assert.ok(inspection.bgTilemap);
            assert.equal(inspection.bgTilemap.width, 32);
            assert.equal(inspection.bgTilemap.height, 32);
        } finally {
            await emu.close();
        }
    });

    await t.test('9. emu.waitFor should resolve on condition match and abort gracefully', async () => {
        const emu = await Mgba.load(romPath);
        try {
            await emu.controls.tick(5);
            // Write a test value at 0xC600
            await emu.memory.write8(0xC600, 0x07);

            // Test declarative waitFor
            await emu.waitFor({ address: 0xC600, value: 0x07, op: 'eq' }, { timeoutFrames: 10 });

            // Test predicate waitFor
            await emu.waitFor(async (instance) => {
                const val = await instance.memory.read8(0xC600);
                return val === 0x07;
            }, { timeoutFrames: 10 });
        } finally {
            await emu.close();
        }
    });

    await t.test('10. emu.states should emit stateRestore event upon restore', async () => {
        const emu = await Mgba.load(romPath);
        try {
            await emu.controls.tick(10);
            const handle = await emu.states.save();

            let restoreEventReceived = false;
            emu.on('stateRestore', (evt: { frameIndex: number; handleId: string }) => {
                if (evt.handleId === handle.id) {
                    restoreEventReceived = true;
                }
            });

            await emu.controls.tick(10);
            await emu.states.restore(handle);
            assert.equal(restoreEventReceived, true);
        } finally {
            await emu.close();
        }
    });

    await t.test('11. emu.waitFor should reject immediately if AbortSignal is aborted', async () => {
        const emu = await Mgba.load(romPath);
        try {
            const controller = new AbortController();
            controller.abort(new Error('TestAbortSignal'));
            await assert.rejects(
                emu.waitFor({ address: 0xC600, value: 0x99, op: 'eq' }, { timeoutFrames: 100, signal: controller.signal }),
                /TestAbortSignal|aborted/i
            );
        } finally {
            await emu.close();
        }
    });

    await t.test('12. PokemonRedBluePlugin should reject incompatible ROM titles or install on compatible ROMs', async () => {
        const { PokemonRedBluePlugin, isPokemonRedBlue } = await import('../plugins/index.js');
        const emu = await Mgba.load(romPath);
        try {
            if (!isPokemonRedBlue(emu.console.title, emu.console.gameCode)) {
                await assert.rejects(
                    emu.use(PokemonRedBluePlugin),
                    /PokemonRedBluePlugin supports Pokémon Red and Pokémon Blue/i
                );
            } else {
                const redBlue = await emu.use(PokemonRedBluePlugin);
                assert.ok(redBlue !== undefined);
            }
        } finally {
            await emu.close();
        }
    });

    await t.test('13. emu.waitFor should cancel in-flight worker execution on signal abort', async () => {
        const emu = await Mgba.load(romPath);
        try {
            const controller = new AbortController();
            // Start a long-running wait that will not match
            const waitPromise = emu.waitFor(
                { address: 0xC700, value: 0xEE, op: 'eq' },
                { timeoutFrames: 1000, signal: controller.signal }
            );

            // Abort after 30ms while the loop is actively executing
            await new Promise((r) => setTimeout(r, 30));
            controller.abort(new Error('InFlightAbort'));

            await assert.rejects(waitPromise, /InFlightAbort|aborted/i);

            // Immediately test that the worker thread is unblocked and responsive to new commands
            const ping = await emu.diagnostics.ping();
            assert.equal(ping, 'pong');
        } finally {
            await emu.close();
        }
    });

    await t.test('14. emu.screen.tilemap should accept mode and bitmapMode options', async () => {
        const emu = await Mgba.load(romPath);
        try {
            await emu.controls.tick(5);
            // On GB/GBC, tilemap decodes GB tilemap
            const gbTilemap = await emu.screen.tilemap({ layer: 'bg', mode: 'text' });
            assert.ok(gbTilemap);
            assert.equal(gbTilemap.width, 32);
            assert.equal(gbTilemap.height, 32);
        } finally {
            await emu.close();
        }
    });

    await t.test('15. emu.screen.crop should extract subregions with PNG and raw buffer formats', async () => {
        const emu = await Mgba.load(romPath);
        try {
            await emu.controls.tick(10);
            const pngCrop = await emu.screen.crop({ x: 10, y: 10, width: 40, height: 40 }, 'png');
            assert.ok(Buffer.isBuffer(pngCrop));
            assert.equal(pngCrop[0], 0x89);
            assert.equal(pngCrop[1], 0x50);
            assert.equal(pngCrop[2], 0x4E);
            assert.equal(pngCrop[3], 0x47);

            const rawCrop = await emu.screen.crop({ x: 0, y: 0, width: 20, height: 20 }, 'raw');
            assert.ok(Buffer.isBuffer(rawCrop));
            assert.equal(rawCrop.length, 20 * 20 * 4);
        } finally {
            await emu.close();
        }
    });

    await t.test('16. emu.waitFor should validate options and support predicate functions', async () => {
        const emu = await Mgba.load(romPath);
        try {
            await assert.rejects(
                emu.waitFor(() => false, { timeoutFrames: -1 }),
                /Invalid timeoutFrames/i
            );
            await assert.rejects(
                emu.waitFor(() => false, { checkIntervalFrames: 0 }),
                /Invalid checkIntervalFrames/i
            );

            // Predicate match on frame counter
            let checked = 0;
            await emu.waitFor(async (instance) => {
                checked++;
                const count = await instance.console.getFrameCounter();
                return count >= 15;
            }, { timeoutFrames: 100, checkIntervalFrames: 5 });

            assert.ok(checked >= 3);
            const finalCount = await emu.console.getFrameCounter();
            assert.ok(finalCount >= 15);
        } finally {
            await emu.close();
        }
    });

    await t.test('17. emu.console.cartridge should expose full battery and RTC metadata', async () => {
        const emu = await Mgba.load(romPath);
        try {
            const cart = emu.console.cartridge;
            assert.ok(cart);
            assert.equal(typeof cart.title, 'string');
            assert.equal(typeof cart.romSize, 'number');
            assert.equal(typeof cart.ramSize, 'number');
            assert.equal(typeof cart.hasBattery, 'boolean');
            assert.ok(cart.model && ['DMG', 'CGB', 'AGB'].includes(cart.model));
            assert.ok(['GB/GBC', 'GBA'].includes(cart.platform));
        } finally {
            await emu.close();
        }
    });

    await t.test('18. emu.waitFor predicate should step exactly timeoutFrames without overshoot', async () => {
        const emu = await Mgba.load(romPath);
        try {
            const initialFrame = await emu.console.getFrameCounter();
            assert.equal(initialFrame, 0);

            // Timeout after 6 frames with checkInterval of 5 frames
            await assert.rejects(
                emu.waitFor(() => false, { timeoutFrames: 6, checkIntervalFrames: 5 }),
                /waitFor predicate timed out after 6 frames/i
            );

            const finalFrame = await emu.console.getFrameCounter();
            assert.equal(finalFrame, 6, 'Frame counter must advance by exactly timeoutFrames (6), not overshoot to 10');
        } finally {
            await emu.close();
        }
    });

    await t.test('19. emu.waitFor declarative condition spec should resolve when memory condition met', async () => {
        const emu = await Mgba.load(romPath);
        try {
            // Write a value to WRAM at frame 0
            await emu.memory.write8(0xC000, 0x42);

            // Wait for 0xC000 to equal 0x42
            await emu.waitFor({
                address: 0xC000,
                value: 0x42,
                op: 'eq',
            }, { timeoutFrames: 20 });

            const readVal = await emu.memory.read8(0xC000);
            assert.equal(readVal, 0x42);
        } finally {
            await emu.close();
        }
    });

    await t.test('20. emu.waitFor declarative condition spec should resolve symbol names', async () => {
        const emu = await Mgba.load(romPath);
        try {
            emu.symbols.manager.add('wPlayerState', 0xC010);
            await emu.symbols.write('wPlayerState', 0x99);

            await emu.waitFor({
                symbol: 'wPlayerState',
                value: 0x99,
                op: 'eq',
            }, { timeoutFrames: 20 });

            const readVal = await emu.symbols.read('wPlayerState');
            assert.equal(readVal, 0x99);
        } finally {
            await emu.close();
        }
    });

    await t.test('21. emu.waitFor should abort when AbortSignal is triggered', async () => {
        const emu = await Mgba.load(romPath);
        const controller = new AbortController();
        try {
            // Abort after 20ms
            setTimeout(() => controller.abort(new Error('Operation cancelled by user')), 20);

            await assert.rejects(
                emu.waitFor(() => false, { timeoutFrames: 1000, checkIntervalFrames: 5, signal: controller.signal }),
                /cancelled|aborted/i
            );
        } finally {
            await emu.close();
        }
    });

    await t.test('22. emu.observe should capture screen, memory reader, and custom slices atomically', async () => {
        const emu = await Mgba.load(romPath);
        try {
            await emu.controls.tick(15);
            // Write a marker to WRAM
            await emu.memory.write8(0xC100, 0x77);

            const obs = await emu.observe({
                screen: true,
                memory: { vram: true, oam: true },
                reads: [
                    { address: 0xC100, type: 'u8', key: 'marker' },
                ],
                slices: [
                    { regionOrAddress: 'WRAM', length: 0x2000, key: 'wram' },
                    { regionOrAddress: 'IO', length: 0x80, key: 'io' },
                ],
            });

            assert.equal(obs.frameIndex, 15);
            assert.ok(Buffer.isBuffer(obs.screenBuffer));
            assert.ok(obs.memory);
            assert.equal(obs.memory.readU8(0xC100), 0x77);
            assert.equal(obs.data['marker'], 0x77);
            assert.ok(obs.slices);
            assert.ok(Buffer.isBuffer(obs.slices['wram']));
            assert.equal(obs.slices['wram'].length, 0x2000);
            assert.equal(obs.slices['wram'][0x100], 0x77);
            assert.ok(Buffer.isBuffer(obs.slices['io']));
            assert.equal(obs.slices['io'].length, 0x80);
        } finally {
            await emu.close();
        }
    });

    await t.test('23. emu.console metadata and memory scalar address boundary enforcement', async () => {
        const emu = await Mgba.load(romPath);
        try {
            assert.ok(emu.console.cartridge);
            assert.equal(typeof emu.console.cartridge.title, 'string');
            assert.equal(typeof emu.console.cartridge.romSize, 'number');
            assert.ok(['DMG', 'CGB', 'AGB', 'SGB'].includes(emu.console.model));

            // Valid in-bounds write and read
            await emu.memory.write8(0xC000, 0x42);
            assert.equal(await emu.memory.read8(0xC000), 0x42);

            // Out-of-bounds scalar reads must reject
            await assert.rejects(
                emu.memory.read8(0x10000),
                /RangeError|bounds|Failed to execute native read_batch/i
            );
            await assert.rejects(
                emu.memory.read16LE(0xFFFF),
                /RangeError|bounds|Failed to execute native read_batch/i
            );
            await assert.rejects(
                emu.memory.read32LE(0xFFFD),
                /RangeError|bounds|Failed to execute native read_batch/i
            );
            await assert.rejects(
                emu.memory.write8(0x10000, 0x00),
                /RangeError|bounds|Invalid bus address/i
            );
        } finally {
            await emu.close();
        }
    });

    await t.test('24. PokemonRedBluePlugin.decode should decode structured state offline without emulator', async () => {
        const { PokemonRedBluePlugin } = await import('../plugins/index.js');
        const wram = Buffer.alloc(0x2000);
        const io = Buffer.alloc(0x80);
        const hram = Buffer.alloc(0x7F);
        const vram = Buffer.alloc(0x2000);
        const rom = Buffer.alloc(0x100000).fill(0xFF);

        // Set map coordinates and money
        wram[0x135E] = 0x01; // map id at 0xD35E (0xD35E - 0xC000 = 0x135E)
        wram[0x1361] = 5;    // playerY at 0xD361
        wram[0x1362] = 10;   // playerX at 0xD362
        wram[0x1347] = 0x12; // money at 0xD347
        wram[0x1348] = 0x34;
        wram[0x1349] = 0x56;

        // Player Name: 'RED' (0x91, 0x84, 0x83, 0x50) at 0xD158 (0xD158 - 0xC000 = 0x1158)
        wram[0x1158] = 0x91;
        wram[0x1159] = 0x84;
        wram[0x115A] = 0x83;
        wram[0x115B] = 0x50;

        // Badges: 0x03 (Boulder + Cascade badges) at 0xD356 (0xD356 - 0xC000 = 0x1356)
        wram[0x1356] = 0x03;

        // Inventory: 1 item (Master Ball x 5) at 0xD31D (0xD31D - 0xC000 = 0x131D)
        wram[0x131D] = 0x01; // count
        wram[0x131E] = 0x01; // Master Ball id
        wram[0x131F] = 0x05; // quantity
        wram[0x1320] = 0xFF; // terminator

        const memory = new SnapshotMemoryReader({
            wram,
            io,
            hram,
            vram,
            rom,
        });
        const state = PokemonRedBluePlugin.decode(memory);

        assert.equal(state.map.id, 0x01);
        assert.equal(state.player.position.x, 10);
        assert.equal(state.player.position.y, 5);
        assert.equal(state.player.money, 123456);
        assert.equal(state.player.name, 'RED');
        assert.equal(state.player.badges, 0x03);
        assert.equal(state.player.badgeCount, 2);
        assert.equal(state.inventory.length, 1);
        assert.equal(state.inventory[0]?.name, 'MASTER BALL');
        assert.equal(state.inventory[0]?.quantity, 5);
    });

    await t.test('25. emu.memory.snapshot() captures atomic MemorySnapshotReader with frame metadata', async () => {
        const emu = await Mgba.load(romPath);
        try {
            await emu.controls.tick(5);
            const snapshot = await emu.memory.snapshot({ vram: true });

            assert.equal(typeof snapshot.frameIndex, 'number');
            assert.ok(snapshot.frameIndex >= 5);
            assert.equal(typeof snapshot.timestamp, 'number');
            assert.ok(snapshot.timestamp > 0);

            // Verify reads across memory spaces
            assert.equal(snapshot.readU8(0x0100), 0xC3); // JP opcode at GB entry point
            assert.equal(typeof snapshot.readU8(0xC000), 'number');
            assert.equal(typeof snapshot.readU8(0x8000), 'number');
            assert.equal(typeof snapshot.readU8(0xFF80), 'number');
            assert.equal(typeof snapshot.readU8(0xFFFF), 'number');
        } finally {
            await emu.close();
        }
    });
});
