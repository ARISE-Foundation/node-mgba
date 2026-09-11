import zlib from 'node:zlib';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

/**
 * Checks if a buffer represents an mGBA PNG savestate container and extracts the internal
 * zlib-compressed mGBA savestate chunk ('gbAs', 'gbaS', 'gbCs', or 'mgBa').
 * Returns the raw uncompressed state buffer, or null if not an mGBA PNG savestate container.
 */
export function unpackMgbaPngBuffer(buffer: Buffer | Uint8Array): Buffer | null {
    const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    if (buf.length < 16 || !buf.subarray(0, 8).equals(PNG_SIGNATURE)) {
        return null;
    }

    let offset = 8;
    while (offset + 8 <= buf.length) {
        const length = buf.readUInt32BE(offset);
        const type = buf.subarray(offset + 4, offset + 8).toString('ascii');
        const dataStart = offset + 8;
        const dataEnd = dataStart + length;

        if (dataEnd > buf.length) {
            break;
        }

        if (type === 'gbAs' || type === 'gbaS' || type === 'gbCs' || type === 'mgBa') {
            const compressedData = buf.subarray(dataStart, dataEnd);
            try {
                return zlib.inflateSync(compressedData);
            } catch (err) {
                throw new Error(`[node-mgba] Corrupt zlib stream in PNG savestate chunk '${type}': ${(err as Error).message}`, {
                    cause: err,
                });
            }
        }

        // 12 bytes = 4 (length) + 4 (type) + length (data) + 4 (CRC)
        offset += 12 + length;
    }

    return null;
}
