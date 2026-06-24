import { describe, expect, it } from 'vitest';
import { getSandboxExecutionBlockReason } from '../../main/sandbox/sandbox-execution-guard';

function createSandboxStub(
  overrides: Partial<{
    isBlocked: boolean;
    blockingReason: string | null;
    isWSL: boolean;
    isLima: boolean;
    mode: 'wsl' | 'lima' | 'native' | 'none' | 'blocked';
  }> = {}
) {
  return {
    isBlocked: false,
    blockingReason: null,
    isWSL: true,
    isLima: false,
    mode: 'wsl' as const,
    ...overrides,
  };
}

describe('getSandboxExecutionBlockReason', () => {
  it('allows execution when sandbox is disabled', () => {
    expect(
      getSandboxExecutionBlockReason({
        sandboxEnabled: false,
        platform: 'win32',
        sandbox: createSandboxStub({ isWSL: false, mode: 'native' }) as never,
      })
    ).toBeNull();
  });

  it('blocks Windows agent runs when WSL sandbox is unavailable', () => {
    expect(
      getSandboxExecutionBlockReason({
        sandboxEnabled: true,
        platform: 'win32',
        sandbox: createSandboxStub({
          isBlocked: true,
          blockingReason: 'WSL2 not installed',
          isWSL: false,
          mode: 'blocked',
        }) as never,
      })
    ).toBe('WSL2 not installed');
  });

  it('blocks when sandbox sync fails', () => {
    expect(
      getSandboxExecutionBlockReason({
        sandboxEnabled: true,
        platform: 'win32',
        sandbox: createSandboxStub() as never,
        syncFailed: true,
        syncError: 'rsync failed',
      })
    ).toBe('rsync failed');
  });
});
