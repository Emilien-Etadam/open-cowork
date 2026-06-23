export type ParsedSlashCommand = { kind: 'compact'; instructions?: string } | { kind: 'message' };

const COMPACT_COMMAND_RE = /^\/compact(?:\s+([\s\S]*))?$/i;

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

  return { kind: 'message' };
}

export function isCompactSlashCommand(input: string): boolean {
  return parseSlashCommand(input).kind === 'compact';
}
