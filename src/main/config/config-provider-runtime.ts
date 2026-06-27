/**
 * @module main/config/config-provider-runtime
 *
 * Provider presets, credential checks, and environment variable application.
 */
import { API_PROVIDER_PRESETS, PI_AI_CURATED_PRESETS } from '../../shared/api-model-presets';
import { log, logWarn } from '../utils/logger';
import {
  isOpenAIProvider,
  isLoopbackOpenAIEndpoint,
  normalizeAnthropicBaseUrl,
  resolveOpenAICredentials,
  shouldAllowEmptyAnthropicApiKey,
  shouldAllowEmptyOpenAIApiKey,
  shouldUseAnthropicAuthToken,
} from './auth-utils';
import { normalizeConfig, projectFromConfigSet } from './config-normalizer';
import {
  LOCAL_ANTHROPIC_PLACEHOLDER_KEY,
  defaultProtocolForProvider,
  normalizeCustomProtocol,
  type AppConfig,
  type CustomProtocolType,
  type ProviderType,
} from './config-schema';

export const PROVIDER_PRESETS = API_PROVIDER_PRESETS;
const PI_AI_CURATED: Record<string, { piProvider: string; pick: string[] }> = PI_AI_CURATED_PRESETS;

let cachedDynamicPresets: typeof PROVIDER_PRESETS | null = null;

/**
 * Build model presets dynamically from pi-ai registry.
 * Returns PROVIDER_PRESETS with models arrays replaced by registry data where available.
 * Uses async import() because pi-ai is ESM-only.
 */
export async function getPiAiModelPresets(): Promise<typeof PROVIDER_PRESETS> {
  if (cachedDynamicPresets) return cachedDynamicPresets;

  try {
    const { getModels } = (await import('@earendil-works/pi-ai/compat')) as {
      getModels: (provider: string) => Array<{ id: string; name: string }> | undefined;
    };

    const result = { ...PROVIDER_PRESETS } as Record<
      string,
      (typeof PROVIDER_PRESETS)[keyof typeof PROVIDER_PRESETS]
    >;

    for (const [providerKey, curated] of Object.entries(PI_AI_CURATED)) {
      const preset = PROVIDER_PRESETS[providerKey as keyof typeof PROVIDER_PRESETS];
      if (!preset) continue;

      const registryModels = getModels(curated.piProvider);
      if (!registryModels || registryModels.length === 0) continue;

      const registryIds = new Set(registryModels.map((m) => m.id));
      const picked = curated.pick
        .filter((id) => registryIds.has(id))
        .map((id) => {
          const reg = registryModels.find((m) => m.id === id);
          return { id, name: reg?.name || id };
        });

      if (picked.length > 0) {
        result[providerKey] = { ...preset, models: picked };
      }
    }

    cachedDynamicPresets = result as unknown as typeof PROVIDER_PRESETS;
    return cachedDynamicPresets;
  } catch (err) {
    logWarn('[ConfigStore] Failed to load pi-ai model presets, using hardcoded fallback:', err);
    return PROVIDER_PRESETS;
  }
}

export function hasUsableCredentialsForProjection(projection: {
  provider: ProviderType;
  customProtocol?: CustomProtocolType;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}): boolean {
  if (
    projection.provider === 'openai' &&
    isLoopbackOpenAIEndpoint(projection) &&
    !projection.model?.trim()
  ) {
    return false;
  }
  const apiKey = projection.apiKey?.trim();
  if (apiKey) {
    return true;
  }
  if (
    shouldAllowEmptyAnthropicApiKey({
      provider: projection.provider,
      customProtocol: projection.customProtocol,
      baseUrl: projection.baseUrl,
    })
  ) {
    return true;
  }
  if (
    shouldAllowEmptyOpenAIApiKey({
      provider: projection.provider,
      customProtocol: projection.customProtocol,
      baseUrl: projection.baseUrl,
    })
  ) {
    return true;
  }
  const protocol: CustomProtocolType = normalizeCustomProtocol(
    projection.customProtocol,
    defaultProtocolForProvider(projection.provider)
  );
  if (!isOpenAIProvider({ provider: projection.provider, customProtocol: protocol })) {
    return false;
  }
  return (
    resolveOpenAICredentials({
      provider: projection.provider,
      customProtocol: protocol,
      apiKey: projection.apiKey ?? '',
      baseUrl: projection.baseUrl,
    }) !== null
  );
}

export function hasUsableCredentialsForActiveSet(config: AppConfig): boolean {
  const normalized = normalizeConfig(config);
  return hasUsableCredentialsForProjection({
    provider: normalized.provider,
    customProtocol: normalized.customProtocol,
    apiKey: normalized.apiKey,
    baseUrl: normalized.baseUrl,
    model: normalized.model,
  });
}

export function hasUsableCredentials(config: AppConfig): boolean {
  return hasUsableCredentialsForActiveSet(config);
}

