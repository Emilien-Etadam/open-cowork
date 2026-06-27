import { spawn, type ChildProcess, type SpawnOptions } from 'child_process';
import {
  resolveSandboxBashCwd,
  rewriteVirtualWorkspacePaths,
  shellEscapePosixPath,
} from '../sandbox/sandbox-workspace-path';

const MARKER_DONE = '__OCOWORK_BASH_DONE__';
const MARKER_EXIT_PREFIX = '__OCOWORK_BASH_EXIT:';
const DEFAULT_TERMINATION_GRACE_MS = 5000;

type SpawnProcess = (command: string, args: string[], options: SpawnOptions) => ChildProcess;

export interface WslSandboxBashSessionOptions {
  distro: string;
  sandboxPath: string;
  virtualWorkspacePath?: string;
  spawnProcess?: SpawnProcess;
  terminationGraceMs?: number;
}

interface ExecRequest {
  command: string;
  cwd: string;
  onData: (chunk: string | Uint8Array) => void;
  signal?: AbortSignal;
  timeout?: number;
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

class WslSandboxBashSession {
  private child: ChildProcess | null = null;
  private readonly queue: Array<{
    request: ExecRequest;
    resolve: (value: { exitCode: number | null }) => void;
    reject: (error: Error) => void;
  }> = [];
  private active:
    | {
        request: ExecRequest;
        resolve: (value: { exitCode: number | null }) => void;
        reject: (error: Error) => void;
      }
    | undefined;
  private activeTimeout: NodeJS.Timeout | undefined;
  private buffer = '';
  private disposed = false;
  private draining = false;

  constructor(
    private readonly options: Required<
      Pick<WslSandboxBashSessionOptions, 'distro' | 'sandboxPath' | 'virtualWorkspacePath'>
    > & {
      spawnProcess: SpawnProcess;
      terminationGraceMs: number;
    }
  ) {}

  exec(
    command: string,
    cwd: string,
    {
      onData,
      signal,
      timeout,
    }: {
      onData: (chunk: string | Uint8Array) => void;
      signal?: AbortSignal;
      timeout?: number;
      env?: NodeJS.ProcessEnv;
    }
  ): Promise<{ exitCode: number | null }> {
    if (this.disposed) {
      return Promise.reject(new Error('WSL bash session disposed'));
    }
    if (signal?.aborted) {
      return Promise.reject(new Error('aborted'));
    }

    return new Promise((resolve, reject) => {
      const entry = {
        request: { command, cwd, onData, signal, timeout },
        resolve,
        reject,
      };

      signal?.addEventListener(
        'abort',
        () => {
          if (this.active === entry) {
            void this.terminateActive('aborted');
            return;
          }
          const index = this.queue.indexOf(entry);
          if (index >= 0) {
            this.queue.splice(index, 1);
          }
          reject(new Error('aborted'));
        },
        { once: true }
      );

      this.queue.push(entry);
      void this.pumpQueue();
    });
  }

  dispose(): void {
    this.disposed = true;
    this.queue.splice(0).forEach((entry) => entry.reject(new Error('aborted')));
    if (this.active) {
      this.active.reject(new Error('aborted'));
      this.active = undefined;
    }
    void this.stopChild();
  }

  private async pumpQueue(): Promise<void> {
    if (this.draining || this.active || this.queue.length === 0 || this.disposed) {
      return;
    }

    this.draining = true;
    while (this.queue.length > 0 && !this.disposed) {
      const entry = this.queue.shift();
      if (!entry) {
        break;
      }

      this.active = entry;
      try {
        await this.ensureChild();
        await this.runActiveCommand(entry);
      } catch (error) {
        entry.reject(error instanceof Error ? error : new Error(String(error)));
        await this.stopChild();
      } finally {
        if (this.activeTimeout) {
          clearTimeout(this.activeTimeout);
          this.activeTimeout = undefined;
        }
        this.active = undefined;
      }
    }
    this.draining = false;
  }

  private async ensureChild(): Promise<void> {
    if (this.child && !this.child.killed) {
      return;
    }

    const child = this.options.spawnProcess(
      'wsl',
      ['-d', this.options.distro, '-e', 'bash', '--noprofile', '--norc'],
      {
        detached: false,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      }
    );

    if (!child.stdin || !child.stdout || !child.stderr) {
      throw new Error('Failed to start persistent WSL bash session');
    }

    child.stdout.on('data', (chunk) => this.handleOutput(chunk));
    child.stderr.on('data', (chunk) => this.handleOutput(chunk));
    child.once('close', () => {
      this.child = null;
      const error = new Error('WSL bash session closed unexpectedly');
      if (this.active) {
        this.active.reject(error);
        this.active = undefined;
      }
      this.queue.splice(0).forEach((entry) => entry.reject(error));
    });
    child.once('error', (error) => {
      if (this.active) {
        this.active.reject(error);
        this.active = undefined;
      }
    });

    this.child = child;
    child.stdin.write('source ~/.nvm/nvm.sh 2>/dev/null\n');
    child.stdin.write('set +m\n');
  }

