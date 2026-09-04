# Real-Time Emulation & Autonomous Agent Loops

This guide covers how to run `node-mgba` in real-time execution mode for 24/7 AI agents, live stream overlays (OBS/Twitch), and interactive web studios. It documents the architecture, lifecycle management, live action queuing, non-blocking state observation, and media piping used in production by **[Gemini Plays Pokémon](https://www.twitch.tv/gemini_plays_pokemon/about)**.

---

## Architecture Overview

Running an emulator in a Node.js process alongside Large Language Model (LLM) agents, WebSocket servers, and real-time state decoders presents a fundamental concurrency challenge:

- **The Main Thread Problem:** If emulation runs on the main Node.js event loop, any heavy task (such as token streaming, network I/O, VRAM tile decoding, or JSON serialization) stalls frame stepping. This produces choppy video, audio crackle/buffer underruns, and desynchronized game clocks.
- **The Worker Actor Solution:** `node-mgba` solves this by decoupling emulation into a dedicated worker thread actor (`emulator.worker.ts`). The worker executes an autonomous 59.73 FPS high-resolution clock loop, steps the native `libmgba` core, and streams audio/video without blocking or being blocked by the main thread.

```
┌────────────────────────────────────────────────────────────────────────┐
│                        MAIN NODE.JS THREAD                             │
│                                                                        │
│   AI Agent / LLM Turn Loop         Interactive UI / Web Studio         │
│   (e.g., Gemini 3.8 Flash)         (WebSocket / Fastify / OBS)         │
│               │                                 │                      │
│   controller.pressButtons(['A'])   controller.setKeyMask(mask)         │
│   await pokemon.getState()         await controller.step(...)          │
│               │                                 │                      │
│               ▼                                 ▼                      │
│   ┌────────────────────────────────────────────────────────────────┐   │
│   │                     EmulatorController                         │   │
│   │      - Lifecycle State Machine ('ready', 'closed')             │   │
│   │      - MediaSink Registration & Plugin Attachment              │   │
│   │      - High-level Action Queueing & Sequence Dispatch          │   │
│   └───────────────────────────────┬────────────────────────────────┘   │
└───────────────────────────────────┼────────────────────────────────────┘
                                    │ Worker RPC & Events
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                       EMULATOR WORKER THREAD                           │
│                                                                        │
│   ┌────────────────────────────────────────────────────────────────┐   │
│   │                    Autonomous Frame Clock                      │   │
│   │   - Precise 59.73 FPS timer loop (GB_FRAME_DURATION_MS)        │   │
│   │   - Active action queue step planning (ActionQueueStepPlanner) │   │
│   │   - Merges interactive manualMask with action bitmasks         │   │
│   └───────────────────────────────┬────────────────────────────────┘   │
│                                   │                                    │
│                                   ▼                                    │
│   ┌────────────────────────────────────────────────────────────────┐   │
│   │                Native libmgba Emulation Core                   │   │
│   │           (C / C++ Node-API Shim: NativeMgbaCore)              │   │
│   └───────────────┬───────────────────────────────┬────────────────┘   │
│                   │ Video (RGBA8888)              │ Audio (S16 Stereo) │
│                   ▼                               ▼                    │
│   ┌────────────────────────────────────────────────────────────────┐   │
│   │                 Direct MediaPort Piping                        │   │
│   │   - Direct MessagePort transfer to MediaWorker / OBS pipeline  │   │
│   │   - Concurrent delivery to registered MediaSinks (WS / MP4)    │   │
│   └────────────────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────────────────┘
```

---

## Canonical Approach: `EmulatorController`

`EmulatorController` is the central orchestrator that wraps the worker actor, manages lifecycle states, coordinates media sinks, and exposes high-level agent primitives.

### Frame Pacing Constants

The Game Boy hardware runs at a non-standard refresh rate of **≈ 59.7275 FPS** (154 scanlines at 4,194,304 Hz / 70,224 cycles per frame). `node-mgba` exports the exact timing constants:

```typescript
import {
    GB_FPS,               // 59.72750056960583
    GB_FRAME_DURATION_MS, // 16.742706509623877
    GB_AUDIO_SAMPLE_RATE, // 48000
} from 'node-mgba';
```

### Initializing Real-Time Playback

When initializing `EmulatorController` with `realtime: true`, the worker actor immediately starts its autonomous 59.73 FPS stepping clock upon initialization:

```typescript
import { EmulatorController, GB_FPS } from 'node-mgba';

const controller = new EmulatorController({
    romPath: process.env.ROM_PATH,
    realtime: true,
    fps: GB_FPS,
    workerOptions: {
        watchdogTimeoutMs: 15000,
    },
});

// Initialize worker thread and load ROM
await controller.initialize();

// Query state
console.log('Playback running:', controller.isPlaybackRunning()); // true
```

### Playback Lifecycle Controls

You can pause and resume real-time playback on demand (for example, when performing fast-forward turn simulations, loading savestates, or running diagnostics):

```typescript
// Pause real-time clock (emits 'pause' event)
await controller.pausePlayback();
console.log(controller.isPlaybackRunning()); // false

// Resume real-time clock (emits 'start' event)
await controller.startPlayback();
console.log(controller.isPlaybackRunning()); // true

// Listen to lifecycle events
controller.on('start', () => console.log('Emulation loop resumed'));
controller.on('pause', () => console.log('Emulation loop paused'));
```

---

## Input Handling in Real-Time

`EmulatorController` supports two complementary input models: **interactive keymasking** (for continuous button states) and **action queuing** (for discrete button presses and timed sequences).

### 1. Interactive KeyMask (`setKeyMask`)

For real-time player input, WebSockets, or gamepads, send the active button bitmask directly to the worker actor using `setKeyMask()`. The bitmask is retained across frames until explicitly changed:

```typescript
import { BUTTON_BITMASKS } from 'node-mgba';

// Press and hold 'A' and 'RIGHT'
const mask = BUTTON_BITMASKS.A | BUTTON_BITMASKS.RIGHT;
await controller.setKeyMask(mask);

// Later, release all buttons
await controller.clearButtons(); // Sets keymask to 0 and cancels queued actions
```

Available button bitmasks:
- `BUTTON_BITMASKS.A` (0x0001)
- `BUTTON_BITMASKS.B` (0x0002)
- `BUTTON_BITMASKS.SELECT` (0x0004)
- `BUTTON_BITMASKS.START` (0x0008)
- `BUTTON_BITMASKS.RIGHT` (0x0010)
- `BUTTON_BITMASKS.LEFT` (0x0020)
- `BUTTON_BITMASKS.UP` (0x0040)
- `BUTTON_BITMASKS.DOWN` (0x0080)
- `BUTTON_BITMASKS.R` (0x0100)
- `BUTTON_BITMASKS.L` (0x0200)

### 2. Action Queuing (`pressButtons`, `executeSequence`)

`EmulatorController` provides non-blocking action queuing for discrete button presses with configurable hold and release frame durations:

```typescript
// Enqueue a button press with explicit hold and release frame counts
const handle = controller.pressButtons(['START'], {
    holdFrames: 8,
    releaseFrames: 4,
    timeoutMs: 5000,
});

// Await completion in the background while real-time playback continues
await handle.promise;
```

To execute a structured multi-step sequence during real-time playback:

```typescript
const result = await controller.executeSequence([
    { type: 'press', button: 'UP', holdFrames: 6, releaseFrames: 4 },
    { type: 'wait', frames: 10 },
    { type: 'press', button: 'A', holdFrames: 6, releaseFrames: 4 },
]);

console.log(`Executed ${result.actionsExecuted} actions`);
```

### 3. Fast-Forward Keyframed Sequences

When an application requires full keyframed sequence results (such as intermediate screen captures, memory diffs, or exact frame counts) rather than live pacing, pause playback, run the sequence via `controller.controls.sequence()`, and resume playback:

```typescript
// 1. Temporarily pause real-time playback
const wasRunning = controller.isPlaybackRunning();
if (wasRunning) {
    await controller.pausePlayback();
}

try {
    // 2. Step sequence in fast-forward mode
    const turnResult = await controller.controls.sequence([
        { type: 'press', button: 'A', holdFrames: 8, releaseFrames: 4 },
        { type: 'wait', frames: 30 },
    ], {
        keyframeInterval: 10,
        captureTurnStartFrame: true,
    });

    console.log(`Stepped ${turnResult.framesStepped} frames; keyframes: ${turnResult.keyframes.length}`);
    return turnResult;
} finally {
    // 3. Resume real-time playback
    if (wasRunning) {
        await controller.startPlayback();
    }
}
```

---

## Non-Blocking Game State Observation

Game state can be observed in two ways depending on application requirements:

### 1. On-Demand Observation

Applications do not need to poll memory on every frame. For example, a turn-based loop can query `await pokemon.getState()` on demand at the start of each decision:

```typescript
import { PokemonRedBluePlugin } from 'node-mgba/plugins';

const pokemon = await controller.use(PokemonRedBluePlugin);

// Retrieve structured game state on-demand
const state = await pokemon.getState();
console.log(`Player at (${state.player.position.x}, ${state.player.position.y}) on map ${state.map.id}`);
```

### 2. Throttled Observation in Frame Listeners

When observing game state inside high-frequency frame listeners (e.g. for live HUDs or overlays), querying asynchronous memory on every frame can flood the worker actor IPC queue with concurrent RPCs.

Use a single-flight guard pattern to throttle observations to at most 1 in-flight request while maintaining full video frame throughput:

```typescript
let isObserving = false;
let lastKnownMapId = -1;

controller.on('frame', async (frame) => {
    // Forward or render raw video frame immediately (60 FPS)
    sendVideoToOverlay(frame);

    // If a previous observation is still in-flight over IPC, skip this frame
    if (isObserving) {
        return;
    }

    isObserving = true;
    try {
        const state = await pokemon.getState();
        if (state.map.id !== lastKnownMapId) {
            lastKnownMapId = state.map.id;
            console.log(`Map changed to ${lastKnownMapId} at (${state.player.position.x}, ${state.player.position.y})`);
        }
    } catch (err) {
        console.error('Observation error:', err);
    } finally {
        isObserving = false;
    }
});
```

---

## Media Streaming & Piping

`node-mgba` provides two methods to stream audio and video out of the real-time loop:

### 1. Direct `MessagePort` Transfer (OBS / MediaWorker)

For production broadcasting (e.g., feeding an OBS WebSocket server or WebRTC gateway), transferring video and audio buffers directly from the emulator worker to a media worker bypasses the main Node.js event loop completely:

```typescript
import { MessageChannel } from 'node:worker_threads';
import { EmulatorController } from 'node-mgba';

// Create dedicated MessageChannel between EmulatorWorker and MediaWorker
const channel = new MessageChannel();

// 1. Hand port1 to your MediaWorker
await mediaWorker.initMediaPort(channel.port1);

// 2. Pass port2 to EmulatorController
const controller = new EmulatorController({
    romPath: process.env.ROM_PATH,
    realtime: true,
    mediaPort: channel.port2,
});

await controller.initialize();
// Video and audio buffers stream directly between worker threads without routing through the main thread.
```

### 2. Built-in Media Sinks (`WebSocketMediaSink`, `FfmpegRecordingSink`)

You can also register media sinks directly on `EmulatorController`:

```typescript
import {
    EmulatorController,
    WebSocketMediaSink,
    FfmpegRecordingSink,
} from 'node-mgba';

// WebSocket broadcast sink for browser clients
const wsSink = new WebSocketMediaSink({
    name: 'obs-stream',
    clients: () => wss.clients,
});

// MP4 gameplay recording sink
const recordingSink = new FfmpegRecordingSink({
    name: 'vod-recorder',
    outputPath: 'gameplay.mp4',
    fps: 60,
});

const controller = new EmulatorController({
    romPath: process.env.ROM_PATH,
    realtime: true,
    mediaSinks: [wsSink, recordingSink],
});

await controller.initialize();

// Dynamically unregister or register sinks at runtime
controller.unregisterMediaSink('vod-recorder');
```

### 3. Frontend Client Playback (Canvas & Web Audio)

The `node-mgba/browser` export provides client-side utilities to render video frames to an HTML `<canvas>` and stream stereo audio chunks with drift compensation and jitter buffering:

```typescript
import {
    CanvasStreamRenderer,
    WebAudioPlayer,
    type BrowserFramePacket,
    type BrowserAudioPacket,
} from 'node-mgba/browser';

// 1. Initialize video renderer and attach to a <canvas> element
const canvas = document.querySelector<HTMLCanvasElement>('#game-screen')!;
const videoRenderer = new CanvasStreamRenderer({
    defaultWidth: 160,
    defaultHeight: 144,
});
videoRenderer.attach(canvas);

// 2. Initialize Web Audio player with a jitter cushion
const audioPlayer = new WebAudioPlayer({
    defaultVolume: 0.8,
    jitterBufferSeconds: 0.15,
});

// Unlock AudioContext on first user interaction (browser autoplay policy)
window.addEventListener('click', () => {
    void audioPlayer.unlock();
}, { once: true });

// 3. Connect to WebSocket stream and dispatch incoming media packets
const socket = new WebSocket('ws://localhost:9001');

socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);

    if (message.type === 'frame') {
        videoRenderer.submitFrame(message as BrowserFramePacket);
    } else if (message.type === 'audio') {
        audioPlayer.playChunk(message as BrowserAudioPacket);
    }
});

// Teardown when unmounting
function cleanup() {
    videoRenderer.detach();
    audioPlayer.stop();
    socket.close();
}
```

For pixelated scaling on retro displays, style the canvas with CSS:

```css
canvas {
    image-rendering: pixelated;
    image-rendering: crisp-edges;
}
```

---

## Example: Autonomous Agent Loop

Below is a simplified TypeScript example demonstrating the real-time agent loop pattern from Gemini Plays Pokémon:

```typescript
import { EmulatorController, GB_FPS } from 'node-mgba';
import { PokemonRedBluePlugin, type PokemonRedBlueState } from 'node-mgba/plugins';

interface AgentDecision {
    readonly buttons: string[];
    readonly explanation: string;
}

async function runAutonomousAgent(romPath: string): Promise<void> {
    const controller = new EmulatorController({
        romPath,
        realtime: true,
        fps: GB_FPS,
        workerOptions: {
            watchdogTimeoutMs: 15000,
        },
    });

    await controller.initialize();
    const pokemon = await controller.use(PokemonRedBluePlugin);

    let isRunning = true;

    // Graceful shutdown on process signals
    const shutdown = async () => {
        isRunning = false;
        await controller.close();
        process.exit(0);
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);

    // Agent turn loop
    while (isRunning) {
        // 1. Capture current RAM state and screenshot
        const state: PokemonRedBlueState = await pokemon.getState();
        const screenshotPng: Buffer = await controller.screen.toPng();

        // 2. Reason about next action (mocked below)
        const decision: AgentDecision = await decideNextAction(state, screenshotPng);
        console.log(`Action: ${decision.buttons.join('+')} (${decision.explanation})`);

        // 3. Inject button presses during real-time playback
        const handle = controller.pressButtons(decision.buttons, {
            holdFrames: 8,
            releaseFrames: 6,
            timeoutMs: 10000,
        });

        await handle.promise;

        // Cooldown between turns
        await new Promise((resolve) => setTimeout(resolve, 500));
    }
}

async function decideNextAction(
    state: PokemonRedBlueState,
    _screenshot: Buffer
): Promise<AgentDecision> {
    if (state.battle.inBattle) {
        return { buttons: ['A'], explanation: 'In battle: selecting fight command' };
    }
    return {
        buttons: ['UP'],
        explanation: `Exploring map ${state.map.id} at (${state.player.position.x}, ${state.player.position.y})`,
    };
}

runAutonomousAgent(process.env.ROM_PATH).catch(console.error);
```
