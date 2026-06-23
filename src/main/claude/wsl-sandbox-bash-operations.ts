import { spawn, type ChildProcess, type SpawnOptions } from 'child_process';
import type { BashOperations } from '@mariozechner/pi-coding-agent';
import {
  resolveSandboxBashCwd,
  rewriteVirtualWorkspacePaths,
  shellEscapePosixPath,
} from '../sandbox/sandbox-workspace-path';

const DEFAULT_TERMINATION_GRACE_MS = 5000;

type SpawnProcess = (command: string, args: string[], options: SpawnOptions) => ChildProcess;

export interface WslSandboxBashOperationsOptions {
  distro: string;
  sandboxPath: string;
  virtualWorkspacePath?: string;
  spawnProcess?: SpawnProcess;
  terminationGraceMs?: number;
}

function validateDistroName(distro: string): void {
  if (!/^[a-zA-Z0-9._-]+$/.test(distro)) {
    throw new Error(`Invalid WSL distro name: ${distro}`);
  }
}

function createSpawnProcess(): SpawnProcess {
  return (command, args, options) => spawn(command, args, options);
}

async function waitForProcessClose(child: ChildProcess, timeoutMs: number): Promise<void> {
  await new Promise<void>((resolve) => {
    let settled = false;

    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutHandle);
      child.off('close', finish);
      child.off('error', finish);
      resolve();
    };

    child.once('close', finish);
    child.once('error', finish);
    const timeoutHandle = setTimeout(() => {
      try {
        child.kill();
      } catch {
        // Ignore cleanup failures.
      }
      finish();
    }, timeoutMs);
    timeoutHandle.unref?.();
  });
}

async function killWslProcessTree(
  pid: number,
  spawnProcess: SpawnProcess,
  taskkillWaitMs: number
): Promise<void> {
  try {
    const taskkill = spawnProcess('taskkill', ['/F', '/T', '/PID', String(pid)], {
      detached: false,
      stdio: 'ignore',
      windowsHide: true,
    });
    await waitForProcessClose(taskkill, taskkillWaitMs);
  } catch {
    try {
      process.kill(pid);
    } catch {
      // Process may already be gone.
    }
  }
}

export function createWslSandboxBashOperations(
  options: WslSandboxBashOperationsOptions
): BashOperations {
  const spawnProcess = options.spawnProcess ?? createSpawnProcess();
  const virtualWorkspacePath = options.virtualWorkspacePath ?? '/workspace';
  const terminationGraceMs = options.terminationGraceMs ?? DEFAULT_TERMINATION_GRACE_MS;
  validateDistroName(options.distro);

  return {
    exec: (command, cwd, { onData, signal, timeout, env }) =>
      new Promise((resolve, reject) => {
        if (signal?.aborted) {
          reject(new Error('aborted'));
          return;
        }

        const wslCwd = resolveSandboxBashCwd(cwd, options.sandboxPath, virtualWorkspacePath);
        const rewrittenCommand = rewriteVirtualWorkspacePaths(
          command,
          options.sandboxPath,
          virtualWorkspacePath
        );
        const escapedCwd = shellEscapePosixPath(wslCwd);
        const bashScript = [
          'source ~/.nvm/nvm.sh 2>/dev/null',
          `cd '${escapedCwd}'`,
          rewrittenCommand,
        ].join('; ');

        const child = spawnProcess('wsl', ['-d', options.distro, '-e', 'bash', '-c', bashScript], {
          detached: false,
          env: env ?? process.env,
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
        });

        let settled = false;
        let timedOut = false;
        let timeoutHandle: NodeJS.Timeout | undefined;
        let forcedSettleHandle: NodeJS.Timeout | undefined;

        const cleanup = () => {
          if (timeoutHandle) clearTimeout(timeoutHandle);
          if (forcedSettleHandle) clearTimeout(forcedSettleHandle);
          child.stdout?.off('data', onData);
          child.stderr?.off('data', onData);
          child.off('close', onClose);
          child.off('error', onError);
          signal?.removeEventListener('abort', onAbort);
        };

        const settleResolve = (value: { exitCode: number | null }) => {
          if (settled) return;
          settled = true;
          cleanup();
          resolve(value);
        };

        const settleReject = (error: Error) => {
          if (settled) return;
          settled = true;
          cleanup();
          reject(error);
        };

        const terminateChild = (reason: 'aborted' | 'timeout') => {
          if (child.pid) {
            void killWslProcessTree(child.pid, spawnProcess, terminationGraceMs);
          } else {
            try {
              child.kill();
            } catch {
              // Ignore cleanup failures.
            }
          }

          forcedSettleHandle = setTimeout(() => {
            settleReject(
              reason === 'timeout' ? new Error(`timeout:${timeout}`) : new Error('aborted')
            );
          }, terminationGraceMs);
          forcedSettleHandle.unref?.();
        };

        function onClose(code: number | null) {
          if (signal?.aborted) {
            settleReject(new Error('aborted'));
            return;
          }
          if (timedOut) {
            settleReject(new Error(`timeout:${timeout}`));
            return;
          }
          settleResolve({ exitCode: code });
        }

        function onError(error: Error) {
          settleReject(error);
        }

        function onAbort() {
          terminateChild('aborted');
        }

        child.stdout?.on('data', onData);
        child.stderr?.on('data', onData);
        child.once('close', onClose);
        child.once('error', onError);

        if (timeout !== undefined && timeout > 0) {
          timeoutHandle = setTimeout(() => {
            timedOut = true;
            terminateChild('timeout');
          }, timeout * 1000);
          timeoutHandle.unref?.();
        }

        signal?.addEventListener('abort', onAbort, { once: true });
      }),
  };
}
