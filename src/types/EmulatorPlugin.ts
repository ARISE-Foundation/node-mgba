import type { RomInfo } from './RomInfo.js';
import type { NativeMgbaCore } from '../core/NativeMgbaCore.js';

export type CommandHandler = (args?: unknown) => Promise<unknown> | unknown;

export interface FrameEventData {
    readonly frameIndex: number;
    readonly currentKeys: number;
}

export interface EmulatorPlugin<TPluginState = unknown> {
    readonly name: string;
    match?(romInfo: RomInfo): boolean;
    onInit?(core: NativeMgbaCore): Promise<void> | void;
    getState?(): Promise<TPluginState> | TPluginState;
    readonly customCommands?: Readonly<Record<string, CommandHandler>>;
    onFrame?(frameData: FrameEventData): Promise<void> | void;
}
