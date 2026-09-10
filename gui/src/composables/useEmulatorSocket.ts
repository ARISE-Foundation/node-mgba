import { ref, onMounted, onUnmounted } from 'vue';
import type {
    RomInfo,
    PokemonRedBlueState,
    FramePayload,
    KeyframePayload,
    SavestateEntry,
    RomEntry,
    TurnResultPayload,
    ToastNotification,
    AudioPayload,
    InputAction,
    ButtonName,
} from '../types.js';

export function useEmulatorSocket() {
    const isConnected = ref(false);
    const isLooping = ref(true);
    const isMuted = ref(true);
    const romInfo = ref<RomInfo | null>(null);
    const latestFrame = ref<FramePayload | null>(null);
    const gameState = ref<PokemonRedBlueState | null>(null);
    const fps = ref(60);
    const frameCounter = ref(0);
    const keyframes = ref<KeyframePayload[]>([]);
    const savestates = ref<SavestateEntry[]>([]);
    const roms = ref<RomEntry[]>([]);
    const lastTurnResult = ref<TurnResultPayload | null>(null);
    const toasts = ref<ToastNotification[]>([]);

    let ws: WebSocket | null = null;
    let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;

    function showToast(message: string, isSuccess = true): void {
        const id = Math.random().toString(36).substring(2, 9);
        toasts.value.push({ id, message, isSuccess });
        setTimeout(() => {
            removeToast(id);
        }, 3500);
    }

    function removeToast(id: string): void {
        toasts.value = toasts.value.filter(t => t.id !== id);
    }

    function sendWs(payload: unknown): boolean {
        if (ws && ws.readyState === WebSocket.OPEN) {
            try {
                ws.send(JSON.stringify(payload));
                return true;
            } catch (err) {
                console.warn('[node-mgba Studio] WebSocket send error:', err);
                return false;
            }
        }
        showToast('Disconnected from emulator server', false);
        return false;
    }

    let audioCtx: AudioContext | null = null;
    let nextAudioStartTime = 0;
    const BUFFER_AHEAD_SEC = 0.050; // 50ms low-latency jitter buffer

    function initAudioContext(): void {
        if (!audioCtx) {
            const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
            audioCtx = new AudioContextClass();
        }
        if (audioCtx.state === 'suspended') {
            void audioCtx.resume();
        }
    }

    function toggleMute(): void {
        isMuted.value = !isMuted.value;
        if (!isMuted.value) {
            initAudioContext();
            if (audioCtx && audioCtx.state === 'suspended') {
                void audioCtx.resume();
            }
            nextAudioStartTime = 0;
        } else {
            nextAudioStartTime = 0;
        }
        sendWs({ type: 'setMute', muted: isMuted.value });
    }

    function playAudioChunk(sampleRate: number, sampleFrames: number, bufferBase64: string): void {
        if (isMuted.value || !audioCtx) return;

        try {
            if (audioCtx.state === 'suspended') {
                void audioCtx.resume();
            }

            const binaryStr = atob(bufferBase64);
            const len = binaryStr.length;
            const bytes = new Uint8Array(len);
            for (let i = 0; i < len; i++) {
                bytes[i] = binaryStr.charCodeAt(i);
            }

            const alignedBuffer = new ArrayBuffer(len);
            new Uint8Array(alignedBuffer).set(bytes);
            const int16View = new Int16Array(alignedBuffer);

            const frames = sampleFrames || (int16View.length / 2);
            if (frames === 0) return;

            const rate = sampleRate > 0 ? sampleRate : 131072;
            const audioBuffer = audioCtx.createBuffer(2, frames, rate);
            const channelL = audioBuffer.getChannelData(0);
            const channelR = audioBuffer.getChannelData(1);

            for (let i = 0; i < frames; i++) {
                channelL[i] = ((int16View[i * 2] ?? 0) / 32768.0) * 0.85;
                channelR[i] = ((int16View[i * 2 + 1] ?? 0) / 32768.0) * 0.85;
            }

            const source = audioCtx.createBufferSource();
            source.buffer = audioBuffer;
            source.connect(audioCtx.destination);

            const now = audioCtx.currentTime;
            if (nextAudioStartTime < now + 0.010 || nextAudioStartTime > now + 0.300) {
                // If clock drifted or initial playback, sync to now + margin
                nextAudioStartTime = now + BUFFER_AHEAD_SEC;
            }

            // Dynamic Rate Control (DRC): micro-adjust playback rate to gently track buffer target
            const bufferAhead = nextAudioStartTime - now;
            let playbackRate = 1.0;
            if (bufferAhead < 0.035) {
                playbackRate = 0.995; // gently stretch by 0.5% if buffer is slightly low
            } else if (bufferAhead > 0.075) {
                playbackRate = 1.005; // gently compress by 0.5% if buffer is getting high
            }

            source.playbackRate.value = playbackRate;
            source.start(nextAudioStartTime);
            nextAudioStartTime += audioBuffer.duration / playbackRate;
        } catch (err) {
            console.warn('[useEmulatorSocket] Audio playback error:', err);
        }
    }

    function handleMessage(msg: Record<string, unknown>): void {
        const type = msg['type'] as string | undefined;

        if (type === 'init' || type === 'romInfo') {
            if (msg['romInfo']) {
                romInfo.value = msg['romInfo'] as RomInfo;
            }
            if (msg['frame']) {
                const frame = msg['frame'] as FramePayload;
                latestFrame.value = frame;
                frameCounter.value = frame.frameIndex;
            }
            if (msg['gameState']) {
                gameState.value = msg['gameState'] as PokemonRedBlueState;
            }
            if (typeof msg['isLooping'] === 'boolean') {
                isLooping.value = msg['isLooping'];
            }
        } else if (type === 'frame') {
            const frame = msg as unknown as FramePayload;
            latestFrame.value = frame;
            frameCounter.value = frame.frameIndex;
            if (frame.fps !== undefined) {
                fps.value = frame.fps;
            }
            if (frame.gameState) {
                gameState.value = frame.gameState;
            }
        } else if (type === 'audio') {
            const audio = msg as unknown as AudioPayload;
            playAudioChunk(audio.sampleRate, audio.sampleFrames, audio.bufferBase64);
        } else if (type === 'keyframe') {
            if (msg['keyframe']) {
                const kf = msg['keyframe'] as KeyframePayload;
                keyframes.value.unshift(kf);
                if (keyframes.value.length > 50) {
                    keyframes.value.pop();
                }
            }
        } else if (type === 'turnResult') {
            const turn = msg as unknown as TurnResultPayload;
            lastTurnResult.value = turn;
            if (turn.gameState) {
                gameState.value = turn.gameState;
            }
            if (turn.keyframes) {
                keyframes.value = [...turn.keyframes];
            }
            if (turn.lastFrame) {
                latestFrame.value = turn.lastFrame;
                frameCounter.value = turn.lastFrame.frameIndex;
            }
        } else if (type === 'loopStatus') {
            if (typeof msg['isLooping'] === 'boolean') {
                isLooping.value = msg['isLooping'];
            }
        } else if (type === 'toast') {
            showToast(String(msg['message'] ?? ''), Boolean(msg['success'] ?? true));
        } else if (type === 'savestateList') {
            savestates.value = (msg['savestates'] as SavestateEntry[]) || [];
        } else if (type === 'romList') {
            roms.value = (msg['roms'] as RomEntry[]) || [];
        } else if (type === 'romLoaded') {
            if (msg['romInfo']) {
                romInfo.value = msg['romInfo'] as RomInfo;
            }
            if (msg['frame']) {
                latestFrame.value = msg['frame'] as FramePayload;
                frameCounter.value = (msg['frame'] as FramePayload).frameIndex;
            }
            gameState.value = (msg['gameState'] as PokemonRedBlueState) || null;
            if (typeof msg['isLooping'] === 'boolean') {
                isLooping.value = msg['isLooping'];
            }
            sendWs({ type: 'listSavestates' });
            sendWs({ type: 'listRoms' });
        }
    }

    function connect(): void {
        if (ws) {
            try { ws.close(); } catch { /* ignore */ }
            ws = null;
        }

        const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${wsProtocol}//${window.location.host}`;

        ws = new WebSocket(wsUrl);

        ws.onopen = () => {
            isConnected.value = true;
            sendWs({ type: 'init' });
            sendWs({ type: 'listSavestates' });
            sendWs({ type: 'listRoms' });
            sendWs({ type: 'setMute', muted: isMuted.value });
        };

        ws.onclose = () => {
            isConnected.value = false;
            if (reconnectTimeout) clearTimeout(reconnectTimeout);
            reconnectTimeout = setTimeout(connect, 1000);
        };

        ws.onerror = (err) => {
            console.warn('[node-mgba Studio] WebSocket error:', err);
        };

        ws.onmessage = (event) => {
            try {
                if (typeof event.data === 'string') {
                    const msg = JSON.parse(event.data) as Record<string, unknown>;
                    handleMessage(msg);
                }
            } catch (err) {
                console.error('[node-mgba Studio] Failed to parse WebSocket message:', err);
            }
        };
    }

    function step(frames = 1): void {
        sendWs({ type: 'step', frames });
    }

    function stepSequence(actions: readonly InputAction[]): void {
        sendWs({ type: 'stepSequence', actions });
    }

    function toggleLoop(): void {
        isLooping.value = !isLooping.value;
        if (isLooping.value) {
            sendWs({ type: 'startLoop', fps: 60 });
        } else {
            sendWs({ type: 'stopLoop' });
        }
    }

    function reset(): void {
        sendWs({ type: 'reset' });
    }

    function keyDown(button: ButtonName): void {
        sendWs({ type: 'keyDown', button });
    }

    function keyUp(button: ButtonName): void {
        sendWs({ type: 'keyUp', button });
    }

    function pressButton(button: ButtonName): void {
        sendWs({ type: 'pressButton', button });
    }

    function quickSave(): void {
        sendWs({ type: 'saveState' });
    }

    function quickLoad(): void {
        sendWs({ type: 'loadState' });
    }

    function loadState(filePath: string): void {
        sendWs({ type: 'loadState', filePath });
    }

    function uploadState(filename: string, stateBase64: string): void {
        sendWs({ type: 'uploadState', filename, stateBase64 });
    }

    function refreshSavestates(): void {
        sendWs({ type: 'listSavestates' });
    }

    function loadRom(filePath: string): void {
        sendWs({ type: 'loadRom', filePath });
    }

    function uploadRom(filename: string, romBase64: string): void {
        sendWs({ type: 'uploadRom', filename, romBase64 });
    }

    function refreshRoms(): void {
        sendWs({ type: 'listRoms' });
    }

    onMounted(() => {
        connect();
    });

    onUnmounted(() => {
        if (reconnectTimeout) clearTimeout(reconnectTimeout);
        if (ws) {
            try { ws.close(); } catch { /* ignore */ }
            ws = null;
        }
    });

    return {
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
        removeToast,
        step,
        stepSequence,
        toggleLoop,
        toggleMute,
        reset,
        keyDown,
        keyUp,
        pressButton,
        quickSave,
        quickLoad,
        loadState,
        uploadState,
        refreshSavestates,
        loadRom,
        uploadRom,
        refreshRoms,
    };
}