export function hasAnyUsableCredentials(config: AppConfig): boolean {
  const normalized = normalizeConfig(config);
  return normalized.configSets.some((configSet) => {
    const projected = projectFromConfigSet(configSet);
    return hasUsableCredentialsForProjection({
      provider: projected.provider,
      customProtocol: projected.customProtocol,
      apiKey: projected.apiKey,
      baseUrl: projected.baseUrl,
      model: projected.model,
    });
  });
}

/**
 * Apply config to environment variables.
 * This should be called before creating sessions.
 */
export function applyConfigToEnv(config: AppConfig): void {
  const activeProfile = config.profiles?.[config.activeProfileKey] || {
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    model: config.model,
  };
  const projectedConfig: AppConfig = {
    ...config,
    apiKey: activeProfile.apiKey || '',
    baseUrl: activeProfile.baseUrl,
    model: activeProfile.model || '',
  };

  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_AUTH_TOKEN;
  delete process.env.ANTHROPIC_BASE_URL;
  delete process.env.CLAUDE_MODEL;
  delete process.env.ANTHROPIC_DEFAULT_SONNET_MODEL;
  delete process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_BASE_URL;
  delete process.env.OPENAI_MODEL;
  delete process.env.OPENAI_API_MODE;
  delete process.env.OPENAI_ACCOUNT_ID;
  delete process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_BASE_URL;
  delete process.env.CLAUDE_CODE_PATH;
  delete process.env.COWORK_WORKDIR;

  if (projectedConfig.provider === 'openai') {
    const resolvedOpenAI = resolveOpenAICredentials(projectedConfig);
    if (resolvedOpenAI?.apiKey) {
      process.env.OPENAI_API_KEY = resolvedOpenAI.apiKey;
    }
    const openAIBaseUrl = resolvedOpenAI?.baseUrl || projectedConfig.baseUrl;
    if (openAIBaseUrl) {
      process.env.OPENAI_BASE_URL = openAIBaseUrl;
    }
    if (resolvedOpenAI?.accountId) {
      process.env.OPENAI_ACCOUNT_ID = resolvedOpenAI.accountId;
    }
    if (projectedConfig.model) {
      process.env.OPENAI_MODEL = projectedConfig.model;
    }
  } else {
    const effectiveAnthropicApiKey =
      projectedConfig.apiKey?.trim() ||
      (shouldAllowEmptyAnthropicApiKey(projectedConfig) ? LOCAL_ANTHROPIC_PLACEHOLDER_KEY : '');
    const useAuthToken = shouldUseAnthropicAuthToken({
      ...projectedConfig,
      apiKey: effectiveAnthropicApiKey,
    });
    if (effectiveAnthropicApiKey) {
      if (useAuthToken) {
        process.env.ANTHROPIC_AUTH_TOKEN = effectiveAnthropicApiKey;
      } else {
        process.env.ANTHROPIC_API_KEY = effectiveAnthropicApiKey;
      }
    }
    const normalizedAnthropicBaseUrl = normalizeAnthropicBaseUrl(projectedConfig.baseUrl);
    if (normalizedAnthropicBaseUrl) {
      process.env.ANTHROPIC_BASE_URL = normalizedAnthropicBaseUrl;
    }
    if (useAuthToken) {
      delete process.env.ANTHROPIC_API_KEY;
    } else {
      delete process.env.ANTHROPIC_AUTH_TOKEN;
    }

    if (projectedConfig.model) {
      process.env.CLAUDE_MODEL = projectedConfig.model;
      process.env.ANTHROPIC_DEFAULT_SONNET_MODEL = projectedConfig.model;
    }
  }

  if (projectedConfig.defaultWorkdir) {
    process.env.COWORK_WORKDIR = projectedConfig.defaultWorkdir;
  }

  log('[Config] Applied env vars for provider:', projectedConfig.provider, {
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ? '✓ Set' : '(empty/unset)',
    ANTHROPIC_AUTH_TOKEN: process.env.ANTHROPIC_AUTH_TOKEN ? '✓ Set' : '(empty/unset)',
    ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL || '(default)',
    OPENAI_API_KEY: process.env.OPENAI_API_KEY ? '✓ Set' : '(empty/unset)',
    OPENAI_BASE_URL: process.env.OPENAI_BASE_URL || '(default)',
    OPENAI_MODEL: process.env.OPENAI_MODEL || '(not set)',
    OPENAI_API_MODE: process.env.OPENAI_API_MODE || '(default)',
    OPENAI_ACCOUNT_ID: process.env.OPENAI_ACCOUNT_ID || '(not set)',
    GEMINI_API_KEY: process.env.GEMINI_API_KEY ? '✓ Set' : '(empty/unset)',
    GEMINI_BASE_URL: process.env.GEMINI_BASE_URL || '(default)',
  });
}
