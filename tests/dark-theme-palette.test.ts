import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const stylesPath = path.resolve(process.cwd(), 'src/renderer/styles/globals.css');

describe('VS Code theme palette', () => {
  it('uses VS Code Dark+ colors as the default dark palette', () => {
    const source = fs.readFileSync(stylesPath, 'utf8');
    expect(source).toContain('--color-background: #1e1e1e;');
    expect(source).toContain('--color-surface: #252526;');
    expect(source).toContain('--color-text-primary: #cccccc;');
  });

  it('uses VS Code Light+ accent and keeps the blue family', () => {
    const source = fs.readFileSync(stylesPath, 'utf8');
    expect(source).toContain('--color-accent: #007acc;');
    expect(source).toContain('--color-accent-hover: #0062a3;');
  });
});
