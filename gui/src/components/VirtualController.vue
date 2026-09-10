<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import type { ButtonName } from '../types.js';

const emit = defineEmits<{
    (e: 'keyDown', button: ButtonName): void;
    (e: 'keyUp', button: ButtonName): void;
}>();

const activeButtons = ref<Set<ButtonName>>(new Set());

const keyMap: Record<string, ButtonName> = {
    'ArrowUp': 'UP',
    'KeyW': 'UP',
    'ArrowDown': 'DOWN',
    'KeyS': 'DOWN',
    'ArrowLeft': 'LEFT',
    'KeyA': 'LEFT',
    'ArrowRight': 'RIGHT',
    'KeyD': 'RIGHT',
    'KeyZ': 'A',
    'KeyJ': 'A',
    'KeyX': 'B',
    'KeyK': 'B',
    'KeyQ': 'L',
    'KeyE': 'R',
    'Enter': 'START',
    'ShiftRight': 'SELECT',
    'ShiftLeft': 'SELECT',
};

function handleButtonDown(btn: ButtonName): void {
    if (!activeButtons.value.has(btn)) {
        activeButtons.value.add(btn);
        emit('keyDown', btn);
    }
}

function handleButtonUp(btn: ButtonName): void {
    if (activeButtons.value.has(btn)) {
        activeButtons.value.delete(btn);
        emit('keyUp', btn);
    }
}

function handleWindowKeyDown(e: KeyboardEvent): void {
    const target = e.target as HTMLElement | null;
    if (target && ['INPUT', 'TEXTAREA'].includes(target.tagName)) return;

    const btn = keyMap[e.code];
    if (btn) {
        e.preventDefault();
        handleButtonDown(btn);
    }
}

function handleWindowKeyUp(e: KeyboardEvent): void {
    const target = e.target as HTMLElement | null;
    if (target && ['INPUT', 'TEXTAREA'].includes(target.tagName)) return;

    const btn = keyMap[e.code];
    if (btn) {
        e.preventDefault();
        handleButtonUp(btn);
    }
}

onMounted(() => {
    window.addEventListener('keydown', handleWindowKeyDown);
    window.addEventListener('keyup', handleWindowKeyUp);
});

onUnmounted(() => {
    window.removeEventListener('keydown', handleWindowKeyDown);
    window.removeEventListener('keyup', handleWindowKeyUp);
});
</script>

