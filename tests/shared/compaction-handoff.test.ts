import { describe, expect, it } from 'vitest';

import {
  buildCompactionHandoffPrompt,
  buildCompactionSessionTitle,
  buildConversationTranscriptForHandoff,
  buildHandoffSummaryUserPrompt,
} from '../../src/shared/compaction-handoff';

describe('compaction handoff helpers', () => {
  it('builds a structured continuation prompt with summary and focus', () => {
    const prompt = buildCompactionHandoffPrompt({
      summary: 'We fixed context metering and compaction reserves.',
      sourceTitle: 'Context audit',
      tokensBefore: 114689,
      customInstructions: 'focus on API changes',
    });

    expect(prompt).toContain('<previous_session_handoff>');
    expect(prompt).toContain('<conversation_summary>');
    expect(prompt).toContain('We fixed context metering');
    expect(prompt).toContain('<continuation_focus>');
    expect(prompt).toContain('focus on API changes');
    expect(prompt).toContain('114689');
  });

  it('builds a continued session title', () => {
    expect(buildCompactionSessionTitle('Audit contexte')).toBe('Audit contexte (continued)');
  });

  it('builds a transcript from user and assistant messages', () => {
    const transcript = buildConversationTranscriptForHandoff(
      [
        {
          id: '1',
          sessionId: 's1',
          role: 'user',
          content: [{ type: 'text', text: 'Hello' }],
          timestamp: 1,
        },
        {
          id: '2',
          sessionId: 's1',
          role: 'assistant',
          content: [{ type: 'text', text: 'Hi there' }],
          timestamp: 2,
        },
        {
          id: '3',
          sessionId: 's1',
          role: 'system',
          content: [{ type: 'text', text: 'ignored' }],
          timestamp: 3,
        },
      ],
      (content) => content.map((block) => ('text' in block ? block.text : '')).join('')
    );

    expect(transcript).toContain('[user]\nHello');
    expect(transcript).toContain('[assistant]\nHi there');
    expect(transcript).not.toContain('ignored');
  });

  it('builds a summarization user prompt with optional focus', () => {
    const prompt = buildHandoffSummaryUserPrompt('transcript', 'keep file paths');
    expect(prompt).toContain('<conversation>');
    expect(prompt).toContain('transcript');
    expect(prompt).toContain('keep file paths');
  });
});
