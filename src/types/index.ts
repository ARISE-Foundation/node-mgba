export type { RomInfo, PlatformType, ConsoleModel } from './RomInfo.js';
export type { CartridgeMetadata } from './ConsoleModel.js';
export type { StateHandle } from './StateHandle.js';
export type {
    GbMemoryRegion,
    GbaMemoryRegion,
    MemoryRegionName,
    ReadSpec,
    ReadSpecType,
    ReadResultValue,
    MemorySnapshotOptions,
} from './MemoryRegion.js';
export type { MemoryTarget } from './MemoryTarget.js';
export type { Keyframe } from './Keyframe.js';
export type { TurnResult } from './TurnResult.js';
export type { KeyframeSink } from './KeyframeSink.js';
export type { MediaSink, VideoPacket, AudioChunk } from './MediaSink.js';
export { parseSinkIdentity } from './MediaSink.js';
export type { EmulatorPlugin, CommandHandler } from './EmulatorPlugin.js';
export type {
    InputAction,
    ButtonName,
    ButtonChord,
    ButtonInput,
    HeldButtonStatus,
    InputActionMetadata,
    InputActionBase,
    InputPressAction,
    InputWaitAction,
    InputHoldAction,
    InputReleaseAction,
    ExecuteSequenceOptions,
    StepSequenceOptions,
    SequenceExecutionResult,
    SequenceHandle,
    PressButtonsOptions,
    ButtonActionItem,
} from './InputAction.js';
export {
    GB_FPS,
    GB_FRAME_DURATION_MS,
    GB_AUDIO_SAMPLE_RATE,
    DEFAULT_HOLD_FRAMES,
    DEFAULT_RELEASE_FRAMES,
    DEFAULT_POST_STABILIZATION_FRAMES,
    press,
    wait,
    hold,
    release,
    validateInputAction,
    validateStepSequenceOptions,
    normalizeButtonChord,
    maskToButtonNames,
} from './InputAction.js';
export {
    FatalWorkerError,
    LifecycleError,
    AbortError,
    TimeoutError,
} from './errors.js';
