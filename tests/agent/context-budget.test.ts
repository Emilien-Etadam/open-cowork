import { describe, expect, it } from 'vitest';

import {
  computeCompactionReserveTokens,
  computeEffectiveContextUsage,
  computeMemoryPrefixBudget,
  getLastInputTokenCount,
  isContextOverflowError,
  shouldBlockForContextOverflow,
} from '../../src/main/agent/context-budget';

describe('context-budget', () => {
  it('computes effective usage including reserved output tokens', () => {
    const usage = computeEffectiveContextUsage(114689, 16384, 131072);
    expect(usage.used).toBe(131073);
    expect(usage.percentage).toBeGreaterThan(99.9);
    expect(usage.remaining).toBe(0);
  });

  it('reads the latest non-zero input token count', () => {
    const count = getLastInputTokenCount([
      {
        id: '1',
        sessionId: 's1',
        role: 'assistant',
        content: [{ type: 'text', text: 'hi' }],
        timestamp: 1,
        tokenUsage: { input: 100, output: 10 },
      },
      {
        id: '2',
        sessionId: 's1',
        role: 'assistant',
        content: [{ type: 'text', text: 'bye' }],
        timestamp: 2,
        tokenUsage: { input: 250, output: 20 },
      },
    ]);
    expect(count).toBe(250);
  });

  it('reserves compaction tokens with safety margin and memory estimate', () => {
    expect(computeCompactionReserveTokens(16384, 2048)).toBe(16384 + 2048 + 4096);
  });

  it('detects provider context overflow errors', () => {
    const error =
      "400 This model's maximum context length is 131072 tokens. However, you requested 16384 output tokens";
    expect(isContextOverflowError(error)).toBe(true);
  });

  it('blocks when projected usage exceeds the context window', () => {
    expect(shouldBlockForContextOverflow(114689, 0, 16384, 131072)).toBe(true);
    expect(shouldBlockForContextOverflow(90000, 1000, 16384, 131072)).toBe(false);
  });

  it('computes remaining memory prefix budget', () => {
    expect(computeMemoryPrefixBudget(131072, 90000, 16384)).toBe(20592);
    expect(computeMemoryPrefixBudget(131072, 114689, 16384)).toBe(0);
  });
});
