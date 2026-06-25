import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  seed: {} as Record<string, unknown>,
}));

vi.mock('electron-store', () => {
  class MockStore<T extends Record<string, unknown>> {
    public store: Record<string, unknown>;
    public path = '/tmp/mock-config-store.json';

    constructor(options: { defaults?: Record<string, unknown> }) {
      this.store = {
        ...(options?.defaults || {}),
        ...mocks.seed,
      };
    }

    get<K extends keyof T>(key: K): T[K] {
      return this.store[key as string] as T[K];
    }

    set(key: string | Record<string, unknown>, value?: unknown): void {
      if (typeof key === 'string') {
        this.store[key] = value;
        return;
      }
      this.store = {
        ...this.store,
        ...key,
      };
    }

    clear(): void {
      this.store = {};
    }
  }

  return {
    default: MockStore,
  };
});

import { ConfigStore } from '../src/main/config/config-store';

describe('ConfigStore provider profiles', () => {
  beforeEach(() => {
    mocks.seed = {};
  });

  it('migrates legacy single-profile fields into active profile', () => {
    mocks.seed = {
      provider: 'openai',
      customProtocol: 'openai',
      apiKey: 'sk-legacy-openai',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-5.2-mini',
      enableDevLogs: true,
      sandboxEnabled: false,
      enableThinking: false,
      isConfigured: true,
    };

    const store = new ConfigStore();
    const config = store.getAll();

    expect(config.activeProfileKey).toBe('openai');
    expect(config.apiKey).toBe('sk-legacy-openai');
    expect(config.profiles.openai?.apiKey).toBe('sk-legacy-openai');
    expect(config.profiles.anthropic?.apiKey).toBe('');
  });

  it('switches provider without overwriting other provider profiles', () => {
    mocks.seed = {
      provider: 'openai',
      customProtocol: 'openai',
      activeProfileKey: 'openai',
      profiles: {
        openai: {
          apiKey: 'sk-openai',
          baseUrl: 'https://api.openai.com/v1',
          model: 'gpt-5.2',
        },
        anthropic: {
          apiKey: 'sk-ant',
          baseUrl: 'https://api.anthropic.com',
          model: 'claude-sonnet-4-6',
        },
      },
      enableDevLogs: true,
      sandboxEnabled: false,
      enableThinking: false,
      isConfigured: true,
    };

    const store = new ConfigStore();
    store.update({ provider: 'anthropic' });
    const switched = store.getAll();

    expect(switched.provider).toBe('anthropic');
    expect(switched.apiKey).toBe('sk-ant');
    expect(switched.profiles.openai?.apiKey).toBe('sk-openai');

    store.update({ provider: 'openai' });
    const back = store.getAll();
    expect(back.provider).toBe('openai');
    expect(back.apiKey).toBe('sk-openai');
  });

  it('updates active profile credentials only for current profile', () => {
    const store = new ConfigStore();

    store.update({ provider: 'openai' });
    store.update({
      apiKey: 'sk-openai-new',
      model: 'gpt-5.4',
      baseUrl: 'https://api.openai.com/v1',
    });

    store.update({ provider: 'anthropic' });
    const anthropicView = store.getAll();
    expect(anthropicView.provider).toBe('anthropic');
    expect(anthropicView.apiKey).toBe('');

    store.update({ provider: 'openai' });
    const openaiView = store.getAll();
    expect(openaiView.provider).toBe('openai');
    expect(openaiView.apiKey).toBe('sk-openai-new');
    expect(openaiView.model).toBe('gpt-5.4');
  });

  it('keeps openai and anthropic profiles isolated from each other', () => {
    const store = new ConfigStore();

    store.update({
      provider: 'openai',
      apiKey: 'sk-openai',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-5.4',
    });
    store.update({
      provider: 'anthropic',
      apiKey: 'sk-ant',
      baseUrl: 'https://api.anthropic.com',
      model: 'claude-sonnet-4-6',
    });

    const anthropicView = store.getAll();
    expect(anthropicView.provider).toBe('anthropic');
    expect(anthropicView.apiKey).toBe('sk-ant');
    expect(anthropicView.profiles.openai?.apiKey).toBe('sk-openai');

    store.update({ provider: 'openai' });
    const openaiView = store.getAll();
    expect(openaiView.provider).toBe('openai');
    expect(openaiView.apiKey).toBe('sk-openai');
    expect(openaiView.model).toBe('gpt-5.4');
  });

  it('treats global configured state as any set usable while active set can still be unusable', () => {
    const store = new ConfigStore();

    store.update({ provider: 'openai', apiKey: 'sk-openai-global' });
    store.createSet({ name: 'Blank Active', mode: 'blank' });

    expect(store.hasUsableCredentialsForActiveSet()).toBe(false);
    expect(store.hasAnyUsableCredentials()).toBe(true);
    expect(store.isConfigured()).toBe(true);
  });

  it('treats local anthropic gateway as usable without api key', () => {
    const store = new ConfigStore();

    store.update({
      provider: 'anthropic',
      customProtocol: 'anthropic',
      apiKey: '',
      baseUrl: 'http://127.0.0.1:8082',
      model: 'claude-sonnet-4-6',
    });

    expect(store.hasUsableCredentialsForActiveSet()).toBe(true);
  });

  it('treats loopback openai gateway as usable without api key', () => {
    const store = new ConfigStore();

    store.update({
      provider: 'openai',
      customProtocol: 'openai',
      apiKey: '',
      baseUrl: 'http://127.0.0.1:8082/v1',
      model: 'qwen3.5:0.8b',
    });

    expect(store.hasUsableCredentialsForActiveSet()).toBe(true);
  });
});
