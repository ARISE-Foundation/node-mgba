import type {
    PokemonRedBlueState,
    PokemonPartyMember,
    PokemonStoredMember,
    InventoryItem,
    MapObject,
} from '../../src/plugins/pokemonRedBlue.js';
import type { RomInfo } from '../../src/types/RomInfo.js';
import type { InputAction, ButtonName } from '../../src/types/InputAction.js';

export type {
    PokemonRedBlueState,
    PokemonPartyMember,
    PokemonStoredMember,
    InventoryItem,
    MapObject,
    RomInfo,
    InputAction,
    ButtonName,
};

export interface FramePayload {
    readonly type: 'frame';
    readonly width: number;
    readonly height: number;
    readonly frameIndex: number;
    readonly bufferBase64: string;
    readonly gameState?: PokemonRedBlueState | undefined;
    readonly fps?: number | undefined;
}

export interface KeyframePayload {
    readonly frameIndex: number;
    readonly timestampMs: number;
    readonly width: number;
    readonly height: number;
    readonly triggerReason: string;
    readonly hash: string;
    readonly bufferBase64: string;
}

export interface SavestateEntry {
    readonly name: string;
    readonly path: string;
    readonly size: number;
}

export interface RomEntry {
    readonly name: string;
    readonly path: string;
    readonly size: number;
    readonly platform: string;
}

export interface TurnResultPayload {
    readonly type: 'turnResult';
    readonly executionTimeMs: number;
    readonly durationFrames: number;
    readonly fps: number;
    readonly gameState: PokemonRedBlueState;
    readonly keyframes: readonly KeyframePayload[];
    readonly lastFrame?: FramePayload | undefined;
}

export interface ToastNotification {
    readonly id: string;
    readonly message: string;
    readonly isSuccess: boolean;
}

export interface AudioPayload {
    readonly type: 'audio';
    readonly sampleRate: number;
    readonly channels: number;
    readonly sampleFrames: number;
    readonly bufferBase64: string;
}

