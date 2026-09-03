import type { MemoryReader } from '../core/MemoryReader.js';
import type { Field, StructSchema, InferDefinition } from './types.js';

export function defineStruct<const D extends Record<string, Field<unknown>>>(
    definition: D,
): StructSchema<InferDefinition<D>> {
    const keys = Object.keys(definition);
    let maxExtent = 0;

    for (let i = 0; i < keys.length; i++) {
        const k = keys[i];
        if (!k) continue;
        const field = definition[k];
        if (!field || typeof field.extent !== 'number' || !Number.isSafeInteger(field.extent) || field.extent < 0) {
            throw new TypeError(`defineStruct: field "${k}" must be a valid Field with a non-negative integer extent`);
        }
        if (field.extent > maxExtent) {
            maxExtent = field.extent;
        }
    }

    return {
        extent: maxExtent,
        fields: definition,
        read: (reader: MemoryReader, baseAddress: number): InferDefinition<D> => {
            const result: Record<string, unknown> = {};
            for (let i = 0; i < keys.length; i++) {
                const k = keys[i];
                if (!k) continue;
                const field = definition[k];
                if (field) {
                    result[k] = field.read(reader, baseAddress);
                }
            }
            return result as InferDefinition<D>;
        },
    };
}
