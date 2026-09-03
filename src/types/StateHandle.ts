declare const StateHandleBrand: unique symbol;

/**
 * Opaque handle referencing an in-memory savestate snapshot stored inside the worker runtime.
 * Stamped with sessionId, frameIndex, and byteSize.
 */
export interface StateHandle {
    readonly [StateHandleBrand]?: true;
    readonly id: string;
    readonly sessionId: string;
    readonly frameIndex: number;
    readonly byteSize: number;
    readonly createdAt: number;
}
