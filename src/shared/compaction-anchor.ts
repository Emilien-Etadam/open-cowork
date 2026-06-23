import type { CompactionSummaryContent, ContentBlock, Message } from '../renderer/types';

export type { CompactionSummaryContent };

export function isCompactionSummaryBlock(block: ContentBlock): block is CompactionSummaryContent {
  return block.type === 'compaction_summary';
}

export function findLastCompactionAnchor(messages: Message[]): {
  anchorIndex: number;
  summary: CompactionSummaryContent | null;
} {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    const summaryBlock = message.content.find(isCompactionSummaryBlock);
    if (summaryBlock) {
      return { anchorIndex: i, summary: summaryBlock };
    }
  }
  return { anchorIndex: -1, summary: null };
}

export function messagesAfterCompactionAnchor(messages: Message[]): Message[] {
  const { anchorIndex } = findLastCompactionAnchor(messages);
  if (anchorIndex < 0) {
    return messages;
  }
  return messages.slice(anchorIndex + 1);
}
