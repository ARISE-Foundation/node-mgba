<script setup lang="ts">
import { ref } from 'vue';
import type { InputAction, TurnResultPayload, KeyframePayload } from '../types.js';

defineProps<{
    lastTurnResult: TurnResultPayload | null;
    keyframes: readonly KeyframePayload[];
}>();

const emit = defineEmits<{
    (e: 'runSequence', actions: InputAction[]): void;
    (e: 'error', message: string): void;
}>();

const presets: Record<string, InputAction[]> = {
    start_menu: [
        { type: 'press', button: 'START', holdFrames: 16, releaseFrames: 8 },
        { type: 'wait', frames: 10 },
        { type: 'press', button: 'A', holdFrames: 16, releaseFrames: 8 },
    ],
    dialog_advance: [
        { type: 'press', button: 'A', holdFrames: 16, releaseFrames: 8 },
        { type: 'wait', frames: 16 },
        { type: 'press', button: 'A', holdFrames: 16, releaseFrames: 8 },
        { type: 'wait', frames: 16 },
        { type: 'press', button: 'A', holdFrames: 16, releaseFrames: 8 },
    ],
    step_down: [
        { type: 'press', button: 'DOWN', holdFrames: 16, releaseFrames: 8 },
        { type: 'press', button: 'DOWN', holdFrames: 16, releaseFrames: 8 },
        { type: 'press', button: 'DOWN', holdFrames: 16, releaseFrames: 8 },
        { type: 'press', button: 'DOWN', holdFrames: 16, releaseFrames: 8 },
    ],
};

const sequenceJson = ref<string>(JSON.stringify(presets.start_menu, null, 2));
const selectedKf = ref<KeyframePayload | null>(null);

function applyPreset(key: string): void {
    const p = presets[key];
    if (p) {
        sequenceJson.value = JSON.stringify(p, null, 2);
    }
}

function handleExecute(): void {
    try {
        const parsed = JSON.parse(sequenceJson.value) as InputAction[];
        if (!Array.isArray(parsed)) {
            emit('error', 'Input sequence must be a JSON array of actions');
            return;
        }
        emit('runSequence', parsed);
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        emit('error', `Invalid JSON sequence: ${msg}`);
    }
}

function formatTriggerBadge(reason: string): { label: string; bgClass: string } {
    if (reason === 'pre_action') {
        return { label: '🎬 Initial State', bgClass: 'bg-sky-950 text-sky-300 border-sky-800' };
    }
    if (reason === 'post_action') {
        return { label: '🏁 Turn Settled', bgClass: 'bg-emerald-950 text-emerald-300 border-emerald-800' };
    }
    if (reason === 'visual_change') {
        return { label: '✨ Visual Transition', bgClass: 'bg-purple-950 text-purple-300 border-purple-800' };
    }
    if (reason.startsWith('action_')) {
        const match = reason.match(/^action_(\d+):([a-z]+)(?:_([A-Z0-9]+))?/i);
        if (match) {
            const stepNum = match[1];
            const type = match[2];
            const btn = match[3];
            if (type === 'press' && btn) {
                return { label: `⚡ #${stepNum} Press [${btn}]`, bgClass: 'bg-amber-950 text-amber-300 border-amber-800' };
            }
            if (type === 'wait') {
                return { label: `⏳ #${stepNum} Wait`, bgClass: 'bg-indigo-950 text-indigo-300 border-indigo-800' };
            }
            return { label: `⚡ #${stepNum} ${type}`, bgClass: 'bg-amber-950 text-amber-300 border-amber-800' };
        }
    }
    return { label: reason, bgClass: 'bg-slate-800 text-slate-300 border-slate-700' };
}

