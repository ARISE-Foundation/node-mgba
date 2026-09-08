import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { Mgba, PokemonRedBluePlugin, isPokemonRedBlue } from '../src/index.js';
import { isTextboxOrMenuOpen, decodeScreenText } from '../src/plugins/redblue/decoder.js';
import { getPokemonRom, hasPokemonRom } from './helpers/rom.js';

test('PokemonRedBluePlugin RAM Decoder Integration', async (t) => {
    if (!hasPokemonRom()) {
        t.skip('Pokémon Red/Blue ROM fixture not found (set POKEMON_ROM_PATH to run)');
        return;
    }
    const testRom = getPokemonRom();
    const emu = await Mgba.load(testRom.path);

    try {
        if (!isPokemonRedBlue(emu.console.title, emu.console.gameCode)) {
            t.skip(`Skipping PokemonRedBluePlugin tests: loaded ROM "${emu.console.title}" (${emu.console.gameCode}) is not Pokemon Red or Blue`);
            return;
        }

        const redBlue = await emu.use(PokemonRedBluePlugin);

        await t.test('1. Should return structured game state schema on boot', async () => {
            const state = await redBlue.getState();

            assert.equal(typeof state.player.position.x, 'number');
            assert.equal(typeof state.player.position.y, 'number');
            assert.ok(['down', 'up', 'left', 'right'].includes(state.player.facing));
            assert.equal(typeof state.player.badges, 'number');
            assert.equal(typeof state.player.badgeCount, 'number');
            assert.equal(typeof state.partyCount, 'number');
            assert.ok(Array.isArray(state.party));
            assert.equal(typeof state.battle.inBattle, 'boolean');
            assert.ok(['wild', 'trainer', 'none'].includes(state.battle.battleType));
            assert.equal(typeof state.pokedexProgress.seen, 'number');
            assert.equal(typeof state.pokedexProgress.caught, 'number');
            assert.equal(typeof state.pokedexProgress.total, 'number');
            assert.ok(Array.isArray(state.pokedexCaught));
            assert.ok(Array.isArray(state.inventory));
            assert.ok(Array.isArray(state.storedItems));
            assert.ok(Array.isArray(state.storedPokemon));
            assert.equal(typeof state.screenText, 'string');
            assert.equal(typeof state.rawText, 'string');
            assert.equal(typeof state.systemState, 'string');
        });

        await t.test('2. Should decode game state transactionally after input sequence', async () => {
            await emu.controls.sequence([
                { type: 'press', button: 'START', holdFrames: 16 },
                { type: 'wait', frames: 10 },
                { type: 'press', button: 'A', holdFrames: 16 },
            ]);

            const state = await redBlue.getState();
            assert.ok(state !== undefined);
            assert.equal(typeof state.player.name, 'string');
            assert.equal(typeof state.player.money, 'number');
            assert.equal(typeof state.map.id, 'number');
            assert.equal(typeof state.battle.inBattle, 'boolean');
        });

        const savestatePath = 'fixtures/turn_state.ss0';
        if (existsSync(savestatePath)) {
            await t.test('3. Should accurately decode complete live state from reference savestate', async () => {
                await emu.states.loadFromFile(savestatePath);
                const state = await redBlue.getState();

                // Player & World Assertions
                assert.equal(state.player.name, 'ACE');
                assert.equal(state.player.rival, 'JACK');
                assert.equal(state.player.money, 32977);
                assert.equal(state.player.badges, 0x3F); // 6 badges (bitmask 00111111)
                assert.equal(state.player.badgeCount, 6);
                assert.equal(state.map.id, 165);
                assert.deepEqual(state.player.position, { x: 18, y: 5 });

                // Party Assertions
                assert.equal(state.partyCount, 6);
                assert.equal(state.party.length, 6);

                const leadMon = state.party[0];
                assert.ok(leadMon !== undefined);
                assert.equal(leadMon.nickname, 'SHELLBY');
                assert.equal(leadMon.species, 'BLASTOISE');
                assert.equal(leadMon.pokedexNumber, 9);
                assert.equal(leadMon.level, 62);
                assert.equal(leadMon.hp, 186);
                assert.equal(leadMon.maxHP, 199);
                assert.equal(leadMon.type, 'WATER');
                assert.equal(leadMon.status, 'OK');
                assert.equal(leadMon.otName, 'ACE');
                assert.equal(leadMon.otId, 12053);
                assert.equal(leadMon.experience, 243407);
                assert.equal(leadMon.moves.length, 4);
                assert.deepEqual(leadMon.moves.map(m => m.move), ['HYDRO PUMP', 'ICE BEAM', 'BITE', 'SURF']);

                const faintedMon = state.party[2];
                assert.ok(faintedMon !== undefined);
                assert.equal(faintedMon.species, 'RATTATA');
                assert.equal(faintedMon.hp, 0);
                assert.equal(faintedMon.status, 'FNT');

                // Stored Box Pokémon Assertions
                assert.equal(state.currentBoxNumber, 4);
                assert.equal(state.storedPokemon.length, 4);

                const boxMon1 = state.storedPokemon[0];
                assert.ok(boxMon1 !== undefined);
                assert.equal(boxMon1.species, 'LAPRAS');
                assert.equal(boxMon1.level, 15);
                assert.equal(boxMon1.hp, 66);
                assert.equal(boxMon1.maxHP, 66); // Calculated from ROM base stats
                assert.ok(boxMon1.attack > 0 && boxMon1.defense > 0 && boxMon1.speed > 0);

                // Bag Inventory Assertions
                assert.equal(state.inventory.length, 12);
                const itemNames = state.inventory.map(i => i.name);
                assert.ok(itemNames.includes('POKé FLUTE'));
                assert.ok(itemNames.includes('SUPER ROD'));
                assert.ok(itemNames.includes('MAX POTION'));
                assert.ok(itemNames.includes('MAX REVIVE'));
                assert.ok(itemNames.includes('HM03'));
                assert.ok(itemNames.includes('MASTER BALL'));

                // Pokédex Progress Assertions
                assert.ok(state.pokedexProgress.caught >= 6);
                assert.ok(state.pokedexProgress.seen >= 6);
                assert.equal(state.pokedexProgress.total, 151);
                assert.ok(state.pokedexCaught.includes('BLASTOISE'));
                assert.ok(state.pokedexCaught.includes('PIDGEY'));
                assert.ok(state.pokedexCaught.includes('PIKACHU'));
            });
        }

        await t.test('4. Should achieve sub-millisecond memory decoding throughput (< 0.5ms per call)', async () => {
            const obs = await emu.observe({
                screen: false,
                memory: { vram: true },
            });
            assert.ok(obs.memory);
            const mem = obs.memory;

            // Warmup JIT
            for (let i = 0; i < 50; i++) {
                PokemonRedBluePlugin.decode(mem);
            }

            const iterations = 500;
            const start = performance.now();
            for (let i = 0; i < iterations; i++) {
                PokemonRedBluePlugin.decode(mem);
            }
            const elapsed = performance.now() - start;
            const avgMs = elapsed / iterations;
            assert.ok(
                avgMs < 0.5,
                `Decoded observation average ${avgMs.toFixed(3)}ms exceeded 0.5ms budget (total: ${elapsed.toFixed(1)}ms for ${iterations} calls)`,
            );
        });

        await t.test('5. Should handle sprite freeze and resume lifecycle with strict bounds', async () => {
            // Boundary validation
            await assert.rejects(() => redBlue.freezeSprite(0), /Invalid objectId 0/i);
            await assert.rejects(() => redBlue.freezeSprite(16), /Invalid objectId 16/i);
            await assert.rejects(() => redBlue.freezeSprite(NaN), /Invalid objectId NaN/i);
            await assert.rejects(() => redBlue.resumeSprite(0), /Invalid objectId 0/i);
            await assert.rejects(() => redBlue.resumeSprite(16), /Invalid objectId 16/i);

            // Inactive sprite check (slot 15 when sprite is 0)
            await emu.memory.write8(0xC100 + 15 * 0x10, 0x00);
            const inactiveRes = await redBlue.freezeSprite(15);
            assert.equal(inactiveRes, 'Object 15 is not active');

            // Setup active sprite in slot 1 (sprite = 0x03 at 0xC110, movement = 0x04 at 0xC216)
            await emu.memory.write8(0xC110, 0x03);
            await emu.memory.write8(0xC216, 0x04);

            // First freeze: stops sprite and saves movement byte
            const freezeRes = await redBlue.freezeSprite(1);
            assert.equal(freezeRes, 'Stopped sprite 1 (saved movement byte 0x4)');
            assert.equal(await emu.memory.read8(0xC216), 0xFF);

            // Second freeze: already frozen
            const repeatFreezeRes = await redBlue.freezeSprite(1);
            assert.equal(repeatFreezeRes, 'Sprite 1 is already frozen');

            // Resume on non-frozen slot (ensure slot 14 is inactive)
            await emu.memory.write8(0xC100 + 14 * 0x10, 0x00);
            const resumeInactiveRes = await redBlue.resumeSprite(14);
            assert.equal(resumeInactiveRes, 'Object 14 is not active');

            // Resume on active slot without saved movement
            await emu.memory.write8(0xC100 + 2 * 0x10, 0x01);
            const resumeUnfrozenRes = await redBlue.resumeSprite(2);
            assert.equal(resumeUnfrozenRes, 'No saved movement byte for sprite 2');

            // Resume slot 1: restores movement byte
            const resumeRes = await redBlue.resumeSprite(1);
            assert.equal(resumeRes, 'Resumed sprite 1 (restored movement byte 0x4)');
            assert.equal(await emu.memory.read8(0xC216), 0x04);
            assert.equal(await emu.memory.read8(0xC111), 0x01);
        });

        await t.test('6. Should gate screen text decoding via isTextboxOrMenuOpen and handle battle transitions', async () => {
            if (existsSync(savestatePath)) {
                await emu.states.loadFromFile(savestatePath);
                const state = await redBlue.getState();
                assert.ok(state.screenText.includes('Wild PONYTA'));
                assert.ok(state.screenText.includes('appeared!'));
                assert.ok(!state.screenText.includes('│                  │'));
                assert.ok(!state.screenText.includes('└──────────────────┘'));

                const obs = await emu.observe({ screen: false, memory: { vram: true } });
                assert.ok(obs.memory);
                assert.equal(isTextboxOrMenuOpen(obs.memory), true);

                // Simulate battle transition: fill wTileMap with 0xFF, zero out box borders and menu flags
                for (let addr = 0xC3A0; addr <= 0xC507; addr++) {
                    await emu.memory.write8(addr, 0xFF);
                }
                await emu.memory.write8(0xCC29, 0x00);
                await emu.memory.write8(0xCFC4, 0x00);

                const transitionObs = await emu.observe({ screen: false, memory: { vram: true } });
                assert.ok(transitionObs.memory);
                assert.equal(isTextboxOrMenuOpen(transitionObs.memory), false);
                const decoded = decodeScreenText(transitionObs.memory);
                assert.equal(decoded.screenText, '');
                assert.equal(decoded.isPossiblyMenuOpen, false);
            }
        });
    } finally {
        await emu.close();
    }
});
