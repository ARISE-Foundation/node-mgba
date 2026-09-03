import type { ConsoleModel } from '../types/ConsoleModel.js';
import type { MgbaInstance } from '../Mgba.js';
import type { MemoryReader } from '../core/MemoryReader.js';
import type { MemorySnapshotOptions } from '../types/MemoryRegion.js';

export interface GamePluginConstructor<TState, TInstance = GamePlugin<TState>> {
    new (emu: MgbaInstance): TInstance;
    readonly pluginName: string;
    readonly supportedModels?: readonly ConsoleModel[] | undefined;
    readonly memorySlices?: MemorySnapshotOptions | undefined;
    decode(mem: MemoryReader): TState;
}

/**
 * Abstract base class for game-specific RAM state plugins.
 * Automatically handles console model validation, snapshotting configured memory slices,
 * and delegating to the static pure decoder.
 */
export abstract class GamePlugin<TState> {
    public static readonly pluginName: string = '';
    public static readonly supportedModels?: readonly ConsoleModel[] | undefined;
    public static readonly memorySlices?: MemorySnapshotOptions | undefined;

    protected readonly emu: MgbaInstance;

    constructor(emu: MgbaInstance) {
        const ctor = this.constructor as typeof GamePlugin;
        const supported = ctor.supportedModels;

        if (supported && !supported.includes(emu.console.model)) {
            throw new Error(
                `Plugin "${ctor.pluginName}" does not support console model "${emu.console.model}". Supported models: ${supported.join(', ')}`
            );
        }

        this.emu = emu;
    }

    /**
     * Snapshots the memory slices required by this game plugin and decodes the live game state.
     */
    public async getState(): Promise<TState> {
        const ctor = this.constructor as unknown as GamePluginConstructor<TState, this>;
        const slices = ctor.memorySlices ?? {};
        const snapshot = await this.emu.memory.snapshot(slices);

        if (typeof ctor.decode !== 'function') {
            throw new TypeError(
                `GamePlugin "${ctor.pluginName}" must implement a static decode(mem: MemoryReader): TState method.`
            );
        }

        return ctor.decode(snapshot);
    }
}
