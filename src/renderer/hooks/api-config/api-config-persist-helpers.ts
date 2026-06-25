import { isLoopbackBaseUrl } from '../../../shared/network/loopback';
import type { TFunction } from 'i18next';
import type { ProviderType } from '../../types';

export const isElectron = typeof window !== 'undefined' && window.electronAPI !== undefined;
export const API_CONFIG_SET_LIMIT = 20;

export function translateApiConfigErrorMessage(message: string, t: TFunction): string {
  if (message === 'Config set name is required') return t('api.configSetNameRequired');
  if (message === 'Config set clone source not found') return t('api.configSetCloneSourceMissing');
  if (message === 'Config set not found') return t('api.configSetMissing');
  if (message === 'System config set cannot be deleted') {
    return t('api.configSetSystemDeleteForbidden');
  }
  if (message === 'At least one config set must be kept') return t('api.configSetKeepOne');

  const limitMatch = message.match(/^Config set limit reached: max\s+(\d+)$/);
  if (limitMatch) {
    return t('api.configSetLimitReached', { count: Number(limitMatch[1]) });
  }
  return message;
}

export function resolveBaseUrl(
  provider: ProviderType,
  baseUrl: string,
  currentPresetBaseUrl?: string
): string {
  if (provider === 'openai' && isLoopbackBaseUrl(baseUrl)) {
    return baseUrl.trim();
  }
  return (baseUrl.trim() || currentPresetBaseUrl || '').trim();
}

export function resolveFinalModel(
  model: string,
  customModel: string,
  useCustomModel: boolean
): string {
  return useCustomModel ? customModel.trim() : model;
}
