<script setup lang="ts">
import { ref, watch, onMounted } from 'vue';
import type { FramePayload } from '../types.js';

const props = defineProps<{
    frame: FramePayload | null;
    isLooping: boolean;
    isMuted?: boolean;
}>();

const emit = defineEmits<{
    (e: 'step', frames: number): void;
    (e: 'toggleLoop'): void;
    (e: 'toggleMute'): void;
    (e: 'reset'): void;
}>();

const canvasRef = ref<HTMLCanvasElement | null>(null);
let ctx: CanvasRenderingContext2D | null = null;
let imgData: ImageData | null = null;

function renderFrame(frame: FramePayload | null): void {
    if (!frame || !canvasRef.value) return;
    if (!ctx) {
        ctx = canvasRef.value.getContext('2d');
    }
    if (!ctx) return;

    if (!imgData || imgData.width !== frame.width || imgData.height !== frame.height) {
        canvasRef.value.width = frame.width;
        canvasRef.value.height = frame.height;
        imgData = ctx.createImageData(frame.width, frame.height);
    }

    try {
        const rawBytes = Uint8Array.from(atob(frame.bufferBase64), c => c.charCodeAt(0));
        for (let i = 0; i < rawBytes.length; i += 4) {
            imgData.data[i] = rawBytes[i] ?? 0;
            imgData.data[i + 1] = rawBytes[i + 1] ?? 0;
            imgData.data[i + 2] = rawBytes[i + 2] ?? 0;
            imgData.data[i + 3] = 255;
        }
        ctx.putImageData(imgData, 0, 0);
    } catch (err) {
        console.error('[ScreenView] Frame decode error:', err);
    }
}

watch(() => props.frame, (newFrame) => {
    renderFrame(newFrame);
});

onMounted(() => {
    if (canvasRef.value) {
        ctx = canvasRef.value.getContext('2d');
    }
    if (props.frame) {
        renderFrame(props.frame);
    }
});
</script>

<template>
  <div class="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-xl flex flex-col items-center">
    <!-- 2x Scaled Canvas Container -->
    <div class="relative bg-slate-800 rounded-lg p-2 border-2 border-slate-700 shadow-inner flex items-center justify-center">
      <canvas
        ref="canvasRef"
        width="160"
        height="144"
        class="pixelated w-[320px] h-[288px] bg-slate-950 rounded"
      />
      <div
        v-if="!frame"
        class="absolute inset-0 bg-black/80 flex items-center justify-center text-sm text-slate-400 font-mono"
      >
        Connecting to emulator...
      </div>
    </div>

    <!-- Playback & Step Controls -->
    <div class="mt-4 w-full grid grid-cols-5 gap-2 text-xs font-medium">
      <button
        class="bg-slate-800 hover:bg-slate-700 active:bg-slate-600 text-slate-200 py-2 rounded-lg border border-slate-700 transition"
        @click="emit('step', 1)"
      >
        Step 1
      </button>
      <button
        class="bg-slate-800 hover:bg-slate-700 active:bg-slate-600 text-slate-200 py-2 rounded-lg border border-slate-700 transition"
        @click="emit('step', 60)"
      >
        Step 60 (1s)
      </button>
      <button
        class="py-2 rounded-lg transition font-semibold"
        :class="isLooping ? 'bg-rose-600 hover:bg-rose-500 active:bg-rose-700 text-white' : 'bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white'"
        @click="emit('toggleLoop')"
      >
        {{ isLooping ? 'Pause Loop' : 'Live 60 FPS' }}
      </button>
      <button
        class="py-2 rounded-lg transition font-semibold"
        :class="isMuted ? 'bg-slate-800 hover:bg-slate-700 text-slate-400 border border-slate-700' : 'bg-indigo-600 hover:bg-indigo-500 text-white'"
        title="Toggle audio stream"
        @click="emit('toggleMute')"
      >
        {{ isMuted ? '🔇 Muted' : '🔊 Audio' }}
      </button>
      <button
        class="bg-rose-900/60 hover:bg-rose-800 text-rose-200 py-2 rounded-lg border border-rose-800/60 transition"
        @click="emit('reset')"
      >
        Reset
      </button>
    </div>
  </div>
</template>

