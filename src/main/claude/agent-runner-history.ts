/**
 * Cold-start conversation history serialization for pi-coding-agent sessions.
 */
import type { ContentBlock, Message } from '../../renderer/types';
import {
  findLastCompactionAnchor,
  messagesAfterCompactionAnchor,
} from '../../shared/compaction-anchor';
import { log } from '../utils/logger';

/**
 * Estimate chars-per-token ratio based on content language.
 * CJK characters tokenize at ~1.5 chars/token vs ~4 for English.
 */
export function estimateCharsPerToken(sampleText: string): number {
  if (!sampleText || sampleText.length === 0) return 4;
  const sample = sampleText.substring(0, 500);
  const cjkCount = (sample.match(/[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/g) || [])
    .length;
  const cjkRatio = cjkCount / sample.length;
  return 4 - cjkRatio * 2.5;
}

function escapeXmlAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeXmlText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Serialize message content blocks into the XML used inside cold-start history.
 */
export function serializeMessageContentForHistory(content: ContentBlock[]): string {
  const parts: string[] = [];
  for (const block of content) {
    switch (block.type) {
      case 'text': {
        const text = block.text ?? '';
        if (text.length > 0) parts.push(text);
        break;
      }
      case 'thinking': {
        const thinking = block.thinking ?? '';
        if (thinking.length > 0) parts.push(`<thinking>${escapeXmlText(thinking)}</thinking>`);
        break;
      }
      case 'tool_use': {
        const name = block.name ?? 'unknown';
        const id = block.id ?? '';
        let inputStr: string;
        try {
          inputStr = JSON.stringify(block.input ?? {});
        } catch {
          inputStr = '{}';
        }
        parts.push(
          `<tool_use name="${escapeXmlAttr(name)}" id="${escapeXmlAttr(id)}">${escapeXmlText(inputStr)}</tool_use>`
        );
        break;
      }
      case 'tool_result': {
        const id = block.toolUseId ?? '';
        const errAttr = block.isError ? ' is_error="true"' : '';
        const rawContent = (block as { content: unknown }).content;
        let text: string;
        if (typeof rawContent === 'string') {
          text = rawContent;
        } else if (Array.isArray(rawContent)) {
          text = rawContent
            .map((c) =>
              c && typeof c === 'object' && 'text' in c
                ? String((c as { text: unknown }).text ?? '')
                : ''
            )
            .join('\n');
        } else {
          text = '';
        }
        parts.push(
          `<tool_result tool_use_id="${escapeXmlAttr(id)}"${errAttr}>${escapeXmlText(text)}</tool_result>`
        );
        break;
      }
      case 'image':
      case 'file_attachment':
      case 'compaction_summary':
        break;
    }
  }
  return parts.join('\n');
}

export interface BuildColdStartPromptOptions {
  prompt: string;
  existingMessages: Message[];
  provider: string;
  contextWindow: number;
}

/**
 * Inject a token-budgeted history preamble when starting a fresh pi session.
 */
export function buildColdStartContextualPrompt(options: BuildColdStartPromptOptions): string {
  const anchoredMessages = messagesAfterCompactionAnchor(options.existingMessages);
  const { summary: compactionSummary } = findLastCompactionAnchor(options.existingMessages);
  const conversationMessages = anchoredMessages.filter(
    (msg) => msg.role === 'user' || msg.role === 'assistant'
  );
  const textOnlyMessages = conversationMessages.filter(
    (msg) => !msg.content.some((c) => (c as { type?: string }).type === 'image')
  );
  const historyMessages =
    textOnlyMessages.length > 0 && textOnlyMessages[textOnlyMessages.length - 1]?.role === 'user'
      ? textOnlyMessages.slice(0, -1)
      : textOnlyMessages;

  if (historyMessages.length === 0) {
    return options.prompt;
  }

  const historyBudgetRatio =
    options.provider === 'ollama' && options.contextWindow < 16384 ? 0.15 : 0.3;
  const historyTokenBudget = Math.floor(options.contextWindow * historyBudgetRatio);
  const sampleText = historyMessages
    .slice(-3)
    .map((m) => serializeMessageContentForHistory(m.content))
    .join('');
  const charsPerToken = estimateCharsPerToken(sampleText);
  const historyCharBudget = Math.floor(historyTokenBudget * charsPerToken);

  const historyItems: string[] = [];
  let charCount = 0;
  for (let i = historyMessages.length - 1; i >= 0; i--) {
    const msg = historyMessages[i];
    const serialized = serializeMessageContentForHistory(msg.content);
    if (serialized.length === 0) continue;
    const roleTag = msg.role === 'user' ? 'user' : 'assistant';
    const entry = `<turn role="${roleTag}">${serialized}</turn>`;
    if (charCount + entry.length > historyCharBudget) break;
    charCount += entry.length;
    historyItems.unshift(entry);
  }

  if (historyItems.length === 0) {
    return options.prompt;
  }

  const trimmedCount = historyMessages.length - historyItems.length;
  const compactionPrefix = compactionSummary
    ? `<compaction_summary tokens_before="${compactionSummary.tokensBefore}">\n${escapeXmlText(compactionSummary.summary)}\n</compaction_summary>\n`
    : '';
  const historyNote =
    trimmedCount > 0
      ? `[${trimmedCount} older messages omitted]\n`
      : compactionSummary
        ? '[older messages compacted manually]\n'
        : '';
  const preamble = `<conversation_history>\n${compactionPrefix}${historyNote}${historyItems.join('\n')}\n</conversation_history>`;

  log(
    '[ClaudeAgentRunner] Cold start: injecting',
    historyItems.length,
    'of',
    historyMessages.length,
    'history messages (budget:',
    historyCharBudget,
    'chars, used:',
    charCount,
    ', charsPerToken:',
    charsPerToken.toFixed(2),
    ')'
  );

  return `${preamble}\n\n${options.prompt}`;
}
