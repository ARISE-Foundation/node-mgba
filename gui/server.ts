import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { Buffer } from 'node:buffer';
import { WebSocketServer, type WebSocket } from 'ws';
import {
    EmulatorController,
    WebSocketMediaSink,
    KEY_MASKS,
    type VideoPacket,
    type RomInfo,
    type InputAction,
    type ButtonName,
} from '../src/index.js';
import { PokemonRedBluePlugin, isPokemonRedBlue, type PokemonRedBlueState } from '../src/plugins/pokemonRedBlue.js';

const PORT = 3456;
const STATE_FILE = '/tmp/lean_mgba_gui_state.state';

interface ClientMessage {
    type: string;
    frames?: number;
    actions?: InputAction[];
    button?: string;
    fps?: number;
    filePath?: string;
    stateBase64?: string;
    romBase64?: string;
    filename?: string;
    muted?: boolean;
}

interface FramePayload {
    type: 'frame';
    width: number;
    height: number;
    frameIndex: number;
    bufferBase64: string;
    gameState?: PokemonRedBlueState | undefined;
    fps?: number | undefined;
}

interface KeyframePayload {
    frameIndex: number;
    timestampMs: number;
    width: number;
    height: number;
    triggerReason: string;
    hash: string;
    bufferBase64: string;
}

