import { describe, expect, it } from 'vitest';
import { resolveAutoUpdaterExport } from '../src/main/auto-updater';

describe('resolveAutoUpdaterExport', () => {
  const mockUpdater = { allowPrerelease: false } as const;

  it('returns named export when present', () => {
    expect(resolveAutoUpdaterExport({ autoUpdater: mockUpdater })).toBe(mockUpdater);
  });

  it('falls back to default.autoUpdater for CJS/ESM interop', () => {
    expect(resolveAutoUpdaterExport({ default: { autoUpdater: mockUpdater } })).toBe(mockUpdater);
  });

  it('returns null when autoUpdater is missing', () => {
    expect(resolveAutoUpdaterExport({})).toBeNull();
    expect(resolveAutoUpdaterExport({ default: {} })).toBeNull();
  });
});
