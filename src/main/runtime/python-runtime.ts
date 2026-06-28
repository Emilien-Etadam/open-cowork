/**
 * @module main/runtime/python-runtime
 *
 * Resolves and optionally downloads the Python runtime used for GUI automation and skills.
 * Packaged apps store the runtime under userData; dev mode uses resources/python.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { app } from 'electron';
import { log, logError } from '../utils/logger';

export const PYTHON_VERSION = '3.10.19';

export type PythonPaths = {
  python: string;
  pythonRoot: string;
  sitePackages: string;
};

let cachedBundledPythonPaths: PythonPaths | null | undefined;
let ensurePromise: Promise<PythonPaths> | null = null;

interface PythonRuntimeLib {
  PYTHON_VERSION: string;
  downloadAndPrepare: (options: {
    outputDir: string;
    platform?: string;
    arch?: string;
    flatLayout?: boolean;
    installGuiDeps?: boolean;
    crossCompileGuiDeps?: boolean;
  }) => Promise<string>;
  isRuntimeComplete: (runtimeRoot: string, options?: { requireGuiPackages?: boolean }) => boolean;
  resolveRuntimePaths: (runtimeRoot: string) => PythonPaths | null;
}

async function loadPythonRuntimeLib(): Promise<PythonRuntimeLib> {
  const libPath = path.join(app.getAppPath(), 'scripts', 'lib', 'python-runtime.mjs');
  return (await import(pathToFileURL(libPath).href)) as PythonRuntimeLib;
}

function getDevRuntimeRoot(): string {
  const projectRoot = path.join(__dirname, '..', '..');
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  return path.join(projectRoot, 'resources', 'python', `${process.platform}-${arch}`);
}

export function getPackagedRuntimeRoot(): string {
  return path.join(app.getPath('userData'), 'runtimes', 'python', PYTHON_VERSION);
}

function getLegacyBundledRuntimeRoot(): string | null {
  if (!app.isPackaged) {
    return null;
  }
  const legacyRoot = path.join(process.resourcesPath, 'python');
  const pythonBin = path.join(legacyRoot, 'bin', 'python3');
  return fs.existsSync(pythonBin) ? legacyRoot : null;
}

function resolvePathsFromRoot(runtimeRoot: string): PythonPaths | null {
  const pythonPath = path.join(runtimeRoot, 'bin', 'python3');
  if (!fs.existsSync(pythonPath)) {
    return null;
  }
  return {
    python: pythonPath,
    pythonRoot: runtimeRoot,
    sitePackages: path.join(runtimeRoot, 'site-packages'),
  };
}

function requiresGuiPackages(): boolean {
  return process.platform === 'darwin';
}

function isCompleteRuntimeRoot(runtimeRoot: string): boolean {
  if (!resolvePathsFromRoot(runtimeRoot)) {
    return false;
  }
  if (!requiresGuiPackages()) {
    return true;
  }
  const sitePackages = path.join(runtimeRoot, 'site-packages');
  return (
    fs.existsSync(path.join(sitePackages, 'PIL')) &&
    fs.existsSync(path.join(sitePackages, 'Quartz'))
  );
}

function findExistingRuntimeRoot(): string | null {
  const candidates = app.isPackaged
    ? [getPackagedRuntimeRoot(), getLegacyBundledRuntimeRoot()]
    : [getDevRuntimeRoot()];

  for (const candidate of candidates) {
    if (candidate && isCompleteRuntimeRoot(candidate)) {
      return candidate;
    }
  }
  return null;
}

export function clearPythonRuntimeCache(): void {
  cachedBundledPythonPaths = undefined;
  ensurePromise = null;
}

export function getBundledPythonPaths(): PythonPaths | null {
  if (cachedBundledPythonPaths !== undefined) {
    return cachedBundledPythonPaths;
  }

  const runtimeRoot = findExistingRuntimeRoot();
  cachedBundledPythonPaths = runtimeRoot ? resolvePathsFromRoot(runtimeRoot) : null;
  return cachedBundledPythonPaths;
}

async function migrateLegacyRuntimeIfPresent(): Promise<void> {
  if (!app.isPackaged) {
    return;
  }

  const legacyRoot = getLegacyBundledRuntimeRoot();
  const targetRoot = getPackagedRuntimeRoot();
  if (!legacyRoot || isCompleteRuntimeRoot(targetRoot)) {
    return;
  }

  log(`[PythonRuntime] Migrating legacy bundled Python to ${targetRoot}`);
  fs.mkdirSync(path.dirname(targetRoot), { recursive: true });
  fs.cpSync(legacyRoot, targetRoot, { recursive: true });
  clearPythonRuntimeCache();
}

function isSupportedPlatform(): boolean {
  return process.platform === 'darwin' || process.platform === 'linux';
}

export async function ensurePythonRuntime(): Promise<PythonPaths> {
  if (!isSupportedPlatform()) {
    throw new Error(`Python on-demand runtime is not supported on ${process.platform}`);
  }

  const existing = getBundledPythonPaths();
  if (existing) {
    return existing;
  }

  if (!ensurePromise) {
    ensurePromise = (async () => {
      await migrateLegacyRuntimeIfPresent();
      const migrated = getBundledPythonPaths();
      if (migrated) {
        return migrated;
      }

      const lib = await loadPythonRuntimeLib();

      if (!app.isPackaged) {
        log('[PythonRuntime] Dev mode — downloading Python to resources/python');
        const outputDir = path.join(app.getAppPath(), 'resources', 'python');
        await lib.downloadAndPrepare({
          outputDir,
          crossCompileGuiDeps: process.platform === 'darwin',
        });
        clearPythonRuntimeCache();
        const devPaths = getBundledPythonPaths();
        if (!devPaths) {
          throw new Error('Failed to prepare Python runtime for development');
        }
        return devPaths;
      }

      log('[PythonRuntime] Downloading Python runtime on first use...');
      const targetRoot = getPackagedRuntimeRoot();
      fs.mkdirSync(path.dirname(targetRoot), { recursive: true });
      await lib.downloadAndPrepare({
        outputDir: targetRoot,
        flatLayout: true,
        installGuiDeps: process.platform === 'darwin',
      });
      clearPythonRuntimeCache();
      const downloaded = getBundledPythonPaths();
      if (!downloaded) {
        throw new Error('Failed to download Python runtime');
      }
      log(`[PythonRuntime] Ready: ${downloaded.python}`);
      return downloaded;
    })().catch((error) => {
      ensurePromise = null;
      const message = error instanceof Error ? error.message : String(error);
      logError('[PythonRuntime] Failed to ensure Python runtime:', message);
      throw error;
    });
  }

  return ensurePromise;
}

export function isPythonRuntimeReady(): boolean {
  return getBundledPythonPaths() !== null;
}

export function getPythonRuntimeStatus(): {
  ready: boolean;
  version: string;
  root: string | null;
} {
  const root = findExistingRuntimeRoot();
  return {
    ready: root !== null,
    version: PYTHON_VERSION,
    root,
  };
}

export function getPythonRuntimeLibPath(): string {
  return path.join(app.getAppPath(), 'scripts', 'lib', 'python-runtime.mjs');
}
