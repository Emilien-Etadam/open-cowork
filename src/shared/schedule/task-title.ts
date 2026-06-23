export type ScheduleTitleLocale = 'en' | 'zh';

const SCHEDULE_TITLE_PREFIX_BY_LOCALE: Record<ScheduleTitleLocale, string> = {
  en: '[Scheduled Task]',
  zh: '[定时任务]',
};

const EMPTY_TITLE_FALLBACK_BY_LOCALE: Record<ScheduleTitleLocale, string> = {
  en: 'Untitled Task',
  zh: '未命名任务',
};

const DEFAULT_SUMMARY_MAX_LENGTH = 48;

function normalizeTitlePart(value: string): string {
  return value
    .trim()
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ');
}

function stripSchedulePrefix(value: string): string {
  return value
    .replace(/^\s*\[定时任务\]\s*/, '')
    .replace(/^\s*\[Scheduled Task\]\s*/, '')
    .trim();
}

export function normalizeScheduleTitleLocale(
  value: string | null | undefined
): ScheduleTitleLocale {
  return value?.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

export function summarizeSchedulePrompt(
  prompt: string,
  maxLength: number = DEFAULT_SUMMARY_MAX_LENGTH,
  locale: ScheduleTitleLocale = 'en'
): string {
  const normalizedPrompt = normalizeTitlePart(prompt);
  if (!normalizedPrompt) {
    return EMPTY_TITLE_FALLBACK_BY_LOCALE[locale];
  }
  if (!Number.isFinite(maxLength) || maxLength <= 0) {
    return normalizedPrompt;
  }
  if (normalizedPrompt.length <= maxLength) {
    return normalizedPrompt;
  }
  return `${normalizedPrompt.slice(0, Math.max(1, maxLength - 3))}...`;
}

export function buildScheduledTaskTitle(
  titleOrSummary: string,
  locale: ScheduleTitleLocale = 'en'
): string {
  const normalized = normalizeTitlePart(stripSchedulePrefix(titleOrSummary));
  const summary = normalized || EMPTY_TITLE_FALLBACK_BY_LOCALE[locale];
  return `${SCHEDULE_TITLE_PREFIX_BY_LOCALE[locale]} ${summary}`;
}

export function buildScheduledTaskFallbackTitle(
  prompt: string,
  locale: ScheduleTitleLocale = 'en'
): string {
  return buildScheduledTaskTitle(
    summarizeSchedulePrompt(prompt, DEFAULT_SUMMARY_MAX_LENGTH, locale),
    locale
  );
}
