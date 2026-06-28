import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Brain, ChevronDown, ChevronUp } from 'lucide-react';
import type { MemoryInjectedItem } from '../types';

interface MemoryContextBarProps {
  items: MemoryInjectedItem[];
  memoryEnabled: boolean;
  onToggleMemory: (enabled: boolean) => void;
  onOpenSourceSession?: (sessionId: string) => void;
}

export function MemoryContextBar({
  items,
  memoryEnabled,
  onToggleMemory,
  onOpenSourceSession,
}: MemoryContextBarProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border-b border-border-muted bg-background-secondary/70 px-4 lg:px-8 py-2">
      <div className="max-w-[920px] mx-auto flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => items.length > 0 && setExpanded((value) => !value)}
          className="flex items-center gap-2 text-left min-w-0"
          disabled={items.length === 0}
        >
          <Brain className="w-4 h-4 text-accent shrink-0" />
          <span className="text-xs text-text-secondary truncate">
            {items.length > 0
              ? t('chat.memoryUsedCount', { count: items.length })
              : memoryEnabled
                ? t('chat.memoryNoRecall')
                : t('chat.memoryDisabledSession')}
          </span>
          {items.length > 0 &&
            (expanded ? (
              <ChevronUp className="w-3.5 h-3.5 text-text-muted shrink-0" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5 text-text-muted shrink-0" />
            ))}
        </button>

        <label className="flex items-center gap-2 text-xs text-text-muted shrink-0 cursor-pointer">
          <input
            type="checkbox"
            checked={memoryEnabled}
            onChange={(event) => onToggleMemory(event.target.checked)}
            className="rounded border-border-muted"
          />
          {t('chat.memorySessionToggle')}
        </label>
      </div>

      {expanded && items.length > 0 && (
        <div className="max-w-[920px] mx-auto mt-2 space-y-2">
          {items.map((item) => (
            <div
              key={`${item.kind}-${item.id}`}
              className="rounded-lg border border-border-subtle bg-background/80 px-3 py-2"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs font-medium text-text-primary truncate">{item.title}</div>
                {typeof item.score === 'number' && (
                  <span className="text-[10px] text-text-muted shrink-0">
                    {t('memory.relevanceScore', { score: item.score.toFixed(2) })}
                  </span>
                )}
              </div>
              <p className="text-xs text-text-secondary mt-1 line-clamp-2">{item.summary}</p>
              {(item.sourceWorkspace || item.sourceSessionTitle) && (
                <p className="text-[10px] text-text-muted mt-1">
                  {[item.sourceWorkspace, item.sourceSessionTitle].filter(Boolean).join(' · ')}
                </p>
              )}
              {item.sourceSessionId && onOpenSourceSession && item.kind !== 'core' && (
                <button
                  type="button"
                  onClick={() => onOpenSourceSession(item.sourceSessionId!)}
                  className="mt-1 text-[11px] text-accent hover:underline"
                >
                  {t('chat.memoryOpenSourceSession')}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
