<script setup lang="ts">
import type { PokemonPartyMember, PokemonStoredMember, PokemonRedBlueState } from '../types.js';

defineProps<{
    player?: PokemonRedBlueState['player'];
    pokedexProgress?: PokemonRedBlueState['pokedexProgress'];
    party: readonly PokemonPartyMember[];
    currentBoxNumber?: number;
    storedPokemon: readonly PokemonStoredMember[];
}>();

function getHpPercent(hp: number, maxHp: number): number {
    if (maxHp <= 0) return 0;
    return Math.min(100, Math.round((hp / maxHp) * 100));
}

function getHpColor(pct: number): string {
    if (pct > 50) return 'bg-emerald-500';
    if (pct > 20) return 'bg-amber-500';
    return 'bg-rose-500';
}

function getStatusBadge(status: string): string {
    switch (status) {
        case 'OK': return 'bg-emerald-900/60 text-emerald-300 border-emerald-800';
        case 'FNT': return 'bg-rose-900/60 text-rose-300 border-rose-800';
        default: return 'bg-amber-900/60 text-amber-300 border-amber-800';
    }
}
</script>

<template>
  <div class="flex flex-col space-y-4">
    <!-- Summary Stats Bar (4 Columns) -->
    <div class="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-xl grid grid-cols-4 gap-3 text-xs">
      <div class="bg-slate-950/60 p-2.5 rounded-lg border border-slate-800/80">
        <div class="text-slate-500 text-[10px] uppercase font-bold">Trainer</div>
        <div class="text-emerald-400 font-mono text-sm mt-0.5">
          {{ player?.name || 'RED' }} (Rival: {{ player?.rival || 'BLUE' }})
        </div>
      </div>
      <div class="bg-slate-950/60 p-2.5 rounded-lg border border-slate-800/80">
        <div class="text-slate-500 text-[10px] uppercase font-bold">Money</div>
        <div class="text-emerald-400 font-mono text-sm mt-0.5">
          ${{ player?.money ?? 0 }}
        </div>
      </div>
      <div class="bg-slate-950/60 p-2.5 rounded-lg border border-slate-800/80">
        <div class="text-slate-500 text-[10px] uppercase font-bold">Badges</div>
        <div class="text-amber-400 font-mono text-sm mt-0.5">
          {{ player?.badgeCount ?? 0 }} / 8 ({{ (player?.badges ?? 0).toString(2).padStart(8, '0') }})
        </div>
      </div>
      <div class="bg-slate-950/60 p-2.5 rounded-lg border border-slate-800/80">
        <div class="text-slate-500 text-[10px] uppercase font-bold">Pokédex</div>
        <div class="text-cyan-400 font-mono text-sm mt-0.5">
          {{ pokedexProgress?.seen ?? 0 }} Seen / {{ pokedexProgress?.caught ?? 0 }} Caught
        </div>
      </div>
    </div>

    <!-- Party Pokémon Deck -->
    <div class="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-xl flex flex-col space-y-3">
      <div class="flex items-center justify-between border-b border-slate-800 pb-2">
        <h3 class="font-bold text-xs text-slate-200 uppercase tracking-wider">Party Roster (44-Byte RAM Structs)</h3>
        <span class="text-xs text-slate-400 font-mono">{{ party.length }} / 6</span>
      </div>

      <div v-if="party.length === 0" class="grid grid-cols-1 md:grid-cols-2 gap-3">
        <span class="text-xs text-slate-600 italic col-span-2">No Pokémon in party.</span>
      </div>

      <div v-else class="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div
          v-for="(mon, idx) in party"
          :key="idx"
          class="bg-slate-950/80 p-3 rounded-lg border border-slate-800/90 flex flex-col space-y-2 text-xs font-mono"
        >
          <!-- Header -->
          <div class="flex items-center justify-between border-b border-slate-800/60 pb-1.5">
            <div class="flex items-center space-x-1.5 font-bold">
              <span class="text-cyan-400 font-sans">#{{ idx + 1 }}</span>
              <span class="text-slate-100">{{ mon.nickname }}</span>
              <span class="text-slate-500 text-[10px]">({{ mon.species }})</span>
            </div>
            <div class="flex items-center space-x-1">
              <span class="text-[10px] bg-slate-800 px-1.5 py-0.5 rounded text-cyan-300">Lv.{{ mon.level }}</span>
              <span class="text-[10px] px-1.5 py-0.5 rounded border" :class="getStatusBadge(mon.status)">{{ mon.status }}</span>
            </div>
          </div>

          <!-- HP Bar -->
          <div class="flex flex-col space-y-1">
            <div class="flex justify-between text-[11px]">
              <span class="text-slate-500">HP:</span>
              <span class="font-bold text-slate-200">{{ mon.hp }} / {{ mon.maxHP }}</span>
            </div>
            <div class="w-full bg-slate-900 rounded-full h-1.5 overflow-hidden">
              <div
                class="h-full transition-all duration-200"
                :class="getHpColor(getHpPercent(mon.hp, mon.maxHP))"
                :style="{ width: `${getHpPercent(mon.hp, mon.maxHP)}%` }"
              />
            </div>
          </div>

          <!-- Moves & Stats -->
          <div class="grid grid-cols-2 gap-2 text-[10px] text-slate-400 pt-1 border-t border-slate-800/60">
            <div>
              <div class="text-slate-500 font-semibold mb-0.5">Moves:</div>
              <div v-for="(move, mIdx) in mon.moves" :key="mIdx" class="truncate text-slate-300">
                • {{ move.move }} ({{ move.pp }} PP)
              </div>
            </div>
            <div>
              <div class="text-slate-500 font-semibold mb-0.5">Stats:</div>
              <div>Atk: {{ mon.attack }} | Def: {{ mon.defense }}</div>
              <div>Spd: {{ mon.speed }} | Spc: {{ mon.spAttack }}</div>
              <div class="text-[9px] text-slate-500 mt-1">DVs: {{ mon.attackDV }}/{{ mon.defenseDV }}/{{ mon.speedDV }}/{{ mon.specialDV }}</div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Stored PC Box Pokémon Deck -->
    <div class="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-xl flex flex-col space-y-3">
      <div class="flex items-center justify-between border-b border-slate-800 pb-2">
        <div class="flex items-center space-x-2">
          <h3 class="font-bold text-xs text-slate-200 uppercase tracking-wider">PC Storage Box</h3>
          <span class="text-[10px] bg-slate-800 text-cyan-300 px-2 py-0.5 rounded border border-slate-700">
            Box {{ currentBoxNumber ?? 1 }}
          </span>
        </div>
        <span class="text-xs text-slate-400 font-mono">{{ storedPokemon.length }} stored</span>
      </div>

      <div v-if="storedPokemon.length === 0" class="grid grid-cols-1 md:grid-cols-2 gap-3">
        <span class="text-xs text-slate-600 italic col-span-2">No Pokémon stored in current box.</span>
      </div>

      <div v-else class="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div
          v-for="(mon, idx) in storedPokemon"
          :key="idx"
          class="bg-slate-950/80 p-3 rounded-lg border border-slate-800/90 flex flex-col space-y-1.5 text-xs font-mono"
        >
          <div class="flex items-center justify-between border-b border-slate-800/60 pb-1">
            <div class="flex items-center space-x-1.5 font-bold">
              <span class="text-cyan-400 font-sans">#{{ idx + 1 }}</span>
              <span class="text-slate-100">{{ mon.nickname }}</span>
              <span class="text-slate-500 text-[10px]">({{ mon.species }})</span>
            </div>
            <span class="text-[10px] bg-slate-800 px-1.5 py-0.5 rounded text-cyan-300">Lv.{{ mon.level }}</span>
          </div>
          <div class="flex justify-between text-[11px] text-slate-400">
            <span>HP: {{ mon.hp }}/{{ mon.maxHP }}</span>
            <span>Status: {{ mon.status }}</span>
          </div>
          <div class="text-[10px] text-slate-500 truncate">
            Moves: {{ mon.moves.map((m: { move: string }) => m.move).filter(Boolean).join(', ') || 'None' }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

