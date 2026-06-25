import type { Message } from '../types';

export interface ContextUsageSnapshot {
  inputTokens: number;
  reservedOutput: number;
  used: number;
  total: number;
  percentage: number;
  remaining: number;
}

export function computeContextUsage(
  messages: readonly Message[],
  contextWindow?: number,
  maxTokens = 0
): ContextUsageSnapshot | null {
  if (!contextWindow || contextWindow <= 0) {
    return null;
  }

  let lastInput = 0;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const input = messages[index].tokenUsage?.input;
    if (input) {
      lastInput = input;
      break;
    }
  }

  const effectiveUsed = lastInput + maxTokens;
  const percentage = Math.min((effectiveUsed / contextWindow) * 100, 100);
  const remaining = Math.max(0, contextWindow - effectiveUsed);

  return {
    inputTokens: lastInput,
    reservedOutput: maxTokens,
    used: effectiveUsed,
    total: contextWindow,
    percentage,
    remaining,
  };
}

export function formatTokenCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(value);
}
