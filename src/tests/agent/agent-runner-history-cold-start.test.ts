import { describe, expect, it } from 'vitest';
import type { Message } from '../../renderer/types';
import {
  buildColdStartContextualPrompt,
  estimateCharsPerToken,
} from '../../main/agent/agent-runner-history';

function msg(role: Message['role'], text: string, extra: Message['content'] = []): Message {
  return {
    id: `${role}-${text}`,
    sessionId: 'session-1',
    role,
    content: [{ type: 'text', text }, ...extra],
    timestamp: Date.now(),
  };
}

describe('estimateCharsPerToken', () => {
  it('defaults to ~4 chars/token for English text', () => {
    expect(estimateCharsPerToken('hello world this is english prose')).toBeCloseTo(4, 1);
  });

  it('uses a lower ratio for CJK-heavy samples', () => {
    const english = estimateCharsPerToken('abcdefghijklmnopqrstuvwxyz');
    const cjk = estimateCharsPerToken('你好世界测试中文内容示例继续填充一些汉字');
    expect(cjk).toBeLessThan(english);
    expect(cjk).toBeGreaterThanOrEqual(1.5);
  });
});

describe('buildColdStartContextualPrompt', () => {
  it('returns the raw prompt when there is no prior history', () => {
    expect(
      buildColdStartContextualPrompt({
        prompt: 'What next?',
        existingMessages: [msg('user', 'What next?')],
        provider: 'anthropic',
        contextWindow: 128000,
      })
    ).toBe('What next?');
  });

  it('excludes the current user turn from the injected history', () => {
    const result = buildColdStartContextualPrompt({
      prompt: 'continue',
      existingMessages: [
        msg('user', 'first question'),
        msg('assistant', 'first answer'),
        msg('user', 'continue'),
      ],
      provider: 'anthropic',
      contextWindow: 128000,
    });

    expect(result).toContain('<conversation_history>');
    expect(result).toContain('<turn role="user">first question</turn>');
    expect(result).toContain('<turn role="assistant">first answer</turn>');
    expect(result).not.toContain('continue</turn>');
    expect(result.endsWith('\n\ncontinue')).toBe(true);
  });

  it('skips image-only turns when building the history preamble', () => {
    const result = buildColdStartContextualPrompt({
      prompt: 'describe this',
      existingMessages: [
        msg('user', 'look', [
          {
            type: 'image',
            source: { type: 'base64', media_type: 'image/png', data: 'AAAA' },
          },
        ]),
        msg('assistant', 'I cannot see images in history'),
        msg('user', 'describe this'),
      ],
      provider: 'anthropic',
      contextWindow: 128000,
    });

    expect(result).toContain('I cannot see images in history');
    expect(result).not.toContain('look');
  });

  it('uses a tighter history budget for small Ollama context windows', () => {
    const longHistory = Array.from({ length: 30 }, (_, index) =>
      msg(index % 2 === 0 ? 'user' : 'assistant', `message-${index}-${'x'.repeat(200)}`)
    );
    longHistory.push(msg('user', 'latest prompt'));

    const ollama = buildColdStartContextualPrompt({
      prompt: 'latest prompt',
      existingMessages: longHistory,
      provider: 'ollama',
      contextWindow: 8192,
    });
    const anthropic = buildColdStartContextualPrompt({
      prompt: 'latest prompt',
      existingMessages: longHistory,
      provider: 'anthropic',
      contextWindow: 8192,
    });

    const ollamaTurns = (ollama.match(/<turn role="/g) || []).length;
    const anthropicTurns = (anthropic.match(/<turn role="/g) || []).length;

    expect(ollamaTurns).toBeGreaterThan(0);
    expect(anthropicTurns).toBeGreaterThan(ollamaTurns);
  });

  it('includes compaction summary metadata when present', () => {
    const result = buildColdStartContextualPrompt({
      prompt: 'resume',
      existingMessages: [
        {
          id: 'anchor',
          sessionId: 'session-1',
          role: 'assistant',
          content: [
            {
              type: 'compaction_summary',
              summary: 'We discussed sandbox setup.',
              tokensBefore: 120000,
            },
          ],
          timestamp: Date.now(),
        },
        msg('user', 'older question'),
        msg('assistant', 'older answer'),
        msg('user', 'resume'),
      ],
      provider: 'anthropic',
      contextWindow: 128000,
    });

    expect(result).toContain('<compaction_summary tokens_before="120000">');
    expect(result).toContain('We discussed sandbox setup.');
    expect(result).toContain('[older messages compacted manually]');
  });
});
