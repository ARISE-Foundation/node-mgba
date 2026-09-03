import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export interface TempDirHandle {
    readonly path: string;
    readonly cleanup: () => void;
}

/**
 * Creates a temporary directory with multi-tier candidate resolution (os.tmpdir() -> /tmp -> process.cwd())
 * and returns a handle containing the path and a safe cleanup callback.
 * Returns null if no writable directory is available in the current execution environment (e.g. read-only sandboxes).
 */
export function createSafeTempDir(prefix: string = 'mgba-test-'): TempDirHandle | null {
    const candidateDirs = [os.tmpdir(), '/tmp', process.cwd()];
    for (const dir of candidateDirs) {
        try {
            const tempPath = fs.mkdtempSync(path.join(dir, prefix));
            return {
                path: tempPath,
                cleanup: () => {
                    try {
                        fs.rmSync(tempPath, { recursive: true, force: true });
                    } catch {
                        // Ignore cleanup error in sandbox environments
                    }
                },
            };
        } catch {
            // Try next candidate directory
        }
    }
    return null;
}
