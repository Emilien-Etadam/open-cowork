/**
 * @module main/runtime/node-runtime
 *
 * Resolves and optionally downloads the Node.js runtime used by MCP servers and skills.
 * Packaged apps store the runtime under userData; dev mode uses resources/node.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { app } from 'electron';
import { log, logError } from '../utils/logger';

export const NODE_RUNTIME_VERSION = 'v22.22.0';

type NodeBinaries = { node: string; npx: string };

let cachedBundledNodePaths: NodeBinaries | null | undefined;
let ensurePromise: Promise<NodeBinaries> | null = null;

interface NodeRuntimeLib {
  NODE_VERSION: string;
  downloadAndExtract: (options: {
    outputDir: string;
    platform?: string;
    arch?: string;
    flatLayout?: boolean;
  }) => Promise<string>;
  isRuntimeComplete: (runtimeRoot: string) => boolean;
  resolveRuntimeBinaries: (runtimeRoot: string) => NodeBinaries | null;
  applyNpxFix: (runtimeRoot: string) => void;
}

async function loadNodeRuntimeLib(): Promise<NodeRuntimeLib> {
  const libPath = path.join(app.getAppPath(), 'scripts', 'lib', 'node-runtime.mjs');
  return (await import(pathToFileURL(libPath).href)) as NodeRuntimeLib;
}

function getDevRuntimeRoot(): string {
  const projectRoot = path.join(__dirname, '..', '..');
  return path.join(projectRoot, 'resources', 'node', `${process.platform}-${process.arch}`);
}

export function getPackagedRuntimeRoot(): string {
  return path.join(app.getPath('userData'), 'runtimes', 'node', NODE_RUNTIME_VERSION);
}

function getLegacyBundledRuntimeRoot(): string | null {
  if (!app.isPackaged) {
    return null;
  }
  const legacyRoot = path.join(process.resourcesPath, 'node');
  return fs.existsSync(legacyRoot) ? legacyRoot : null;
}

function resolveBinariesFromRoot(runtimeRoot: string): NodeBinaries | null {
  const platform = process.platform;
  const binDir = platform === 'win32' ? runtimeRoot : path.join(runtimeRoot, 'bin');
  const nodePath = path.join(binDir, platform === 'win32' ? 'node.exe' : 'node');
  const npxPath = path.join(binDir, platform === 'win32' ? 'npx.cmd' : 'npx');
  if (fs.existsSync(nodePath) && fs.existsSync(npxPath)) {
    return { node: nodePath, npx: npxPath };
  }
  return null;
}

function findExistingRuntimeRoot(): string | null {
  const candidates = app.isPackaged
    ? [getPackagedRuntimeRoot(), getLegacyBundledRuntimeRoot()]
    : [getDevRuntimeRoot()];

  for (const candidate of candidates) {
    if (candidate && resolveBinariesFromRoot(candidate)) {
      return candidate;
    }
  }
  return null;
}

export function clearNodeRuntimeCache(): void {
  cachedBundledNodePaths = undefined;
  ensurePromise = null;
}

export function getBundledNodePaths(): NodeBinaries | null {
  if (cachedBundledNodePaths !== undefined) {
    return cachedBundledNodePaths;
  }

  const runtimeRoot = findExistingRuntimeRoot();
  cachedBundledNodePaths = runtimeRoot ? resolveBinariesFromRoot(runtimeRoot) : null;
  return cachedBundledNodePaths;
}

async function migrateLegacyRuntimeIfPresent(): Promise<void> {
  if (!app.isPackaged) {
    return;
  }

  const legacyRoot = getLegacyBundledRuntimeRoot();
  const targetRoot = getPackagedRuntimeRoot();
  if (!legacyRoot || resolveBinariesFromRoot(targetRoot)) {
    return;
  }

  log(`[NodeRuntime] Migrating legacy bundled Node.js to ${targetRoot}`);
  fs.mkdirSync(path.dirname(targetRoot), { recursive: true });
  fs.cpSync(legacyRoot, targetRoot, { recursive: true });
  const lib = await loadNodeRuntimeLib();
  lib.applyNpxFix(targetRoot);
  clearNodeRuntimeCache();
}

export async function ensureNodeRuntime(): Promise<NodeBinaries> {
  const existing = getBundledNodePaths();
  if (existing) {
    return existing;
  }

  if (!ensurePromise) {
    ensurePromise = (async () => {
      await migrateLegacyRuntimeIfPresent();
      const migrated = getBundledNodePaths();
      if (migrated) {
        return migrated;
      }

      if (!app.isPackaged) {
        log('[NodeRuntime] Dev mode — downloading Node.js to resources/node');
        const lib = await loadNodeRuntimeLib();
        const outputDir = path.join(app.getAppPath(), 'resources', 'node');
        await lib.downloadAndExtract({ outputDir });
        clearNodeRuntimeCache();
        const devPaths = getBundledNodePaths();
        if (!devPaths) {
          throw new Error('Failed to prepare Node.js runtime for development');
        }
        return devPaths;
      }

      log('[NodeRuntime] Downloading Node.js runtime on first use...');
      const lib = await loadNodeRuntimeLib();
      const targetRoot = getPackagedRuntimeRoot();
      fs.mkdirSync(path.dirname(targetRoot), { recursive: true });
      await lib.downloadAndExtract({ outputDir: targetRoot, flatLayout: true });
      clearNodeRuntimeCache();
      const downloaded = getBundledNodePaths();
      if (!downloaded) {
        throw new Error('Failed to download Node.js runtime');
      }
      log(`[NodeRuntime] Ready: ${downloaded.node}`);
      return downloaded;
    })().catch((error) => {
      ensurePromise = null;
      const message = error instanceof Error ? error.message : String(error);
      logError('[NodeRuntime] Failed to ensure Node.js runtime:', message);
      throw error;
    });
  }

  return ensurePromise;
}

export function isNodeRuntimeReady(): boolean {
  return getBundledNodePaths() !== null;
}

export function getNodeRuntimeStatus(): {
  ready: boolean;
  version: string;
  root: string | null;
} {
  const root = findExistingRuntimeRoot();
  return {
    ready: root !== null,
    version: NODE_RUNTIME_VERSION,
    root,
  };
}

// Legacy helper for preflight/tests
export function getNodeRuntimeLibPath(): string {
  return path.join(app.getAppPath(), 'scripts', 'lib', 'node-runtime.mjs');
}
