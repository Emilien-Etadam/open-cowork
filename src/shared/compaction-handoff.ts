import type { ContentBlock, Message } from '../renderer/types';

export interface CompactionHandoffInput {
  summary: string;
  sourceTitle: string;
  tokensBefore: number;
  customInstructions?: string;
}

export const HANDOFF_SUMMARY_SYSTEM_PROMPT = `You summarize coding-agent conversations so work can continue in a fresh session.

Write a thorough, structured summary in the same language as the conversation. Preserve:
- Goals, current status, and what was already completed
- Key decisions, trade-offs, and rationale
- Files, paths, APIs, configs, and commands that matter
- Open tasks, blockers, errors, and the most likely next steps

Use clear markdown sections. Be dense and factual — do not invent details.`;

export function buildHandoffSummaryUserPrompt(
  transcript: string,
  customInstructions?: string
): string {
  const focus = customInstructions?.trim()
    ? `\n\nPay special attention while summarizing: ${customInstructions.trim()}`
    : '';

  return `Summarize the conversation below for handoff to a new session.${focus}

<conversation>
${transcript.trim()}
</conversation>`;
}

export function buildConversationTranscriptForHandoff(
  messages: Message[],
  serializeContent: (content: ContentBlock[]) => string,
  maxChars = 400_000
): string {
  const lines: string[] = [];

  for (const message of messages) {
    if (message.role !== 'user' && message.role !== 'assistant') {
      continue;
    }
    const body = serializeContent(message.content).trim();
    if (!body) {
      continue;
    }
    lines.push(`[${message.role}]\n${body}`);
  }

  if (lines.length === 0) {
    return '';
  }

  let transcript = lines.join('\n\n');
  if (transcript.length > maxChars) {
    const omittedCount = lines.length;
    transcript = `[${omittedCount} messages total — oldest content truncated for summarization]\n\n${transcript.slice(-maxChars)}`;
  }

  return transcript;
}

export function buildCompactionHandoffPrompt(input: CompactionHandoffInput): string {
  const focusSection = input.customInstructions?.trim()
    ? `\n<continuation_focus>\n${input.customInstructions.trim()}\n</continuation_focus>\n`
    : '';

  return `<previous_session_handoff>
You are continuing work from a previous session titled "${escapeXmlAttr(input.sourceTitle)}".
The prior conversation (about ${input.tokensBefore} input tokens) has been compacted into the summary below.
Treat the summary as the full authoritative context from that session. Earlier raw messages are not available in this new session.
${focusSection}
<conversation_summary>
${input.summary.trim()}
</conversation_summary>
</previous_session_handoff>

Continue the work from this context. Pick up any in-progress task, open questions, or next steps implied by the summary.`;
}

export function buildCompactionSessionTitle(sourceTitle: string): string {
  const base = sourceTitle.trim() || 'Session';
  const suffix = ' (continued)';
  const maxLen = 80;
  if (base.length + suffix.length <= maxLen) {
    return `${base}${suffix}`;
  }
  return `${base.slice(0, maxLen - suffix.length - 1)}…${suffix}`;
}

function escapeXmlAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
