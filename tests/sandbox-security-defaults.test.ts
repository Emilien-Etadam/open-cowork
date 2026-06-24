import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const adapterPath = path.resolve('src/main/sandbox/sandbox-adapter.ts');
const adapterSource = fs.readFileSync(adapterPath, 'utf8');
const configSchemaPath = path.resolve('src/main/config/config-schema.ts');
const configSchemaSource = fs.readFileSync(configSchemaPath, 'utf8');

describe('sandbox security defaults', () => {
  it('defaults sandbox to enabled on Windows', () => {
    expect(configSchemaSource).toContain('getDefaultSandboxEnabled');
    expect(configSchemaSource).toContain("process.platform === 'win32'");
  });

  it('blocks instead of falling back to native when WSL is unavailable', () => {
    expect(adapterSource).toContain("'blocked'");
    expect(adapterSource).toContain('initializeBlocked');
    expect(adapterSource).toContain('Agent execution is blocked while sandbox mode is enabled');
  });
});
