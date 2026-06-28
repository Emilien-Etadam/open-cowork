/**
 * @module main/paths/app-data-paths
 *
 * Canonical userData paths for skills/plugins with one-time migration from legacy `claude/`.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { app } from 'electron';
import { log, logWarn } from '../utils/logger';

const LEGACY_AGENT_DIR = 'claude';

function getUserDataRoot(): string {
  return app.getPath('userData');
}

/** Runtime skills directory (symlinks + user skills). */
export function getRuntimeSkillsDir(): string {
  return path.join(getUserDataRoot(), 'skills');
}

/** Installed plugin packages root. */
export function getPluginsRootPath(): string {
  return path.join(getUserDataRoot(), 'plugins');
}

/**
 * Parent directory for agent-local data. Prefer flat `skills` / `plugins` dirs instead.
 * @deprecated Kept for logs and transitional call sites — equals `getRuntimeSkillsDir()`.
 */
export function getAppAgentDataDir(): string {
  return getRuntimeSkillsDir();
}

/** External Claude Code skills directory (read-only import source). */
export function getUserClaudeSkillsDir(): string {
  return path.join(app.getPath('home'), '.claude', 'skills');
}

function copyDirectorySync(source: string, target: string): void {
  fs.mkdirSync(target, { recursive: true });
  for (const entry of fs.readdirSync(source)) {
    const sourcePath = path.join(source, entry);
    const targetPath = path.join(target, entry);
    const stat = fs.statSync(sourcePath);
    if (stat.isDirectory()) {
      copyDirectorySync(sourcePath, targetPath);
    } else {
      fs.copyFileSync(sourcePath, targetPath);
    }
  }
}

function migrateDirectory(legacyPath: string, targetPath: string, label: string): void {
  if (fs.existsSync(targetPath)) {
    return;
  }
  if (!fs.existsSync(legacyPath)) {
    return;
  }

  try {
    fs.renameSync(legacyPath, targetPath);
    log(`[AppDataPaths] Migrated ${label}: ${legacyPath} → ${targetPath}`);
  } catch (error) {
    logWarn(`[AppDataPaths] Rename failed for ${label}, copying instead:`, error);
    try {
      copyDirectorySync(legacyPath, targetPath);
      fs.rmSync(legacyPath, { recursive: true, force: true });
      log(`[AppDataPaths] Copied ${label}: ${legacyPath} → ${targetPath}`);
    } catch (copyError) {
      logWarn(`[AppDataPaths] Failed to migrate ${label}:`, copyError);
    }
  }
}

/**
 * One-time migration: `userData/claude/{skills,plugins}` → `userData/{skills,plugins}`.
 */
export function migrateLegacyAgentDataPaths(): void {
  const userData = getUserDataRoot();

  migrateDirectory(
    path.join(userData, LEGACY_AGENT_DIR, 'skills'),
    getRuntimeSkillsDir(),
    'skills'
  );
  migrateDirectory(
    path.join(userData, LEGACY_AGENT_DIR, 'plugins'),
    getPluginsRootPath(),
    'plugins'
  );

  const legacyRoot = path.join(userData, LEGACY_AGENT_DIR);
  try {
    if (fs.existsSync(legacyRoot) && fs.readdirSync(legacyRoot).length === 0) {
      fs.rmdirSync(legacyRoot);
      log('[AppDataPaths] Removed empty legacy agent data directory');
    }
  } catch {
    // Non-fatal
  }
}
