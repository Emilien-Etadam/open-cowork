import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const chatViewPath = path.resolve(process.cwd(), 'src/renderer/components/ChatView.tsx');
const chatViewContent = readFileSync(chatViewPath, 'utf8');

describe('ChatView slash command autocomplete', () => {
  it('renders a slash command menu while typing a command', () => {
    expect(chatViewContent).toContain('SlashCommandMenu');
    expect(chatViewContent).toContain('getSlashCommandQuery(prompt)');
    expect(chatViewContent).toContain('filterSlashCommands(slashQuery, pluginSlashCommands)');
    expect(chatViewContent).toContain('plugins.listCommands');
  });

  it('supports keyboard navigation for slash command suggestions', () => {
    expect(chatViewContent).toContain("e.key === 'ArrowDown'");
    expect(chatViewContent).toContain("e.key === 'ArrowUp'");
    expect(chatViewContent).toContain("e.key === 'Escape'");
    expect(chatViewContent).toContain('hasExactSlashCommandQuery(slashQuery, pluginSlashCommands)');
  });
});
