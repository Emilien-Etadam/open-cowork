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

describe('python-runtime', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('detects legacy bundled runtime under resourcesPath', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'python-runtime-legacy-'));
    const legacyRoot = path.join(tmp, 'python');
    fs.mkdirSync(path.join(legacyRoot, 'bin'), { recursive: true });
    fs.writeFileSync(path.join(legacyRoot, 'bin', 'python3'), '');
    fs.mkdirSync(path.join(legacyRoot, 'site-packages', 'PIL'), { recursive: true });
    fs.mkdirSync(path.join(legacyRoot, 'site-packages', 'Quartz'), { recursive: true });

    const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
    Object.defineProperty(process, 'platform', {
      value: 'darwin',
      configurable: true,
    });

    const originalResourcesPath = (process as NodeJS.Process & { resourcesPath?: string })
      .resourcesPath;
    Object.defineProperty(process, 'resourcesPath', {
      value: tmp,
      configurable: true,
    });

    const { getBundledPythonPaths, clearPythonRuntimeCache } =
      await import('../../main/runtime/python-runtime');
    clearPythonRuntimeCache();
    const paths = getBundledPythonPaths();
    expect(paths?.python).toBe(path.join(legacyRoot, 'bin', 'python3'));
    expect(paths?.pythonRoot).toBe(legacyRoot);

    Object.defineProperty(process, 'resourcesPath', {
      value: originalResourcesPath,
      configurable: true,
    });
    if (originalPlatform) {
      Object.defineProperty(process, 'platform', originalPlatform);
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('reports not ready when no runtime is present', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'python-runtime-empty-'));
    Object.defineProperty(process, 'resourcesPath', {
      value: tmp,
      configurable: true,
    });

    const { isPythonRuntimeReady, clearPythonRuntimeCache } =
      await import('../../main/runtime/python-runtime');
    clearPythonRuntimeCache();
    expect(isPythonRuntimeReady()).toBe(false);

    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
