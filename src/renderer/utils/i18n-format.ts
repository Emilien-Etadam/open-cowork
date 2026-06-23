import i18n from '../i18n/config';
import type { TFunction } from 'i18next';
import type { ProviderType } from '../types';

function getAppLocale(language = i18n.resolvedLanguage || i18n.language): string {
  if (language.startsWith('zh')) {
    return 'zh-CN';
  }
  return 'en-US';
}

export function formatAppDateTime(value: number | string | Date): string {
  return new Intl.DateTimeFormat(getAppLocale(), {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

export function formatAppDate(
  value: number | string | Date,
  options?: Intl.DateTimeFormatOptions
): string {
  return new Intl.DateTimeFormat(
    getAppLocale(),
    options || {
      month: 'short',
      day: 'numeric',
    }
  ).format(new Date(value));
}

export function joinAppList(values: string[]): string {
  return values.join(getAppLocale().startsWith('zh') ? '、' : ', ');
}

export function getProviderKeyHint(
  provider: ProviderType,
  presetHint: string | undefined,
  t: TFunction
): string | undefined {
  const translated = t(`api.providerHints.${provider}.keyHint`, { defaultValue: presetHint || '' });
  return translated || undefined;
}

export function getProviderKeyPlaceholder(
  provider: ProviderType,
  presetPlaceholder: string | undefined,
  t: TFunction,
  fallback: string
): string {
  return (
    t(`api.providerHints.${provider}.keyPlaceholder`, { defaultValue: presetPlaceholder || '' }) ||
    fallback
  );
}
