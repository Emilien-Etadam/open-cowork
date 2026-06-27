import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const stylesPath = path.resolve(process.cwd(), 'src/renderer/styles/globals.css');
const appPath = path.resolve(process.cwd(), 'src/renderer/App.tsx');
const highlightHookPath = path.resolve(process.cwd(), 'src/renderer/hooks/useHighlightTheme.ts');

describe('VS Code theme', () => {
  it('defines VS Code palette blocks in globals.css', () => {
    const source = fs.readFileSync(stylesPath, 'utf8');

    expect(source).toContain('--color-background: #1e1e1e;');
    expect(source).toContain('--color-accent: #007acc;');
    expect(source).toContain('--color-text-primary: #cccccc;');
    expect(source).not.toContain("data-preset='vscode'");
    expect(source).not.toContain('--color-background: #171614;');
  });

  it('uses VS Code fonts and flat controls globally', () => {
    const source = fs.readFileSync(stylesPath, 'utf8');

    expect(source).toContain("font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;");
    expect(source).toContain('Consolas,');
    expect(source).toContain('@apply inline-flex items-center justify-center gap-2 px-4 py-2 rounded');
  });

  it('applies light/dark class on the document root and loads hljs by theme', () => {
    const appSource = fs.readFileSync(appPath, 'utf8');
    const hookSource = fs.readFileSync(highlightHookPath, 'utf8');

    expect(appSource).toContain("document.documentElement.classList.add('light')");
    expect(appSource).toContain('useHighlightTheme(effectiveTheme)');
    expect(appSource).not.toContain('dataset.preset');
    expect(hookSource).toContain("import('highlight.js/styles/vs2015.min.css?url')");
  });
});
