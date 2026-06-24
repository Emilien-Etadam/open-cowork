export type SlashCommandId = 'compact' | 'handoff';

export type ParsedSlashCommand =
  | { kind: 'compact'; instructions?: string }
  | { kind: 'handoff'; instructions?: string }
  | { kind: 'message' };

export interface SlashCommandDefinition {
  id: SlashCommandId;
  command: `/${SlashCommandId}`;
  aliases?: readonly string[];
  descriptionKey: `chat.slashCommands.${SlashCommandId}.description`;
}

export const SLASH_COMMAND_DEFINITIONS: readonly SlashCommandDefinition[] = [
  {
    id: 'compact',
    command: '/compact',
    descriptionKey: 'chat.slashCommands.compact.description',
  },
  {
    id: 'handoff',
    command: '/handoff',
    aliases: ['handsoff'],
    descriptionKey: 'chat.slashCommands.handoff.description',
  },
] as const;

const COMPACT_COMMAND_RE = /^\/compact(?:\s+([\s\S]*))?$/i;
const HANDOFF_COMMAND_RE = /^\/handoff(?:\s+([\s\S]*))?$/i;
const HANDSOFF_COMMAND_RE = /^\/handsoff(?:\s+([\s\S]*))?$/i;

function getSlashCommandNames(definition: SlashCommandDefinition): string[] {
  return [definition.command.slice(1), ...(definition.aliases ?? [])];
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

export function filterSlashCommands(query: string): SlashCommandDefinition[] {
  if (!query) {
    return [...SLASH_COMMAND_DEFINITIONS];
  }

  return SLASH_COMMAND_DEFINITIONS.filter((definition) =>
    getSlashCommandNames(definition).some((name) => name.toLowerCase().startsWith(query))
  );
}

export function hasExactSlashCommandQuery(query: string): boolean {
  return SLASH_COMMAND_DEFINITIONS.some((definition) =>
    getSlashCommandNames(definition).some((name) => name.toLowerCase() === query)
  );
}

export function parseSlashCommand(input: string): ParsedSlashCommand {
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

  return { kind: 'message' };
}

export function isCompactSlashCommand(input: string): boolean {
  return parseSlashCommand(input).kind === 'compact';
}

export function isHandoffSlashCommand(input: string): boolean {
  return parseSlashCommand(input).kind === 'handoff';
}
