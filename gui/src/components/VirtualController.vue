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
  <div class="flex flex-col items-center select-none w-full">
    <!-- Sculpted Top Shoulder Triggers Row -->
    <div class="w-full flex items-end justify-between relative z-10">
      <!-- L Trigger -->
      <button
        class="w-28 sm:w-32 flex items-center justify-between px-4 py-2 rounded-tl-2xl rounded-tr-md border-t border-l border-r border-slate-700/80 transition-all duration-75 select-none shadow-sm cursor-pointer"
        :class="activeButtons.has('L')
          ? 'bg-cyan-500 text-slate-950 border-cyan-400 shadow-[0_0_14px_rgba(6,182,212,0.7)] translate-y-0.5'
          : 'bg-slate-800/90 hover:bg-slate-800 text-slate-400 shadow-[0_2px_4px_rgba(0,0,0,0.3)]'"
        title="Left Shoulder Button (Q)"
        @mousedown="handleButtonDown('L')"
        @mouseup="handleButtonUp('L')"
        @mouseleave="handleButtonUp('L')"
        @touchstart.prevent="handleButtonDown('L')"
        @touchend.prevent="handleButtonUp('L')"
      >
        <span class="text-xs font-mono font-black tracking-widest">L</span>
        <div class="flex flex-col gap-0.5 opacity-40">
          <span class="w-4 h-[1.5px] bg-current rounded-full" />
          <span class="w-4 h-[1.5px] bg-current rounded-full" />
          <span class="w-4 h-[1.5px] bg-current rounded-full" />
        </div>
      </button>

      <!-- Center Top Bezel Contour -->
      <div class="flex-1 mx-2 h-3 bg-slate-950/80 rounded-t-md border-t border-x border-slate-800/80 shadow-inner flex items-center justify-center">
        <div class="w-16 h-1 bg-slate-800 rounded-full opacity-60" />
      </div>

      <!-- R Trigger -->
      <button
        class="w-28 sm:w-32 flex items-center justify-between px-4 py-2 rounded-tr-2xl rounded-tl-md border-t border-r border-l border-slate-700/80 transition-all duration-75 select-none shadow-sm cursor-pointer"
        :class="activeButtons.has('R')
          ? 'bg-cyan-500 text-slate-950 border-cyan-400 shadow-[0_0_14px_rgba(6,182,212,0.7)] translate-y-0.5'
          : 'bg-slate-800/90 hover:bg-slate-800 text-slate-400 shadow-[0_2px_4px_rgba(0,0,0,0.3)]'"
        title="Right Shoulder Button (E)"
        @mousedown="handleButtonDown('R')"
        @mouseup="handleButtonUp('R')"
        @mouseleave="handleButtonUp('R')"
        @touchstart.prevent="handleButtonDown('R')"
        @touchend.prevent="handleButtonUp('R')"
      >
        <div class="flex flex-col gap-0.5 opacity-40">
          <span class="w-4 h-[1.5px] bg-current rounded-full" />
          <span class="w-4 h-[1.5px] bg-current rounded-full" />
          <span class="w-4 h-[1.5px] bg-current rounded-full" />
        </div>
        <span class="text-xs font-mono font-black tracking-widest">R</span>
      </button>
    </div>

    <!-- Main Controller Face Chassis -->
    <div class="w-full bg-slate-900/95 border border-slate-800 p-4 shadow-[0_12px_28px_rgba(0,0,0,0.5)] rounded-b-2xl rounded-t-none -mt-px relative">
      <div class="grid grid-cols-12 w-full items-center">
        <!-- 1. LEFT COLUMN: Continuous Seamless SVG Cross D-Pad -->
        <div class="col-span-5 flex items-center justify-start pl-2 sm:pl-3">
          <div class="w-28 h-28 flex items-center justify-center shrink-0">
            <svg class="w-28 h-28 select-none" viewBox="0 0 100 100">
              <defs>
                <filter id="cyan-arm-glow" x="-30%" y="-30%" width="160%" height="160%">
                  <feDropShadow dx="0" dy="0" stdDeviation="3" flood-color="#06b6d4" flood-opacity="0.85" />
                </filter>
              </defs>

              <!-- Recessed Matte Socket Well -->
              <circle cx="50" cy="50" r="47" fill="#0a0f1d" stroke="#1e293b" stroke-width="1.5" />

              <!-- Continuous Cross Unibody Base Piece -->
              <path
                d="
                  M 39 12
                  L 61 12
                  A 2.5 2.5 0 0 1 63.5 14.5
                  L 63.5 34.5
                  A 2.5 2.5 0 0 0 66 37
                  L 85.5 37
                  A 2.5 2.5 0 0 1 88 39.5
                  L 88 60.5
                  A 2.5 2.5 0 0 1 85.5 63
                  L 66 63
                  A 2.5 2.5 0 0 0 63.5 65.5
                  L 63.5 85.5
                  A 2.5 2.5 0 0 1 61 88
                  L 39 88
                  A 2.5 2.5 0 0 1 36.5 85.5
                  L 36.5 65.5
                  A 2.5 2.5 0 0 0 34 63
                  L 14.5 63
                  A 2.5 2.5 0 0 1 12 60.5
                  L 12 39.5
                  A 2.5 2.5 0 0 1 14.5 37
                  L 34 37
                  A 2.5 2.5 0 0 0 36.5 34.5
                  L 36.5 14.5
                  A 2.5 2.5 0 0 1 39 12
                  Z
                "
                fill="#1e293b"
                stroke="#334155"
                stroke-width="1.2"
              />

              <!-- Active Arm Glow Overlays -->
              <path
                v-if="activeButtons.has('UP')"
                d="M 39 12 L 61 12 A 2.5 2.5 0 0 1 63.5 14.5 L 63.5 45 L 36.5 45 L 36.5 14.5 A 2.5 2.5 0 0 1 39 12 Z"
                fill="#06b6d4"
                filter="url(#cyan-arm-glow)"
              />
              <path
                v-if="activeButtons.has('DOWN')"
                d="M 36.5 55 L 63.5 55 L 63.5 85.5 A 2.5 2.5 0 0 1 61 88 L 39 88 A 2.5 2.5 0 0 1 36.5 85.5 Z"
                fill="#06b6d4"
                filter="url(#cyan-arm-glow)"
              />
              <path
                v-if="activeButtons.has('LEFT')"
                d="M 14.5 37 L 45 37 L 45 63 L 14.5 63 A 2.5 2.5 0 0 1 12 60.5 L 12 39.5 A 2.5 2.5 0 0 1 14.5 37 Z"
                fill="#06b6d4"
                filter="url(#cyan-arm-glow)"
              />
              <path
                v-if="activeButtons.has('RIGHT')"
                d="M 55 37 L 85.5 37 A 2.5 2.5 0 0 1 88 39.5 L 88 60.5 A 2.5 2.5 0 0 1 85.5 63 L 55 63 Z"
                fill="#06b6d4"
                filter="url(#cyan-arm-glow)"
              />

              <!-- Directional Molded Arrow Glyphs -->
              <polygon
                points="50,21 44,28 56,28"
                :fill="activeButtons.has('UP') ? '#020617' : '#94a3b8'"
                class="transition-colors duration-75 pointer-events-none"
              />
              <polygon
                points="50,79 44,72 56,72"
                :fill="activeButtons.has('DOWN') ? '#020617' : '#94a3b8'"
                class="transition-colors duration-75 pointer-events-none"
              />
              <polygon
                points="21,50 28,44 28,56"
                :fill="activeButtons.has('LEFT') ? '#020617' : '#94a3b8'"
                class="transition-colors duration-75 pointer-events-none"
              />
              <polygon
                points="79,50 72,44 72,56"
                :fill="activeButtons.has('RIGHT') ? '#020617' : '#94a3b8'"
                class="transition-colors duration-75 pointer-events-none"
              />

              <!-- Center Concave Pivot Dish & Inner Dimple -->
              <circle cx="50" cy="50" r="9.5" fill="#131c2e" stroke="#334155" stroke-width="1.2" class="pointer-events-none" />
              <circle cx="50" cy="50" r="3.5" fill="#0a0f1d" opacity="0.9" class="pointer-events-none" />

              <!-- Transparent Hitboxes for interactive clicks/touch -->
              <rect
                x="34" y="6" width="32" height="38"
                fill="transparent"
                pointer-events="all"
                class="cursor-pointer"
                @mousedown="handleButtonDown('UP')"
                @mouseup="handleButtonUp('UP')"
                @mouseleave="handleButtonUp('UP')"
                @touchstart.prevent="handleButtonDown('UP')"
                @touchend.prevent="handleButtonUp('UP')"
              />
              <rect
                x="34" y="56" width="32" height="38"
                fill="transparent"
                pointer-events="all"
                class="cursor-pointer"
                @mousedown="handleButtonDown('DOWN')"
                @mouseup="handleButtonUp('DOWN')"
                @mouseleave="handleButtonUp('DOWN')"
                @touchstart.prevent="handleButtonDown('DOWN')"
                @touchend.prevent="handleButtonUp('DOWN')"
              />
              <rect
                x="6" y="34" width="38" height="32"
                fill="transparent"
                pointer-events="all"
                class="cursor-pointer"
                @mousedown="handleButtonDown('LEFT')"
                @mouseup="handleButtonUp('LEFT')"
                @mouseleave="handleButtonUp('LEFT')"
                @touchstart.prevent="handleButtonDown('LEFT')"
                @touchend.prevent="handleButtonUp('LEFT')"
              />
              <rect
                x="56" y="34" width="38" height="32"
                fill="transparent"
                pointer-events="all"
                class="cursor-pointer"
                @mousedown="handleButtonDown('RIGHT')"
                @mouseup="handleButtonUp('RIGHT')"
                @mouseleave="handleButtonUp('RIGHT')"
                @touchstart.prevent="handleButtonDown('RIGHT')"
                @touchend.prevent="handleButtonUp('RIGHT')"
              />
            </svg>
          </div>
        </div>

        <!-- 2. CENTER COLUMN: Angled Rubberized Select and Start (Clean, no status LEDs or text) -->
        <div class="col-span-2 flex flex-col items-center justify-center h-28">
          <div class="flex items-center space-x-3 rotate-[-20deg]">
            <!-- SELECT -->
            <div class="flex flex-col items-center">
              <button
                class="w-7 h-2.5 rounded-full border transition-all duration-75 shadow-sm cursor-pointer select-none"
                :class="activeButtons.has('SELECT')
                  ? 'bg-purple-400 border-purple-300 shadow-[0_0_10px_rgba(192,132,252,0.95)] scale-95'
                  : 'bg-slate-800 hover:bg-slate-750 border-slate-700 shadow-[0_2px_0_#0a0f1d]'"
                title="Select Button (Shift)"
                @mousedown="handleButtonDown('SELECT')"
                @mouseup="handleButtonUp('SELECT')"
                @mouseleave="handleButtonUp('SELECT')"
                @touchstart.prevent="handleButtonDown('SELECT')"
                @touchend.prevent="handleButtonUp('SELECT')"
              />
              <span class="text-[7.5px] font-mono font-bold text-slate-400 tracking-wider mt-1 uppercase">Select</span>
            </div>

            <!-- START -->
            <div class="flex flex-col items-center">
              <button
                class="w-7 h-2.5 rounded-full border transition-all duration-75 shadow-sm cursor-pointer select-none"
                :class="activeButtons.has('START')
                  ? 'bg-purple-400 border-purple-300 shadow-[0_0_10px_rgba(192,132,252,0.95)] scale-95'
                  : 'bg-slate-800 hover:bg-slate-750 border-slate-700 shadow-[0_2px_0_#0a0f1d]'"
                title="Start Button (Enter)"
                @mousedown="handleButtonDown('START')"
                @mouseup="handleButtonUp('START')"
                @mouseleave="handleButtonUp('START')"
                @touchstart.prevent="handleButtonDown('START')"
                @touchend.prevent="handleButtonUp('START')"
              />
              <span class="text-[7.5px] font-mono font-bold text-slate-400 tracking-wider mt-1 uppercase">Start</span>
            </div>
          </div>
        </div>

        <!-- 3. RIGHT COLUMN: Action Buttons (B & A) inside Recessed Angled Track -->
        <div class="col-span-5 flex items-center justify-end pr-2 sm:pr-3 relative">
          <!-- Recessed Oval Track -->
          <div class="rotate-[-22deg] bg-slate-950/90 border border-slate-800/90 rounded-full p-2 shadow-[inset_0_2px_5px_rgba(0,0,0,0.7)] flex items-center space-x-2.5">
            <!-- B BUTTON -->
            <div class="flex flex-col items-center">
              <button
                class="w-10 h-10 rounded-full font-black text-sm flex items-center justify-center transition-all duration-75 border cursor-pointer select-none"
                :class="activeButtons.has('B')
                  ? 'bg-amber-300 border-amber-200 text-slate-950 shadow-[0_0_16px_rgba(251,191,36,1)] translate-y-0.5'
                  : 'bg-amber-500 hover:bg-amber-450 border-amber-300/40 text-slate-950 shadow-[0_3px_0_#b45309,0_4px_8px_rgba(0,0,0,0.3)] active:translate-y-0.5'"
                title="B Button (X)"
                @mousedown="handleButtonDown('B')"
                @mouseup="handleButtonUp('B')"
                @mouseleave="handleButtonUp('B')"
                @touchstart.prevent="handleButtonDown('B')"
                @touchend.prevent="handleButtonUp('B')"
              >
                <span class="rotate-[22deg] text-sm font-black drop-shadow-[0_1px_1px_rgba(0,0,0,0.2)]">B</span>
              </button>
            </div>

            <!-- A BUTTON -->
            <div class="flex flex-col items-center">
              <button
                class="w-10 h-10 rounded-full font-black text-sm flex items-center justify-center transition-all duration-75 border cursor-pointer select-none"
                :class="activeButtons.has('A')
                  ? 'bg-rose-300 border-rose-200 text-slate-950 shadow-[0_0_16px_rgba(244,63,94,1)] translate-y-0.5'
                  : 'bg-rose-500 hover:bg-rose-450 border-rose-300/40 text-white shadow-[0_3px_0_#9f1239,0_4px_8px_rgba(0,0,0,0.3)] active:translate-y-0.5'"
                title="A Button (Z)"
                @mousedown="handleButtonDown('A')"
                @mouseup="handleButtonUp('A')"
                @mouseleave="handleButtonUp('A')"
                @touchstart.prevent="handleButtonDown('A')"
                @touchend.prevent="handleButtonUp('A')"
              >
                <span class="rotate-[22deg] text-sm font-black drop-shadow-[0_1px_1px_rgba(0,0,0,0.2)]">A</span>
              </button>
            </div>
          </div>

          <!-- Lower-Right Acoustic Speaker Grille -->
          <div class="absolute -bottom-1.5 right-1 grid grid-cols-3 gap-1 opacity-25 pointer-events-none select-none">
            <span class="w-1 h-1 rounded-full bg-slate-950 shadow-inner" />
            <span class="w-1 h-1 rounded-full bg-slate-950 shadow-inner" />
            <span class="w-1 h-1 rounded-full bg-slate-950 shadow-inner" />
            <span class="w-1 h-1 rounded-full bg-slate-950 shadow-inner" />
            <span class="w-1 h-1 rounded-full bg-slate-950 shadow-inner" />
            <span class="w-1 h-1 rounded-full bg-slate-950 shadow-inner" />
          </div>
        </div>
      </div>

      <!-- Minimalist Keyboard Shortcuts Footer -->
      <div class="w-full mt-2.5 pt-2 border-t border-slate-800/60 flex items-center justify-center flex-wrap gap-x-3 gap-y-1 text-[9px] font-mono text-slate-500">
        <span><span class="text-slate-400 font-semibold">WASD / Arrows</span> Move</span>
        <span>•</span>
        <span><span class="text-slate-400 font-semibold">Z</span> A</span>
        <span>•</span>
        <span><span class="text-slate-400 font-semibold">X</span> B</span>
        <span>•</span>
        <span><span class="text-slate-400 font-semibold">Q / E</span> L / R</span>
        <span>•</span>
        <span><span class="text-slate-400 font-semibold">Enter</span> Start</span>
        <span>•</span>
        <span><span class="text-slate-400 font-semibold">Shift</span> Select</span>
      </div>
    </div>
  </div>
</template>

