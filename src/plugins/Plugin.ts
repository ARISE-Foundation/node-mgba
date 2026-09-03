import type { ConsoleModel } from '../types/ConsoleModel.js';
import type { MgbaInstance } from '../Mgba.js';
export { GamePlugin, type GamePluginConstructor } from './GamePlugin.js';

/**
 * Single canonical Plugin class contract for node-mgba.
 * Every plugin is a TypeScript class that receives MgbaInstance in its constructor.
 */
export interface PluginClass<TInstance = unknown> {
    new (emu: MgbaInstance): TInstance;
    readonly pluginName: string;
    readonly supportedModels?: readonly ConsoleModel[] | undefined;
}

export type MgbaPlugin<T = unknown> = PluginClass<T>;

export function definePlugin<T>(plugin: PluginClass<T>): PluginClass<T> {
    return plugin;
}
