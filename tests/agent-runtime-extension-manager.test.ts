import { describe, expect, it, vi } from 'vitest';

import { AgentRuntimeExtensionManager } from '../src/main/extensions/agent-runtime-extension-manager';

describe('AgentRuntimeExtensionManager.beforeSessionRun', () => {
  it('continues without contribution when an extension times out', async () => {
    vi.useFakeTimers();

    const manager = new AgentRuntimeExtensionManager([
      {
        name: 'slow-memory',
        async beforeSessionRun() {
          await new Promise<void>(() => {});
          return { promptPrefix: 'should-not-appear' };
        },
      },
      {
        name: 'fast-tools',
        async beforeSessionRun() {
          return { promptPrefix: 'ready', customTools: [{ name: 'demo', execute: vi.fn() }] };
        },
      },
    ]);

    const resultPromise = manager.beforeSessionRun({
      session: { id: 's1' } as never,
      prompt: 'hello',
      existingMessages: [],
      isColdStart: true,
    });

    await vi.advanceTimersByTimeAsync(45_000);
    await vi.runAllTimersAsync();

    await expect(resultPromise).resolves.toEqual({
      promptPrefix: 'ready',
      customTools: [{ name: 'demo', execute: expect.any(Function) }],
    });

    vi.useRealTimers();
  });
});
