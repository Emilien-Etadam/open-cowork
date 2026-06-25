import { useTranslation } from 'react-i18next';
import { useActiveContextUsage } from '../store/selectors';

export function ChatContextUsageBar() {
  const { t } = useTranslation();
  const contextUsage = useActiveContextUsage();

  if (!contextUsage) {
    return null;
  }

  return (
    <div className="px-5 lg:px-8 pb-2">
      <div className="max-w-[920px] mx-auto rounded-xl border border-border-muted bg-surface px-3 py-2">
        <div className="flex items-center justify-between gap-3">
          <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-text-muted">
            {t('context.contextUsage')}
          </span>
          <span
            className={`text-xs font-medium ${
              contextUsage.percentage > 95
                ? 'text-error'
                : contextUsage.percentage > 80
                  ? 'text-warning'
                  : 'text-text-primary'
            }`}
          >
            {Math.round(contextUsage.percentage)}%
          </span>
        </div>
        <div className="mt-2 h-1.5 bg-surface-muted rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ease-out ${
              contextUsage.percentage > 95
                ? 'bg-error'
                : contextUsage.percentage > 80
                  ? 'bg-warning'
                  : 'bg-gradient-to-r from-accent to-accent-hover'
            }`}
            style={{ width: `${contextUsage.percentage}%` }}
          />
        </div>
        <p className="mt-1.5 text-[11px] text-text-muted">
          {t('context.contextUsageLabel', {
            used: contextUsage.usedLabel,
            total: contextUsage.totalLabel,
          })}
        </p>
      </div>
    </div>
  );
}
