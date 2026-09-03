<script setup lang="ts">
import { ref } from 'vue';
import type { SavestateEntry } from '../types.js';

defineProps<{
    savestates: readonly SavestateEntry[];
}>();

const emit = defineEmits<{
    (e: 'quickSave'): void;
    (e: 'quickLoad'): void;
    (e: 'loadState', path: string): void;
    (e: 'uploadState', filename: string, base64: string): void;
    (e: 'refresh'): void;
    (e: 'error', message: string): void;
}>();

const selectedStatePath = ref<string>('');
const customStatePath = ref<string>('');

function handleLoadSelected(): void {
    if (!selectedStatePath.value) {
        emit('error', 'Please select a savestate from the list');
        return;
    }
    emit('loadState', selectedStatePath.value);
}

function handleLoadCustom(): void {
    const p = customStatePath.value.trim();
    if (!p) {
        emit('error', 'Please enter a valid savestate path');
        return;
    }
    emit('loadState', p);
}

function handleFileUpload(e: Event): void {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
        const result = reader.result as string;
        const base64 = result.split(',')[1] ?? '';
        emit('uploadState', file.name, base64);
        input.value = '';
    };
    reader.onerror = () => {
        emit('error', 'Failed to read uploaded savestate file');
    };
    reader.readAsDataURL(file);
}
</script>

<template>
  <div class="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-xl flex flex-col space-y-3">
    <div class="flex items-center justify-between border-b border-slate-800 pb-2">
      <span class="text-xs font-bold text-slate-300 uppercase tracking-wider">💾 Savestate Manager</span>
      <button
        class="text-[11px] text-emerald-400 hover:text-emerald-300 transition"
        @click="emit('refresh')"
      >
        ↻ Scan Files
      </button>
    </div>

    <!-- Detected States Selector -->
    <div class="flex space-x-2">
      <select
        v-model="selectedStatePath"
        class="flex-1 bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-emerald-500 font-mono"
      >
        <option value="">-- Discovered Savestates --</option>
        <option
          v-for="st in savestates"
          :key="st.path"
          :value="st.path"
        >
          {{ st.name }} ({{ Math.round(st.size / 1024) }} KB)
        </option>
      </select>
      <button
        class="bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium px-3 py-1.5 rounded transition"
        @click="handleLoadSelected"
      >
        Load
      </button>
    </div>

    <!-- Custom Path Input -->
    <div class="flex space-x-2">
      <input
        v-model="customStatePath"
        type="text"
        placeholder="/path/to/savestate.state"
        class="flex-1 bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-xs text-slate-200 font-mono focus:outline-none focus:border-emerald-500"
        @keydown.enter="handleLoadCustom"
      >
      <button
        class="bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium px-3 py-1.5 rounded border border-slate-700 transition"
        @click="handleLoadCustom"
      >
        Load Path
      </button>
    </div>

    <!-- File Picker Upload & Quick Buttons -->
    <div class="grid grid-cols-3 gap-2 pt-1 text-xs">
      <label class="bg-slate-800 hover:bg-slate-700 text-slate-300 py-1.5 rounded border border-slate-700 text-center cursor-pointer transition flex items-center justify-center">
        <span>Upload File</span>
        <input
          type="file"
          class="hidden"
          accept=".ss0,.ss1,.ss2,.ss3,.state,*"
          @change="handleFileUpload"
        >
      </label>
      <button
        class="bg-slate-800 hover:bg-slate-700 text-slate-300 py-1.5 rounded border border-slate-700 transition"
        @click="emit('quickSave')"
      >
        Quick Save
      </button>
      <button
        class="bg-slate-800 hover:bg-slate-700 text-slate-300 py-1.5 rounded border border-slate-700 transition"
        @click="emit('quickLoad')"
      >
        Quick Load
      </button>
    </div>
  </div>
</template>

