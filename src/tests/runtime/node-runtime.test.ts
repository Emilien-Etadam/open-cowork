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

describe('node-runtime', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('detects legacy bundled runtime under resourcesPath', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'node-runtime-legacy-'));
    const legacyRoot = path.join(tmp, 'node');
    fs.mkdirSync(path.join(legacyRoot, 'bin'), { recursive: true });
    fs.writeFileSync(path.join(legacyRoot, 'bin', 'node'), '');
    fs.writeFileSync(path.join(legacyRoot, 'bin', 'npx'), '');

    const originalResourcesPath = (process as NodeJS.Process & { resourcesPath?: string })
      .resourcesPath;
    Object.defineProperty(process, 'resourcesPath', {
      value: tmp,
      configurable: true,
    });

    const { getBundledNodePaths, clearNodeRuntimeCache } = await import(
      '../../main/runtime/node-runtime'
    );
    clearNodeRuntimeCache();
    const paths = getBundledNodePaths();
    expect(paths?.node).toBe(path.join(legacyRoot, 'bin', 'node'));
    expect(paths?.npx).toBe(path.join(legacyRoot, 'bin', 'npx'));

    Object.defineProperty(process, 'resourcesPath', {
      value: originalResourcesPath,
      configurable: true,
    });
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('reports not ready when no runtime is present', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'node-runtime-empty-'));
    Object.defineProperty(process, 'resourcesPath', {
      value: tmp,
      configurable: true,
    });

    const { isNodeRuntimeReady, clearNodeRuntimeCache } = await import(
      '../../main/runtime/node-runtime'
    );
    clearNodeRuntimeCache();
    expect(isNodeRuntimeReady()).toBe(false);

    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
