import { describe, expect, it } from 'vitest';
import {
  buildWorkspaceFingerprint,
  parseSandboxSyncManifest,
  serializeSandboxSyncManifest,
} from '../../main/sandbox/sandbox-sync-manifest';

describe('sandbox-sync-manifest', () => {
  it('builds a stable workspace fingerprint', () => {
    const a = buildWorkspaceFingerprint('D:\\Projects\\Demo');
    const b = buildWorkspaceFingerprint('d:/projects/demo');
    expect(a).toBe(b);
  });

  it('parses the current manifest shape', () => {
    const manifest = parseSandboxSyncManifest(
      JSON.stringify({
        workspacePath: '/workspace/project',
        workspaceFingerprint: 'abc123',
        syncedAt: 1_700_000_000_000,
        lastExportAt: 1_700_000_100_000,
      })
    );

    expect(manifest).toEqual({
      workspacePath: '/workspace/project',
      workspaceFingerprint: 'abc123',
      syncedAt: 1_700_000_000_000,
      lastExportAt: 1_700_000_100_000,
    });
  });

  it('accepts legacy windowsPath manifests', () => {
    const manifest = parseSandboxSyncManifest(
      JSON.stringify({
        windowsPath: 'C:\\\\workspace',
        workspaceFingerprint: 'legacy',
        syncedAt: 42,
      })
    );

    expect(manifest?.workspacePath).toContain('workspace');
    expect(manifest?.workspaceFingerprint).toBe('legacy');
  });

  it('round-trips through serializeSandboxSyncManifest', () => {
    const payload = serializeSandboxSyncManifest({
      workspacePath: '/Users/me/project',
      workspaceFingerprint: 'fp',
      syncedAt: 10,
      lastExportAt: 20,
    });

    expect(parseSandboxSyncManifest(payload)).toEqual({
      workspacePath: '/Users/me/project',
      workspaceFingerprint: 'fp',
      syncedAt: 10,
      lastExportAt: 20,
    });
  });
});
