import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight, Layers } from 'lucide-react';
import type { CompactionSummaryContent } from '../../types';

interface CompactionSummaryBlockProps {
  block: CompactionSummaryContent;
}

function formatTokenCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(value);
}

export function CompactionSummaryBlock({ block }: CompactionSummaryBlockProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-xl border border-border-muted bg-surface-muted/60 px-4 py-3 space-y-2">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="w-full flex items-center gap-2 text-left"
      >
        <Layers className="w-4 h-4 text-accent flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-text-primary">
            {block.sourceTitle
              ? t('messageCard.compactionHandoffTitle', { sourceTitle: block.sourceTitle })
              : t('messageCard.compactionTitle')}
          </p>
          <p className="text-xs text-text-muted">
            {t('messageCard.compactionMeta', {
              tokensBefore: formatTokenCount(block.tokensBefore),
            })}
          </p>
        </div>
        {expanded ? (
          <ChevronDown className="w-4 h-4 text-text-muted flex-shrink-0" />
        ) : (
          <ChevronRight className="w-4 h-4 text-text-muted flex-shrink-0" />
        )}
      </button>
      {block.customInstructions && (
        <p className="text-xs text-text-muted pl-6">
          {t('messageCard.compactionInstructions', { instructions: block.customInstructions })}
        </p>
      )}
      {expanded && (
        <div className="pl-6 text-sm text-text-secondary whitespace-pre-wrap break-words">
          {block.summary}
        </div>
      )}
    </div>
  );
}
