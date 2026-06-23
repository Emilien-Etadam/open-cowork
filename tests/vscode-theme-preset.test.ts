import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const stylesPath = path.resolve(process.cwd(), 'src/renderer/styles/globals.css');
const typesPath = path.resolve(process.cwd(), 'src/renderer/types/index.ts');
const configStorePath = path.resolve(process.cwd(), 'src/main/config/config-store.ts');
const appPath = path.resolve(process.cwd(), 'src/renderer/App.tsx');
const highlightHookPath = path.resolve(process.cwd(), 'src/renderer/hooks/useHighlightTheme.ts');

describe('vscode theme preset', () => {
  it('defines VS Code palette blocks in globals.css', () => {
    const source = fs.readFileSync(stylesPath, 'utf8');

    expect(source).toContain(":root[data-preset='vscode']");
    expect(source).toContain(":root[data-preset='vscode'].light");
    expect(source).toContain('--color-background: #1e1e1e;');
    expect(source).toContain('--color-accent: #007acc;');
    expect(source).toContain('--color-text-primary: #cccccc;');
  });

  it('scopes VS Code fonts and flat controls to the vscode preset', () => {
    const source = fs.readFileSync(stylesPath, 'utf8');

    expect(source).toContain("[data-preset='vscode'] body");
    expect(source).toContain('Segoe UI');
    expect(source).toContain("[data-preset='vscode'] .btn");
    expect(source).toContain('border-radius: 3px;');
  });

  it('exposes themePreset in shared types and config store', () => {
    const typesSource = fs.readFileSync(typesPath, 'utf8');
    const configSource = fs.readFileSync(configStorePath, 'utf8');

    expect(typesSource).toContain("export type ThemePreset = 'default' | 'vscode';");
    expect(typesSource).toContain('themePreset: ThemePreset;');
    expect(configSource).toContain("themePreset: 'default'");
    expect(configSource).toContain('isThemePreset');
  });

  it('applies data-preset on the document root and loads hljs by preset', () => {
    const appSource = fs.readFileSync(appPath, 'utf8');
    const hookSource = fs.readFileSync(highlightHookPath, 'utf8');

    expect(appSource).toContain('document.documentElement.dataset.preset');
    expect(appSource).toContain('useHighlightTheme');
    expect(hookSource).toContain("'vscode-dark'");
    expect(hookSource).toContain('vs2015.min.css?url');
  });
});
