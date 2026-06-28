import { describe, expect, it } from 'vitest';
import type { AppConfig } from '../src/renderer/types';
import fs from 'node:fs';
import path from 'node:path';
import { shouldAutoDiscoverLocalOllamaBaseUrl } from '../src/shared/ollama-base-url';
import { isLoopbackBaseUrl } from '../src/shared/network/loopback';
import {
  FALLBACK_PROVIDER_PRESETS,
  buildApiConfigSnapshot,
  canDiscoverProviderModels,
  getModelInputGuidance,
  isLocalOpenAiMode,
  profileKeyFromProvider,
  profileKeyToProvider,
} from '../src/renderer/hooks/useApiConfigState';

const hookPath = path.resolve(
  process.cwd(),
  'src/renderer/hooks/api-config/use-api-config-state-hook.ts'
);
const ollamaActionsPath = path.resolve(
  process.cwd(),
  'src/renderer/hooks/api-config/api-config-ollama-actions.ts'
);

describe('api config state helpers', () => {
  it('maps provider/protocol to profile key and back', () => {
    expect(profileKeyFromProvider('openai')).toBe('openai');
    expect(profileKeyFromProvider('anthropic')).toBe('anthropic');
    expect(profileKeyToProvider('openai')).toEqual({
      provider: 'openai',
      customProtocol: 'openai',
    });
    expect(profileKeyToProvider('anthropic')).toEqual({
      provider: 'anthropic',
      customProtocol: 'anthropic',
    });
  });

  it('loads loopback openai profile values from config', () => {
    const config = {
      provider: 'openai',
      customProtocol: 'openai',
      activeProfileKey: 'openai',
      apiKey: '',
      baseUrl: 'http://localhost:11434/v1',
      model: 'qwen3.5:0.8b',
      profiles: {
        openai: {
          apiKey: '',
          baseUrl: 'http://localhost:11434/v1',
          model: 'qwen3.5:0.8b',
        },
      },
      isConfigured: true,
    } as AppConfig;

    const snapshot = buildApiConfigSnapshot(config, FALLBACK_PROVIDER_PRESETS);
    expect(snapshot.activeProfileKey).toBe('openai');
    expect(snapshot.profiles.openai.baseUrl).toBe('http://localhost:11434/v1');
    expect(snapshot.profiles.openai.customModel).toBe('qwen3.5:0.8b');
  });

  it('normalizes openai loopback base urls during renderer bootstrap', () => {
    const config = {
      provider: 'openai',
      customProtocol: 'openai',
      activeProfileKey: 'openai',
      apiKey: '',
      baseUrl: 'http://localhost:11434/api',
      model: 'qwen3.5:0.8b',
      profiles: {
        openai: {
          apiKey: '',
          baseUrl: 'http://localhost:11434/api',
          model: 'qwen3.5:0.8b',
        },
      },
      isConfigured: true,
    } as AppConfig;

    const snapshot = buildApiConfigSnapshot(config, FALLBACK_PROVIDER_PRESETS);
    expect(snapshot.profiles.openai.baseUrl).toBe('http://localhost:11434/v1');
  });

  it('keeps remote openai configs on the openai profile', () => {
    const config = {
      provider: 'openai',
      customProtocol: 'openai',
      activeProfileKey: 'openai',
      apiKey: '',
      baseUrl: 'https://relay.example.internal/v1',
      model: 'qwen3.5:0.8b',
      profiles: {
        openai: {
          apiKey: '',
          baseUrl: 'https://relay.example.internal/v1',
          model: 'qwen3.5:0.8b',
        },
      },
      isConfigured: true,
    } as AppConfig;

    const snapshot = buildApiConfigSnapshot(config, FALLBACK_PROVIDER_PRESETS);
    expect(snapshot.activeProfileKey).toBe('openai');
  });

  it('exposes openai guidance for local servers', () => {
    expect(getModelInputGuidance('openai').placeholder).toContain('qwen');
    expect(isLocalOpenAiMode('openai', 'http://localhost:11434/v1')).toBe(true);
    expect(isLocalOpenAiMode('openai', 'https://api.openai.com/v1')).toBe(false);
  });

  it('loads existing profile values without overwriting them with defaults', () => {
    const config = {
      provider: 'openai',
      customProtocol: 'openai',
      activeProfileKey: 'openai',
      apiKey: 'sk-active',
      baseUrl: 'https://custom-openai.example/v1',
      model: 'gpt-5.3-codex',
      profiles: {
        openai: {
          apiKey: 'sk-custom-openai',
          baseUrl: 'https://custom-openai.example/v1',
          model: 'gpt-5.3-codex',
        },
        anthropic: {
          apiKey: 'sk-custom-anthropic',
          baseUrl: 'https://custom-anthropic.example',
          model: 'claude-sonnet-4-6',
        },
      },
      isConfigured: true,
    } as AppConfig;

    const snapshot = buildApiConfigSnapshot(config, FALLBACK_PROVIDER_PRESETS);
    expect(snapshot.activeProfileKey).toBe('openai');
    expect(snapshot.profiles.openai.apiKey).toBe('sk-custom-openai');
    expect(snapshot.profiles.openai.baseUrl).toBe('https://custom-openai.example/v1');
    expect(snapshot.profiles.anthropic.apiKey).toBe('sk-custom-anthropic');
  });

  it('applies defaults only for missing profiles', () => {
    const config = {
      provider: 'openai',
      customProtocol: 'openai',
      activeProfileKey: 'openai',
      apiKey: 'sk-openai',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-5.4',
      profiles: {
        openai: {
          apiKey: 'sk-openai',
          baseUrl: 'https://api.openai.com/v1',
          model: 'gpt-5.4',
        },
      },
      isConfigured: true,
    } as AppConfig;

    const snapshot = buildApiConfigSnapshot(config, FALLBACK_PROVIDER_PRESETS);
    expect(snapshot.profiles.openai.apiKey).toBe('sk-openai');
    expect(snapshot.profiles.anthropic.baseUrl).toBe(FALLBACK_PROVIDER_PRESETS.anthropic.baseUrl);
    expect(snapshot.profiles.openai.useCustomModel).toBe(true);
  });

  it('detects loopback gateway urls', () => {
    expect(isLoopbackBaseUrl('http://127.0.0.1:8082')).toBe(true);
    expect(isLoopbackBaseUrl('http://localhost:8082')).toBe(true);
    expect(isLoopbackBaseUrl('http://[::1]:8082')).toBe(true);
    expect(isLoopbackBaseUrl('http://0.0.0.0:8082')).toBe(false);
    expect(isLoopbackBaseUrl('https://proxy.example.com')).toBe(false);
  });

  it('allows remote model discovery when credentials and base url are present', () => {
    expect(
      canDiscoverProviderModels(
        'openai',
        'https://api.openai.com/v1',
        'sk-test',
        true,
        FALLBACK_PROVIDER_PRESETS.openai.baseUrl
      )
    ).toBe(true);
    expect(canDiscoverProviderModels('openai', 'https://api.openai.com/v1', '', true, '')).toBe(
      false
    );
    expect(canDiscoverProviderModels('anthropic', '', 'sk-ant-test', true, '')).toBe(true);
  });

  it('wires model discovery through the shared config hook', () => {
    const hookSource = fs.readFileSync(hookPath, 'utf8');
    const ollamaSource = fs.readFileSync(ollamaActionsPath, 'utf8');
    expect(hookSource).toContain('useApiConfigActions');
    expect(ollamaSource).toContain('window.electronAPI.config.discoverLocal({');
    expect(ollamaSource).toContain('canDiscoverProviderModels');
    expect(ollamaSource).toContain("showErrorKey('api.localOllamaNotFound')");
    expect(ollamaSource).toContain("showSuccessKey('api.localOllamaDiscovered'");
    expect(ollamaSource).toContain('autoSelectModelId: models[0]?.id');
  });

  it('keeps the shared auto-discovery helper constrained to the default local endpoint', () => {
    expect(shouldAutoDiscoverLocalOllamaBaseUrl(undefined)).toBe(true);
    expect(shouldAutoDiscoverLocalOllamaBaseUrl('')).toBe(true);
    expect(shouldAutoDiscoverLocalOllamaBaseUrl('http://localhost:11434')).toBe(true);
    expect(shouldAutoDiscoverLocalOllamaBaseUrl('http://localhost:11434/api')).toBe(true);
    expect(shouldAutoDiscoverLocalOllamaBaseUrl('http://127.0.0.1:11434')).toBe(false);
    expect(shouldAutoDiscoverLocalOllamaBaseUrl('http://127.0.0.1:8080/v1')).toBe(false);
    expect(shouldAutoDiscoverLocalOllamaBaseUrl('https://ollama.example.internal/v1')).toBe(false);
  });
});
