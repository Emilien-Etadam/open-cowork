import type { AppConfig } from './config-schema';
import { isLoopbackBaseUrl as sharedIsLoopbackBaseUrl } from '../../shared/network/loopback';
import { normalizeOllamaBaseUrl as sharedNormalizeOllamaBaseUrl } from '../../shared/ollama-base-url';

const API_KEY_PREFIX_RE = /^sk-/i;
const CHATGPT_ACCOUNT_ID_RE = /^[-_a-zA-Z0-9]{6,}$/;
const OFFICIAL_OPENAI_HOSTS = new Set(['api.openai.com', 'chatgpt.com']);

export const OPENAI_PLATFORM_BASE_URL = 'https://api.openai.com/v1';
export const LOCAL_OPENAI_PLACEHOLDER_KEY = 'sk-openai-local-proxy';
export const OLLAMA_PLACEHOLDER_KEY = 'sk-ollama-local-proxy';

type OpenAIConfigLike = Pick<AppConfig, 'provider' | 'customProtocol' | 'apiKey' | 'baseUrl'>;

export interface ResolvedOpenAICredentials {
  apiKey: string;
  baseUrl?: string;
  accountId?: string;
}

export function isLikelyOAuthAccessToken(token: string | undefined | null): boolean {
  const value = token?.trim();
  if (!value) {
    return false;
  }
  return !API_KEY_PREFIX_RE.test(value);
}

export function shouldUseAnthropicAuthToken(
  config: Pick<AppConfig, 'provider' | 'customProtocol' | 'apiKey'>
): boolean {
  if (config.provider !== 'anthropic') {
    return false;
  }
  return isLikelyOAuthAccessToken(config.apiKey);
}

export function isOpenAIProvider(config: Pick<AppConfig, 'provider' | 'customProtocol'>): boolean {
  return config.provider === 'openai';
}

export function sanitizeOpenAIAccountId(raw: string | undefined): string | undefined {
  const value = raw?.trim();
  if (!value || value.includes('@')) {
    return undefined;
  }
  if (!CHATGPT_ACCOUNT_ID_RE.test(value)) {
    return undefined;
  }
  return value;
}

function normalizeBaseUrl(baseUrl: string | undefined): string | undefined {
  const value = baseUrl?.trim();
  if (!value) {
    return undefined;
  }
  return value.replace(/\/+$/, '');
}

export function normalizeOpenAICompatibleBaseUrl(baseUrl: string | undefined): string | undefined {
  const normalized = normalizeBaseUrl(baseUrl);
  if (!normalized) {
    return undefined;
  }
  try {
    const parsed = new URL(normalized);
    const host = parsed.hostname.toLowerCase();

    // OpenRouter has its own path convention (/api/v1) — handle separately.
    if (host.includes('openrouter.ai')) {
      let pathname = parsed.pathname.replace(/\/+$/, '');
      pathname = pathname
        .replace(/\/chat\/completions$/i, '')
        .replace(/\/completions$/i, '')
        .replace(/\/responses$/i, '')
        .replace(/\/+$/, '');
      if (!pathname || pathname === '/') {
        parsed.pathname = '/api/v1';
        return parsed.toString().replace(/\/+$/, '');
      }
      if (/^\/api$/i.test(pathname)) {
        parsed.pathname = '/api/v1';
        return parsed.toString().replace(/\/+$/, '');
      }
      parsed.pathname = pathname;
      return parsed.toString().replace(/\/+$/, '');
    }

    let pathname = parsed.pathname.replace(/\/+$/, '');
    pathname = pathname
      .replace(/\/chat\/completions$/i, '')
      .replace(/\/completions$/i, '')
      .replace(/\/responses$/i, '')
      .replace(/\/+$/, '');

    parsed.pathname = pathname || '/';
    return parsed.toString().replace(/\/+$/, '');
  } catch {
    return normalized;
  }
}

export function normalizeOllamaBaseUrl(baseUrl: string | undefined): string | undefined {
  return sharedNormalizeOllamaBaseUrl(baseUrl);
}

