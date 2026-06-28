/**
 * @module main/paths/sandbox-paths
 *
 * Canonical VM sandbox paths and Lima instance naming with legacy fallbacks.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const LIMA_INSTANCE_NAME = 'lygodactylus-sandbox';
export const LEGACY_LIMA_INSTANCE_NAME = 'claude-sandbox';

export const SYNC_MANIFEST_FILE = '.lygodactylus-sync.json';
export const LEGACY_SYNC_MANIFEST_FILES = ['.opencowork-sync.json'] as const;

export const SANDBOX_DIR_REL = '.lygodactylus/sandbox';
export const LEGACY_SANDBOX_DIR_REL = '.claude/sandbox';

/** Skills directory inside an isolated sandbox workspace. */
export const SANDBOX_SKILLS_DIR = 'skills';

export const LEGACY_SANDBOX_SKILLS_DIR = '.claude/skills';

export const TEMP_PLUGIN_PREFIX = 'lygodactylus-plugin-';
export const LEGACY_TEMP_PLUGIN_PREFIX = 'opencowork-plugin-';

let cachedLimaInstanceName: string | null = null;

export function buildSandboxPath(homeDir: string, sessionId: string, useLegacy = false): string {
  const rel = useLegacy ? LEGACY_SANDBOX_DIR_REL : SANDBOX_DIR_REL;
  return `${homeDir}/${rel}/${sessionId}`;
}

export function listSandboxPathCandidates(homeDir: string, sessionId: string): string[] {
  return [
    buildSandboxPath(homeDir, sessionId, false),
    buildSandboxPath(homeDir, sessionId, true),
  ];
}

export function resolveLimaInstanceName(limactlListOutput: string): string {
  if (limactlListOutput.includes(LIMA_INSTANCE_NAME)) {
    return LIMA_INSTANCE_NAME;
  }
  if (limactlListOutput.includes(LEGACY_LIMA_INSTANCE_NAME)) {
    return LEGACY_LIMA_INSTANCE_NAME;
  }
  return LIMA_INSTANCE_NAME;
}

export function getCachedLimaInstanceName(): string {
  return cachedLimaInstanceName || LIMA_INSTANCE_NAME;
}

export function setCachedLimaInstanceName(name: string | null): void {
  cachedLimaInstanceName = name;
}

export async function resolveActiveLimaInstanceName(): Promise<string> {
  if (cachedLimaInstanceName) {
    return cachedLimaInstanceName;
  }

  try {
    const { stdout } = await execFileAsync('limactl', ['list'], {
      timeout: 10_000,
      encoding: 'utf-8',
    });
    cachedLimaInstanceName = resolveLimaInstanceName(stdout);
  } catch {
    cachedLimaInstanceName = LIMA_INSTANCE_NAME;
  }

  return cachedLimaInstanceName;
}

export function listSyncManifestFilenames(): string[] {
  return [SYNC_MANIFEST_FILE, ...LEGACY_SYNC_MANIFEST_FILES];
}
