import type { MemoryReader } from '../core/MemoryReader.js';
import type { Field, BitfieldSpec, InferBitfield } from './types.js';

function validateSafeOffset(val: number, name = 'offset'): void {
    if (!Number.isSafeInteger(val) || val < 0) {
        throw new RangeError(`${name} must be a non-negative safe integer, received ${val}`);
    }
}

function validatePositiveSafeInteger(val: number, name: string): void {
    if (!Number.isSafeInteger(val) || val <= 0) {
        throw new RangeError(`${name} must be a positive safe integer, received ${val}`);
    }
}

export function u8(offset: number): Field<number> {
    validateSafeOffset(offset);
    return {
        extent: offset + 1,
        read: (reader: MemoryReader, baseAddress: number) => reader.readU8(baseAddress + offset),
    };
}

export function u16le(offset: number): Field<number> {
    validateSafeOffset(offset);
    return {
        extent: offset + 2,
        read: (reader: MemoryReader, baseAddress: number) => reader.readU16LE(baseAddress + offset),
    };
}

export function u16be(offset: number): Field<number> {
    validateSafeOffset(offset);
    return {
        extent: offset + 2,
        read: (reader: MemoryReader, baseAddress: number) => reader.readU16BE(baseAddress + offset),
    };
}

export function u24le(offset: number): Field<number> {
    validateSafeOffset(offset);
    return {
        extent: offset + 3,
        read: (reader: MemoryReader, baseAddress: number) => reader.readU24LE(baseAddress + offset),
    };
}

export function u24be(offset: number): Field<number> {
    validateSafeOffset(offset);
    return {
        extent: offset + 3,
        read: (reader: MemoryReader, baseAddress: number) => reader.readU24BE(baseAddress + offset),
    };
}

export function u32le(offset: number): Field<number> {
    validateSafeOffset(offset);
    return {
        extent: offset + 4,
        read: (reader: MemoryReader, baseAddress: number) => reader.readU32LE(baseAddress + offset),
    };
}

export function u32be(offset: number): Field<number> {
    validateSafeOffset(offset);
    return {
        extent: offset + 4,
        read: (reader: MemoryReader, baseAddress: number) => reader.readU32BE(baseAddress + offset),
    };
}

export interface StringFieldOptions {
    readonly charMap: Readonly<Record<number, string>>;
    readonly terminator?: number | undefined;
    readonly trim?: boolean | undefined;
}

export function stringField(offset: number, length: number, options: StringFieldOptions): Field<string> {
    validateSafeOffset(offset);
    validatePositiveSafeInteger(length, 'length');
    const terminator = options.terminator ?? 0x50;
    const shouldTrim = options.trim ?? true;
    return {
        extent: offset + length,
        read: (reader: MemoryReader, baseAddress: number) => {
            const raw = reader.readString(baseAddress + offset, length, options.charMap, terminator);
            return shouldTrim ? raw.trim() : raw;
        },
    };
}

export function bcdField(offset: number, byteCount: number): Field<number> {
    validateSafeOffset(offset);
    validatePositiveSafeInteger(byteCount, 'byteCount');
    return {
        extent: offset + byteCount,
        read: (reader: MemoryReader, baseAddress: number) => reader.readBCD(baseAddress + offset, byteCount),
    };
}

export function bitfield<const TSpec extends BitfieldSpec>(offset: number, spec: TSpec): Field<InferBitfield<TSpec>> {
    validateSafeOffset(offset);
    return {
        extent: offset + 1,
        read: (reader: MemoryReader, baseAddress: number) => {
            const byte = reader.readU8(baseAddress + offset);
            const result: Record<string, boolean | number> = {};
            for (const key of Object.keys(spec)) {
                const def = spec[key];
                if (typeof def === 'number') {
                    result[key] = (byte & (1 << def)) !== 0;
                } else if (Array.isArray(def)) {
                    const [startBit, endBit] = def;
                    const bitCount = endBit - startBit + 1;
                    const mask = (1 << bitCount) - 1;
                    result[key] = (byte >> startBit) & mask;
                }
            }
            return result as InferBitfield<TSpec>;
        },
    };
}

export function enumField<const TLookup extends Record<number, string>, TFallback extends string = string>(
    offset: number,
    lookupTable: TLookup,
    fallback?: TFallback,
): Field<TLookup[keyof TLookup] | TFallback | `UNKNOWN_${number}`> {
    validateSafeOffset(offset);
    return {
        extent: offset + 1,
        read: (reader: MemoryReader, baseAddress: number) => {
            const val = reader.readU8(baseAddress + offset);
            const found = (lookupTable as Record<number, string>)[val];
            if (found !== undefined) {
                return found as TLookup[keyof TLookup];
            }
            return (fallback !== undefined ? fallback : `UNKNOWN_${val}`) as TFallback | `UNKNOWN_${number}`;
        },
    };
}

export function arrayField<T>(
    offset: number,
    count: number,
    element: Field<T>,
    stride?: number,
): Field<readonly T[]> {
    validateSafeOffset(offset, 'offset');
    validateSafeOffset(count, 'count');
    if (!element || typeof element.extent !== 'number') {
        throw new TypeError('arrayField element must be a valid Field with an extent');
    }
    const itemStride = stride ?? element.extent;
    validateSafeOffset(itemStride, 'stride');
    const extent = count === 0 ? offset : offset + (count - 1) * itemStride + element.extent;
    return {
        extent,
        read: (reader: MemoryReader, baseAddress: number) => {
            const items: T[] = new Array(count);
            for (let i = 0; i < count; i++) {
                items[i] = element.read(reader, baseAddress + offset + i * itemStride);
            }
            return items;
        },
    };
}

export function customField<T>(
    extent: number,
    fn: (reader: MemoryReader, baseAddress: number) => T,
): Field<T> {
    validateSafeOffset(extent, 'extent');
    return {
        extent,
        read: fn,
    };
}
