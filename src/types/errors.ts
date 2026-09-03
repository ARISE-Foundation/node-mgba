export class FatalWorkerError extends Error {
    constructor(msg = 'Worker encountered fatal error', opts?: ErrorOptions) {
        super(msg, opts);
        this.name = 'FatalWorkerError';
    }
}

export class LifecycleError extends Error {
    constructor(msg = 'Backend lifecycle invalid', opts?: ErrorOptions) {
        super(msg, opts);
        this.name = 'LifecycleError';
    }
}

export class AbortError extends Error {
    constructor(msg = 'Operation aborted', opts?: ErrorOptions) {
        super(msg, opts);
        this.name = 'AbortError';
    }
}

export class TimeoutError extends Error {
    constructor(msg = 'Operation timed out', opts?: ErrorOptions) {
        super(msg, opts);
        this.name = 'TimeoutError';
    }
}

export function createAbortError(signal?: AbortSignal, defaultMessage = 'Operation aborted'): Error {
    if (!signal?.aborted) {
        return new AbortError(defaultMessage);
    }
    const reason = signal.reason;
    if (reason instanceof Error) {
        return reason;
    }
    if (typeof reason === 'string' && reason.length > 0) {
        return new AbortError(reason);
    }
    if (reason && typeof (reason as { message?: unknown }).message === 'string') {
        return new AbortError(String((reason as { message: string }).message));
    }
    return new AbortError(defaultMessage);
}

export function throwIfAborted(signal?: AbortSignal, defaultMessage = 'Operation aborted'): void {
    if (signal?.aborted) {
        throw createAbortError(signal, defaultMessage);
    }
}
