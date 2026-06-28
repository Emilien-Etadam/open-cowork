import { createHash } from 'crypto';
import {
  LEGACY_SYNC_MANIFEST_FILES,
  SYNC_MANIFEST_FILE,
  listSyncManifestFilenames,
} from '../paths/sandbox-paths';

export { SYNC_MANIFEST_FILE, LEGACY_SYNC_MANIFEST_FILES, listSyncManifestFilenames };

export interface SandboxSyncManifest {
  workspacePath: string;
  workspaceFingerprint: string;
  syncedAt: number;
  lastExportAt?: number;
}

export function buildWorkspaceFingerprint(workspacePath: string): string {
  const normalized = workspacePath.trim().toLowerCase().replace(/\\/g, '/');
  return createHash('sha256').update(normalized).digest('hex');
}

export function parseSandboxSyncManifest(raw: string): SandboxSyncManifest | null {
  try {
    const parsed = JSON.parse(raw) as Partial<SandboxSyncManifest> & {
      windowsPath?: string;
      macPath?: string;
    };
    const workspacePath =
      typeof parsed.workspacePath === 'string'
        ? parsed.workspacePath
        : typeof parsed.windowsPath === 'string'
          ? parsed.windowsPath
          : typeof parsed.macPath === 'string'
            ? parsed.macPath
            : null;
    if (
      workspacePath &&
      typeof parsed.workspaceFingerprint === 'string' &&
      typeof parsed.syncedAt === 'number'
    ) {
      return {
        workspacePath,
        workspaceFingerprint: parsed.workspaceFingerprint,
        syncedAt: parsed.syncedAt,
        lastExportAt: typeof parsed.lastExportAt === 'number' ? parsed.lastExportAt : undefined,
      };
    }
    return null;
  } catch {
    return null;
  }
}

export function serializeSandboxSyncManifest(manifest: SandboxSyncManifest): string {
  return JSON.stringify(manifest, null, 2);
}
