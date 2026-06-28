import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { app } from 'electron';
import { getDefaultShell } from '../utils/shell-resolver';
import { log, logWarn } from '../utils/logger';
import { getBundledNodePaths, ensureNodeRuntime } from '../runtime/node-runtime';
import { ensurePythonRuntime, getBundledPythonPaths } from '../runtime/python-runtime';
import { ensureCliclickRuntime, getBundledCliclickPath } from '../runtime/gui-tools-runtime';

export { getBundledNodePaths, ensureNodeRuntime } from '../runtime/node-runtime';
export { ensurePythonRuntime, getBundledPythonPaths } from '../runtime/python-runtime';
export { ensureCliclickRuntime, getBundledCliclickPath } from '../runtime/gui-tools-runtime';

/**
 * Resolve bundled Python bin directory path (if available).
 */
export function resolveBundledPythonBinDir(): string | null {
  const paths = getBundledPythonPaths();
  return paths ? path.dirname(paths.python) : null;
}

/**
 * Resolve bundled tools directory (cliclick etc., macOS only).
 */
export function resolveBundledToolsBinDir(): string | null {
  if (process.platform !== 'darwin') return null;
  const cliclickPath = getBundledCliclickPath();
  return cliclickPath ? path.dirname(cliclickPath) : null;
}

/**
 * One-time enrichment of process.env.PATH for build (production) mode.
 *
 * In dev mode, Electron inherits the user's full shell PATH, so Skill commands
 * like `python3` and `node` just work. In build mode, `process.env.PATH` is
 * minimal (often just `/usr/bin:/bin`).
 *
 * This function:
 * 1. Restores the user's login-shell PATH (safe: uses execFileSync, not execSync)
 * 2. Prepends bundled Node, Python, and tools bin dirs (highest priority)
 * 3. Deduplicates all entries
 * 4. Writes the result back to `process.env.PATH`
 *
 * Called once before the first agent session creation — subsequent calls are no-ops.
 */
let pathEnriched = false;

export async function enrichProcessPathForBuild(): Promise<void> {
  if (pathEnriched) return;
  pathEnriched = true;

  if (!app.isPackaged) {
    log('[AgentRunner] Dev mode — skipping PATH enrichment');
    return;
  }

  const platform = process.platform;

  await ensureNodeRuntime();
  if (platform === 'darwin' || platform === 'linux') {
    try {
      await ensurePythonRuntime();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logWarn(`[AgentRunner] Python runtime not ready yet: ${message}`);
    }
  }
  if (platform === 'darwin') {
    await ensureCliclickRuntime();
  }

  const delimiter = platform === 'win32' ? ';' : ':';
  const currentPaths = (process.env.PATH || '').split(delimiter).filter((p: string) => p.trim());

  // 1. Restore user's login-shell PATH
  let shellPaths: string[] = [];
  if (platform === 'darwin' || platform === 'linux') {
    try {
      const shell = getDefaultShell();
      const output = (
        execFileSync(shell, ['-l', '-c', 'echo $PATH'], {
          encoding: 'utf-8',
          timeout: 5000,
          env: { ...process.env, HOME: os.homedir() },
        }) as string
      ).trim();
      if (output) {
        shellPaths = output.split(':').filter((p: string) => p.trim());
        log(`[AgentRunner] Restored ${shellPaths.length} paths from login shell`);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logWarn(`[AgentRunner] Could not restore shell PATH: ${message}`);
    }
  } else if (platform === 'win32') {
    try {
      const output = (
        execFileSync(
          'powershell.exe',
          [
            '-NoProfile',
            '-Command',
            "[Environment]::GetEnvironmentVariable('Path', 'User') + ';' + [Environment]::GetEnvironmentVariable('Path', 'Machine')",
          ],
          { encoding: 'utf-8', timeout: 5000 }
        ) as string
      ).trim();
      if (output) {
        shellPaths = output.split(';').filter((p: string) => p.trim());
        log(`[AgentRunner] Restored ${shellPaths.length} paths from Windows registry`);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logWarn(`[AgentRunner] Could not restore Windows PATH: ${message}`);
    }
  }

  // 2. Collect bundled bin directories (highest priority)
  const bundledDirs: string[] = [];

  const nodePaths = getBundledNodePaths();
  if (nodePaths) {
    bundledDirs.push(path.dirname(nodePaths.node));
  }

  const pythonBinDir = resolveBundledPythonBinDir();
  if (pythonBinDir) {
    bundledDirs.push(pythonBinDir);
  }

  const toolsBinDir = resolveBundledToolsBinDir();
  if (toolsBinDir) {
    bundledDirs.push(toolsBinDir);
  }

  // 3. Merge: bundled (highest) → shell → current process, deduplicate
  const seen = new Set<string>();
  const merged: string[] = [];

  for (const p of [...bundledDirs, ...shellPaths, ...currentPaths]) {
    const normalized = platform === 'win32' ? p.toLowerCase() : p;
    if (!seen.has(normalized)) {
      seen.add(normalized);
      merged.push(p);
    }
  }

  process.env.PATH = merged.join(delimiter);
  log(
    `[AgentRunner] Enriched process.env.PATH for build mode: ${bundledDirs.length} bundled + ${shellPaths.length} shell + ${currentPaths.length} process → ${merged.length} total`
  );
}
