import { app } from 'electron';

import { getDefaultShell } from '../utils/shell-resolver.js';
import { log, logError, logWarn } from '../utils/logger.js';
import {
  findPreferredWindowsNpxPath,
  getTrustedWindowsNpxDirectories,
  mergeShellEnvForMcp,
  normalizeWindowsPathForComparison,
} from './mcp-env.js';

export interface MCPManagerEnvContext {
  getBundledNodePath(): { node: string; npx: string } | null;
  getCachedBaseEnv(): Record<string, string> | null;
  setCachedBaseEnv(env: Record<string, string>): void;
  getNpxPath(): string | null;
  setNpxPath(npxPath: string | null): void;
}

import { ensureNodeRuntime } from '../runtime/node-runtime.js';

export async function checkNpxInPath(ctx: MCPManagerEnvContext): Promise<void> {
  await ensureNodeRuntime();
  const bundledNode = ctx.getBundledNodePath();
  if (!bundledNode) {
    const errorMessage =
      'Node.js runtime is not available yet. The app will download it on first MCP use.\n' +
      'Node.js 运行时暂不可用，首次使用 MCP 时将自动下载。\n\n' +
      'Connect to the internet and retry opening MCP servers.\n' +
      '请连接网络后重试启动 MCP 服务器。';

    logError('[MCPManager] Bundled Node.js not found');
    throw new Error(errorMessage);
  }

  ctx.setNpxPath(bundledNode.npx);
  log(`[MCPManager] Using bundled npx: ${bundledNode.npx}`);
}

export async function resolvePreferredNpxPath(
  ctx: MCPManagerEnvContext,
  pathEnv: string | undefined
): Promise<string> {
  const bundledNpxPath = ctx.getBundledNodePath()?.npx ?? null;

  if (process.platform === 'win32') {
    const preferredNpxPath = findPreferredWindowsNpxPath(
      pathEnv,
      bundledNpxPath,
      undefined,
      getTrustedWindowsNpxDirectories(process.env)
    );
    if (!preferredNpxPath) {
      throw new Error(
        'npx is not available. Install Node.js so Lygodactylus can use your system npx.cmd, or reinstall the app to restore the bundled runtime.'
      );
    }

    ctx.setNpxPath(preferredNpxPath);
    if (
      bundledNpxPath &&
      normalizeWindowsPathForComparison(preferredNpxPath) !==
        normalizeWindowsPathForComparison(bundledNpxPath)
    ) {
      log(`[MCPManager] Using system npx on Windows: ${preferredNpxPath}`);
    } else {
      log(`[MCPManager] Using bundled npx: ${preferredNpxPath}`);
    }

    return preferredNpxPath;
  }

  await checkNpxInPath(ctx);
  const npxPath = ctx.getNpxPath();
  if (!npxPath) {
    throw new Error('Bundled npx is unavailable.');
  }
  return npxPath;
}

export async function getEnhancedEnv(
  ctx: MCPManagerEnvContext,
  configEnv: Record<string, string>
): Promise<Record<string, string>> {
  let cachedBaseEnv = ctx.getCachedBaseEnv();
  if (!cachedBaseEnv) {
    cachedBaseEnv = await resolveBaseEnv(ctx);
    ctx.setCachedBaseEnv(cachedBaseEnv);
  }

  return { ...cachedBaseEnv, ...configEnv };
}

