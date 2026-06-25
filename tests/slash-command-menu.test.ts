import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const menuPath = path.resolve(process.cwd(), 'src/renderer/components/SlashCommandMenu.tsx');
const menuContent = readFileSync(menuPath, 'utf8');

describe('SlashCommandMenu', () => {
  it('uses an opaque surface background so chat history does not bleed through', () => {
    expect(menuContent).toContain('bg-surface shadow-elevated');
    expect(menuContent).not.toContain('bg-surface/95');
    expect(menuContent).not.toContain('backdrop-blur');
  });
});
