<script setup lang="ts">
import type { RomInfo, RomEntry } from '../types.js';

defineProps<{
    romInfo: RomInfo | null;
    roms?: readonly RomEntry[];
    fps: number;
    frameCounter: number;
    isLooping: boolean;
}>();

const emit = defineEmits<{
    (e: 'loadRom', path: string): void;
}>();

function formatBytes(bytes?: number): string {
    if (!bytes || bytes <= 0) return '0 B';
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${bytes} B`;
}
</script>

<template>
  <div class="flex flex-col space-y-4">
    <!-- Header Card -->
    <div class="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-xl">
      <div class="flex items-center justify-between border-b border-slate-800 pb-4 mb-4">
        <div>
          <h2 class="text-base font-bold text-white font-mono flex items-center space-x-2">
            <span>{{ romInfo?.title || 'Unknown ROM' }}</span>
            <span
              v-if="romInfo?.platform"
              class="text-xs px-2 py-0.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-800/80 font-sans uppercase font-semibold"
            >
              {{ romInfo.platform }} / {{ romInfo.model }}
            </span>
          </h2>
          <div class="text-xs text-slate-400 font-mono mt-1">
            Game Code: <span class="text-slate-200 font-semibold">{{ romInfo?.gameCode || 'N/A' }}</span>
          </div>
        </div>

        <div class="flex items-center space-x-2 text-xs">
          <span
            class="px-2.5 py-1 rounded-md border font-mono"
            :class="isLooping ? 'bg-emerald-950/80 text-emerald-300 border-emerald-700/60' : 'bg-slate-800 text-slate-400 border-slate-700'"
          >
            {{ isLooping ? '● Loop 60 FPS' : '❚❚ Paused' }}
          </span>
        </div>
      </div>

      <!-- Technical Specifications Grid -->
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
        <div class="bg-slate-950/60 p-3 rounded-lg border border-slate-800/80">
          <div class="text-slate-500 text-[10px] uppercase font-bold">ROM Size</div>
          <div class="text-slate-200 font-mono text-sm mt-1">
            {{ formatBytes(romInfo?.romSize) }}
          </div>
        </div>

        <div class="bg-slate-950/60 p-3 rounded-lg border border-slate-800/80">
          <div class="text-slate-500 text-[10px] uppercase font-bold">Save RAM</div>
          <div class="text-slate-200 font-mono text-sm mt-1">
            {{ formatBytes(romInfo?.ramSize) }}
          </div>
        </div>

        <div class="bg-slate-950/60 p-3 rounded-lg border border-slate-800/80">
          <div class="text-slate-500 text-[10px] uppercase font-bold">Battery Backup</div>
          <div class="font-mono text-sm mt-1" :class="romInfo?.hasBattery ? 'text-emerald-400' : 'text-slate-500'">
            {{ romInfo?.hasBattery ? 'Yes' : 'No' }}
          </div>
        </div>

        <div class="bg-slate-950/60 p-3 rounded-lg border border-slate-800/80">
          <div class="text-slate-500 text-[10px] uppercase font-bold">RTC Clock</div>
          <div class="font-mono text-sm mt-1" :class="romInfo?.hasRtc ? 'text-emerald-400' : 'text-slate-500'">
            {{ romInfo?.hasRtc ? 'Present' : 'None' }}
          </div>
        </div>
      </div>
    </div>

    <!-- Engine Telemetry Card -->
    <div class="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-xl">
      <div class="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">
        Emulator Engine Diagnostics
      </div>
      <div class="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
        <div class="bg-slate-950/60 p-3 rounded-lg border border-slate-800/80">
          <div class="text-slate-500 text-[10px] uppercase font-bold">Frame Counter</div>
          <div class="text-cyan-300 font-mono text-sm mt-1">
            {{ frameCounter }}
          </div>
        </div>
        <div class="bg-slate-950/60 p-3 rounded-lg border border-slate-800/80">
          <div class="text-slate-500 text-[10px] uppercase font-bold">Measured FPS</div>
          <div class="text-amber-300 font-mono text-sm mt-1">
            {{ Math.round(fps) }} FPS
          </div>
        </div>
        <div class="bg-slate-950/60 p-3 rounded-lg border border-slate-800/80">
          <div class="text-slate-500 text-[10px] uppercase font-bold">Worker Isolation</div>
          <div class="text-emerald-400 font-mono text-sm mt-1">
            Active (Actor Thread)
          </div>
        </div>
      </div>
    </div>

    <!-- Controller Keyboard Shortcuts Reference -->
    <div class="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-xl text-xs">
      <div class="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">
        Keyboard Controls Reference
      </div>
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 font-mono">
        <div class="flex items-center justify-between bg-slate-950/40 px-2.5 py-1.5 rounded border border-slate-800/60">
          <span class="text-slate-400">D-Pad:</span>
          <span class="text-cyan-300">Arrows / WASD</span>
        </div>
        <div class="flex items-center justify-between bg-slate-950/40 px-2.5 py-1.5 rounded border border-slate-800/60">
          <span class="text-slate-400">A Button:</span>
          <span class="text-rose-300">Z / J</span>
        </div>
        <div class="flex items-center justify-between bg-slate-950/40 px-2.5 py-1.5 rounded border border-slate-800/60">
          <span class="text-slate-400">B Button:</span>
          <span class="text-rose-300">X / K</span>
        </div>
        <div class="flex items-center justify-between bg-slate-950/40 px-2.5 py-1.5 rounded border border-slate-800/60">
          <span class="text-slate-400">L / R:</span>
          <span class="text-cyan-300">Q / E</span>
        </div>
        <div class="flex items-center justify-between bg-slate-950/40 px-2.5 py-1.5 rounded border border-slate-800/60">
          <span class="text-slate-400">START:</span>
          <span class="text-emerald-300">Enter</span>
        </div>
        <div class="flex items-center justify-between bg-slate-950/40 px-2.5 py-1.5 rounded border border-slate-800/60">
          <span class="text-slate-400">SELECT:</span>
          <span class="text-emerald-300">Shift</span>
        </div>
      </div>
    </div>

    <!-- Available ROMs Card -->
    <div v-if="roms && roms.length > 0" class="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-xl text-xs">
      <div class="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3 flex items-center justify-between">
        <span>Available Discovered ROMs</span>
        <span class="text-slate-500 font-mono text-[10px]">{{ roms.length }} found</span>
      </div>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div
          v-for="r in roms"
          :key="r.path"
          class="flex items-center justify-between bg-slate-950/60 p-2.5 rounded-lg border border-slate-800 hover:border-cyan-700/80 transition"
        >
          <div class="truncate mr-2">
            <div class="font-mono text-slate-200 truncate font-semibold">{{ r.name }}</div>
            <div class="text-[10px] text-slate-500">{{ r.platform }} • {{ formatBytes(r.size) }}</div>
          </div>
          <button
            class="bg-cyan-900/60 hover:bg-cyan-600 text-cyan-200 hover:text-white px-2.5 py-1 rounded text-[11px] font-medium transition whitespace-nowrap"
            @click="emit('loadRom', r.path)"
          >
            Load
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
