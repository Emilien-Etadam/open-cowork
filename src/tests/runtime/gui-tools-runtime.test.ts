import { describe, expect, it, vi, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

vi.mock('electron', () => ({
  app: {
    isPackaged: true,
    getAppPath: () => '/tmp/lygodactylus-app',
    getPath: (name: string) => {
      if (name === 'userData') {
        return '/tmp/lygodactylus-userdata';
      }
      return `/tmp/lygodactylus-${name}`;
    },
  },
}));

describe('gui-tools-runtime', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('detects legacy bundled cliclick under resourcesPath', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gui-tools-legacy-'));
    const legacyPath = path.join(tmp, 'tools', 'darwin-arm64', 'bin', 'cliclick');
    fs.mkdirSync(path.dirname(legacyPath), { recursive: true });
    fs.writeFileSync(legacyPath, '');

    const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
    const originalArch = Object.getOwnPropertyDescriptor(process, 'arch');
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
    Object.defineProperty(process, 'arch', { value: 'arm64', configurable: true });

    const originalResourcesPath = (process as NodeJS.Process & { resourcesPath?: string })
      .resourcesPath;
    Object.defineProperty(process, 'resourcesPath', {
      value: tmp,
      configurable: true,
    });

    const { getBundledCliclickPath, clearGuiToolsRuntimeCache } =
      await import('../../main/runtime/gui-tools-runtime');
    clearGuiToolsRuntimeCache();
    expect(getBundledCliclickPath()).toBe(legacyPath);

    Object.defineProperty(process, 'resourcesPath', {
      value: originalResourcesPath,
      configurable: true,
    });
    if (originalPlatform) Object.defineProperty(process, 'platform', originalPlatform);
    if (originalArch) Object.defineProperty(process, 'arch', originalArch);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('reports not ready when no cliclick is present', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gui-tools-empty-'));
    Object.defineProperty(process, 'resourcesPath', {
      value: tmp,
      configurable: true,
    });

    const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });

    const { isCliclickRuntimeReady, clearGuiToolsRuntimeCache } =
      await import('../../main/runtime/gui-tools-runtime');
    clearGuiToolsRuntimeCache();
    expect(isCliclickRuntimeReady()).toBe(false);

    if (originalPlatform) Object.defineProperty(process, 'platform', originalPlatform);
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
