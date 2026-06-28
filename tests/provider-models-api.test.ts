import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { listProviderModels } from '../src/main/config/provider-models-api';
import { resetOllamaModelIndexCache } from '../src/main/config/ollama-api';

describe('provider models api', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    resetOllamaModelIndexCache();
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('lists remote openai-compatible models from the models endpoint', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          object: 'list',
          data: [
            { id: 'gpt-5.4', object: 'model' },
            { id: 'o4-mini', object: 'model' },
          ],
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    );

    const result = await listProviderModels({
      provider: 'openai',
      apiKey: 'sk-test',
      baseUrl: 'https://api.openai.com/v1',
    });

    expect(result).toEqual([
      { id: 'gpt-5.4', name: 'gpt-5.4' },
      { id: 'o4-mini', name: 'o4-mini' },
    ]);
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.openai.com/v1/models',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'Bearer sk-test',
        }),
      })
    );
  });

  it('returns an empty list when remote openai models endpoint is unsupported', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      new Response('Not Found', {
        status: 404,
      })
    );

    const result = await listProviderModels({
      provider: 'openai',
      apiKey: 'sk-test',
      baseUrl: 'https://dashscope.example/v1',
    });

    expect(result).toEqual([]);
  });

  it('lists anthropic-compatible models from the models endpoint', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [
            { id: 'claude-sonnet-4-6', display_name: 'Claude Sonnet 4.6' },
            { id: 'claude-haiku-4-5', display_name: 'Claude Haiku 4.5' },
          ],
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    );

    const result = await listProviderModels({
      provider: 'anthropic',
      apiKey: 'sk-ant-test',
      baseUrl: 'https://api.anthropic.com',
    });

    expect(result).toEqual([
      { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5' },
      { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6' },
    ]);
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.anthropic.com/v1/models',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          'x-api-key': 'sk-ant-test',
        }),
      })
    );
  });

  it('delegates loopback openai discovery to the ollama models endpoint', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          object: 'list',
          data: [{ id: 'qwen3.5:0.8b', object: 'model' }],
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    );

    const result = await listProviderModels({
      provider: 'openai',
      apiKey: '',
      baseUrl: 'http://localhost:11434/v1',
    });

    expect(result).toEqual([{ id: 'qwen3.5:0.8b', name: 'qwen3.5:0.8b' }]);
    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:11434/v1/models',
      expect.objectContaining({ method: 'GET' })
    );
  });
});
