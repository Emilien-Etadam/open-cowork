import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

describe('sync-windows-latest-yml.mjs', () => {
  it('rewrites path/url to match the installer exe name', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'latest-yml-'));
    const ymlPath = path.join(dir, 'latest.yml');
    fs.writeFileSync(
      ymlPath,
      `version: 3.3.1-EE4.94
files:
  - url: Open-Cowork-3.3.1-EE4.94-win-x64.exe
path: Open-Cowork-3.3.1-EE4.94-win-x64.exe
`
    );
    fs.writeFileSync(path.join(dir, 'Open.Cowork-3.3.1-EE4.94-win-x64.exe'), '');

    execFileSync('node', ['scripts/sync-windows-latest-yml.mjs', dir], { cwd: process.cwd() });

    const updated = fs.readFileSync(ymlPath, 'utf8');
    expect(updated).toContain('path: Open.Cowork-3.3.1-EE4.94-win-x64.exe');
    expect(updated).toContain('- url: Open.Cowork-3.3.1-EE4.94-win-x64.exe');
  });
});
