<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{
    screenText?: string;
    rawText?: string;
}>();

const rawRows = computed<string[]>(() => {
    if (!props.rawText) return [];
    return props.rawText.split('\n');
});
</script>

<template>
  <div class="flex flex-col space-y-4">
    <!-- Parsed Dialogue Box Card -->
    <div class="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-xl flex flex-col space-y-3">
      <div class="flex items-center justify-between border-b border-slate-800 pb-2">
        <h3 class="font-bold text-xs text-slate-200 uppercase tracking-wider">💬 Parsed Dialogue Box ($C3A0 Grid)</h3>
        <span class="text-[11px] text-slate-500 font-mono">Lines 13-17</span>
      </div>
      <div
        class="bg-slate-950 p-4 rounded-lg border border-slate-800 font-mono text-sm text-emerald-300 whitespace-pre-wrap min-h-[90px] leading-relaxed select-text"
      >
        {{ screenText && screenText.trim() ? screenText : 'No dialogue text detected.' }}
      </div>
    </div>

    <!-- Raw 18×20 Screen Grid Card -->
    <div class="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-xl flex flex-col space-y-3">
      <div class="flex items-center justify-between border-b border-slate-800 pb-2">
        <h3 class="font-bold text-xs text-slate-200 uppercase tracking-wider">🖥️ Raw 18×20 Screen Grid ($C3A0 - $C507)</h3>
        <span class="text-[11px] text-slate-500 font-mono">360 Bytes • 20 Cols × 18 Rows</span>
      </div>

      <div class="overflow-x-auto bg-slate-950 p-4 rounded-lg border border-slate-800">
        <div class="min-w-[420px] font-mono text-xs text-slate-300 select-text">
          <!-- Column Index Header -->
          <div class="flex items-center text-slate-600 text-[10px] pb-1.5 border-b border-slate-800/80 mb-1.5 select-none">
            <span class="w-12 shrink-0 font-bold text-slate-500">ROW</span>
            <div class="grid grid-cols-20 flex-1 text-center text-cyan-400/80 font-bold">
              <span v-for="c in 20" :key="c">{{ (c - 1) % 10 }}</span>
            </div>
          </div>

          <!-- Empty State -->
          <div v-if="rawRows.length === 0" class="py-6 text-center text-slate-600 italic">
            No screen text memory available.
          </div>

          <!-- Rows -->
          <div
            v-for="(row, idx) in rawRows"
            :key="idx"
            class="flex items-center hover:bg-slate-900/60 rounded px-0.5 py-0.5 transition"
          >
            <span class="w-12 shrink-0 text-slate-500 text-[10px] select-none font-mono">#{{ String(idx).padStart(2, '0') }}</span>
            <div class="grid grid-cols-20 flex-1 text-center">
              <span
                v-for="(char, cIdx) in row.padEnd(20, ' ').slice(0, 20).split('')"
                :key="cIdx"
                class="inline-block whitespace-pre"
                :class="char.trim() ? 'text-slate-100 font-medium' : 'text-slate-700'"
              >
                {{ char }}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.grid-cols-20 {
  grid-template-columns: repeat(20, minmax(0, 1fr));
}
</style>
