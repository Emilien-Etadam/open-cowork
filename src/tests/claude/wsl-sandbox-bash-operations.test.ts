import { EventEmitter } from 'events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChildProcess, SpawnOptions } from 'child_process';
import {
  createWslSandboxBashOperations,
  resetWslSandboxBashSessionsForTests,
} from '../../main/claude/wsl-sandbox-bash-operations';

class FakeChildProcess extends EventEmitter {
  stdin = new EventEmitter();
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  kill = vi.fn();

  constructor(readonly pid = 4242) {
    super();
    this.stdin.write = vi.fn((script: string, cb?: (error?: Error | null) => void) => {
      const markerDone = '__OCOWORK_BASH_DONE__';
      const markerExit = '__OCOWORK_BASH_EXIT:';
      if (script.includes('pwd')) {
        this.stdout.emit(
          'data',
          Buffer.from(`/home/ubuntu/.claude/sandbox/session-1\n${markerExit}0\n${markerDone}\n`)
        );
      } else {
        this.stdout.emit('data', Buffer.from(`${markerExit}0\n${markerDone}\n`));
      }
      cb?.(null);
      return true;
    }) as unknown as ChildProcess['stdin']['write'];
  }
}

function createSpawnMock(child: FakeChildProcess) {
  return vi.fn((command: string, args: string[], _options: SpawnOptions) => {
    return Object.assign(child, {
      spawnargs: [command, ...args],
      spawnfile: command,
      killed: false,
      connected: false,
      exitCode: null,
      signalCode: null,
    }) as unknown as ChildProcess;
  });
}

describe('wsl sandbox bash operations', () => {
  const sandboxPath = '/home/ubuntu/.claude/sandbox/session-1';

  afterEach(() => {
    resetWslSandboxBashSessionsForTests();
    vi.restoreAllMocks();
  });

  it('reuses a persistent WSL bash session across commands', async () => {
    const child = new FakeChildProcess();
    const spawnProcess = createSpawnMock(child);
    const ops = createWslSandboxBashOperations({
      distro: 'Ubuntu-24.04',
      sandboxPath,
      spawnProcess,
    });

    const chunks: Buffer[] = [];
    await ops.exec('pwd', '/workspace', {
      onData: (chunk) => chunks.push(chunk as Buffer),
      signal: undefined,
      timeout: 30,
      env: undefined,
    });
    await ops.exec('echo ok', '/workspace', {
      onData: () => undefined,
      signal: undefined,
      timeout: 30,
      env: undefined,
    });

    expect(spawnProcess).toHaveBeenCalledTimes(1);
    const [, args] = spawnProcess.mock.calls[0]!;
    expect(args).toEqual(['-d', 'Ubuntu-24.04', '-e', 'bash', '--noprofile', '--norc']);
    expect(Buffer.concat(chunks).toString()).toContain(sandboxPath);
  });

  it('rejects aborted commands', async () => {
    const child = new FakeChildProcess();
    const controller = new AbortController();
    controller.abort();

    const ops = createWslSandboxBashOperations({
      distro: 'Ubuntu-24.04',
      sandboxPath,
      spawnProcess: createSpawnMock(child),
    });

    await expect(
      ops.exec('pwd', sandboxPath, {
        onData: () => undefined,
        signal: controller.signal,
        timeout: undefined,
        env: undefined,
      })
    ).rejects.toThrow('aborted');
  });
});
