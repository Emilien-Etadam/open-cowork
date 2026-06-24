import { EventEmitter } from 'events';
import { describe, expect, it, vi } from 'vitest';
import type { ChildProcess, SpawnOptions } from 'child_process';
import { createWslSandboxBashOperations } from '../../main/claude/wsl-sandbox-bash-operations';

class FakeChildProcess extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  kill = vi.fn();

  constructor(readonly pid = 4242) {
    super();
  }
}

function createSpawnMock(children: FakeChildProcess[]) {
  return vi.fn((command: string, args: string[], _options: SpawnOptions) => {
    const child = children.shift();
    if (!child) {
      throw new Error(`Unexpected spawn: ${command} ${args.join(' ')}`);
    }
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

  it('runs commands inside WSL with sandbox cwd and virtual path rewrite', async () => {
    const child = new FakeChildProcess();
    const spawnProcess = createSpawnMock([child]);
    const ops = createWslSandboxBashOperations({
      distro: 'Ubuntu-24.04',
      sandboxPath,
      spawnProcess,
    });

    const chunks: Buffer[] = [];
    const promise = ops.exec('pwd && ls /workspace', '/workspace', {
      onData: (chunk) => chunks.push(chunk as Buffer),
      signal: undefined,
      timeout: 30,
      env: undefined,
    });

    child.stdout.emit('data', Buffer.from('/home/ubuntu/.claude/sandbox/session-1\n'));
    child.emit('close', 0);

    await expect(promise).resolves.toEqual({ exitCode: 0 });
    expect(spawnProcess).toHaveBeenCalledTimes(1);
    const [, args] = spawnProcess.mock.calls[0]!;
    expect(args).toEqual([
      '-d',
      'Ubuntu-24.04',
      '-e',
      'bash',
      '-c',
      expect.stringContaining(`cd '${sandboxPath}'`),
    ]);
    expect(args[5]).toContain(`ls ${sandboxPath}`);
    expect(Buffer.concat(chunks).toString()).toContain(sandboxPath);
  });

  it('rejects aborted commands', async () => {
    const child = new FakeChildProcess();
    const controller = new AbortController();
    controller.abort();

    const ops = createWslSandboxBashOperations({
      distro: 'Ubuntu-24.04',
      sandboxPath,
      spawnProcess: createSpawnMock([child]),
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
