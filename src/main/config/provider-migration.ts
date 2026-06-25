import { defaultProtocolForSharedProvider } from '../../shared/api-model-presets';
import type {
  CustomProtocolType,
  ProviderProfile,
  ProviderProfileKey,
  ProviderType,
} from './config-schema';

type LegacyProfileKey =
  | ProviderProfileKey
  | 'openrouter'
  | 'gemini'
  | 'ollama'
  | 'vllm'
  | 'custom:anthropic'
  | 'custom:openai'
  | 'custom:gemini';

export function migrateProviderType(
  rawProvider: unknown,
  options?: { customProtocol?: CustomProtocolType; model?: string }
): ProviderType {
  if (rawProvider === 'openai' || rawProvider === 'anthropic') {
    return rawProvider;
  }

  if (
    rawProvider === 'ollama' ||
    rawProvider === 'vllm' ||
    rawProvider === 'gemini' ||
    rawProvider === 'custom' ||
    rawProvider === 'openrouter'
  ) {
    if (options?.customProtocol === 'anthropic') {
      return 'anthropic';
    }
    if (rawProvider === 'openrouter') {
      const model = options?.model?.trim() || '';
      return model.startsWith('anthropic/') ? 'anthropic' : 'openai';
    }
    return 'openai';
  }

  return 'openai';
}

export function migrateProfileKey(
  rawKey: unknown,
  profile?: Partial<ProviderProfile>,
  fallbackProvider: ProviderType = 'openai'
): ProviderProfileKey {
  if (rawKey === 'openai' || rawKey === 'anthropic') {
    return rawKey;
  }

  if (rawKey === 'custom:anthropic') {
    return 'anthropic';
  }

  if (
    rawKey === 'custom:openai' ||
    rawKey === 'custom:gemini' ||
    rawKey === 'gemini' ||
    rawKey === 'ollama' ||
    rawKey === 'vllm' ||
    rawKey === 'openrouter'
  ) {
    if (rawKey === 'openrouter') {
      return migrateProviderType('openrouter', { model: profile?.model }) === 'anthropic'
        ? 'anthropic'
        : 'openai';
    }
    return 'openai';
  }

  return fallbackProvider;
}

export function migrateCustomProtocol(
  provider: ProviderType,
  _rawProtocol: unknown
): CustomProtocolType {
  return defaultProtocolForSharedProvider(provider);
}

export function mergeLegacyProfiles(
  profiles: Partial<Record<LegacyProfileKey, ProviderProfile>>
): Partial<Record<ProviderProfileKey, ProviderProfile>> {
  const merged: Partial<Record<ProviderProfileKey, ProviderProfile>> = {};

  const assignIfEmpty = (targetKey: ProviderProfileKey, source?: ProviderProfile) => {
    if (!source) {
      return;
    }
    const existing = merged[targetKey];
    const hasExistingData =
      Boolean(existing?.apiKey?.trim()) ||
      Boolean(existing?.model?.trim()) ||
      Boolean(existing?.baseUrl?.trim());
    if (!hasExistingData) {
      merged[targetKey] = { ...source };
    }
  };

  for (const [rawKey, profile] of Object.entries(profiles || {})) {
    const targetKey = migrateProfileKey(rawKey, profile);
    assignIfEmpty(targetKey, profile);
  }

  return merged;
}
