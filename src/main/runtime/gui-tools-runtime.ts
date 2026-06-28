/**
 * @module main/runtime/gui-tools-runtime
 *
 * Resolves and optionally downloads cliclick for macOS GUI automation.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { app } from 'electron';
import { log, logWarn } from '../utils/logger';

export const CLICLICK_VERSION = '5.1';

let cachedCliclickPath: string | null | undefined;
let ensurePromise: Promise<string | null> | null = null;

interface GuiToolsRuntimeLib {
  CLICLICK_VERSION: string;
  ensureCliclick: (options: { runtimeRoot: string; arch?: string }) => Promise<string>;
  copyCliclickFromSystem: (runtimeRoot: string, arch?: string) => string | null;
  isRuntimeComplete: (runtimeRoot: string) => boolean;
  resolveCliclickPath: (runtimeRoot: string) => string | null;
}

async function loadGuiToolsRuntimeLib(): Promise<GuiToolsRuntimeLib> {
  const libPath = path.join(app.getAppPath(), 'scripts', 'lib', 'gui-tools-runtime.mjs');
  return (await import(pathToFileURL(libPath).href)) as GuiToolsRuntimeLib;
}

function getDevRuntimeRoot(): string {
  const projectRoot = path.join(__dirname, '..', '..');
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  return path.join(projectRoot, 'resources', 'tools', `darwin-${arch}`);
}

export function getPackagedRuntimeRoot(): string {
  return path.join(app.getPath('userData'), 'runtimes', 'tools', 'cliclick', CLICLICK_VERSION);
}

function getLegacyBundledCliclickPath(): string | null {
  if (!app.isPackaged) {
    return null;
  }

  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  const candidates = [
    path.join(process.resourcesPath, 'tools', `darwin-${arch}`, 'bin', 'cliclick'),
    path.join(process.resourcesPath, 'tools', 'bin', 'cliclick'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function resolveCachedCliclickPath(): string | null {
  const runtimeRoots = app.isPackaged ? [getPackagedRuntimeRoot()] : [getDevRuntimeRoot()];

  for (const runtimeRoot of runtimeRoots) {
    const cliclickPath = path.join(runtimeRoot, 'bin', 'cliclick');
    if (fs.existsSync(cliclickPath)) {
      return cliclickPath;
    }
  }

  return getLegacyBundledCliclickPath();
}

export function clearGuiToolsRuntimeCache(): void {
  cachedCliclickPath = undefined;
  ensurePromise = null;
}

export function getBundledCliclickPath(): string | null {
  if (cachedCliclickPath !== undefined) {
    return cachedCliclickPath;
  }

  cachedCliclickPath = resolveCachedCliclickPath();
  return cachedCliclickPath;
}

async function migrateLegacyRuntimeIfPresent(): Promise<void> {
  if (!app.isPackaged || process.platform !== 'darwin') {
    return;
  }

  const legacyPath = getLegacyBundledCliclickPath();
  const targetRoot = getPackagedRuntimeRoot();
  if (!legacyPath || getBundledCliclickPath()) {
    return;
  }

  log(`[GuiToolsRuntime] Migrating legacy bundled cliclick to ${targetRoot}`);
  fs.mkdirSync(path.join(targetRoot, 'bin'), { recursive: true });
  fs.copyFileSync(legacyPath, path.join(targetRoot, 'bin', 'cliclick'));
  fs.chmodSync(path.join(targetRoot, 'bin', 'cliclick'), 0o755);
  clearGuiToolsRuntimeCache();
}

export async function ensureCliclickRuntime(): Promise<string | null> {
  if (process.platform !== 'darwin') {
    return null;
  }

  const existing = getBundledCliclickPath();
  if (existing) {
    return existing;
  }

  if (!ensurePromise) {
    ensurePromise = (async () => {
      await migrateLegacyRuntimeIfPresent();
      const migrated = getBundledCliclickPath();
      if (migrated) {
        return migrated;
      }

      const lib = await loadGuiToolsRuntimeLib();
      const arch = process.arch === 'arm64' ? 'arm64' : 'x64';

      if (!app.isPackaged) {
        const devRoot = getDevRuntimeRoot();
        if (lib.isRuntimeComplete(devRoot)) {
          clearGuiToolsRuntimeCache();
          return getBundledCliclickPath();
        }

        log('[GuiToolsRuntime] Dev mode — copying cliclick to resources/tools');
        const copied = lib.copyCliclickFromSystem(devRoot, arch);
        if (!copied) {
          const downloaded = await lib.ensureCliclick({ runtimeRoot: devRoot, arch });
          clearGuiToolsRuntimeCache();
          return downloaded;
        }
        clearGuiToolsRuntimeCache();
        return copied;
      }

      log('[GuiToolsRuntime] Downloading cliclick on first use...');
      const targetRoot = getPackagedRuntimeRoot();
      fs.mkdirSync(targetRoot, { recursive: true });
      const downloaded = await lib.ensureCliclick({ runtimeRoot: targetRoot, arch });
      clearGuiToolsRuntimeCache();
      log(`[GuiToolsRuntime] Ready: ${downloaded}`);
      return downloaded;
    })().catch((error) => {
      ensurePromise = null;
      const message = error instanceof Error ? error.message : String(error);
      logWarn('[GuiToolsRuntime] Failed to ensure cliclick runtime:', message);
      return null;
    });
  }

  return ensurePromise;
}

export function isCliclickRuntimeReady(): boolean {
  return getBundledCliclickPath() !== null;
}

export function getCliclickRuntimeStatus(): {
  ready: boolean;
  version: string;
  path: string | null;
} {
  return {
    ready: isCliclickRuntimeReady(),
    version: CLICLICK_VERSION,
    path: getBundledCliclickPath(),
  };
}

export function getGuiToolsRuntimeLibPath(): string {
  return path.join(app.getAppPath(), 'scripts', 'lib', 'gui-tools-runtime.mjs');
}
