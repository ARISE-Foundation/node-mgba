import type { ConsoleModel, PlatformType, CartridgeMetadata } from './ConsoleModel.js';

export type { PlatformType, ConsoleModel, CartridgeMetadata } from './ConsoleModel.js';

export interface RomInfo {
    readonly title: string;
    readonly gameCode: string;
    readonly romSize: number;
    readonly ramSize: number;
    readonly hasBattery: boolean;
    readonly hasRtc: boolean;
    readonly platform: PlatformType;
    readonly model: ConsoleModel;
    readonly cartridge: CartridgeMetadata;
}
