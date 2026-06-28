import { describe, expect, it, vi } from 'vitest';

import { withAsyncTimeout, withAsyncTimeoutOrNull } from '../src/main/utils/async-timeout';

describe('withAsyncTimeout', () => {
  it('resolves when the operation completes in time', async () => {
    await expect(withAsyncTimeout('fast-op', 100, async () => 'ok')).resolves.toBe('ok');
  });

  it('rejects when the operation exceeds the timeout', async () => {
    vi.useFakeTimers();
    const pending = withAsyncTimeout('slow-op', 50, () => new Promise<string>(() => {}));
    const assertion = expect(pending).rejects.toThrow('slow-op timed out after 50ms');
    await vi.advanceTimersByTimeAsync(50);
    await assertion;
    vi.useRealTimers();
  });
});

describe('withAsyncTimeoutOrNull', () => {
  it('returns null instead of throwing on timeout', async () => {
    vi.useFakeTimers();
    const pending = withAsyncTimeoutOrNull('slow-op', 25, () => new Promise<string>(() => {}));
    await vi.advanceTimersByTimeAsync(25);
    await expect(pending).resolves.toBeNull();
    vi.useRealTimers();
  });
});
