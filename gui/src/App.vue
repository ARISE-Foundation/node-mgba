<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useEmulatorSocket } from './composables/useEmulatorSocket.js';

import ScreenView from './components/ScreenView.vue';
import RomManager from './components/RomManager.vue';
import SavestateManager from './components/SavestateManager.vue';
import VirtualController from './components/VirtualController.vue';
import PartyInspector from './components/PartyInspector.vue';
import InventoryInspector from './components/InventoryInspector.vue';
import WorldInspector from './components/WorldInspector.vue';
import ScreenTextInspector from './components/ScreenTextInspector.vue';
import SequenceRunner from './components/SequenceRunner.vue';
import RomInfoInspector from './components/RomInfoInspector.vue';

const {
    isConnected,
    isLooping,
    isMuted,
    romInfo,
    latestFrame,
    gameState,
    fps,
    frameCounter,
    keyframes,
    savestates,
    roms,
    lastTurnResult,
    toasts,
    showToast,
    step,
    stepSequence,
    toggleLoop,
    toggleMute,
    reset,
    keyDown,
    keyUp,
    quickSave,
    quickLoad,
    loadState,
    uploadState,
    refreshSavestates,
    loadRom,
    uploadRom,
    refreshRoms,
} = useEmulatorSocket();

interface TabItem {
    id: string;
    label: string;
    icon: string;
    badge?: string | number;
}

const availableTabs = computed<TabItem[]>(() => {
    const tabs: TabItem[] = [];

    if (gameState.value?.party !== undefined) {
        tabs.push({
            id: 'party',
            label: 'Party & Box',
            icon: '🐾',
            badge: gameState.value.party.length,
        });
    }

    if (gameState.value?.inventory !== undefined || gameState.value?.storedItems !== undefined) {
        tabs.push({
            id: 'inventory',
            label: 'Bag & PC',
            icon: '🎒',
            badge: (gameState.value?.inventory?.length ?? 0) + (gameState.value?.storedItems?.length ?? 0),
        });
    }

    if (gameState.value?.map !== undefined) {
        tabs.push({
            id: 'world',
            label: 'World & NPCs',
            icon: '🗺️',
            badge: gameState.value.map.objects?.length ?? 0,
        });
    }

    if (gameState.value?.screenText !== undefined || gameState.value?.rawText !== undefined) {
        tabs.push({
            id: 'text',
            label: 'Screen Text',
            icon: '💬',
        });
    }

    tabs.push({
        id: 'sequence',
        label: 'Sequence Runner',
        icon: '⚡',
    });

    tabs.push({
        id: 'info',
        label: 'ROM & System',
        icon: '💾',
    });

    return tabs;
});

const activeTab = ref<string>('sequence');

watch(availableTabs, (newTabs) => {
    if (!newTabs.some(t => t.id === activeTab.value)) {
        activeTab.value = newTabs[0]?.id ?? 'sequence';
    }
}, { immediate: true });
</script>

