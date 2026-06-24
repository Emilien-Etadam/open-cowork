import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const settingsPanelPath = path.resolve(process.cwd(), 'src/renderer/components/SettingsPanel.tsx');
const settingsDir = path.resolve(process.cwd(), 'src/renderer/components/settings');
const settingsPanelContent = [
  readFileSync(settingsPanelPath, 'utf8'),
  ...readdirSync(settingsDir).map((f) => readFileSync(path.join(settingsDir, f), 'utf8')),
].join('\n');

describe('SettingsPanel extensions marketplace', () => {
  it('uses unified extensions tab instead of legacy skills/connectors tabs', () => {
    expect(settingsPanelContent).toContain('SettingsMarketplace');
    expect(settingsPanelContent).toContain("id: 'extensions'");
    expect(settingsPanelContent).not.toContain('SettingsSkills');
    expect(settingsPanelContent).not.toContain('SettingsConnectors');
  });

  it('exposes marketplace IPC for curated catalog', () => {
    expect(settingsPanelContent).toContain('window.electronAPI.marketplace.list');
    expect(settingsPanelContent).toContain('window.electronAPI.marketplace.getMeta');
    expect(settingsPanelContent).toContain('window.electronAPI.marketplace.install');
  });

  it('keeps manual skill install and MCP advanced section', () => {
    expect(settingsPanelContent).toContain("t('marketplace.manualSkillInstall')");
    expect(settingsPanelContent).toContain('MarketplaceMcpAdvanced');
    expect(settingsPanelContent).toContain("t('marketplace.manualWarning')");
  });

  it('shows catalog OTA metadata in the UI', () => {
    expect(settingsPanelContent).toContain("t('marketplace.catalogMeta'");
    expect(settingsPanelContent).toContain("t('marketplace.catalogSourceRemote')");
    expect(settingsPanelContent).toContain('marketplace.getMeta');
  });

  it('retains skills storage controls in marketplace storage view', () => {
    expect(settingsPanelContent).toContain("t('skills.storagePathTitle')");
    expect(settingsPanelContent).toContain('window.electronAPI.skills.getStoragePath()');
    expect(settingsPanelContent).toContain('window.electronAPI.skills.setStoragePath');
  });
});