<template>
  <div class="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-xl flex flex-col items-center select-none">
    <div class="text-xs text-slate-500 font-semibold mb-3 tracking-wider uppercase">
      Hardware Controller (Live Responsive)
    </div>

    <!-- Shoulder Buttons (L / R) -->
    <div class="w-full flex items-center justify-between px-6 mb-3">
      <div class="flex flex-col items-center">
        <button
          class="px-5 py-1.5 bg-slate-800 hover:bg-slate-700 active:bg-cyan-600 rounded-t-lg border-t-2 border-x border-slate-700 text-xs font-bold text-slate-300 shadow transition font-mono"
          :class="{ '!bg-cyan-600 !text-white': activeButtons.has('L') }"
          title="Left Shoulder Button (Q)"
          @mousedown="handleButtonDown('L')"
          @mouseup="handleButtonUp('L')"
          @mouseleave="handleButtonUp('L')"
          @touchstart.prevent="handleButtonDown('L')"
          @touchend.prevent="handleButtonUp('L')"
        >
          [ L ]
        </button>
        <span class="text-[9px] text-slate-500 font-mono mt-0.5">Key: Q</span>
      </div>

      <div class="flex flex-col items-center">
        <button
          class="px-5 py-1.5 bg-slate-800 hover:bg-slate-700 active:bg-cyan-600 rounded-t-lg border-t-2 border-x border-slate-700 text-xs font-bold text-slate-300 shadow transition font-mono"
          :class="{ '!bg-cyan-600 !text-white': activeButtons.has('R') }"
          title="Right Shoulder Button (E)"
          @mousedown="handleButtonDown('R')"
          @mouseup="handleButtonUp('R')"
          @mouseleave="handleButtonUp('R')"
          @touchstart.prevent="handleButtonDown('R')"
          @touchend.prevent="handleButtonUp('R')"
        >
          [ R ]
        </button>
        <span class="text-[9px] text-slate-500 font-mono mt-0.5">Key: E</span>
      </div>
    </div>

    <div class="w-full flex items-center justify-between px-4">
      <!-- Cross D-Pad -->
      <div class="relative w-28 h-28">
        <button
          class="absolute top-0 left-9 w-10 h-10 bg-slate-800 hover:bg-slate-700 active:bg-cyan-600 rounded-t-md flex items-center justify-center text-slate-300 shadow transition text-xs font-bold"
          :class="{ '!bg-cyan-600 !text-white': activeButtons.has('UP') }"
          @mousedown="handleButtonDown('UP')"
          @mouseup="handleButtonUp('UP')"
          @mouseleave="handleButtonUp('UP')"
          @touchstart.prevent="handleButtonDown('UP')"
          @touchend.prevent="handleButtonUp('UP')"
        >
          ▲
        </button>
        <button
          class="absolute top-9 left-0 w-10 h-10 bg-slate-800 hover:bg-slate-700 active:bg-cyan-600 rounded-l-md flex items-center justify-center text-slate-300 shadow transition text-xs font-bold"
          :class="{ '!bg-cyan-600 !text-white': activeButtons.has('LEFT') }"
          @mousedown="handleButtonDown('LEFT')"
          @mouseup="handleButtonUp('LEFT')"
          @mouseleave="handleButtonUp('LEFT')"
          @touchstart.prevent="handleButtonDown('LEFT')"
          @touchend.prevent="handleButtonUp('LEFT')"
        >
          ◀
        </button>
        <div class="absolute top-9 left-9 w-10 h-10 bg-slate-800" />
        <button
          class="absolute top-9 right-0 w-10 h-10 bg-slate-800 hover:bg-slate-700 active:bg-cyan-600 rounded-r-md flex items-center justify-center text-slate-300 shadow transition text-xs font-bold"
          :class="{ '!bg-cyan-600 !text-white': activeButtons.has('RIGHT') }"
          @mousedown="handleButtonDown('RIGHT')"
          @mouseup="handleButtonUp('RIGHT')"
          @mouseleave="handleButtonUp('RIGHT')"
          @touchstart.prevent="handleButtonDown('RIGHT')"
          @touchend.prevent="handleButtonUp('RIGHT')"
        >
          ▶
        </button>
        <button
          class="absolute bottom-0 left-9 w-10 h-10 bg-slate-800 hover:bg-slate-700 active:bg-cyan-600 rounded-b-md flex items-center justify-center text-slate-300 shadow transition text-xs font-bold"
          :class="{ '!bg-cyan-600 !text-white': activeButtons.has('DOWN') }"
          @mousedown="handleButtonDown('DOWN')"
          @mouseup="handleButtonUp('DOWN')"
          @mouseleave="handleButtonUp('DOWN')"
          @touchstart.prevent="handleButtonDown('DOWN')"
          @touchend.prevent="handleButtonUp('DOWN')"
        >
          ▼
        </button>
      </div>

      <!-- Action Buttons (Angled) -->
      <div class="flex space-x-4 items-center -rotate-12">
        <div class="flex flex-col items-center">
          <button
            class="w-12 h-12 rounded-full bg-rose-700 hover:bg-rose-600 active:bg-rose-500 flex items-center justify-center font-bold text-white shadow-lg text-sm transition"
            :class="{ '!bg-rose-500 ring-2 ring-rose-300': activeButtons.has('B') }"
            @mousedown="handleButtonDown('B')"
            @mouseup="handleButtonUp('B')"
            @mouseleave="handleButtonUp('B')"
            @touchstart.prevent="handleButtonDown('B')"
            @touchend.prevent="handleButtonUp('B')"
          >
            B
          </button>
          <span class="text-[10px] text-slate-500 font-mono mt-1">Key: X</span>
        </div>
        <div class="flex flex-col items-center">
          <button
            class="w-12 h-12 rounded-full bg-rose-700 hover:bg-rose-600 active:bg-rose-500 flex items-center justify-center font-bold text-white shadow-lg text-sm transition"
            :class="{ '!bg-rose-500 ring-2 ring-rose-300': activeButtons.has('A') }"
            @mousedown="handleButtonDown('A')"
            @mouseup="handleButtonUp('A')"
            @mouseleave="handleButtonUp('A')"
            @touchstart.prevent="handleButtonDown('A')"
            @touchend.prevent="handleButtonUp('A')"
          >
            A
          </button>
          <span class="text-[10px] text-slate-500 font-mono mt-1">Key: Z</span>
        </div>
      </div>
    </div>

    <!-- Select & Start Buttons -->
    <div class="flex space-x-6 mt-4">
      <div class="flex flex-col items-center">
        <button
          class="w-12 h-4 bg-slate-800 hover:bg-slate-700 active:bg-cyan-600 rounded-full border border-slate-700 shadow transition"
          :class="{ '!bg-cyan-600': activeButtons.has('SELECT') }"
          @mousedown="handleButtonDown('SELECT')"
          @mouseup="handleButtonUp('SELECT')"
          @mouseleave="handleButtonUp('SELECT')"
          @touchstart.prevent="handleButtonDown('SELECT')"
          @touchend.prevent="handleButtonUp('SELECT')"
        />
        <span class="text-[9px] text-slate-500 font-semibold mt-1">SELECT</span>
      </div>
      <div class="flex flex-col items-center">
        <button
          class="w-12 h-4 bg-slate-800 hover:bg-slate-700 active:bg-cyan-600 rounded-full border border-slate-700 shadow transition"
          :class="{ '!bg-cyan-600': activeButtons.has('START') }"
          @mousedown="handleButtonDown('START')"
          @mouseup="handleButtonUp('START')"
          @mouseleave="handleButtonUp('START')"
          @touchstart.prevent="handleButtonDown('START')"
          @touchend.prevent="handleButtonUp('START')"
        />
        <span class="text-[9px] text-slate-500 font-semibold mt-1">START</span>
      </div>
    </div>
  </div>
</template>

