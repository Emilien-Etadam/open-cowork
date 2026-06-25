import { useTranslation } from 'react-i18next';
import { Terminal } from 'lucide-react';
import type { SlashCommandDefinition } from '../../shared/slash-commands';

interface SlashCommandMenuProps {
  suggestions: SlashCommandDefinition[];
  highlightedIndex: number;
  onSelect: (command: SlashCommandDefinition) => void;
  onHighlight: (index: number) => void;
}

export function SlashCommandMenu({
  suggestions,
  highlightedIndex,
  onSelect,
  onHighlight,
}: SlashCommandMenuProps) {
  const { t } = useTranslation();

  return (
    <div
      role="listbox"
      aria-label={t('chat.slashCommands.menuLabel')}
      className="absolute bottom-full left-0 right-0 mb-2 rounded-2xl border border-border-muted bg-surface/95 backdrop-blur shadow-soft overflow-hidden z-20"
    >
      <div className="px-3 py-2 border-b border-border-muted/80 text-xs font-medium text-text-muted">
        {t('chat.slashCommands.menuLabel')}
      </div>
      <ul className="py-1">
        {suggestions.map((suggestion, index) => {
          const isHighlighted = index === highlightedIndex;
          return (
            <li key={suggestion.kind === 'builtin' ? suggestion.id : suggestion.id}>
              <button
                type="button"
                role="option"
                aria-selected={isHighlighted}
                onMouseEnter={() => onHighlight(index)}
                onMouseDown={(event) => {
                  event.preventDefault();
                  onSelect(suggestion);
                }}
                className={`w-full px-3 py-2.5 flex items-start gap-3 text-left transition-colors ${
                  isHighlighted ? 'bg-accent/10' : 'hover:bg-surface-hover'
                }`}
              >
                <Terminal className="w-4 h-4 mt-0.5 text-accent flex-shrink-0" />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-text-primary font-mono">
                    {suggestion.command}
                  </span>
                  <span className="block text-xs text-text-muted mt-0.5">
                    {suggestion.kind === 'builtin'
                      ? t(suggestion.descriptionKey)
                      : suggestion.description || suggestion.pluginName}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
