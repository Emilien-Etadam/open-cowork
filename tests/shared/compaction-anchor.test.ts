import { describe, expect, it } from 'vitest';

import {
  findLastCompactionAnchor,
  messagesAfterCompactionAnchor,
} from '../../src/shared/compaction-anchor';
import type { Message } from '../../src/renderer/types';

function makeMessage(id: string, role: Message['role'], content: Message['content']): Message {
  return {
    id,
    sessionId: 's1',
    role,
    content,
    timestamp: Number(id.replace(/\D/g, '') || 0),
  };
}

describe('compaction anchor helpers', () => {
  const messages: Message[] = [
    makeMessage('m1', 'user', [{ type: 'text', text: 'old question' }]),
    makeMessage('m2', 'assistant', [{ type: 'text', text: 'old answer' }]),
    makeMessage('m3', 'system', [
      {
        type: 'compaction_summary',
        summary: 'Older discussion about setup.',
        tokensBefore: 120000,
      },
    ]),
    makeMessage('m4', 'user', [{ type: 'text', text: 'new question' }]),
  ];

  it('finds the latest compaction summary message', () => {
    expect(findLastCompactionAnchor(messages)).toEqual({
      anchorIndex: 2,
      summary: {
        type: 'compaction_summary',
        summary: 'Older discussion about setup.',
        tokensBefore: 120000,
      },
    });
  });

  it('returns only messages after the compaction anchor', () => {
    expect(messagesAfterCompactionAnchor(messages).map((m) => m.id)).toEqual(['m4']);
  });
});
