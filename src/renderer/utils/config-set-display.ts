import type { TFunction } from 'i18next';
import type { ApiConfigSet } from '../types';

export function getConfigSetDisplayName(set: ApiConfigSet, t: TFunction): string {
  if (set.isSystem) {
    const label = t('api.defaultConfigSetName');
    const tag = t('api.defaultSetTag');
    if (label === tag) {
      return label;
    }
    return `${label} (${tag})`;
  }

  return set.name;
}