<template>
  <div class="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
    <!-- Main Top Navigation Bar -->
    <header class="bg-slate-900 border-b border-slate-800 px-6 py-3 flex items-center justify-between shadow-md">
      <div class="flex items-center space-x-3">
        <div class="flex items-center space-x-2">
          <span
            class="h-3 w-3 rounded-full"
            :class="isConnected ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'"
          />
          <h1 class="font-bold text-base tracking-tight text-white font-mono">
            node-mgba <span class="text-xs text-emerald-400 font-sans font-semibold">Studio</span>
          </h1>
        </div>
        <div class="h-4 w-px bg-slate-750 mx-2" />
        <div class="flex items-center space-x-2 text-xs font-mono">
          <span class="text-slate-300 font-semibold">{{ romInfo?.title || 'Unknown ROM' }}</span>
          <span v-if="romInfo?.platform" class="text-slate-500">({{ romInfo.platform }})</span>
        </div>
      </div>

      <div class="flex items-center space-x-3 text-xs font-medium">
        <button
          class="flex items-center space-x-1.5 px-3 py-1 rounded border transition font-mono"
          :class="isMuted ? 'bg-slate-800 text-slate-400 border-slate-700 hover:text-slate-200' : 'bg-emerald-950 text-emerald-300 border-emerald-700/60 shadow-sm'"
          title="Toggle live emulator audio stream"
          @click="toggleMute"
        >
          <span>{{ isMuted ? '🔇 Muted' : '🔊 Audio ON' }}</span>
        </button>
        <div class="bg-slate-800/80 px-3 py-1 rounded border border-slate-700/60">
          <span class="text-slate-500 mr-1">Frame:</span>
          <span class="font-mono text-cyan-300">{{ frameCounter }}</span>
        </div>
        <div class="bg-slate-800/80 px-3 py-1 rounded border border-slate-700/60">
          <span class="text-slate-500 mr-1">FPS:</span>
          <span class="font-mono text-amber-300">{{ Math.round(fps) }}</span>
        </div>
      </div>
    </header>

    <!-- Main Workspace Grid (12 Columns) -->
    <main class="flex-1 p-6 grid grid-cols-1 lg:grid-cols-12 gap-6 max-w-7xl mx-auto w-full">
      <!-- Left Column: Display & Hardware Controller & Savestate Manager (5 Cols) -->
      <div class="lg:col-span-5 flex flex-col space-y-4">
        <ScreenView
          :frame="latestFrame"
          :is-looping="isLooping"
          :is-muted="isMuted"
          @step="step"
          @toggle-loop="toggleLoop"
          @toggle-mute="toggleMute"
          @reset="reset"
        />

        <VirtualController
          @key-down="keyDown"
          @key-up="keyUp"
        />

        <RomManager
          :current-rom="romInfo"
          :roms="roms"
          @load-rom="loadRom"
          @upload-rom="uploadRom"
          @refresh="refreshRoms"
          @error="(msg) => showToast(msg, false)"
        />

        <SavestateManager
          :savestates="savestates"
          @quick-save="quickSave"
          @quick-load="quickLoad"
          @load-state="loadState"
          @upload-state="uploadState"
          @refresh="refreshSavestates"
          @error="(msg) => showToast(msg, false)"
        />
      </div>

      <!-- Right Column: State & Telemetry Inspector (7 Cols) -->
      <div class="lg:col-span-7 flex flex-col space-y-4">
        <!-- Dynamic Navigation Tab Header -->
        <div class="bg-slate-900 border border-slate-800 rounded-xl p-1.5 shadow-xl flex space-x-2 text-xs font-semibold select-none overflow-x-auto">
          <button
            v-for="tab in availableTabs"
            :key="tab.id"
            class="px-3 py-2 rounded-lg transition whitespace-nowrap flex items-center space-x-1.5"
            :class="activeTab === tab.id ? 'bg-slate-800 text-cyan-300 font-bold border border-slate-700 shadow-sm' : 'text-slate-400 hover:text-slate-200'"
            @click="activeTab = tab.id"
          >
            <span>{{ tab.icon }}</span>
            <span>{{ tab.label }}</span>
            <span
              v-if="tab.badge !== undefined"
              class="ml-1 px-1.5 py-0.5 rounded-full text-[10px]"
              :class="activeTab === tab.id ? 'bg-cyan-950 text-cyan-300 border border-cyan-800' : 'bg-slate-800 text-slate-400'"
            >
              {{ tab.badge }}
            </span>
          </button>
        </div>

        <!-- Tab Content 1: Party & Box -->
        <PartyInspector
          v-if="activeTab === 'party'"
          :player="gameState?.player"
          :pokedex-progress="gameState?.pokedexProgress"
          :party="gameState?.party || []"
          :current-box-number="gameState?.currentBoxNumber"
          :stored-pokemon="gameState?.storedPokemon || []"
        />

        <!-- Tab Content 2: Inventory & Items -->
        <InventoryInspector
          v-else-if="activeTab === 'inventory'"
          :inventory="gameState?.inventory || []"
          :stored-items="gameState?.storedItems || []"
        />

        <!-- Tab Content 3: World & NPCs -->
        <WorldInspector
          v-else-if="activeTab === 'world'"
          :player="gameState?.player"
          :map="gameState?.map"
        />

        <!-- Tab Content 4: Screen Text -->
        <ScreenTextInspector
          v-else-if="activeTab === 'text'"
          :screen-text="gameState?.screenText"
          :raw-text="gameState?.rawText"
        />

        <!-- Tab Content 5: Sequence Runner & Keyframes -->
        <SequenceRunner
          v-else-if="activeTab === 'sequence'"
          :last-turn-result="lastTurnResult"
          :keyframes="keyframes"
          @run-sequence="stepSequence"
          @error="(msg) => showToast(msg, false)"
        />

        <!-- Tab Content 6: ROM & System Diagnostics -->
        <RomInfoInspector
          v-else-if="activeTab === 'info'"
          :rom-info="romInfo"
          :roms="roms"
          :fps="fps"
          :frame-counter="frameCounter"
          :is-looping="isLooping"
          @load-rom="loadRom"
        />
      </div>
    </main>

    <!-- Toast Notification Container -->
    <div class="fixed bottom-6 right-6 z-50 flex flex-col space-y-2 pointer-events-none">
      <div
        v-for="toast in toasts"
        :key="toast.id"
        class="px-4 py-2.5 rounded-lg shadow-xl text-xs font-mono border pointer-events-auto transition-all transform flex items-center space-x-2"
        :class="toast.isSuccess ? 'bg-emerald-950/90 border-emerald-500/80 text-emerald-200' : 'bg-rose-950/90 border-rose-500/80 text-rose-200'"
      >
        <span>{{ toast.isSuccess ? '✓' : '⚠️' }}</span>
        <span>{{ toast.message }}</span>
      </div>
    </div>
  </div>
</template>

