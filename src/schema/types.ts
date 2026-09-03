import type { MemoryReader } from '../core/MemoryReader.js';

/**
 * A strongly-typed binary field extractor that reads a value from a MemoryReader.
 */
export interface Field<T> {
    readonly extent: number;
    read(reader: MemoryReader, baseAddress: number): T;
}

/**
 * Infers the output TypeScript type of a Field.
 */
export type InferField<F> = F extends Field<infer T> ? T : never;

/**
 * Infers the complete record type from a dictionary of Field definitions.
 */
export type InferDefinition<D extends Record<string, Field<unknown>>> = {
    readonly [K in keyof D]: InferField<D[K]>;
};

/**
 * A compiled binary structure schema capable of reading an entire record.
 */
export interface StructSchema<T> extends Field<T> {
    readonly fields: Readonly<Record<string, Field<unknown>>>;
}

export type BitfieldSpec = Record<string, number | readonly [number, number]>;

export type InferBitfield<TSpec extends BitfieldSpec> = {
    readonly [K in keyof TSpec]: TSpec[K] extends readonly [number, number] ? number : boolean;
};