function getFrameDataUrl(base64: string, width: number, height: number): string {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';

    const imgData = ctx.createImageData(width, height);
    try {
        const rawBytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
        for (let i = 0; i < rawBytes.length; i += 4) {
            imgData.data[i] = rawBytes[i] ?? 0;
            imgData.data[i + 1] = rawBytes[i + 1] ?? 0;
            imgData.data[i + 2] = rawBytes[i + 2] ?? 0;
            imgData.data[i + 3] = 255;
        }
        ctx.putImageData(imgData, 0, 0);
        return canvas.toDataURL('image/png');
    } catch {
        return '';
    }
}
</script>

<template>
  <div class="flex flex-col space-y-4">
    <!-- Sequence Runner Card -->
    <div class="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-xl flex flex-col">
      <div class="flex items-center justify-between pb-3 border-b border-slate-800">
        <div class="flex items-center space-x-2">
          <span class="h-2.5 w-2.5 rounded-full bg-amber-400" />
          <h2 class="font-bold text-sm text-amber-300">Step Sequence Runner (Turbo Mode)</h2>
        </div>
        <span v-if="lastTurnResult" class="text-xs text-slate-400 font-mono">
          {{ lastTurnResult.executionTimeMs }}ms ({{ lastTurnResult.durationFrames }} frames, ~{{ Math.round(lastTurnResult.fps) }} FPS)
        </span>
      </div>

      <div class="mt-3 flex items-center space-x-2 text-xs">
        <span class="text-slate-400 font-medium">Preset:</span>
        <button
          class="bg-slate-800 hover:bg-slate-700 px-2.5 py-1 rounded border border-slate-700 text-slate-300 transition"
          @click="applyPreset('start_menu')"
        >
          Start Menu
        </button>
        <button
          class="bg-slate-800 hover:bg-slate-700 px-2.5 py-1 rounded border border-slate-700 text-slate-300 transition"
          @click="applyPreset('dialog_advance')"
        >
          Dialog Advance (A, A, A)
        </button>
        <button
          class="bg-slate-800 hover:bg-slate-700 px-2.5 py-1 rounded border border-slate-700 text-slate-300 transition"
          @click="applyPreset('step_down')"
        >
          Walk Down 4 Steps
        </button>
      </div>

      <div class="mt-3 flex-1 flex flex-col">
        <textarea
          v-model="sequenceJson"
          class="w-full bg-slate-950 border border-slate-800 rounded-lg p-3 font-mono text-xs text-emerald-300 focus:outline-none focus:border-emerald-500 h-28 resize-none leading-relaxed"
          spellcheck="false"
        />
        <div class="mt-3 flex items-center justify-between">
          <button
            class="bg-amber-600 hover:bg-amber-500 active:bg-amber-700 text-white text-xs font-semibold py-2 px-5 rounded-lg shadow transition flex items-center space-x-1.5"
            @click="handleExecute"
          >
            <span>▶ Execute Step Sequence</span>
          </button>
          <span v-if="lastTurnResult" class="text-xs font-mono text-slate-400">
            Completed {{ lastTurnResult.durationFrames }} frames in {{ lastTurnResult.executionTimeMs }}ms
          </span>
        </div>
      </div>
    </div>

    <!-- Keyframe Gallery Card (Generous Display & Clear Badges) -->
    <div class="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-xl flex flex-col space-y-3">
      <div class="flex items-center justify-between border-b border-slate-800 pb-2">
        <div class="flex items-center space-x-2">
          <h3 class="font-bold text-xs text-slate-200 uppercase tracking-wider">🎞️ Captured Keyframes (Deduplicated Stream)</h3>
        </div>
        <span class="text-xs text-slate-400 font-mono">{{ keyframes.length }} frames captured</span>
      </div>

      <div v-if="keyframes.length === 0" class="text-xs text-slate-600 italic py-8 text-center bg-slate-950/60 rounded-lg border border-slate-800/60">
        No keyframes captured yet. Execute a step sequence above to record keyframes.
      </div>

      <div v-else class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 max-h-[560px] overflow-y-auto pr-1">
        <div
          v-for="(kf, idx) in keyframes"
          :key="idx"
          class="bg-slate-950 rounded-xl border border-slate-800 hover:border-cyan-500/80 cursor-pointer transition-all duration-150 p-3 flex flex-col space-y-2 group shadow-md hover:shadow-cyan-950/30"
          @click="selectedKf = kf"
        >
          <!-- Frame Meta Header -->
          <div class="flex items-center justify-between text-xs font-mono">
            <span class="font-bold text-cyan-400 flex items-center space-x-1">
              <span class="text-slate-500 font-normal">#</span><span>{{ kf.frameIndex }}</span>
            </span>
            <span class="text-slate-400 text-[11px]">+{{ kf.timestampMs }}ms</span>
          </div>

          <!-- Crisp 160x144 Scaled Canvas Preview -->
          <div class="relative bg-black rounded-lg overflow-hidden border border-slate-800 flex items-center justify-center aspect-[160/144]">
            <img
              :src="getFrameDataUrl(kf.bufferBase64, kf.width, kf.height)"
              class="pixelated w-full h-full object-contain"
              :alt="`Keyframe #${kf.frameIndex}`"
            >
            <div class="absolute inset-0 bg-cyan-500/10 opacity-0 group-hover:opacity-100 transition flex items-center justify-center pointer-events-none">
              <span class="bg-black/80 text-cyan-300 text-[10px] px-2 py-0.5 rounded border border-cyan-500/40 font-mono">🔍 Enlarge</span>
            </div>
          </div>

          <!-- Human-Readable Trigger Pill -->
          <div class="pt-0.5 flex items-center justify-between">
            <span
              class="text-[10px] font-mono px-2 py-0.5 rounded border font-semibold truncate max-w-full"
              :class="formatTriggerBadge(kf.triggerReason).bgClass"
            >
              {{ formatTriggerBadge(kf.triggerReason).label }}
            </span>
          </div>
        </div>
      </div>
    </div>

    <!-- Keyframe Detail Modal (Full Size) -->
    <div
      v-if="selectedKf"
      class="fixed inset-0 bg-black/85 flex items-center justify-center p-4 z-50 backdrop-blur-sm select-none"
      @click.self="selectedKf = null"
    >
      <div class="bg-slate-900 border border-slate-700 rounded-2xl p-6 max-w-lg w-full flex flex-col items-center space-y-4 shadow-2xl">
        <div class="w-full flex items-center justify-between border-b border-slate-800 pb-3">
          <div class="flex items-center space-x-2">
            <span
              class="text-xs font-mono px-2 py-0.5 rounded border font-semibold"
              :class="formatTriggerBadge(selectedKf.triggerReason).bgClass"
            >
              {{ formatTriggerBadge(selectedKf.triggerReason).label }}
            </span>
            <h3 class="font-bold text-sm text-slate-100 font-mono">Frame #{{ selectedKf.frameIndex }}</h3>
          </div>
          <button
            class="text-slate-400 hover:text-white text-lg font-bold px-2 py-1 rounded hover:bg-slate-800 transition"
            @click="selectedKf = null"
          >
            ✕
          </button>
        </div>

        <img
          :src="getFrameDataUrl(selectedKf.bufferBase64, selectedKf.width, selectedKf.height)"
          class="pixelated w-[320px] h-[288px] bg-black rounded-xl border-2 border-slate-700 shadow-inner"
          :alt="`Keyframe #${selectedKf.frameIndex}`"
        >

        <div class="w-full text-xs font-mono grid grid-cols-2 gap-2.5 text-slate-300 bg-slate-950 p-3.5 rounded-xl border border-slate-800">
          <div>Frame Index: <strong class="text-cyan-300">#{{ selectedKf.frameIndex }}</strong></div>
          <div>Relative Time: <strong class="text-emerald-300">+{{ selectedKf.timestampMs }} ms</strong></div>
          <div class="col-span-2">Trigger Identifier: <strong class="text-amber-300">{{ selectedKf.triggerReason }}</strong></div>
          <div class="col-span-2 truncate text-slate-400">
            xxHash64: <span class="text-[10px] text-slate-500 font-mono">{{ selectedKf.hash }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