export async function resolveBaseEnv(
  ctx: Pick<MCPManagerEnvContext, 'getBundledNodePath'>
): Promise<Record<string, string>> {
  const { execFile } = await import('child_process');
  const { promisify } = await import('util');
  const execFileAsync = promisify(execFile);
  const os = await import('os');
  const path = await import('path');

  const platform = os.platform();
  const homeDir = os.homedir();

  let env = { ...process.env } as Record<string, string>;

  if (platform === 'darwin' || platform === 'linux') {
    try {
      const shell = getDefaultShell();
      const shellName = path.basename(shell);

      log(`[MCPManager] Getting full environment from ${shellName}...`);

      const { stdout } = await execFileAsync(shell, ['-l', '-c', 'env'], {
        timeout: 5000,
        env: { HOME: homeDir },
      });

      const lines = stdout.split(/\r?\n/);
      const shellEnv: Record<string, string> = {};

      for (const line of lines) {
        const equalIndex = line.indexOf('=');
        if (equalIndex > 0) {
          const key = line.substring(0, equalIndex);
          const value = line.substring(equalIndex + 1);
          shellEnv[key] = value;
        }
      }

      env = mergeShellEnvForMcp(env, shellEnv);

      if (shellEnv.PATH && process.env.PATH) {
        const pathDelimiter = ':';
        const shellPaths = shellEnv.PATH.split(pathDelimiter).filter((p) => p.trim());
        const processPaths = process.env.PATH.split(pathDelimiter).filter((p) => p.trim());
        const allPaths = [...shellPaths];

        for (const processPath of processPaths) {
          if (!allPaths.includes(processPath)) {
            allPaths.push(processPath);
          }
        }

        env.PATH = allPaths.join(pathDelimiter);
        log(
          `[MCPManager] Merged PATH: ${shellPaths.length} paths from shell + ${processPaths.length - (allPaths.length - shellPaths.length)} unique paths from process = ${allPaths.length} total`
        );
      } else if (shellEnv.PATH) {
        env.PATH = shellEnv.PATH;
        log('[MCPManager] Using shell PATH only');
      }

      log(
        `[MCPManager] Enhanced environment with ${Object.keys(shellEnv).length} variables from shell`
      );
    } catch (error: unknown) {
      logWarn(
        `[MCPManager] Could not get environment from shell: ${error instanceof Error ? error.message : String(error)}`
      );
      logWarn('[MCPManager] Using limited process.env, MCP servers may fail');
    }
  } else if (platform === 'win32') {
    const psExe = path.join(
      process.env.SystemRoot || 'C:\\Windows',
      'System32',
      'WindowsPowerShell',
      'v1.0',
      'powershell.exe'
    );
    try {
      const { stdout } = await execFileAsync(
        psExe,
        [
          '-NoProfile',
          '-Command',
          "[Environment]::GetEnvironmentVariable('Path', 'User') + ';' + [Environment]::GetEnvironmentVariable('Path', 'Machine')",
        ],
        { timeout: 5000 }
      );
      if (stdout.trim()) {
        const pathDelimiter = ';';
        const winPaths = stdout
          .trim()
          .split(pathDelimiter)
          .filter((p) => p.trim());
        const currentPaths = (env.PATH || '').split(pathDelimiter).filter((p) => p.trim());
        const allPaths = [...winPaths];

        for (const currentPath of currentPaths) {
          if (
            !allPaths.some(
              (existingPath) => existingPath.toLowerCase() === currentPath.toLowerCase()
            )
          ) {
            allPaths.push(currentPath);
          }
        }

        env.PATH = allPaths.join(pathDelimiter);
        log(
          `[MCPManager] Enhanced Windows PATH: ${winPaths.length} user/machine paths + ${allPaths.length - winPaths.length} unique process paths = ${allPaths.length} total`
        );
      }
    } catch (error: unknown) {
      logWarn(
        `[MCPManager] Could not get Windows PATH from PowerShell: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  const bundledNode = ctx.getBundledNodePath();
  if (bundledNode && env.PATH) {
    const nodeBinDir = path.dirname(bundledNode.node);
    const pathDelimiter = platform === 'win32' ? ';' : ':';
    const pathParts = env.PATH.split(pathDelimiter).filter((p) => p.trim());
    const filteredPaths = pathParts.filter((p) => p !== nodeBinDir);

    env.PATH = [nodeBinDir, ...filteredPaths].join(pathDelimiter);
    log(`[MCPManager] Prepended bundled Node.js bin to PATH: ${nodeBinDir}`);
  }

  if (!app.isPackaged && !env.HOME) {
    env.HOME = homeDir;
  }

  log(`[MCPManager] Final PATH: ${env.PATH?.substring(0, 150)}...`);
  return env;
}
