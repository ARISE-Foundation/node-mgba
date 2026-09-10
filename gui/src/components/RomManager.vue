<script setup lang="ts">
import { ref } from 'vue';
import type { RomEntry, RomInfo } from '../types.js';

defineProps<{
    currentRom: RomInfo | null;
    roms: readonly RomEntry[];
}>();

const emit = defineEmits<{
    (e: 'loadRom', path: string): void;
    (e: 'uploadRom', filename: string, base64: string): void;
    (e: 'refresh'): void;
    (e: 'error', message: string): void;
}>();

const selectedRomPath = ref<string>('');
const customRomPath = ref<string>('');

function handleLoadSelected(): void {
    if (!selectedRomPath.value) {
        emit('error', 'Please select a ROM from the list');
        return;
    }
    emit('loadRom', selectedRomPath.value);
}

function handleLoadCustom(): void {
    const p = customRomPath.value.trim();
    if (!p) {
        emit('error', 'Please enter a valid ROM path');
        return;
    }
    emit('loadRom', p);
}

function handleFileUpload(e: Event): void {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
        const result = reader.result as string;
        const base64 = result.split(',')[1] ?? '';
        emit('uploadRom', file.name, base64);
        input.value = '';
    };
    reader.onerror = () => {
        emit('error', 'Failed to read uploaded ROM file');
    };
    reader.readAsDataURL(file);
}
</script>

<template>
  <div class="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-xl flex flex-col space-y-3">
    <div class="flex items-center justify-between border-b border-slate-800 pb-2">
      <div class="flex items-center space-x-2">
        <span class="text-xs font-bold text-slate-300 uppercase tracking-wider">🎮 ROM Manager</span>
        <span
          v-if="currentRom"
          class="text-[10px] px-1.5 py-0.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-800 font-mono"
        >
          {{ currentRom.platform }}
        </span>
      </div>
      <button
        class="text-[11px] text-cyan-400 hover:text-cyan-300 transition font-medium"
        title="Rescan directory for ROM files"
        @click="emit('refresh')"
      >
        ↻ Scan ROMs
      </button>
    </div>

    <!-- Detected ROMs Selector -->
    <div class="flex space-x-2">
      <select
        v-model="selectedRomPath"
        class="flex-1 bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-cyan-500 font-mono"
      >
        <option value="">-- Discovered ROMs ({{ roms.length }}) --</option>
        <option
          v-for="r in roms"
          :key="r.path"
          :value="r.path"
        >
          {{ r.name }} [{{ r.platform }}] ({{ (r.size / (1024 * 1024)).toFixed(1) }} MB)
        </option>
      </select>
      <button
        class="bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-medium px-3 py-1.5 rounded transition shadow-sm"
        @click="handleLoadSelected"
      >
        Load
      </button>
    </div>

    <!-- Custom Path Input -->
    <div class="flex space-x-2">
      <input
        v-model="customRomPath"
        type="text"
        placeholder="/path/to/game.gba"
        class="flex-1 bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-xs text-slate-200 font-mono focus:outline-none focus:border-cyan-500"
        @keydown.enter="handleLoadCustom"
      >
      <button
        class="bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium px-3 py-1.5 rounded border border-slate-700 transition whitespace-nowrap"
        @click="handleLoadCustom"
      >
        Load Path
      </button>
    </div>

    <!-- Upload ROM File -->
    <div class="flex space-x-2 pt-1 border-t border-slate-800/80">
      <label class="flex-1 bg-slate-800/80 hover:bg-slate-750 text-slate-300 py-1.5 rounded border border-slate-750 text-center cursor-pointer transition text-xs font-medium hover:text-white">
        <span>📁 Upload ROM (.gba, .gb, .gbc)</span>
        <input
          type="file"
          accept=".gba,.gb,.gbc,.bin"
          class="hidden"
          @change="handleFileUpload"
        >
      </label>
    </div>
  </div>
</template>
