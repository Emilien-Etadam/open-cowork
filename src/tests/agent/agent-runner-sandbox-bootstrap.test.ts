import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SandboxBootstrapDeps } from '../../main/agent/agent-runner-sandbox-bootstrap';

const getSandboxExecutionBlockReason = vi.fn();
const sandboxSyncInit = vi.fn();
const sandboxHasSession = vi.fn();
const limaSyncInit = vi.fn();
const limaHasSession = vi.fn();
const execFileSync = vi.fn();

vi.mock('../../main/sandbox/sandbox-execution-guard', () => ({
  getSandboxExecutionBlockReason: (...args: unknown[]) => getSandboxExecutionBlockReason(...args),
}));

vi.mock('../../main/sandbox/sandbox-sync', () => ({
  SandboxSync: {
    hasSession: (...args: unknown[]) => sandboxHasSession(...args),
    initSync: (...args: unknown[]) => sandboxSyncInit(...args),
  },
}));

vi.mock('../../main/sandbox/lima-sync', () => ({
  LimaSync: {
    hasSession: (...args: unknown[]) => limaHasSession(...args),
    initSync: (...args: unknown[]) => limaSyncInit(...args),
  },
}));

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return {
    ...actual,
    execFileSync: (...args: unknown[]) => execFileSync(...args),
  };
});

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    existsSync: vi.fn(() => false),
    mkdirSync: vi.fn(),
  };
});

import { bootstrapSandboxEnvironment } from '../../main/agent/agent-runner-sandbox-bootstrap';

function makeDeps(overrides: Partial<SandboxBootstrapDeps> = {}): SandboxBootstrapDeps {
  const events: unknown[] = [];
  return {
    sessionId: 'session-1',
    workingDir: '/workspace/project',
    thinkingStepId: 'trace-1',
    sandboxEnabled: true,
    sandbox: {
      isWSL: false,
      isLima: false,
      wslStatus: undefined,
      limaStatus: undefined,
    } as SandboxBootstrapDeps['sandbox'],
    sendToRenderer: vi.fn((event) => events.push(event)),
    sendMessage: vi.fn(),
    sendTraceUpdate: vi.fn(),
    getBuiltinSkillsPath: vi.fn(() => ''),
    getRuntimeSkillsDir: vi.fn(() => '/tmp/skills'),
    syncUserSkillsToAppDir: vi.fn(),
    syncConfiguredSkillsToRuntimeDir: vi.fn(),
    ...overrides,
  };
}

