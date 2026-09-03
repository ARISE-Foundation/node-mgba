import type { Keyframe } from './Keyframe.js';
import type { TurnResult } from './TurnResult.js';

export interface KeyframeSink {
    readonly name: string;
    onKeyframe?(keyframe: Keyframe): Promise<void> | void;
    onTurnComplete?(turnResult: TurnResult): Promise<void> | void;
}
