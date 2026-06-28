import type { AppConfig } from './config-schema';
import type { ProviderModelInfo } from '../../renderer/types';
import {
  OPENAI_PLATFORM_BASE_URL,
  isLoopbackOpenAIEndpoint,
  normalizeAnthropicBaseUrl,
  normalizeOpenAICompatibleBaseUrl,
  resolveOpenAICredentials,
  shouldAllowEmptyAnthropicApiKey,
  shouldUseAnthropicAuthToken,
} from './auth-utils';
import { listOllamaModels } from './ollama-api';

const LOCAL_ANTHROPIC_PLACEHOLDER_KEY = 'sk-ant-local-proxy';
const DEFAULT_ANTHROPIC_BASE_URL = 'https://api.anthropic.com';
const MODELS_LIST_TIMEOUT_MS = 15000;

export interface ListProviderModelsInput {
  provider: AppConfig['provider'];
  apiKey?: string;
  baseUrl?: string;
  customProtocol?: AppConfig['customProtocol'];
}

function buildHeaders(apiKey: string | undefined, useBearerAuth: boolean): HeadersInit {
  const headers: Record<string, string> = {
    Accept: 'application/json',
  };
  const trimmedApiKey = apiKey?.trim();
  if (!trimmedApiKey) {
    return headers;
  }
  if (useBearerAuth) {
    headers.Authorization = `Bearer ${trimmedApiKey}`;
  } else {
    headers['x-api-key'] = trimmedApiKey;
    headers['anthropic-version'] = '2023-06-01';
  }
  return headers;
}

function normalizeModelEntries(
  entries: Array<{ id?: string | null; name?: string | null; display_name?: string | null }>
): ProviderModelInfo[] {
  const seen = new Set<string>();
  const models: ProviderModelInfo[] = [];

  for (const entry of entries) {
    const id = entry.id?.trim();
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    const displayName = entry.display_name?.trim() || entry.name?.trim();
    models.push({ id, name: displayName || id });
  }

  return models.sort((a, b) => a.id.localeCompare(b.id));
}

async function fetchModelsIndex(input: {
  modelsUrl: string;
  apiKey?: string;
  useBearerAuth: boolean;
}): Promise<ProviderModelInfo[]> {
  const response = await fetch(input.modelsUrl, {
    method: 'GET',
    headers: buildHeaders(input.apiKey, input.useBearerAuth),
    signal: AbortSignal.timeout(MODELS_LIST_TIMEOUT_MS),
  });

  if (response.status === 404) {
    return [];
  }

  const text = await response.text();
  if (!response.ok) {
    throw new Error(text || `HTTP ${response.status}`);
  }

  let data: Record<string, unknown> = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Failed to parse models response: ${text.substring(0, 200)}`);
  }

  const rawItems = Array.isArray(data.data)
    ? data.data
    : Array.isArray(data.models)
      ? data.models
      : [];

  return normalizeModelEntries(
    rawItems.map((item) => {
      const modelItem = item as {
        id?: string | null;
        name?: string | null;
        display_name?: string | null;
      };
      return modelItem;
    })
  );
}

async function listOpenAICompatibleModels(
  input: ListProviderModelsInput
): Promise<ProviderModelInfo[]> {
  const config = {
    provider: input.provider,
    customProtocol: input.customProtocol,
    apiKey: input.apiKey,
    baseUrl: input.baseUrl,
  } as Pick<AppConfig, 'provider' | 'customProtocol' | 'apiKey' | 'baseUrl'>;

  const resolved = resolveOpenAICredentials(config);
  if (!resolved?.apiKey) {
    return [];
  }

  const clientBaseUrl =
    resolved.baseUrl ||
    normalizeOpenAICompatibleBaseUrl(input.baseUrl?.trim()) ||
    OPENAI_PLATFORM_BASE_URL;

  return fetchModelsIndex({
    modelsUrl: `${clientBaseUrl.replace(/\/+$/, '')}/models`,
    apiKey: resolved.apiKey,
    useBearerAuth: true,
  });
}

async function listAnthropicCompatibleModels(
  input: ListProviderModelsInput
): Promise<ProviderModelInfo[]> {
  const config = {
    provider: input.provider,
    customProtocol: input.customProtocol,
    apiKey: input.apiKey,
    baseUrl: input.baseUrl,
  } as Pick<AppConfig, 'provider' | 'customProtocol' | 'apiKey' | 'baseUrl'>;

  const clientBaseUrl =
    normalizeAnthropicBaseUrl(input.baseUrl?.trim()) || DEFAULT_ANTHROPIC_BASE_URL;
  const allowEmpty = shouldAllowEmptyAnthropicApiKey(config);
  const trimmedApiKey = input.apiKey?.trim() || '';
  const effectiveKey = trimmedApiKey || (allowEmpty ? LOCAL_ANTHROPIC_PLACEHOLDER_KEY : '');

  if (!effectiveKey) {
    return [];
  }

  const useBearerAuth = shouldUseAnthropicAuthToken({
    provider: input.provider,
    customProtocol: input.customProtocol,
    apiKey: effectiveKey,
  });

  return fetchModelsIndex({
    modelsUrl: `${clientBaseUrl.replace(/\/+$/, '')}/v1/models`,
    apiKey: effectiveKey,
    useBearerAuth,
  });
}

export async function listProviderModels(
  input: ListProviderModelsInput
): Promise<ProviderModelInfo[]> {
  if (input.provider === 'openai') {
    if (
      isLoopbackOpenAIEndpoint({
        provider: input.provider,
        baseUrl: input.baseUrl,
      })
    ) {
      return listOllamaModels({
        baseUrl: input.baseUrl,
        apiKey: input.apiKey,
      });
    }
    return listOpenAICompatibleModels(input);
  }

  if (input.provider === 'anthropic') {
    return listAnthropicCompatibleModels(input);
  }

  return [];
}
