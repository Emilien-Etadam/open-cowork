import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  discoverPluginPromptTemplatePaths,
  discoverPluginSlashCommands,
  resolvePluginSlashCommands,
} from '../src/main/skills/plugin-command-catalog';

function writeCommandFile(commandsDir: string, name: string, content: string): void {
  fs.mkdirSync(commandsDir, { recursive: true });
  fs.writeFileSync(path.join(commandsDir, `${name}.md`), content, 'utf8');
}

describe('plugin command catalog', () => {
  it('discovers command metadata from markdown files', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-cmd-'));
    const commandsDir = path.join(root, 'commands');
    writeCommandFile(commandsDir, 'deploy', '---\ndescription: Deploy the app\n---\n# Deploy\n');

    const commands = discoverPluginSlashCommands(root, 'demo', 'Demo Plugin', null);
    expect(commands).toEqual([
      {
        pluginId: 'demo',
        pluginName: 'Demo Plugin',
        name: 'deploy',
        command: '/deploy',
        description: 'Deploy the app',
      },
    ]);
    expect(discoverPluginPromptTemplatePaths(root, null)).toEqual([commandsDir]);
  });

  it('prefixes colliding command names with plugin id', () => {
    const sources = [
      {
        pluginId: 'alpha',
        pluginName: 'Alpha',
        filePath: '/tmp/alpha/commands/do.md',
        name: 'do',
        description: 'Alpha do',
      },
      {
        pluginId: 'beta',
        pluginName: 'Beta',
        filePath: '/tmp/beta/commands/do.md',
        name: 'do',
        description: 'Beta do',
      },
    ];

    expect(resolvePluginSlashCommands(sources)).toEqual([
      {
        pluginId: 'alpha',
        pluginName: 'Alpha',
        name: 'do',
        command: '/alpha:do',
        description: 'Alpha do',
      },
      {
        pluginId: 'beta',
        pluginName: 'Beta',
        name: 'do',
        command: '/beta:do',
        description: 'Beta do',
      },
    ]);
  });
});
