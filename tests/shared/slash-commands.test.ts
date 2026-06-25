import { describe, expect, it } from 'vitest';

import {
  BUILTIN_SLASH_COMMAND_DEFINITIONS,
  filterSlashCommands,
  getSlashCommandQuery,
  hasExactSlashCommandQuery,
  isCompactSlashCommand,
  isHandoffSlashCommand,
  isPluginSlashCommand,
  normalizePluginSlashPromptForExpansion,
  parseSlashCommand,
  SLASH_COMMAND_DEFINITIONS,
} from '../../src/shared/slash-commands';
import type { PluginSlashCommandInfo } from '../../src/shared/plugin-slash-commands';

const PLUGIN_COMMANDS: PluginSlashCommandInfo[] = [
  {
    pluginId: 'demo',
    pluginName: 'Demo Plugin',
    name: 'deploy',
    command: '/deploy',
    description: 'Deploy the app',
  },
];

const NAMESPACED_PLUGIN_COMMANDS: PluginSlashCommandInfo[] = [
  {
    pluginId: 'demo',
    pluginName: 'Demo Plugin',
    name: 'deploy',
    command: '/demo:deploy',
    description: 'Deploy the app',
  },
];

describe('slash command suggestions', () => {
  it('returns null when not in slash command context', () => {
    expect(getSlashCommandQuery('hello')).toBeNull();
    expect(getSlashCommandQuery('/compact done')).toBeNull();
    expect(getSlashCommandQuery('/handoff focus on tests')).toBeNull();
  });

  it('returns the typed command prefix', () => {
    expect(getSlashCommandQuery('/')).toBe('');
    expect(getSlashCommandQuery('/com')).toBe('com');
    expect(getSlashCommandQuery('/COMPACT')).toBe('compact');
  });

  it('filters command definitions by prefix', () => {
    expect(filterSlashCommands('')).toEqual([...BUILTIN_SLASH_COMMAND_DEFINITIONS]);
    expect(filterSlashCommands('com').map((item) => item.id)).toEqual(['compact']);
    expect(filterSlashCommands('hand').map((item) => item.id)).toEqual(['handoff']);
    expect(filterSlashCommands('handsof').map((item) => item.id)).toEqual(['handoff']);
    expect(filterSlashCommands('xyz')).toEqual([]);
  });

  it('includes plugin commands in suggestions', () => {
    expect(filterSlashCommands('dep', PLUGIN_COMMANDS).map((item) => item.command)).toEqual([
      '/deploy',
    ]);
    expect(hasExactSlashCommandQuery('deploy', PLUGIN_COMMANDS)).toBe(true);
  });

  it('detects exact command queries including aliases', () => {
    expect(hasExactSlashCommandQuery('compact')).toBe(true);
    expect(hasExactSlashCommandQuery('handoff')).toBe(true);
    expect(hasExactSlashCommandQuery('handsoff')).toBe(true);
    expect(hasExactSlashCommandQuery('com')).toBe(false);
  });
});

describe('parseSlashCommand', () => {
  it('detects bare /compact', () => {
    expect(parseSlashCommand('/compact')).toEqual({ kind: 'compact', instructions: undefined });
  });

  it('detects /compact with custom instructions', () => {
    expect(parseSlashCommand('/compact focus on API changes')).toEqual({
      kind: 'compact',
      instructions: 'focus on API changes',
    });
  });

  it('detects bare /handoff', () => {
    expect(parseSlashCommand('/handoff')).toEqual({ kind: 'handoff', instructions: undefined });
  });

  it('accepts the common /handsoff typo as handoff', () => {
    expect(parseSlashCommand('/handsoff')).toEqual({ kind: 'handoff', instructions: undefined });
    expect(parseSlashCommand('/handsoff focus on tests')).toEqual({
      kind: 'handoff',
      instructions: 'focus on tests',
    });
  });

  it('detects /handoff with custom instructions', () => {
    expect(parseSlashCommand('/handoff focus on tests')).toEqual({
      kind: 'handoff',
      instructions: 'focus on tests',
    });
  });

  it('is case-insensitive', () => {
    expect(parseSlashCommand('/COMPACT keep tool calls')).toEqual({
      kind: 'compact',
      instructions: 'keep tool calls',
    });
    expect(parseSlashCommand('/HANDOFF keep decisions')).toEqual({
      kind: 'handoff',
      instructions: 'keep decisions',
    });
  });

  it('returns message for normal text', () => {
    expect(parseSlashCommand('hello /compact world')).toEqual({ kind: 'message' });
    expect(parseSlashCommand('please compact this')).toEqual({ kind: 'message' });
    expect(parseSlashCommand('hello /handoff world')).toEqual({ kind: 'message' });
  });

  it('exposes compact predicate', () => {
    expect(isCompactSlashCommand('/compact')).toBe(true);
    expect(isCompactSlashCommand('not a command')).toBe(false);
  });

  it('exposes handoff predicate', () => {
    expect(isHandoffSlashCommand('/handoff')).toBe(true);
    expect(isHandoffSlashCommand('not a command')).toBe(false);
  });

  it('detects plugin slash commands', () => {
    expect(parseSlashCommand('/deploy staging', PLUGIN_COMMANDS)).toEqual({
      kind: 'plugin',
      command: '/deploy',
      name: 'deploy',
      instructions: 'staging',
    });
    expect(isPluginSlashCommand('/deploy', PLUGIN_COMMANDS)).toBe(true);
    expect(parseSlashCommand('/unknown', PLUGIN_COMMANDS)).toEqual({
      kind: 'unknown',
      token: 'unknown',
    });
  });

  it('detects namespaced plugin slash commands', () => {
    expect(parseSlashCommand('/demo:deploy staging', NAMESPACED_PLUGIN_COMMANDS)).toEqual({
      kind: 'plugin',
      command: '/demo:deploy',
      name: 'deploy',
      instructions: 'staging',
    });
  });
});

describe('normalizePluginSlashPromptForExpansion', () => {
  it('rewrites namespaced plugin commands to template names', () => {
    expect(
      normalizePluginSlashPromptForExpansion('/demo:deploy staging', NAMESPACED_PLUGIN_COMMANDS)
    ).toBe('/deploy staging');
  });

  it('leaves short plugin commands unchanged', () => {
    expect(normalizePluginSlashPromptForExpansion('/deploy staging', PLUGIN_COMMANDS)).toBe(
      '/deploy staging'
    );
  });

  it('leaves normal messages unchanged', () => {
    expect(normalizePluginSlashPromptForExpansion('hello world', PLUGIN_COMMANDS)).toBe(
      'hello world'
    );
  });
});