function extractHostname(baseUrl: string | undefined): string | undefined {
  const normalized = normalizeBaseUrl(baseUrl);
  if (!normalized) {
    return undefined;
  }
  try {
    return new URL(normalized).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

export function isOfficialOpenAIBaseUrl(baseUrl: string | undefined): boolean {
  const host = extractHostname(baseUrl);
  if (!host) {
    return false;
  }
  if (OFFICIAL_OPENAI_HOSTS.has(host)) {
    return true;
  }
  for (const officialHost of OFFICIAL_OPENAI_HOSTS) {
    if (host.endsWith(`.${officialHost}`)) {
      return true;
    }
  }
  return false;
}

export function getUnifiedUnsupportedCustomOpenAIBaseUrl(config: OpenAIConfigLike): string | null {
  if (config.provider !== 'openai') {
    return null;
  }
  const resolved = resolveOpenAICredentials(config);
  const baseUrl = resolved?.baseUrl || config.baseUrl;
  if (!isOfficialOpenAIBaseUrl(baseUrl)) {
    return null;
  }
  return normalizeBaseUrl(baseUrl) || OPENAI_PLATFORM_BASE_URL;
}

export function normalizeAnthropicBaseUrl(baseUrl: string | undefined): string | undefined {
  const value = normalizeBaseUrl(baseUrl);
  if (!value) {
    return undefined;
  }
  if (/\/v1$/i.test(value)) {
    return value.slice(0, -3);
  }
  return value;
}

export function resolveOpenAICredentials(
  config: OpenAIConfigLike
): ResolvedOpenAICredentials | null {
  const trimmedApiKey = config.apiKey?.trim();
  const placeholderKey = isLoopbackOpenAIEndpoint(config)
    ? OLLAMA_PLACEHOLDER_KEY
    : LOCAL_OPENAI_PLACEHOLDER_KEY;
  const effectiveApiKey =
    trimmedApiKey || (shouldAllowEmptyOpenAIApiKey(config) ? placeholderKey : '');
  if (effectiveApiKey) {
    const rawBaseUrl = config.baseUrl?.trim();
    const baseUrl = rawBaseUrl
      ? isLoopbackOpenAIEndpoint(config)
        ? normalizeOllamaBaseUrl(rawBaseUrl)
        : normalizeOpenAICompatibleBaseUrl(rawBaseUrl)
      : undefined;
    return {
      apiKey: effectiveApiKey,
      baseUrl,
    };
  }

  return null;
}

export function isLoopbackBaseUrl(baseUrl: string | undefined): boolean {
  return sharedIsLoopbackBaseUrl(baseUrl);
}

export function isLoopbackOpenAIEndpoint(config: Pick<AppConfig, 'provider' | 'baseUrl'>): boolean {
  return config.provider === 'openai' && isLoopbackBaseUrl(config.baseUrl);
}

export function shouldAllowEmptyAnthropicApiKey(
  config: Pick<AppConfig, 'provider' | 'customProtocol' | 'baseUrl'>
): boolean {
  return config.provider === 'anthropic' && isLoopbackBaseUrl(config.baseUrl);
}

export function shouldAllowEmptyOpenAIApiKey(
  config: Pick<AppConfig, 'provider' | 'customProtocol' | 'baseUrl'>
): boolean {
  return config.provider === 'openai' && isLoopbackBaseUrl(config.baseUrl);
}

/** @deprecated Use isLoopbackOpenAIEndpoint */
export function isOllamaLegacyCustomOpenAIConfig(
  config: Pick<AppConfig, 'provider' | 'customProtocol' | 'baseUrl'>
): boolean {
  return isLoopbackOpenAIEndpoint(config);
}

/** @deprecated Use resolveOpenAICredentials */
export function resolveOllamaCredentials(
  config: OpenAIConfigLike
): ResolvedOpenAICredentials | null {
  if (config.provider !== 'openai' || !isLoopbackOpenAIEndpoint(config)) {
    return null;
  }
  return resolveOpenAICredentials(config);
}

/** @deprecated Use shouldAllowEmptyOpenAIApiKey */
export function shouldAllowEmptyOllamaApiKey(
  config: Pick<AppConfig, 'provider' | 'customProtocol' | 'baseUrl'>
): boolean {
  return shouldAllowEmptyOpenAIApiKey(config);
}

/** @deprecated Loopback anthropic gateways no longer use a separate gemini protocol */
export function shouldAllowEmptyGeminiApiKey(
  _config: Pick<AppConfig, 'provider' | 'customProtocol' | 'baseUrl'>
): boolean {
  return false;
}
