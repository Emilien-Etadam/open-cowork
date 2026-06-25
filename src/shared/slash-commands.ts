import type { PluginSlashCommandInfo } from './plugin-slash-commands';

export type BuiltinSlashCommandId = 'compact' | 'handoff';

export type ParsedSlashCommand =
  | { kind: 'compact'; instructions?: string }
  | { kind: 'handoff'; instructions?: string }
  | { kind: 'plugin'; command: string; instructions?: string }
  | { kind: 'message' };

export interface BuiltinSlashCommandDefinition {
  kind: 'builtin';
  id: BuiltinSlashCommandId;
  command: `/${BuiltinSlashCommandId}`;
  aliases?: readonly string[];
  descriptionKey: `chat.slashCommands.${BuiltinSlashCommandId}.description`;
}

export interface PluginSlashCommandDefinition {
  kind: 'plugin';
  id: string;
  command: string;
  name: string;
  description: string;
  pluginId: string;
  pluginName: string;
}

export type SlashCommandDefinition = BuiltinSlashCommandDefinition | PluginSlashCommandDefinition;

export const BUILTIN_SLASH_COMMAND_DEFINITIONS: readonly BuiltinSlashCommandDefinition[] = [
  {
    kind: 'builtin',
    id: 'compact',
    command: '/compact',
    descriptionKey: 'chat.slashCommands.compact.description',
  },
  {
    kind: 'builtin',
    id: 'handoff',
    command: '/handoff',
    aliases: ['handsoff'],
    descriptionKey: 'chat.slashCommands.handoff.description',
  },
] as const;

/** @deprecated Use BUILTIN_SLASH_COMMAND_DEFINITIONS */
export const SLASH_COMMAND_DEFINITIONS = BUILTIN_SLASH_COMMAND_DEFINITIONS;

const COMPACT_COMMAND_RE = /^\/compact(?:\s+([\s\S]*))?$/i;
const HANDOFF_COMMAND_RE = /^\/handoff(?:\s+([\s\S]*))?$/i;
const HANDSOFF_COMMAND_RE = /^\/handsoff(?:\s+([\s\S]*))?$/i;

function getBuiltinCommandNames(definition: BuiltinSlashCommandDefinition): string[] {
  return [definition.command.slice(1), ...(definition.aliases ?? [])];
}

function getPluginCommandNames(definition: PluginSlashCommandDefinition): string[] {
  return [definition.command.slice(1)];
}

export function pluginSlashCommandInfoToDefinition(
  info: PluginSlashCommandInfo
): PluginSlashCommandDefinition {
  return {
    kind: 'plugin',
    id: `${info.pluginId}:${info.name}`,
    command: info.command,
    name: info.name,
    description: info.description,
    pluginId: info.pluginId,
    pluginName: info.pluginName,
  };
}

export function buildPluginSlashCommandDefinitions(
  pluginCommands: readonly PluginSlashCommandInfo[]
): PluginSlashCommandDefinition[] {
  return pluginCommands.map(pluginSlashCommandInfoToDefinition);
}

export function mergeSlashCommands(
  pluginCommands: readonly PluginSlashCommandInfo[] = []
): SlashCommandDefinition[] {
  return [
    ...BUILTIN_SLASH_COMMAND_DEFINITIONS,
    ...buildPluginSlashCommandDefinitions(pluginCommands),
  ];
}

export function getSlashCommandQuery(input: string): string | null {
  if (!input.startsWith('/')) {
    return null;
  }

  const firstLine = input.split('\n')[0] ?? '';
  if (firstLine.includes(' ')) {
    return null;
  }

  return firstLine.slice(1).toLowerCase();
}

export function filterSlashCommands(
  query: string,
  pluginCommands: readonly PluginSlashCommandInfo[] = []
): SlashCommandDefinition[] {
  const definitions = mergeSlashCommands(pluginCommands);
  if (!query) {
    return [...definitions];
  }

  return definitions.filter((definition) => {
    const names =
      definition.kind === 'builtin'
        ? getBuiltinCommandNames(definition)
        : getPluginCommandNames(definition);
    return names.some((name) => name.toLowerCase().startsWith(query));
  });
}

export function hasExactSlashCommandQuery(
  query: string,
  pluginCommands: readonly PluginSlashCommandInfo[] = []
): boolean {
  const definitions = mergeSlashCommands(pluginCommands);
  return definitions.some((definition) => {
    const names =
      definition.kind === 'builtin'
        ? getBuiltinCommandNames(definition)
        : getPluginCommandNames(definition);
    return names.some((name) => name.toLowerCase() === query);
  });
}

function matchPluginSlashCommand(
  trimmed: string,
  pluginCommands: readonly PluginSlashCommandInfo[]
): ParsedSlashCommand | null {
  const definitions = buildPluginSlashCommandDefinitions(pluginCommands);
  const sorted = [...definitions].sort((a, b) => b.command.length - a.command.length);

  for (const definition of sorted) {
    const escaped = definition.command.slice(1).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = trimmed.match(
      new RegExp(`^${definition.command[0]}${escaped}(?:\\s+([\\s\\S]*))?$`, 'i')
    );
    if (match) {
      const instructions = match[1]?.trim();
      return {
        kind: 'plugin',
        command: definition.command,
        instructions: instructions || undefined,
      };
    }
  }

  return null;
}

export function parseSlashCommand(
  input: string,
  pluginCommands: readonly PluginSlashCommandInfo[] = []
): ParsedSlashCommand {
  const trimmed = input.trim();
  if (!trimmed.startsWith('/')) {
    return { kind: 'message' };
  }

  const compactMatch = trimmed.match(COMPACT_COMMAND_RE);
  if (compactMatch) {
    const instructions = compactMatch[1]?.trim();
    return { kind: 'compact', instructions: instructions || undefined };
  }

  const handoffMatch = trimmed.match(HANDOFF_COMMAND_RE);
  if (handoffMatch) {
    const instructions = handoffMatch[1]?.trim();
    return { kind: 'handoff', instructions: instructions || undefined };
  }

  const handsoffMatch = trimmed.match(HANDSOFF_COMMAND_RE);
  if (handsoffMatch) {
    const instructions = handsoffMatch[1]?.trim();
    return { kind: 'handoff', instructions: instructions || undefined };
  }

  const pluginMatch = matchPluginSlashCommand(trimmed, pluginCommands);
  if (pluginMatch) {
    return pluginMatch;
  }

  return { kind: 'message' };
}

export function isCompactSlashCommand(
  input: string,
  pluginCommands: readonly PluginSlashCommandInfo[] = []
): boolean {
  return parseSlashCommand(input, pluginCommands).kind === 'compact';
}

export function isHandoffSlashCommand(
  input: string,
  pluginCommands: readonly PluginSlashCommandInfo[] = []
): boolean {
  return parseSlashCommand(input, pluginCommands).kind === 'handoff';
}

export function isPluginSlashCommand(
  input: string,
  pluginCommands: readonly PluginSlashCommandInfo[] = []
): boolean {
  return parseSlashCommand(input, pluginCommands).kind === 'plugin';
}
