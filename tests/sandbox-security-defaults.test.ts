import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const adapterPath = path.resolve('src/main/sandbox/sandbox-adapter.ts');
const adapterSource = fs.readFileSync(adapterPath, 'utf8');
const configStorePath = path.resolve('src/main/config/config-store.ts');
const configStoreSource = fs.readFileSync(configStorePath, 'utf8');

describe('sandbox security defaults', () => {
  it('defaults sandbox to enabled on Windows', () => {
    expect(configStoreSource).toContain('getDefaultSandboxEnabled');
    expect(configStoreSource).toContain("process.platform === 'win32'");
  });

  it('blocks instead of falling back to native when WSL is unavailable', () => {
    expect(adapterSource).toContain("'blocked'");
    expect(adapterSource).toContain('initializeBlocked');
    expect(adapterSource).toContain('Agent execution is blocked while sandbox mode is enabled');
  });
});
