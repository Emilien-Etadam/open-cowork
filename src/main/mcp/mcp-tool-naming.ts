import { createHash } from 'crypto';

export const MAX_MODEL_TOOL_NAME_LENGTH = 64;
export const MCP_TOOL_NAME_HASH_LENGTH = 8;

export function sanitizeMcpToolSegment(segment: string, fallback: string): string {
  const sanitized = segment
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  return sanitized || fallback;
}

export function truncateMcpToolName(baseName: string, maxLength: number): string {
  if (baseName.length <= maxLength) {
    return baseName;
  }

  if (maxLength <= 0) {
    return '';
  }

  if (maxLength <= MCP_TOOL_NAME_HASH_LENGTH) {
    return createHash('sha256').update(baseName).digest('hex').slice(0, maxLength);
  }

  const hashLength = Math.min(MCP_TOOL_NAME_HASH_LENGTH, maxLength - 2);
  const hash = createHash('sha256').update(baseName).digest('hex').slice(0, hashLength);
  const prefixLength = Math.max(1, maxLength - hash.length - 1);

  return `${baseName.slice(0, prefixLength)}_${hash}`;
}

export function formatMcpToolName(baseName: string, suffix: string | null): string {
  const suffixPart = suffix === null ? '' : `_${suffix}`;
  const availableBaseLength = MAX_MODEL_TOOL_NAME_LENGTH - suffixPart.length;

  if (availableBaseLength <= 0) {
    return truncateMcpToolName(
      `tool_${createHash('sha256').update(`${baseName}${suffixPart}`).digest('hex')}`,
      MAX_MODEL_TOOL_NAME_LENGTH
    );
  }

  const truncatedBase = truncateMcpToolName(baseName, availableBaseLength);

  return `${truncatedBase}${suffixPart}`;
}

export function createUniqueMcpToolName(baseName: string, usedNames: Set<string>): string {
  const firstCandidate = formatMcpToolName(baseName, null);
  if (!usedNames.has(firstCandidate)) {
    usedNames.add(firstCandidate);
    return firstCandidate;
  }

  let suffix = 2;
  let candidate = formatMcpToolName(baseName, String(suffix));
  while (usedNames.has(candidate)) {
    suffix += 1;
    candidate = formatMcpToolName(baseName, String(suffix));
  }

  usedNames.add(candidate);
  return candidate;
}
