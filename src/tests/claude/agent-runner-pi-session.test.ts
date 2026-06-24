import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ToolDefinition } from '@mariozechner/pi-coding-agent';

const decidePermission = vi.fn();
const rememberAlwaysAllow = vi.fn();

vi.mock('../../main/config/permission-rules-store', () => ({
  decidePermission: (...args: unknown[]) => decidePermission(...args),
  rememberAlwaysAllow: (...args: unknown[]) => rememberAlwaysAllow(...args),
}));

const spawnMock = vi.fn();
vi.mock('child_process', () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

import {
  MAX_CACHED_PI_SESSIONS,
  disposeCachedPiSession,
  evictOldestPiSession,
  installPermissionHook,
  resolveToolDisplayName,
  wrapBashToolForSudo,
  wrapBashToolWithDefaultTimeout,
  type CachedPiSession,
} from '../../main/claude/agent-runner-pi-session';

function makeBashTool(execute = vi.fn(async () => ({ content: [{ type: 'text', text: 'ok' }] }))) {
  return {
    name: 'bash',
    description: 'bash',
    parameters: {},
    execute,
  } as unknown as ToolDefinition;
}

function makeCachedSession(id: string): CachedPiSession {
  return {
    session: { dispose: vi.fn() } as unknown as CachedPiSession['session'],
    modelId: `model-${id}`,
    thinkingLevel: 'off',
    runtimeSignature: `sig-${id}`,
    compactionEnabled: false,
  };
}

describe('resolveToolDisplayName', () => {
  it('returns canonical names for built-in tools and caches them', () => {
    const cache = new Map<string, string>();
    expect(resolveToolDisplayName('bash', undefined, cache)).toBe('bash');
    expect(cache.get('bash')).toBe('bash');
    expect(resolveToolDisplayName('bash', undefined, cache)).toBe('bash');
  });

  it('prefers MCP originalName when available', () => {
    const cache = new Map<string, string>();
    const mcpManager = {
      getTool: vi.fn(() => ({ originalName: 'chrome_screenshot' })),
    };
    const toolName = 'mcp__Chrome__chrome_screenshot__ab12';
    expect(resolveToolDisplayName(toolName, mcpManager as never, cache)).toBe('chrome_screenshot');
  });

  it('falls back to the third MCP segment when originalName is missing', () => {
    const cache = new Map<string, string>();
    expect(resolveToolDisplayName('mcp__server__my_tool__suffix', undefined, cache)).toBe(
      'my_tool__suffix'
    );
  });
});

describe('disposeCachedPiSession', () => {
  it('disposes the underlying pi session', () => {
    const dispose = vi.fn();
    disposeCachedPiSession({
      ...makeCachedSession('a'),
      session: { dispose } as unknown as CachedPiSession['session'],
    });
    expect(dispose).toHaveBeenCalledOnce();
  });

  it('swallows dispose errors', () => {
    const dispose = vi.fn(() => {
      throw new Error('already disposed');
    });
    expect(() =>
      disposeCachedPiSession({
        ...makeCachedSession('a'),
        session: { dispose } as unknown as CachedPiSession['session'],
      })
    ).not.toThrow();
  });
});

describe('evictOldestPiSession', () => {
  it('does nothing while the cache is below the limit', () => {
    const sessions = new Map<string, CachedPiSession>([['a', makeCachedSession('a')]]);
    evictOldestPiSession(sessions);
    expect(sessions.size).toBe(1);
  });

  it('evicts the oldest entry when the cache is full', () => {
    const sessions = new Map<string, CachedPiSession>();
    for (let i = 0; i < MAX_CACHED_PI_SESSIONS; i++) {
      sessions.set(`session-${i}`, makeCachedSession(String(i)));
    }
    const oldestDispose = vi.spyOn(sessions.get('session-0')!.session, 'dispose');
    evictOldestPiSession(sessions);
    expect(oldestDispose).toHaveBeenCalledOnce();
    expect(sessions.has('session-0')).toBe(false);
    expect(sessions.size).toBe(MAX_CACHED_PI_SESSIONS - 1);
  });
});

describe('installPermissionHook', () => {
  beforeEach(() => {
    decidePermission.mockReset();
    rememberAlwaysAllow.mockReset();
  });

  it('skips installation when requestPermission is missing', () => {
    const setBeforeToolCall = vi.fn();
    installPermissionHook(
      { agent: { setBeforeToolCall } } as never,
      'session-1',
      undefined,
      (name) => name
    );
    expect(setBeforeToolCall).not.toHaveBeenCalled();
  });

  it('blocks tools denied by rules', async () => {
    decidePermission.mockReturnValue('deny');
    let hook: (ctx: unknown) => Promise<unknown> = async () => undefined;
    const setBeforeToolCall = vi.fn((fn: typeof hook) => {
      hook = fn;
    });
    installPermissionHook(
      { agent: { setBeforeToolCall, _beforeToolCall: vi.fn() } } as never,
      'session-1',
      vi.fn(),
      () => 'Pretty Bash'
    );

    const result = await hook({
      toolCall: { name: 'bash', id: 'tool-1' },
      args: { command: 'ls' },
    });

    expect(result).toEqual({
      block: true,
      reason: "Tool 'Pretty Bash' is denied by your permission rules.",
    });
  });

  it('fails closed when the permission dialog throws', async () => {
    decidePermission.mockReturnValue('ask');
    let hook: (ctx: unknown) => Promise<unknown> = async () => undefined;
    const setBeforeToolCall = vi.fn((fn: typeof hook) => {
      hook = fn;
    });
    installPermissionHook(
      { agent: { setBeforeToolCall } } as never,
      'session-1',
      vi.fn(async () => {
        throw new Error('ipc failed');
      }),
      () => 'bash'
    );

    const result = await hook({
      toolCall: { name: 'bash', id: 'tool-1' },
      args: { command: 'ls' },
    });

    expect(result).toEqual({
      block: true,
      reason: "Permission request failed for 'bash'; tool not executed.",
    });
  });

  it('remembers allow_always decisions and chains to the SDK hook', async () => {
    decidePermission.mockReturnValue('ask');
    const sdkBeforeToolCall = vi.fn(async () => ({ chained: true }));
    let hook: (ctx: unknown, signal?: AbortSignal) => Promise<unknown> = async () => undefined;
    const setBeforeToolCall = vi.fn((fn: typeof hook) => {
      hook = fn;
    });
    installPermissionHook(
      { agent: { setBeforeToolCall, _beforeToolCall: sdkBeforeToolCall } } as never,
      'session-1',
      vi.fn(async (): Promise<'allow_always'> => 'allow_always'),
      () => 'bash'
    );

    const ctx = { toolCall: { name: 'bash', id: 'tool-1' }, args: { command: 'ls' } };
    const signal = new AbortController().signal;
    const result = await hook(ctx, signal);

    expect(rememberAlwaysAllow).toHaveBeenCalledWith('session-1', 'bash');
    expect(sdkBeforeToolCall).toHaveBeenCalledWith(ctx, signal);
    expect(result).toEqual({ chained: true });
  });
});

describe('wrapBashToolWithDefaultTimeout', () => {
  it('injects a 120s timeout when the model omits one', async () => {
    const execute = vi.fn(async () => ({ content: [{ type: 'text', text: 'done' }] }));
    const [wrapped] = wrapBashToolWithDefaultTimeout([makeBashTool(execute)]);

    await wrapped.execute('id-1', { command: 'sleep 1' }, undefined, undefined, {} as never);

    expect(execute).toHaveBeenCalledWith(
      'id-1',
      { command: 'sleep 1', timeout: 120 },
      undefined,
      undefined,
      {} as never
    );
  });

  it('preserves an explicit timeout', async () => {
    const execute = vi.fn(async () => ({ content: [{ type: 'text', text: 'done' }] }));
    const [wrapped] = wrapBashToolWithDefaultTimeout([makeBashTool(execute)]);

    await wrapped.execute(
      'id-1',
      { command: 'sleep 1', timeout: 30 },
      undefined,
      undefined,
      {} as never
    );

    expect(execute).toHaveBeenCalledWith(
      'id-1',
      { command: 'sleep 1', timeout: 30 },
      undefined,
      undefined,
      {} as never
    );
  });
});

describe('wrapBashToolForSudo', () => {
  beforeEach(() => {
    spawnMock.mockReset();
  });

  it('returns tools unchanged when no sudo password callback is provided', () => {
    const tools = [makeBashTool()];
    expect(wrapBashToolForSudo(tools, 'session-1', '/workspace', undefined)).toBe(tools);
  });

  it('delegates non-sudo commands to the original bash execute', async () => {
    const execute = vi.fn(async () => ({ content: [{ type: 'text', text: 'plain' }] }));
    const [wrapped] = wrapBashToolForSudo(
      [makeBashTool(execute)],
      'session-1',
      '/workspace',
      vi.fn()
    );

    const result = await wrapped.execute(
      'tool-1',
      { command: 'echo hi' },
      undefined,
      undefined,
      {} as never
    );

    expect(execute).toHaveBeenCalledOnce();
    expect(spawnMock).not.toHaveBeenCalled();
    expect(result).toEqual({ content: [{ type: 'text', text: 'plain' }] });
  });

  it('returns a cancellation message when the user denies the sudo password', async () => {
    const execute = vi.fn();
    const [wrapped] = wrapBashToolForSudo(
      [makeBashTool(execute)],
      'session-1',
      '/workspace',
      vi.fn(async () => null)
    );

    const result = await wrapped.execute(
      'tool-1',
      { command: 'sudo apt update' },
      undefined,
      undefined,
      {} as never
    );

    expect(result).toEqual({
      content: [{ type: 'text', text: 'Command cancelled: user denied sudo password.' }],
      details: undefined,
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it('pipes the sudo password via stdin and rewrites sudo to sudo -S', async () => {
    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
      stdin: { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
      kill: ReturnType<typeof vi.fn>;
    };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdin = { write: vi.fn(), end: vi.fn() };
    child.kill = vi.fn();
    spawnMock.mockReturnValue(child);

    const execute = vi.fn();
    const [wrapped] = wrapBashToolForSudo(
      [makeBashTool(execute)],
      'session-1',
      '/workspace',
      vi.fn(async () => 'secret')
    );

    const resultPromise = wrapped.execute(
      'tool-1',
      { command: 'sudo echo hi' },
      undefined,
      undefined,
      {} as never
    );

    await Promise.resolve();

    const shell = process.platform === 'win32' ? 'cmd.exe' : '/bin/sh';
    expect(spawnMock).toHaveBeenCalledWith(
      shell,
      process.platform === 'win32' ? ['/c', 'sudo -S echo hi'] : ['-c', 'sudo -S echo hi'],
      expect.objectContaining({ cwd: '/workspace', stdio: ['pipe', 'pipe', 'pipe'] })
    );

    child.stdout.emit('data', Buffer.from('hi\n'));
    child.emit('close', 0);

    await expect(resultPromise).resolves.toEqual({
      content: [{ type: 'text', text: 'hi\n' }],
      details: undefined,
    });
    expect(child.stdin.write).toHaveBeenCalledWith('secret\n');
    expect(child.stdin.end).toHaveBeenCalledOnce();
  });
});
