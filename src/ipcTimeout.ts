const DEFAULT_TIMEOUT = 10_000;

export function withTimeout<T>(
    promise: Promise<T>,
    ms = DEFAULT_TIMEOUT,
    label?: string,
): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new Error(label ? `IPC timeout: ${label}` : 'IPC timeout'));
        }, ms);

        promise.then(
            (value) => { clearTimeout(timer); resolve(value); },
            (error) => { clearTimeout(timer); reject(error); },
        );
    });
}
