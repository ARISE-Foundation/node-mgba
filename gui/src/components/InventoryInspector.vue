<script setup lang="ts">
import type { InventoryItem } from '../types.js';

defineProps<{
    inventory: readonly InventoryItem[];
    storedItems: readonly InventoryItem[];
}>();
</script>

<template>
  <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
    <!-- Bag Items Card -->
    <div class="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-xl flex flex-col space-y-3">
      <div class="flex items-center justify-between border-b border-slate-800 pb-2">
        <h3 class="font-bold text-xs text-slate-200 uppercase tracking-wider">🎒 Bag Inventory ($D31D)</h3>
        <span class="text-xs text-slate-400 font-mono">{{ inventory.length }} items</span>
      </div>
      <div v-if="inventory.length === 0" class="flex flex-col space-y-1">
        <span class="text-xs text-slate-600 italic">Bag is empty.</span>
      </div>
      <div v-else class="flex flex-col space-y-1 max-h-96 overflow-y-auto pr-1">
        <div
          v-for="(item, idx) in inventory"
          :key="idx"
          class="bg-slate-950/80 px-2.5 py-1.5 rounded border border-slate-800/80 flex items-center justify-between text-xs font-mono"
        >
          <div class="flex items-center space-x-2">
            <span class="text-slate-500 text-[10px]">{{ idx + 1 }}.</span>
            <span class="text-slate-200">{{ item.name }}</span>
          </div>
          <div class="flex items-center space-x-2">
            <span class="text-slate-500 text-[10px]">ID: {{ item.id }}</span>
            <span class="text-emerald-400 font-bold">×{{ item.quantity }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- PC Storage Items Card -->
    <div class="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-xl flex flex-col space-y-3">
      <div class="flex items-center justify-between border-b border-slate-800 pb-2">
        <h3 class="font-bold text-xs text-slate-200 uppercase tracking-wider">💾 PC Stored Items ($D53A)</h3>
        <span class="text-xs text-slate-400 font-mono">{{ storedItems.length }} items</span>
      </div>
      <div v-if="storedItems.length === 0" class="flex flex-col space-y-1">
        <span class="text-xs text-slate-600 italic">PC item storage is empty.</span>
      </div>
      <div v-else class="flex flex-col space-y-1 max-h-96 overflow-y-auto pr-1">
        <div
          v-for="(item, idx) in storedItems"
          :key="idx"
          class="bg-slate-950/80 px-2.5 py-1.5 rounded border border-slate-800/80 flex items-center justify-between text-xs font-mono"
        >
          <div class="flex items-center space-x-2">
            <span class="text-slate-500 text-[10px]">{{ idx + 1 }}.</span>
            <span class="text-slate-200">{{ item.name }}</span>
          </div>
          <div class="flex items-center space-x-2">
            <span class="text-slate-500 text-[10px]">ID: {{ item.id }}</span>
            <span class="text-slate-300 font-bold">×{{ item.quantity }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