  private handleOutput(chunk: Buffer): void {
    const active = this.active;
    if (!active) {
      return;
    }

    active.request.onData(chunk);
    this.buffer += chunk.toString();

    const doneToken = `\n${MARKER_DONE}\n`;
    const doneIndex = this.buffer.indexOf(doneToken);
    if (doneIndex < 0) {
      return;
    }

    const beforeDone = this.buffer.slice(0, doneIndex);
    this.buffer = this.buffer.slice(doneIndex + doneToken.length);

    const exitMatch = beforeDone.match(new RegExp(`${MARKER_EXIT_PREFIX}(\\d+)\\s*$`, 'm'));
    const exitCode = exitMatch ? Number.parseInt(exitMatch[1] ?? '1', 10) : 1;

    if (this.activeTimeout) {
      clearTimeout(this.activeTimeout);
      this.activeTimeout = undefined;
    }

    active.resolve({ exitCode });
  }

  private runActiveCommand(entry: {
    request: ExecRequest;
    resolve: (value: { exitCode: number | null }) => void;
    reject: (error: Error) => void;
  }): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.child?.stdin) {
        reject(new Error('WSL bash session is not ready'));
        return;
      }

      const wrappedResolve = entry.resolve;
      const wrappedReject = entry.reject;
      entry.resolve = (value) => {
        wrappedResolve(value);
        resolve();
      };
      entry.reject = (error) => {
        wrappedReject(error);
        reject(error);
      };

      const wslCwd = resolveSandboxBashCwd(
        entry.request.cwd,
        this.options.sandboxPath,
        this.options.virtualWorkspacePath
      );
      const rewrittenCommand = rewriteVirtualWorkspacePaths(
        entry.request.command,
        this.options.sandboxPath,
        this.options.virtualWorkspacePath
      );
      const escapedCwd = shellEscapePosixPath(wslCwd);
      const script = [
        `{ cd '${escapedCwd}' || { echo '${MARKER_EXIT_PREFIX}1'; echo '${MARKER_DONE}'; exit 0; };`,
        rewrittenCommand,
        `echo "${MARKER_EXIT_PREFIX}$?"`,
        `echo "${MARKER_DONE}"`,
        '}',
      ].join(' ');

      this.child.stdin.write(`${script}\n`, (error) => {
        if (error) {
          reject(error);
        }
      });

      if (entry.request.timeout !== undefined && entry.request.timeout > 0) {
        this.activeTimeout = setTimeout(() => {
          void this.terminateActive('timeout', entry.request.timeout);
        }, entry.request.timeout * 1000);
        this.activeTimeout.unref?.();
      }
    });
  }

  private async terminateActive(
    reason: 'aborted' | 'timeout',
    timeoutSeconds?: number
  ): Promise<void> {
    const active = this.active;
    if (!active) {
      return;
    }

    if (this.activeTimeout) {
      clearTimeout(this.activeTimeout);
      this.activeTimeout = undefined;
    }

    this.active = undefined;
    await this.stopChild();

    active.reject(
      reason === 'timeout'
        ? new Error(`timeout:${timeoutSeconds ?? active.request.timeout}`)
        : new Error('aborted')
    );
    void this.pumpQueue();
  }

  private async stopChild(): Promise<void> {
    const child = this.child;
    this.child = null;
    this.buffer = '';
    if (!child) {
      return;
    }
    if (child.pid) {
      await killWslProcessTree(
        child.pid,
        this.options.spawnProcess,
        this.options.terminationGraceMs
      );
    }
  }
}

const sessionPool = new Map<string, WslSandboxBashSession>();

function getSessionKey(distro: string, sandboxPath: string): string {
  return `${distro}::${sandboxPath}`;
}

export function getWslSandboxBashSession(
  options: WslSandboxBashSessionOptions
): WslSandboxBashSession {
  validateDistroName(options.distro);
  const key = getSessionKey(options.distro, options.sandboxPath);
  const existing = sessionPool.get(key);
  if (existing) {
    return existing;
  }

  const session = new WslSandboxBashSession({
    distro: options.distro,
    sandboxPath: options.sandboxPath,
    virtualWorkspacePath: options.virtualWorkspacePath ?? '/workspace',
    spawnProcess: options.spawnProcess ?? createSpawnProcess(),
    terminationGraceMs: options.terminationGraceMs ?? DEFAULT_TERMINATION_GRACE_MS,
  });
  sessionPool.set(key, session);
  return session;
}

export function disposeWslSandboxBashSession(distro: string, sandboxPath: string): void {
  const key = getSessionKey(distro, sandboxPath);
  const session = sessionPool.get(key);
  if (!session) {
    return;
  }
  session.dispose();
  sessionPool.delete(key);
}

/** @internal Test helper */
export function resetWslSandboxBashSessionsForTests(): void {
  for (const session of sessionPool.values()) {
    session.dispose();
  }
  sessionPool.clear();
}
