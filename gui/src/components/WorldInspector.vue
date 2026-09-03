<script setup lang="ts">
import type { PokemonRedBlueState } from '../types.js';

defineProps<{
    player: PokemonRedBlueState['player'] | undefined;
    map: PokemonRedBlueState['map'] | undefined;
}>();
</script>

<template>
  <div class="flex flex-col space-y-4">
    <!-- World Map Meta (3 Columns) -->
    <div class="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-xl grid grid-cols-3 gap-3 text-xs">
      <div class="bg-slate-950/60 p-2.5 rounded-lg border border-slate-800/80">
        <div class="text-slate-500 text-[10px] uppercase font-bold">Map ID & Size</div>
        <div class="text-cyan-300 font-mono text-sm mt-0.5">
          ID: {{ map?.id ?? 0 }} ({{ map?.width ?? 0 }}×{{ map?.height ?? 0 }})
        </div>
      </div>
      <div class="bg-slate-950/60 p-2.5 rounded-lg border border-slate-800/80">
        <div class="text-slate-500 text-[10px] uppercase font-bold">Player Position & Facing</div>
        <div class="text-slate-200 font-mono text-sm mt-0.5">
          X: {{ player?.position?.x ?? 0 }}, Y: {{ player?.position?.y ?? 0 }} ({{ player?.facing ?? 'down' }})
        </div>
      </div>
      <div class="bg-slate-950/60 p-2.5 rounded-lg border border-slate-800/80">
        <div class="text-slate-500 text-[10px] uppercase font-bold">Movement & Status</div>
        <div class="text-slate-200 font-mono text-sm mt-0.5">
          {{ player?.movementState ?? 'walking' }} {{ player?.onGrass ? '🌿 (in grass)' : '' }}
        </div>
      </div>
    </div>

    <!-- NPC Objects Table -->
    <div class="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-xl flex flex-col space-y-3">
      <div class="flex items-center justify-between border-b border-slate-800 pb-2">
        <h3 class="font-bold text-xs text-slate-200 uppercase tracking-wider">Map NPC Tracker ($C100-$C1F0)</h3>
        <span class="text-xs text-slate-400 font-mono">{{ map?.objects?.length ?? 0 }} on-screen NPCs</span>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full text-left text-xs font-mono">
          <thead>
            <tr class="text-slate-500 border-b border-slate-800">
              <th class="py-1.5 px-2">ID</th>
              <th class="py-1.5 px-2">Sprite</th>
              <th class="py-1.5 px-2">Pos (X, Y)</th>
              <th class="py-1.5 px-2">Facing</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-800/60 text-slate-300">
            <tr v-if="!map?.objects || map.objects.length === 0">
              <td colspan="4" class="py-3 text-center text-slate-600 italic">No on-screen NPCs detected.</td>
            </tr>
            <tr
              v-for="(npc, idx) in map?.objects || []"
              :key="idx"
            >
              <td class="py-1.5 px-2 text-cyan-400">#{{ npc.id }}</td>
              <td class="py-1.5 px-2 text-slate-400">{{ npc.name }}</td>
              <td class="py-1.5 px-2 font-bold text-emerald-400">({{ npc.x }}, {{ npc.y }})</td>
              <td class="py-1.5 px-2 text-slate-400">{{ npc.facing }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>