describe('bootstrapSandboxEnvironment', () => {
  beforeEach(() => {
    getSandboxExecutionBlockReason.mockReset();
    sandboxSyncInit.mockReset();
    sandboxHasSession.mockReset();
    limaSyncInit.mockReset();
    limaHasSession.mockReset();
    execFileSync.mockReset();
    getSandboxExecutionBlockReason.mockReturnValue(null);
    sandboxHasSession.mockReturnValue(false);
    limaHasSession.mockReturnValue(false);
  });

  it('aborts early when sandbox execution is blocked before sync', async () => {
    getSandboxExecutionBlockReason.mockReturnValueOnce('WSL2 requis');
    const deps = makeDeps({
      sandbox: {
        isWSL: true,
        isBlocked: true,
        wslStatus: { distro: 'Ubuntu' },
      } as SandboxBootstrapDeps['sandbox'],
    });

    const result = await bootstrapSandboxEnvironment(deps);

    expect(result).toEqual({
      sandboxPath: null,
      useSandboxIsolation: false,
      aborted: true,
    });
    expect(deps.sendMessage).toHaveBeenCalledOnce();
    expect(deps.sendTraceUpdate).toHaveBeenCalledWith('session-1', 'trace-1', {
      status: 'error',
      title: 'Sandbox unavailable',
    });
    expect(sandboxSyncInit).not.toHaveBeenCalled();
  });

  it('initializes WSL sandbox isolation on successful sync', async () => {
    sandboxSyncInit.mockResolvedValue({
      success: true,
      sandboxPath: '/home/user/.lygodactylus/sandbox/session-1',
      fileCount: 12,
      totalSize: 4096,
    });
    execFileSync.mockReturnValue('skill-a\nskill-b');

    const deps = makeDeps({
      sandbox: {
        isWSL: true,
        wslStatus: { distro: 'Ubuntu' },
      } as SandboxBootstrapDeps['sandbox'],
    });

    const result = await bootstrapSandboxEnvironment(deps);

    expect(result).toEqual({
      sandboxPath: '/home/user/.lygodactylus/sandbox/session-1',
      useSandboxIsolation: true,
      aborted: false,
    });
    expect(sandboxSyncInit).toHaveBeenCalledWith('/workspace/project', 'session-1', 'Ubuntu');
    expect(deps.sendToRenderer).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'sandbox.sync',
        payload: expect.objectContaining({ phase: 'ready' }),
      })
    );
  });

  it('aborts when WSL sync fails and the guard returns a block reason', async () => {
    sandboxSyncInit.mockResolvedValue({
      success: false,
      error: 'rsync failed',
    });
    getSandboxExecutionBlockReason.mockImplementation((input) =>
      input.syncFailed ? 'Sync impossible' : null
    );

    const deps = makeDeps({
      sandbox: {
        isWSL: true,
        wslStatus: { distro: 'Ubuntu' },
      } as SandboxBootstrapDeps['sandbox'],
    });

    const result = await bootstrapSandboxEnvironment(deps);

    expect(result.aborted).toBe(true);
    expect(deps.sendTraceUpdate).toHaveBeenCalledWith('session-1', 'trace-1', {
      status: 'error',
      title: 'Sandbox sync failed',
    });
  });

  it('skips WSL bootstrap when distro or working directory is missing', async () => {
    const deps = makeDeps({
      workingDir: undefined,
      sandbox: {
        isWSL: true,
        wslStatus: { distro: 'Ubuntu' },
      } as SandboxBootstrapDeps['sandbox'],
    });

    const result = await bootstrapSandboxEnvironment(deps);

    expect(result).toEqual({
      sandboxPath: null,
      useSandboxIsolation: false,
      aborted: false,
    });
    expect(sandboxSyncInit).not.toHaveBeenCalled();
  });

  it('initializes Lima sandbox isolation on successful sync', async () => {
    limaSyncInit.mockResolvedValue({
      success: true,
      sandboxPath: '/Users/me/.lima/sandboxes/session-1',
      fileCount: 8,
      totalSize: 2048,
    });
    execFileSync.mockReturnValue('pdf\npptx');

    const deps = makeDeps({
      sandbox: {
        isLima: true,
        limaStatus: { instanceRunning: true },
      } as SandboxBootstrapDeps['sandbox'],
    });

    const result = await bootstrapSandboxEnvironment(deps);

    expect(result).toEqual({
      sandboxPath: '/Users/me/.lima/sandboxes/session-1',
      useSandboxIsolation: true,
      aborted: false,
    });
    expect(limaSyncInit).toHaveBeenCalledWith('/workspace/project', 'session-1');
  });

  it('does not attempt Lima bootstrap after WSL bootstrap aborted', async () => {
    sandboxSyncInit.mockResolvedValue({ success: false, error: 'boom' });
    getSandboxExecutionBlockReason.mockImplementation((input) =>
      input.syncFailed ? 'blocked' : null
    );

    const deps = makeDeps({
      sandbox: {
        isWSL: true,
        isLima: true,
        wslStatus: { distro: 'Ubuntu' },
        limaStatus: { instanceRunning: true },
      } as SandboxBootstrapDeps['sandbox'],
    });

    const result = await bootstrapSandboxEnvironment(deps);

    expect(result.aborted).toBe(true);
    expect(limaSyncInit).not.toHaveBeenCalled();
  });
});
