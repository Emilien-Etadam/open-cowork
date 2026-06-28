export async function withAsyncTimeout<T>(
  label: string,
  timeoutMs: number,
  operation: () => Promise<T>
): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation(),
      new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(new Error(`${label} timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

export async function withAsyncTimeoutOrNull<T>(
  label: string,
  timeoutMs: number,
  operation: () => Promise<T>
): Promise<T | null> {
  try {
    return await withAsyncTimeout(label, timeoutMs, operation);
  } catch {
    return null;
  }
}