async function main() {
    let romPath = process.env['ROM_PATH'] || process.argv[2];
    if (!romPath || romPath.trim().length === 0) {
        const defaultCandidates = [
            path.resolve('fixtures/super_mario_bros.gba'),
            path.resolve('fixtures/pokemon_blue.gb'),
            path.resolve('fixtures/super_mario_advance_4.gba'),
        ];
        romPath = defaultCandidates.find(p => fs.existsSync(p)) ?? '';
    }
    if (!romPath) {
        console.error('[node-mgba GUI] Error: No valid ROM found. Specify ROM_PATH="path/to/rom.gba" or pass as argument: pnpm gui <path>');
        process.exit(1);
    }
    const absoluteRomPath = path.resolve(romPath);

    if (!fs.existsSync(absoluteRomPath)) {
        console.error(`[node-mgba GUI] Error: ROM file not found at: ${absoluteRomPath}`);
        process.exit(1);
    }

    // HTTP Server for serving Vue SPA static bundle
    const MIME_TYPES: Record<string, string> = {
        '.html': 'text/html; charset=utf-8',
        '.js': 'text/javascript; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.svg': 'image/svg+xml',
        '.png': 'image/png',
        '.ico': 'image/x-icon',
        '.json': 'application/json; charset=utf-8',
        '.woff2': 'font/woff2',
    };

    const publicDir = path.resolve(process.cwd(), 'gui/dist');
    if (!fs.existsSync(publicDir)) {
        throw new Error(`GUI dist directory not found at: ${publicDir}. Run 'pnpm build:gui' first.`);
    }

    const server = http.createServer((req, res) => {
        const cleanUrl = (req.url ?? '/').split('?')[0] ?? '/';
        const reqPath = cleanUrl === '/' ? '/index.html' : cleanUrl;
        let filePath = path.join(publicDir, reqPath);

        if (!fs.existsSync(filePath) && !path.extname(filePath)) {
            filePath = path.join(publicDir, 'index.html');
        }

        fs.readFile(filePath, (err, data) => {
            if (err) {
                res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
                res.end('Not Found');
                return;
            }

            const ext = path.extname(filePath).toLowerCase();
            const contentType = MIME_TYPES[ext] ?? 'application/octet-stream';
            const isHashedAsset = reqPath.startsWith('/assets/') && ext !== '.html';
            const cacheControl = isHashedAsset
                ? 'public, max-age=31536000, immutable'
                : 'no-cache';

            res.writeHead(200, {
                'Content-Type': contentType,
                'Cache-Control': cacheControl,
            });
            res.end(data);
        });
    });

    const wss = new WebSocketServer({ server });

    let latestFrame: VideoPacket = {
        frameIndex: 0,
        pts: 0,
        width: 160,
        height: 144,
        strideBytes: 160 * 4,
        buffer: Buffer.alloc(160 * 144 * 4),
        keys: 0,
    };

    let activeKeyMask = 0;
    let cachedGameState: PokemonRedBlueState | undefined = undefined;
    const unmutedClients = new Set<WebSocket>();

    // Standard media sink for WebSocket audio streaming
    const wsMediaSink = new WebSocketMediaSink({
        clients: () => wss.clients,
        filterClient: (ws, type) => {
            if (type === 'audio') {
                return unmutedClients.has(ws as WebSocket);
            }
            return true;
        },
    });

    console.log(`[node-mgba GUI] Initializing EmulatorController in Worker Thread: ${romPath}`);
    const controller = new EmulatorController({
        romPath: absoluteRomPath,
        realtime: true,
        fps: 60,
        mediaSinks: [wsMediaSink],
    });

    let romInfo: RomInfo | undefined = undefined;

    async function getGameState(): Promise<PokemonRedBlueState | undefined> {
        if (!romInfo || !isPokemonRedBlue(romInfo.title, romInfo.gameCode)) {
            return undefined;
        }
        try {
            const obs = await controller.observe({ memory: { vram: true } });
            if (obs.memory) {
                return PokemonRedBluePlugin.decode(obs.memory);
            }
        } catch (err) {
            console.warn('[node-mgba GUI] Failed to decode game state:', err);
        }
        return undefined;
    }

    let lastFrameTime = performance.now();
    let measuredFps = 60;
    let isObservingGameState = false;

    function getFramePayload(frame: VideoPacket, gameState?: PokemonRedBlueState, fps?: number): FramePayload {
        return {
            type: 'frame',
            width: frame.width,
            height: frame.height,
            frameIndex: frame.frameIndex,
            bufferBase64: frame.buffer.toString('base64'),
            gameState,
            fps: fps ?? measuredFps,
        };
    }

    function broadcast(data: unknown): void {
        let payloadStr: string | null = null;
        const isLossyFrame = typeof data === 'object' && data !== null && (data as { type?: string }).type === 'frame';

        for (const client of wss.clients) {
            if (client.readyState === 1) { // WebSocket.OPEN
                if (isLossyFrame && client.bufferedAmount !== undefined && client.bufferedAmount > 512 * 1024) {
                    continue;
                }
                if (payloadStr === null) {
                    payloadStr = JSON.stringify(data);
                }
                try {
                    client.send(payloadStr);
                } catch (err) {
                    console.warn('[node-mgba GUI] Client broadcast error:', err);
                }
            }
        }
    }

    controller.on('frame', (frame: VideoPacket) => {
        latestFrame = frame;
        const now = performance.now();
        const delta = now - lastFrameTime;
        lastFrameTime = now;
        if (delta > 0) {
            measuredFps = 1000 / delta;
        }

        if (!isObservingGameState && romInfo && isPokemonRedBlue(romInfo.title, romInfo.gameCode)) {
            isObservingGameState = true;
            getGameState()
                .then((state) => {
                    if (state) {
                        cachedGameState = state;
                    }
                })
                .finally(() => {
                    isObservingGameState = false;
                });
        }

        broadcast(getFramePayload(frame, cachedGameState, measuredFps));
    });

    controller.on('start', () => broadcast({ type: 'loopStatus', isLooping: true }));
    controller.on('pause', () => broadcast({ type: 'loopStatus', isLooping: false }));

    try {
        romInfo = await controller.initialize();
        console.log(`[node-mgba GUI] Loaded ${romInfo.title} (${romInfo.platform})`);
    } catch (err) {
        console.error(`[node-mgba GUI] Failed to load ROM:`, err);
        process.exit(1);
    }

    let commandQueue: Promise<void> = Promise.resolve();

    function enqueueCommand(task: () => Promise<void>): void {
        commandQueue = commandQueue.then(async () => {
            try {
                await task();
            } catch (err) {
                console.error('[node-mgba GUI] Command error:', err);
            }
        });
    }

    wss.on('connection', (ws: WebSocket) => {
        enqueueCommand(async () => {
            if (ws.readyState !== 1) { // WebSocket.OPEN
                return;
            }

            console.log('[node-mgba GUI] Client connected');

            if (!controller.isPlaybackRunning()) {
                await controller.startPlayback();
            }

            cachedGameState = await getGameState();
            const initialFrame = getFramePayload(latestFrame, cachedGameState);
            ws.send(JSON.stringify({
                type: 'init',
                romInfo,
                frame: initialFrame,
                gameState: initialFrame.gameState,
                isLooping: controller.isPlaybackRunning(),
            }));
        });

        ws.on('message', (raw: Buffer | string) => {
            enqueueCommand(async () => {
                const text = typeof raw === 'string' ? raw : raw.toString('utf-8');
                const msg = JSON.parse(text) as ClientMessage;

                switch (msg.type) {
                    case 'init': {
                        cachedGameState = await getGameState();
                        ws.send(JSON.stringify({
                            type: 'init',
                            romInfo,
                            frame: getFramePayload(latestFrame, cachedGameState),
                            gameState: cachedGameState,
                            isLooping: controller.isPlaybackRunning(),
                        }));
                        break;
                    }

                    case 'keyDown': {
                        if (msg.button) {
                            const btn = msg.button.trim().toUpperCase() as ButtonName;
                            const mask = KEY_MASKS[btn];
                            if (mask !== undefined) {
                                activeKeyMask |= mask;
                                await controller.setKeyMask(activeKeyMask);

                                if (!controller.isPlaybackRunning()) {
                                    latestFrame = await controller.step(4, activeKeyMask);
                                    cachedGameState = await getGameState();
                                    broadcast(getFramePayload(latestFrame, cachedGameState));
                                }
                            }
                        }
                        break;
                    }

                    case 'keyUp': {
                        if (msg.button) {
                            const btn = msg.button.trim().toUpperCase() as ButtonName;
                            const mask = KEY_MASKS[btn];
                            if (mask !== undefined) {
                                activeKeyMask &= ~mask;
                                await controller.setKeyMask(activeKeyMask);

                                if (!controller.isPlaybackRunning()) {
                                    latestFrame = await controller.step(4, activeKeyMask);
                                    cachedGameState = await getGameState();
                                    broadcast(getFramePayload(latestFrame, cachedGameState));
                                }
                            }
                        }
                        break;
                    }

                    case 'step': {
                        const wasRunning = controller.isPlaybackRunning();
                        if (wasRunning) await controller.pausePlayback();
                        try {
                            const frames = msg.frames ?? 1;
                            latestFrame = await controller.step(frames, activeKeyMask);
                            cachedGameState = await getGameState();
                            broadcast(getFramePayload(latestFrame, cachedGameState));
                        } finally {
                            if (wasRunning) await controller.startPlayback();
                        }
                        break;
                    }

                    case 'stepSequence': {
                        if (msg.actions && Array.isArray(msg.actions)) {
                            const wasRunning = controller.isPlaybackRunning();
                            if (wasRunning) await controller.pausePlayback();
                            try {
                                const result = await controller.controls.sequence(
                                    msg.actions,
                                    { postStabilizationFrames: 16 },
                                );
                                const kfPayloads: KeyframePayload[] = result.keyframes.map(k => ({
                                    frameIndex: k.frameIndex,
                                    timestampMs: k.timestampMs,
                                    width: k.width,
                                    height: k.height,
                                    triggerReason: k.triggerReason,
                                    hash: k.hash,
                                    bufferBase64: k.buffer.toString('base64'),
                                }));

                                const lastKf = result.keyframes[result.keyframes.length - 1];
                                if (lastKf) {
                                    latestFrame = {
                                        frameIndex: lastKf.frameIndex,
                                        pts: 0,
                                        width: lastKf.width,
                                        height: lastKf.height,
                                        strideBytes: lastKf.width * 4,
                                        buffer: lastKf.buffer,
                                        keys: 0,
                                    };
                                }

                                const state = await getGameState();
                                cachedGameState = state;
                                broadcast({
                                    type: 'turnResult',
                                    executionTimeMs: result.executionTimeMs,
                                    durationFrames: result.durationFrames,
                                    fps: (result.durationFrames / Math.max(1, result.executionTimeMs)) * 1000,
                                    gameState: state,
                                    keyframes: kfPayloads,
                                    lastFrame: getFramePayload(latestFrame, state),
                                });
                            } finally {
                                if (wasRunning) {
                                    await controller.startPlayback();
                                }
                            }
                        }
                        break;
                    }

                    case 'startLoop': {
                        await controller.startPlayback(msg.fps);
                        break;
                    }

                    case 'stopLoop': {
                        await controller.pausePlayback();
                        break;
                    }

                    case 'reset': {
                        const wasRunning = controller.isPlaybackRunning();
                        if (wasRunning) await controller.pausePlayback();
                        try {
                            await controller.reset();
                            activeKeyMask = 0;
                            await controller.setKeyMask(0);
                            latestFrame = await controller.step(120);
                            const state = await getGameState();
                            broadcast(getFramePayload(latestFrame, state));
                        } finally {
                            if (wasRunning) await controller.startPlayback();
                        }
                        break;
                    }

                    case 'saveState': {
                        const targetPath = msg.filePath ? path.resolve(msg.filePath) : STATE_FILE;
                        const ok = await controller.saveState(targetPath);
                        console.log(`[node-mgba GUI] Save state to ${targetPath}: ${ok ? 'SUCCESS' : 'FAILED'}`);
                        ws.send(JSON.stringify({
                            type: 'toast',
                            success: ok,
                            message: ok ? `Saved state to ${path.basename(targetPath)}` : 'Failed to save state',
                        }));
                        break;
                    }

                    case 'loadState': {
                        const targetPath = msg.filePath ? path.resolve(msg.filePath) : STATE_FILE;
                        if (!fs.existsSync(targetPath)) {
                            ws.send(JSON.stringify({
                                type: 'toast',
                                success: false,
                                message: `Savestate file not found: ${targetPath}`,
                            }));
                            break;
                        }
                        const wasRunning = controller.isPlaybackRunning();
                        if (wasRunning) await controller.pausePlayback();
                        try {
                            const ok = await controller.loadState(targetPath);
                            console.log(`[node-mgba GUI] Load state from ${targetPath}: ${ok ? 'SUCCESS' : 'FAILED'}`);
                            if (ok) {
                                await controller.setKeyMask(activeKeyMask);
                                latestFrame = await controller.step(1);
                                cachedGameState = await getGameState();
                                broadcast(getFramePayload(latestFrame, cachedGameState));
                                ws.send(JSON.stringify({
                                    type: 'toast',
                                    success: true,
                                    message: `Successfully loaded ${path.basename(targetPath)}`,
                                }));
                            } else {
                                ws.send(JSON.stringify({
                                    type: 'toast',
                                    success: false,
                                    message: `Failed to load state: ${path.basename(targetPath)}`,
                                }));
                            }
                        } finally {
                            if (wasRunning) await controller.startPlayback();
                        }
                        break;
                    }

                    case 'uploadState': {
                        if (msg.stateBase64) {
                            const buffer = Buffer.from(msg.stateBase64, 'base64');
                            const filename = path.basename(msg.filename ?? 'uploaded_state.state');
                            const targetPath = path.join('/tmp', filename);
                            fs.writeFileSync(targetPath, buffer);

                            const wasRunning = controller.isPlaybackRunning();
                            if (wasRunning) await controller.pausePlayback();
                            try {
                                const ok = await controller.loadState(targetPath);
                                if (ok) {
                                    await controller.setKeyMask(activeKeyMask);
                                    latestFrame = await controller.step(1);
                                    const state = await getGameState();
                                    broadcast(getFramePayload(latestFrame, state));
                                    ws.send(JSON.stringify({
                                        type: 'toast',
                                        success: true,
                                        message: `Uploaded & loaded ${filename} (${buffer.length} bytes)`,
                                    }));
                                } else {
                                    ws.send(JSON.stringify({
                                        type: 'toast',
                                        success: false,
                                        message: `Failed to load uploaded state ${filename}`,
                                    }));
                                }
                            } finally {
                                if (wasRunning) await controller.startPlayback();
                            }
                        }
                        break;
                    }

                    case 'listSavestates': {
                        const discovered: { name: string; path: string; size: number }[] = [];
                        const candidateDirs = [
                            path.resolve('fixtures'),
                            '/tmp',
                        ];

                        for (const dir of candidateDirs) {
                            if (fs.existsSync(dir)) {
                                const files = fs.readdirSync(dir);
                                for (const f of files) {
                                    if (f.endsWith('.state') || f.match(/\.ss\d+$/i)) {
                                        const fullPath = path.join(dir, f);
                                        const stats = fs.statSync(fullPath);
                                        discovered.push({
                                            name: f,
                                            path: fullPath,
                                            size: stats.size,
                                        });
                                    }
                                }
                            }
                        }

                        ws.send(JSON.stringify({
                            type: 'savestateList',
                            savestates: discovered,
                        }));
                        break;
                    }

                    case 'listRoms': {
                        const discovered: { name: string; path: string; size: number; platform: string }[] = [];
                        const candidateDirs = [
                            path.resolve('fixtures'),
                            path.resolve('../fixtures'),
                            path.resolve('../node-mgba/fixtures'),
                            '/tmp',
                        ];

                        const seen = new Set<string>();
                        for (const dir of candidateDirs) {
                            if (fs.existsSync(dir)) {
                                const files = fs.readdirSync(dir);
                                for (const f of files) {
                                    const lower = f.toLowerCase();
                                    if (lower.endsWith('.gba') || lower.endsWith('.gb') || lower.endsWith('.gbc')) {
                                        const fullPath = path.join(dir, f);
                                        if (seen.has(fullPath)) continue;
                                        seen.add(fullPath);
                                        const stats = fs.statSync(fullPath);
                                        const platform = lower.endsWith('.gba') ? 'GBA' : 'GB';
                                        discovered.push({
                                            name: f,
                                            path: fullPath,
                                            size: stats.size,
                                            platform,
                                        });
                                    }
                                }
                            }
                        }

                        ws.send(JSON.stringify({
                            type: 'romList',
                            roms: discovered,
                        }));
                        break;
                    }

                    case 'loadRom': {
                        if (msg.filePath) {
                            const targetPath = path.resolve(msg.filePath);
                            if (!fs.existsSync(targetPath)) {
                                ws.send(JSON.stringify({
                                    type: 'toast',
                                    success: false,
                                    message: `ROM not found: ${path.basename(targetPath)}`,
                                }));
                                break;
                            }

                            try {
                                romInfo = await controller.loadROM(targetPath);
                                cachedGameState = await getGameState();
                                latestFrame = await controller.step(1);
                                broadcast({
                                    type: 'romLoaded',
                                    romInfo,
                                    frame: getFramePayload(latestFrame, cachedGameState),
                                    gameState: cachedGameState,
                                    isLooping: controller.isPlaybackRunning(),
                                });
                                broadcast({
                                    type: 'toast',
                                    success: true,
                                    message: `Loaded ${romInfo.title} (${romInfo.platform})`,
                                });
                            } catch (err) {
                                console.error('[node-mgba GUI] Failed to load ROM:', err);
                                ws.send(JSON.stringify({
                                    type: 'toast',
                                    success: false,
                                    message: `Error loading ROM: ${err instanceof Error ? err.message : String(err)}`,
                                }));
                            }
                        }
                        break;
                    }

                    case 'uploadRom': {
                        if (msg.romBase64) {
                            const buffer = Buffer.from(msg.romBase64, 'base64');
                            const filename = path.basename(msg.filename ?? 'uploaded.gba');
                            const targetPath = path.join('/tmp', filename);
                            fs.writeFileSync(targetPath, buffer);

                            try {
                                romInfo = await controller.loadROM(targetPath);
                                cachedGameState = await getGameState();
                                latestFrame = await controller.step(1);
                                broadcast({
                                    type: 'romLoaded',
                                    romInfo,
                                    frame: getFramePayload(latestFrame, cachedGameState),
                                    gameState: cachedGameState,
                                    isLooping: controller.isPlaybackRunning(),
                                });
                                broadcast({
                                    type: 'toast',
                                    success: true,
                                    message: `Uploaded & loaded ${romInfo.title} (${romInfo.platform})`,
                                });
                            } catch (err) {
                                console.error('[node-mgba GUI] Failed to load uploaded ROM:', err);
                                ws.send(JSON.stringify({
                                    type: 'toast',
                                    success: false,
                                    message: `Error loading uploaded ROM: ${err instanceof Error ? err.message : String(err)}`,
                                }));
                            }
                        }
                        break;
                    }

                    case 'setMute': {
                        if (msg.muted) {
                            unmutedClients.delete(ws);
                        } else {
                            unmutedClients.add(ws);
                        }
                        break;
                    }
                }
            });
        });

        ws.on('close', () => {
            unmutedClients.delete(ws);
            console.log('[node-mgba GUI] Client disconnected');
            if (wss.clients.size === 0 && activeKeyMask !== 0) {
                activeKeyMask = 0;
                void controller.setKeyMask(0).catch(() => {});
            }
        });
    });

    server.listen(PORT, () => {
        console.log(`\n🎮 [node-mgba Studio] Test GUI server running at: http://localhost:${PORT}`);
        console.log(`🎮 Powered by EmulatorController (Worker Thread Isolation).\n`);
    });
}

main().catch((err) => {
    console.error('[node-mgba GUI] Fatal startup error:', err);
    process.exit(1);
});
