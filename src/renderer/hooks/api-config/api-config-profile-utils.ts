import { isParsableBaseUrl } from '../../../shared/api-provider-guidance';
import { isLoopbackBaseUrl } from '../../../shared/network/loopback';
import { normalizeOllamaBaseUrl } from '../../../shared/ollama-base-url';
import type {
  CustomProtocolType,
  ProviderModelInfo,
  ProviderProfile,
  ProviderProfileKey,
  ProviderPresets,
  ProviderType,
} from '../../types';
import { PROFILE_KEYS, type UIProviderProfile } from './api-config-types';

export function isProfileKey(value: unknown): value is ProviderProfileKey {
  return typeof value === 'string' && PROFILE_KEYS.includes(value as ProviderProfileKey);
}

export function isProviderType(value: unknown): value is ProviderType {
  return value === 'openai' || value === 'anthropic';
}

export function isCustomProtocol(value: unknown): value is CustomProtocolType {
  return value === 'anthropic' || value === 'openai';
}

export function profileKeyFromProvider(
  provider: ProviderType,
  _customProtocol: CustomProtocolType = 'anthropic'
): ProviderProfileKey {
  return provider;
}

export function profileKeyToProvider(profileKey: ProviderProfileKey): {
  provider: ProviderType;
  customProtocol: CustomProtocolType;
} {
  return {
    provider: profileKey,
    customProtocol: profileKey === 'anthropic' ? 'anthropic' : 'openai',
  };
}

export function isLocalOpenAiMode(provider: ProviderType, baseUrl: string): boolean {
  return provider === 'openai' && (!baseUrl.trim() || isLoopbackBaseUrl(baseUrl));
}

export function canDiscoverProviderModels(
  provider: ProviderType,
  baseUrl: string,
  apiKey: string,
  requiresApiKey: boolean,
  presetBaseUrl?: string
): boolean {
  const trimmedBaseUrl = baseUrl.trim();
  const fallbackBaseUrl = presetBaseUrl?.trim() || '';
  const effectiveBaseUrl = trimmedBaseUrl || fallbackBaseUrl;

  if (provider === 'openai') {
    if (isLocalOpenAiMode(provider, baseUrl)) {
      return !trimmedBaseUrl || isParsableBaseUrl(trimmedBaseUrl);
    }
    return isParsableBaseUrl(effectiveBaseUrl) && (!requiresApiKey || Boolean(apiKey.trim()));
  }

  if (provider === 'anthropic') {
    const anthropicBaseUrl = effectiveBaseUrl || 'https://api.anthropic.com';
    return isParsableBaseUrl(anthropicBaseUrl) && (!requiresApiKey || Boolean(apiKey.trim()));
  }

  return false;
}

export function modelPresetForProfile(profileKey: ProviderProfileKey, presets: ProviderPresets) {
  return presets[profileKey];
}

export function defaultProfileForKey(
  profileKey: ProviderProfileKey,
  presets: ProviderPresets
): UIProviderProfile {
  const preset = modelPresetForProfile(profileKey, presets);
  return {
    apiKey: '',
    baseUrl: preset.baseUrl,
    model: profileKey === 'openai' ? '' : preset.models[0]?.id || '',
    customModel: '',
    useCustomModel: profileKey === 'openai',
    contextWindow: '',
    maxTokens: '',
  };
}

export function normalizeDiscoveredOllamaModels(models: string[] | undefined): ProviderModelInfo[] {
  return (models || [])
    .map((id) => id.trim())
    .filter(Boolean)
    .map((id) => ({ id, name: id }));
}

export function normalizeProfile(
  profileKey: ProviderProfileKey,
  profile: Partial<ProviderProfile> | undefined,
  presets: ProviderPresets
): UIProviderProfile {
  const fallback = defaultProfileForKey(profileKey, presets);
  if (!profile) {
    return fallback;
  }

  const modelValue = profile?.model?.trim() || fallback.model;
  const rawBaseUrl = profile?.baseUrl?.trim() || fallback.baseUrl;
  const hasPresetModel = modelPresetForProfile(profileKey, presets).models.some(
    (item) => item.id === modelValue
  );
  return {
    apiKey: profile?.apiKey || '',
    baseUrl:
      profileKey === 'openai' ? normalizeOllamaBaseUrl(rawBaseUrl) || rawBaseUrl : rawBaseUrl,
    model: hasPresetModel ? modelValue : fallback.model,
    customModel: hasPresetModel ? '' : modelValue,
    useCustomModel:
      profileKey === 'openai' ? !hasPresetModel || fallback.useCustomModel : !hasPresetModel,
    contextWindow: profile?.contextWindow ? String(profile.contextWindow) : '',
    maxTokens: profile?.maxTokens ? String(profile.maxTokens) : '',
  };
}
