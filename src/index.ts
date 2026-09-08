export {
    Mgba,
    MgbaInstance,
    type MgbaLoadOptions,
    type WaitForDeclarativeSpec,
    type WaitForOptions,
    type MemorySnapshotOptions,
} from './Mgba.js';
export {
    GamePlugin,
    type GamePluginConstructor,
    definePlugin,
    type MgbaPlugin,
    type PluginClass,
} from './plugins/Plugin.js';
export {
    defineStruct,
    u8,
    u16le,
    u16be,
    u24le,
    u24be,
    u32le,
    u32be,
    stringField,
    type StringFieldOptions,
    bcdField,
    bitfield,
    enumField,
    arrayField,
    customField,
    type Field,
    type StructSchema,
    type InferField,
    type InferDefinition,
    type BitfieldSpec,
    type InferBitfield,
} from './schema/index.js';
export {
    MockMemoryReader,
    createMockMemoryReader,
    type MockMemoryOptions,
} from './testing/index.js';
export {
    SpriteDecoder,
    type Sprite,
    type GbSpriteAttributes,
    type GbaSpriteAttributes,
} from './graphics/SpriteDecoder.js';
export {
    TilemapDecoder,
    type TilemapData,
    type GbTilemap,
    type GbTileEntry,
    type GbaBgLayer,
} from './graphics/TilemapDecoder.js';
export {
    SymbolManager,
    type SymbolRecord,
    inferRegionFromAddress,
    bankedToPhysicalOffset,
} from './symbols/SymbolManager.js';
export {
    MgbaEmulator,
    type MgbaEmulatorOptions,
    LeanEmulator,
    type LeanEmulatorOptions,
} from './core/MgbaEmulator.js';
export {
    NativeMgbaCore,
    KEY_MASKS,
    normalizeMemoryRegion,
    normalizeMemorySpace,
    parseRegionId,
} from './core/NativeMgbaCore.js';
export {
    BUTTON_BITMASKS,
    ALL_VALID_BUTTON_BITS,
    resolveButtonMask,
    expandButtonsToInputActions,
    compileSequenceActions,
    type CompiledSequence,
} from './core/InputActionCompiler.js';
export {
    planNextActionStep,
    type ActiveActionState,
    type ActionStepState,
    type ActionStepResult,
} from './core/ActionQueueStepPlanner.js';
export {
    GB_FPS,
    GB_FRAME_DURATION_MS,
    GB_AUDIO_SAMPLE_RATE,
} from './types/InputAction.js';
export {
    EmulatorController,
    type EmulatorControllerOptions,
    type ControllerState,
} from './core/EmulatorController.js';
export { KeyframeCollector, type KeyframeCollectorOptions } from './core/KeyframeCollector.js';
export { PluginRegistry } from './core/PluginRegistry.js';
export { WorkerEmulatorClient } from './worker/WorkerEmulatorClient.js';
export type {
    WorkerRequest,
    WorkerResponse,
    WorkerEvent,
    WorkerEmulatorClientOptions,
    ObservationSnapshot,
    SliceSpec,
    MemoryChangeEntry,
} from './worker/protocol.js';
export {
    FfmpegRecordingSink,
    type FfmpegRecordingOptions,
} from './sinks/FfmpegRecordingSink.js';
export {
    WebSocketMediaSink,
    type WebSocketMediaSinkOptions,
    type WebSocketClientLike,
} from './sinks/WebSocketMediaSink.js';
export {
    ResamplingMediaSink,
    type ResamplingMediaSinkOptions,
    PcmS16StereoResampler,
    type ResamplerOptions,
} from './sinks/ResamplingMediaSink.js';
export {
    encodeVideoPacket,
    type ImageEncodeOptions,
} from './utils/imageEncoder.js';
export type {
    RomInfo,
    PlatformType,
    ConsoleModel,
    CartridgeMetadata,
    StateHandle,
    MemoryRegionName,
    GbMemoryRegion,
    GbaMemoryRegion,
    ReadSpec,
    ReadSpecType,
    ReadResultValue,
    MemoryTarget,
    Keyframe,
    TurnResult,
    KeyframeSink,
    MediaSink,
    VideoPacket,
    AudioChunk,
    EmulatorPlugin,
    CommandHandler,
    InputAction,
    ButtonName,
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
} from './types/index.js';
export {
    press,
    wait,
    hold,
    release,
    validateInputAction,
    validateStepSequenceOptions,
    parseSinkIdentity,
    DEFAULT_HOLD_FRAMES,
    DEFAULT_RELEASE_FRAMES,
    DEFAULT_POST_STABILIZATION_FRAMES,
    FatalWorkerError,
    LifecycleError,
    AbortError,
    TimeoutError,
} from './types/index.js';
export {
    type MemoryReader,
    type MemorySnapshotReader,
    SnapshotMemoryReader,
    type SnapshotMemorySlices,
} from './core/MemoryReader.js';
export {
    PokemonRedBluePlugin,
    isPokemonRedBlue,
    type PokemonRedBlueState,
    type MapObject,
    POKEMON_BLUE_SHA256,
} from './plugins/pokemonRedBlue.js';
