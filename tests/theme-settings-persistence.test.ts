import { describe, expect, it } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';

const mainIndexPath = path.resolve(process.cwd(), 'src/main/index.ts');
const windowPath = path.resolve(process.cwd(), 'src/main/main-app-window.ts');
const clientEventsPath = path.resolve(process.cwd(), 'src/main/main-client-events.ts');
const useIPCPath = path.resolve(process.cwd(), 'src/renderer/hooks/useIPC.ts');
const storePath = path.resolve(process.cwd(), 'src/renderer/store/index.ts');

describe('theme settings persistence', () => {
  it('persists theme updates in the main process and applies them to native window state', () => {
    const windowSource = fs.readFileSync(windowPath, 'utf8');
    const clientEventsSource = fs.readFileSync(clientEventsPath, 'utf8');
    const indexSource = fs.readFileSync(mainIndexPath, 'utf8');

    expect(windowSource).toContain('const WINDOW_BACKGROUNDS');
    expect(windowSource).toContain("dark: '#1e1e1e'");
    expect(clientEventsSource).toContain('configStore.update({ theme: nextTheme });');
    expect(clientEventsSource).not.toContain('themePreset');
    expect(windowSource).toContain('getWindowBackground(');
    expect(windowSource).toContain("light: '#ffffff'");
    expect(windowSource).toContain('nativeTheme.themeSource = theme;');
    expect(windowSource).toContain('setBackgroundColor(');
    expect(indexSource).toContain("getSavedThemePreference() === 'system'");
    expect(windowSource).toContain('getWindowBackground(effectiveTheme)');
    expect(clientEventsSource).not.toContain(
      "case 'settings.update':\n      // TODO: Implement settings update"
    );
  });

  it('hydrates renderer theme from config bootstrap without re-triggering persistence loops', () => {
    const source = fs.readFileSync(useIPCPath, 'utf8');

    expect(source).toContain(
      'const applyConfigSnapshot = (config: AppConfig, isConfigured: boolean) => {'
    );
    expect(source).toContain('store.setSettings({');
    expect(source).toContain("theme: config.theme || 'light'");
    expect(source).not.toContain('themePreset');
    expect(source).toContain('window.electronAPI.config.get()');
    expect(source).toContain('window.electronAPI.getSystemTheme()');
  });

  it('sends user-initiated settings updates back to the main process', () => {
    const source = fs.readFileSync(storePath, 'utf8');

    expect(source).toContain("type: 'settings.update'");
    expect(source).toContain('setSettings: (updates) =>');
    expect(source).toContain('updateSettings: (updates) =>');
  });
});
