import { describe, expect, it } from 'vitest';

import {
  normalizeOllamaBaseUrl,
  getUnifiedUnsupportedCustomOpenAIBaseUrl,
  isOfficialOpenAIBaseUrl,
  isLoopbackOpenAIEndpoint,
  isOllamaLegacyCustomOpenAIConfig,
  isLoopbackBaseUrl,
  isLikelyOAuthAccessToken,
  normalizeAnthropicBaseUrl,
  resolveOllamaCredentials,
  resolveOpenAICredentials,
  sanitizeOpenAIAccountId,
  shouldAllowEmptyAnthropicApiKey,
  shouldAllowEmptyOpenAIApiKey,
  shouldAllowEmptyOllamaApiKey,
  shouldUseAnthropicAuthToken,
} from '../src/main/config/auth-utils';

describe('auth-utils', () => {
  it('detects oauth-style tokens', () => {
    expect(isLikelyOAuthAccessToken('oauth-access-token')).toBe(true);
    expect(isLikelyOAuthAccessToken('sk-ant-123')).toBe(false);
  });

  it('chooses auth token mode for anthropic oauth tokens only', () => {
    expect(
      shouldUseAnthropicAuthToken({
        provider: 'anthropic',
        customProtocol: 'anthropic',
        apiKey: 'oauth-token',
      })
    ).toBe(true);
    expect(
      shouldUseAnthropicAuthToken({
        provider: 'anthropic',
        customProtocol: 'anthropic',
        apiKey: 'sk-ant-abc',
      })
    ).toBe(false);
    expect(
      shouldUseAnthropicAuthToken({
        provider: 'openai',
        customProtocol: 'openai',
        apiKey: 'sk-or-v1-abc',
      })
    ).toBe(false);
  });

  it('resolves openai credentials when api key is provided', () => {
    const resolved = resolveOpenAICredentials({
      provider: 'openai',
      customProtocol: 'openai',
      apiKey: 'sk-test-123',
      baseUrl: 'https://api.openai.com/v1',
    });

    expect(resolved).toEqual({
      apiKey: 'sk-test-123',
      baseUrl: 'https://api.openai.com/v1',
    });
  });

  it('returns null when openai api key is empty on remote endpoints', () => {
    const resolved = resolveOpenAICredentials({
      provider: 'openai',
      customProtocol: 'openai',
      apiKey: '',
      baseUrl: 'https://api.openai.com/v1',
    });

    expect(resolved).toBeNull();
  });

  it('injects a placeholder key for openai loopback gateway when api key is empty', () => {
    const resolved = resolveOpenAICredentials({
      provider: 'openai',
      customProtocol: 'openai',
      apiKey: '',
      baseUrl: 'http://127.0.0.1:8082/v1',
    });

    expect(resolved).toEqual({
      apiKey: 'sk-ollama-local-proxy',
      baseUrl: 'http://127.0.0.1:8082/v1',
    });
  });

  it('sanitizes invalid OpenAI account id values', () => {
    expect(sanitizeOpenAIAccountId('user@example.com')).toBeUndefined();
    expect(sanitizeOpenAIAccountId('abc')).toBeUndefined();
    expect(sanitizeOpenAIAccountId('acct_123456')).toBe('acct_123456');
  });

  it('detects loopback gateway urls', () => {
    expect(isLoopbackBaseUrl('http://127.0.0.1:8082')).toBe(true);
    expect(isLoopbackBaseUrl('http://localhost:8082')).toBe(true);
    expect(isLoopbackBaseUrl('http://[::1]:8082')).toBe(true);
    expect(isLoopbackBaseUrl('http://0.0.0.0:8082')).toBe(false);
    expect(isLoopbackBaseUrl('https://api.example.com')).toBe(false);
  });

  it('normalizes anthropic base urls by removing a trailing /v1 segment', () => {
    expect(normalizeAnthropicBaseUrl('https://api.duckcoding.ai/v1')).toBe(
      'https://api.duckcoding.ai'
    );
    expect(normalizeAnthropicBaseUrl('https://proxy.example.com/anthropic/v1/')).toBe(
      'https://proxy.example.com/anthropic'
    );
    expect(normalizeAnthropicBaseUrl('https://proxy.example.com/anthropic')).toBe(
      'https://proxy.example.com/anthropic'
    );
  });

  it('detects official openai base urls', () => {
    expect(isOfficialOpenAIBaseUrl('https://api.openai.com/v1')).toBe(true);
    expect(isOfficialOpenAIBaseUrl('https://chatgpt.com/backend-api/codex')).toBe(true);
    expect(isOfficialOpenAIBaseUrl('https://api.duckcoding.ai/v1')).toBe(false);
    expect(isOfficialOpenAIBaseUrl('https://proxy.example.com/openai')).toBe(false);
  });

  it('flags unsupported openai + official openai base in unified sdk path', () => {
    expect(
      getUnifiedUnsupportedCustomOpenAIBaseUrl({
        provider: 'openai',
        customProtocol: 'openai',
        apiKey: 'sk-test-123',
        baseUrl: 'https://api.openai.com/v1',
      })
    ).toBe('https://api.openai.com/v1');

    expect(
      getUnifiedUnsupportedCustomOpenAIBaseUrl({
        provider: 'openai',
        customProtocol: 'openai',
        apiKey: 'sk-test-123',
        baseUrl: 'https://api.duckcoding.ai/v1',
      })
    ).toBeNull();
  });

  it('allows empty anthropic api key only for anthropic loopback gateway', () => {
    expect(
      shouldAllowEmptyAnthropicApiKey({
        provider: 'anthropic',
        customProtocol: 'anthropic',
        baseUrl: 'http://[::1]:8082',
      })
    ).toBe(true);

    expect(
      shouldAllowEmptyAnthropicApiKey({
        provider: 'anthropic',
        customProtocol: 'anthropic',
        baseUrl: 'https://proxy.example.com',
      })
    ).toBe(false);
  });

  it('allows empty openai api key only for openai loopback gateway', () => {
    expect(
      shouldAllowEmptyOpenAIApiKey({
        provider: 'openai',
        customProtocol: 'openai',
        baseUrl: 'http://127.0.0.1:8082',
      })
    ).toBe(true);

    expect(
      shouldAllowEmptyOpenAIApiKey({
        provider: 'openai',
        customProtocol: 'openai',
        baseUrl: 'https://proxy.example.com',
      })
    ).toBe(false);
  });

  it('allows empty ollama api key alias for loopback openai endpoints', () => {
    expect(
      shouldAllowEmptyOllamaApiKey({
        provider: 'openai',
        customProtocol: 'openai',
        baseUrl: 'http://localhost:11434/v1',
      })
    ).toBe(true);
  });

  it('normalizes ollama base urls to an openai-compatible /v1 endpoint', () => {
    expect(normalizeOllamaBaseUrl('http://localhost:11434')).toBe('http://localhost:11434/v1');
    expect(normalizeOllamaBaseUrl('http://localhost:11434/api')).toBe('http://localhost:11434/v1');
    expect(normalizeOllamaBaseUrl(undefined)).toBeUndefined();
  });

  it('injects an internal placeholder key for loopback openai when api key is empty', () => {
    const resolved = resolveOllamaCredentials({
      provider: 'openai',
      customProtocol: 'openai',
      apiKey: '',
      baseUrl: 'http://localhost:11434/api',
    });

    expect(resolved).toEqual({
      apiKey: 'sk-ollama-local-proxy',
      baseUrl: 'http://localhost:11434/v1',
    });
  });

  it('detects loopback openai endpoints conservatively', () => {
    expect(
      isLoopbackOpenAIEndpoint({
        provider: 'openai',
        baseUrl: 'http://localhost:11434/v1',
      })
    ).toBe(true);

    expect(
      isOllamaLegacyCustomOpenAIConfig({
        provider: 'openai',
        customProtocol: 'openai',
        baseUrl: 'https://ollama.example.internal/v1',
      })
    ).toBe(false);
  });
});
