import { describe, expect, it } from 'vitest';
import { buildUpdateCheckResult } from '../../src/shared/update-check';

describe('buildUpdateCheckResult', () => {
  it('marks Windows auto-update as installable only after download', () => {
    const available = buildUpdateCheckResult({
      currentVersion: '3.3.1-EE4.91',
      latestVersion: '3.3.1-EE4.92',
      downloadedVersion: null,
      autoUpdateSupported: true,
    });

    expect(available.status).toBe('update-available');
    expect(available.autoUpdateSupported).toBe(true);
    expect(available.canInstall).toBe(false);

    const downloaded = buildUpdateCheckResult({
      currentVersion: '3.3.1-EE4.91',
      latestVersion: '3.3.1-EE4.92',
      downloadedVersion: '3.3.1-EE4.92',
      autoUpdateSupported: true,
    });

    expect(downloaded.status).toBe('downloaded');
    expect(downloaded.canInstall).toBe(true);
  });

  it('uses manual download hint path when auto-update is unsupported', () => {
    const result = buildUpdateCheckResult({
      currentVersion: '3.3.1-EE4.91',
      latestVersion: '3.3.1-EE4.92',
      autoUpdateSupported: false,
    });

    expect(result.status).toBe('update-available');
    expect(result.autoUpdateSupported).toBe(false);
    expect(result.canInstall).toBe(false);
  });
});
