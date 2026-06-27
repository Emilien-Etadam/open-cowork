import { afterEach, describe, expect, it } from 'vitest';
import {
  formatWebSearchResponse,
  normalizeWebSearchConfig,
  providerRequiresBaseUrl,
  resolveWebSearchBaseUrl,
  type WebSearchResponse,
} from '../src/shared/web-search';

describe('normalizeWebSearchConfig', () => {
  it('defaults to duckduckgo', () => {
    const config = normalizeWebSearchConfig(undefined);
    expect(config.provider).toBe('duckduckgo');
    expect(config.maxResults).toBe(8);
  });

  it('clamps maxResults between 1 and 20', () => {
    expect(normalizeWebSearchConfig({ maxResults: 0 }).maxResults).toBe(8);
    expect(normalizeWebSearchConfig({ maxResults: 99 }).maxResults).toBe(20);
  });
});

describe('resolveWebSearchBaseUrl', () => {
  const originalSearx = process.env.SEARXNG_BASE_URL;
  const originalYacy = process.env.YACY_BASE_URL;

  afterEach(() => {
    if (originalSearx === undefined) {
      delete process.env.SEARXNG_BASE_URL;
    } else {
      process.env.SEARXNG_BASE_URL = originalSearx;
    }
    if (originalYacy === undefined) {
      delete process.env.YACY_BASE_URL;
    } else {
      process.env.YACY_BASE_URL = originalYacy;
    }
  });

  it('prefers explicit config base URL', () => {
    const url = resolveWebSearchBaseUrl(
      normalizeWebSearchConfig({ provider: 'searxng', baseUrl: 'http://10.0.0.5:8080' })
    );
    expect(url).toBe('http://10.0.0.5:8080');
  });

  it('falls back to SEARXNG_BASE_URL', () => {
    process.env.SEARXNG_BASE_URL = 'http://localhost:8888';
    const url = resolveWebSearchBaseUrl(normalizeWebSearchConfig({ provider: 'searxng' }));
    expect(url).toBe('http://localhost:8888');
  });

  it('falls back to YACY_BASE_URL', () => {
    process.env.YACY_BASE_URL = 'http://localhost:8090';
    const url = resolveWebSearchBaseUrl(normalizeWebSearchConfig({ provider: 'yacy' }));
    expect(url).toBe('http://localhost:8090');
  });
});

describe('providerRequiresBaseUrl', () => {
  it('requires base URL for self-hosted providers only', () => {
    expect(providerRequiresBaseUrl('duckduckgo')).toBe(false);
    expect(providerRequiresBaseUrl('searxng')).toBe(true);
    expect(providerRequiresBaseUrl('yacy')).toBe(true);
  });
});

describe('formatWebSearchResponse', () => {
  it('formats searxng-like results', () => {
    const response: WebSearchResponse = {
      query: 'test',
      provider: 'searxng',
      sourceLabel: 'SearXNG / SearX / LibreX',
      results: [{ title: 'Example', url: 'https://example.com', snippet: 'Hello' }],
    };
    const text = formatWebSearchResponse(response);
    expect(text).toContain('Query: test');
    expect(text).toContain('Example');
    expect(text).toContain('https://example.com');
  });
});
