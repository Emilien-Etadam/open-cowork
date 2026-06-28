import type { Message } from '../../renderer/types';
import { mt } from '../i18n';

/** Extra headroom so compaction triggers before the API rejects by 1 token. */
export const CONTEXT_SAFETY_MARGIN = 4096;

/** Default estimate when memory prefix size is unknown at session creation. */
export const DEFAULT_MEMORY_PREFIX_ESTIMATE = 2048;

export function getLastInputTokenCount(messages: Message[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    const input = messages[i].tokenUsage?.input;
    if (input && input > 0) {
      return input;
    }
  }
  return 0;
}

export function estimateTokensFromText(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

export function computeCompactionReserveTokens(
  maxTokens: number,
  memoryPrefixTokenEstimate = DEFAULT_MEMORY_PREFIX_ESTIMATE
): number {
  return maxTokens + memoryPrefixTokenEstimate + CONTEXT_SAFETY_MARGIN;
}

export function computeEffectiveContextUsage(
  inputTokens: number,
  maxTokens: number,
  contextWindow: number
): {
  inputTokens: number;
  reservedOutput: number;
  used: number;
  total: number;
  percentage: number;
  remaining: number;
} {
  const reservedOutput = maxTokens;
  const used = inputTokens + reservedOutput;
  const total = contextWindow;
  const percentage = total > 0 ? Math.min((used / total) * 100, 100) : 0;
  const remaining = Math.max(0, total - used);
  return { inputTokens, reservedOutput, used, total, percentage, remaining };
}

export function isContextOverflowError(errorText: string): boolean {
  const lower = errorText.toLowerCase();
  return (
    lower.includes('maximum context length') ||
    lower.includes('context length is') ||
    lower.includes('context length exceeded') ||
    lower.includes('context_length_exceeded') ||
    lower.includes('input_tokens') ||
    lower.includes('reduce the length of the input prompt') ||
    lower.includes('too many tokens') ||
    lower.includes('max context') ||
    lower.includes('context overflow') ||
    lower.includes('conversation context is full') ||
    lower.includes('contexte de la conversation est plein')
  );
}

export function shouldBlockForContextOverflow(
  currentInputTokens: number,
  additionalInputTokens: number,
  maxTokens: number,
  contextWindow: number,
  safetyMargin = CONTEXT_SAFETY_MARGIN
): boolean {
  return currentInputTokens + additionalInputTokens + maxTokens + safetyMargin > contextWindow;
}

export function computeMemoryPrefixBudget(
  contextWindow: number,
  currentInputTokens: number,
  maxTokens: number,
  safetyMargin = CONTEXT_SAFETY_MARGIN
): number {
  return Math.max(0, contextWindow - currentInputTokens - maxTokens - safetyMargin);
}

export interface CompactionSettings {
  enabled: boolean;
  reserveTokens?: number;
  keepRecentTokens?: number;
}

export function buildCompactionSettings(
  provider: string,
  contextWindow: number,
  maxTokens: number,
  memoryPrefixTokenEstimate = DEFAULT_MEMORY_PREFIX_ESTIMATE
): CompactionSettings {
  if (provider === 'ollama' && contextWindow < 16384) {
    return { enabled: false };
  }

  const reserveTokens = computeCompactionReserveTokens(maxTokens, memoryPrefixTokenEstimate);

  if (provider === 'ollama' && contextWindow < 65536) {
    return {
      enabled: true,
      reserveTokens: Math.max(reserveTokens, Math.floor(contextWindow * 0.15)),
      keepRecentTokens: Math.floor(contextWindow * 0.25),
    };
  }

  return {
    enabled: true,
    reserveTokens,
    keepRecentTokens: Math.min(20_000, Math.floor(contextWindow * 0.15)),
  };
}

export function formatContextOverflowError(
  contextWindow: number,
  inputTokens: number,
  maxTokens: number
): string {
  return mt('errContextOverflow', {
    limit: String(contextWindow),
    input: String(inputTokens),
    output: String(maxTokens),
    error: `context overflow: ${inputTokens} input + ${maxTokens} output > ${contextWindow}`,
  });
}
