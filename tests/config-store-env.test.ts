import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron-store', () => {
  class MockStore<T extends Record<string, unknown>> {
    public store: Record<string, unknown>;
    public path = '/tmp/mock-config-store-env.json';

    constructor(options: { defaults?: Record<string, unknown> }) {
      this.store = {
        ...(options?.defaults || {}),
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

describe('ConfigStore applyToEnv', () => {
  const originalEnv = {
    COWORK_WORKDIR: process.env.COWORK_WORKDIR,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
  };

  beforeEach(() => {
    delete process.env.COWORK_WORKDIR;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_BASE_URL;
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_BASE_URL;
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  it('clears stale COWORK_WORKDIR when config value is removed', () => {
    const store = new ConfigStore();

    store.update({
      defaultWorkdir: '/tmp/cowork-valid-workdir',
      provider: 'anthropic',
      apiKey: 'sk-ant-test',
      model: 'claude-sonnet-4-5',
    });
    store.applyToEnv();
    expect(process.env.COWORK_WORKDIR).toBe('/tmp/cowork-valid-workdir');

    store.update({
      defaultWorkdir: '',
    });
    store.applyToEnv();

    expect(process.env.COWORK_WORKDIR).toBeUndefined();
  });

  it('exports loopback placeholder key for anthropic profile when api key is empty', () => {
    const store = new ConfigStore();

    store.update({
      provider: 'anthropic',
      customProtocol: 'anthropic',
      apiKey: '',
      baseUrl: 'http://127.0.0.1:8082',
      model: 'claude-sonnet-4-6',
    });
    store.applyToEnv();

    expect(process.env.ANTHROPIC_API_KEY).toBe('sk-ant-local-proxy');
  });

  it('exports loopback placeholder key for openai profile when api key is empty', () => {
    const store = new ConfigStore();

    store.update({
      provider: 'openai',
      customProtocol: 'openai',
      apiKey: '',
      baseUrl: 'http://127.0.0.1:8082/v1',
      model: 'gpt-4.1-mini',
    });
    store.applyToEnv();

    expect(process.env.OPENAI_API_KEY).toBe('sk-ollama-local-proxy');
    expect(process.env.OPENAI_BASE_URL).toBe('http://127.0.0.1:8082/v1');
  });

  it('exports openai credentials for remote compatible endpoints when api key is provided', () => {
    const store = new ConfigStore();

    store.update({
      provider: 'openai',
      apiKey: 'sk-remote',
      baseUrl: 'https://ollama.example.internal/proxy/api',
      model: 'qwen3.5:0.8b',
    });
    store.applyToEnv();

    expect(process.env.OPENAI_API_KEY).toBe('sk-remote');
    expect(process.env.OPENAI_BASE_URL).toBe('https://ollama.example.internal/proxy/v1');
    expect(process.env.OPENAI_MODEL).toBe('qwen3.5:0.8b');
  });

  it('normalizes trailing /v1 for anthropic-compatible base url when applying env', () => {
    const store = new ConfigStore();

    store.update({
      provider: 'anthropic',
      customProtocol: 'anthropic',
      apiKey: 'sk-test',
      baseUrl: 'https://api.duckcoding.ai/v1',
      model: 'claude-sonnet-4-6',
    });
    store.applyToEnv();

    expect(process.env.ANTHROPIC_BASE_URL).toBe('https://api.duckcoding.ai');
  });

  it('exports openai credentials without leaking anthropic auth env', () => {
    const store = new ConfigStore();

    store.update({
      provider: 'openai',
      customProtocol: 'openai',
      apiKey: 'sk-openai-test',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-5.4',
    });
    store.applyToEnv();

    expect(process.env.OPENAI_API_KEY).toBe('sk-openai-test');
    expect(process.env.OPENAI_BASE_URL).toBe('https://api.openai.com/v1');
    expect(process.env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
  });
});
