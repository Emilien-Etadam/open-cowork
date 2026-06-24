export type ParsedSlashCommand =
  | { kind: 'compact'; instructions?: string }
  | { kind: 'handoff'; instructions?: string }
  | { kind: 'message' };

const COMPACT_COMMAND_RE = /^\/compact(?:\s+([\s\S]*))?$/i;
const HANDOFF_COMMAND_RE = /^\/handoff(?:\s+([\s\S]*))?$/i;

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

  return { kind: 'message' };
}

export function isCompactSlashCommand(input: string): boolean {
  return parseSlashCommand(input).kind === 'compact';
}

export function isHandoffSlashCommand(input: string): boolean {
  return parseSlashCommand(input).kind === 'handoff';
}
