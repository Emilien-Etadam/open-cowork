import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const settingsGeneralPath = path.resolve(
  process.cwd(),
  'src/renderer/components/settings/SettingsGeneral.tsx'
);
const settingsGeneralContent = readFileSync(settingsGeneralPath, 'utf8');

describe('SettingsGeneral update check UI', () => {
  it('exposes a manual update check button and EE version display', () => {
    expect(settingsGeneralContent).toContain('checkForUpdates');
    expect(settingsGeneralContent).toContain('formatEeDisplayVersion');
    expect(settingsGeneralContent).toContain("t('general.updateCheck')");
    expect(settingsGeneralContent).toContain('openReleasesPage');
  });
});
