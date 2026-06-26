/**
 * Web search providers for Open Cowork.
 *
 * Supports DuckDuckGo (default) and self-hosted metasearch engines:
 * - SearXNG / SearX / LibreX (SearXNG-compatible JSON API)
 * - YaCy (yacysearch.json API)
 */

export type WebSearchProvider = 'duckduckgo' | 'searxng' | 'yacy';

export interface WebSearchConfig {
  provider: WebSearchProvider;
  /** Base URL of the instance, e.g. http://localhost:8080 */
  baseUrl?: string;
  /** Optional bearer token for protected instances */
  authToken?: string;
  language?: string;
  categories?: string;
  safeSearch?: 0 | 1 | 2;
  maxResults?: number;
  timeoutMs?: number;
}

export interface WebSearchResultItem {
  title: string;
  url?: string;
  snippet?: string;
}

export interface WebSearchResponse {
  query: string;
  provider: WebSearchProvider;
  sourceLabel: string;
  heading?: string;
  abstract?: string;
  results: WebSearchResultItem[];
}

export const DEFAULT_WEB_SEARCH_CONFIG: WebSearchConfig = {
  provider: 'duckduckgo',
  baseUrl: '',
  authToken: '',
  language: '',
  categories: 'general',
  safeSearch: 1,
  maxResults: 8,
  timeoutMs: 15000,
};

const OUTPUT_CHAR_LIMIT = 20000;

export function normalizeWebSearchConfig(raw: unknown): WebSearchConfig {
  const value = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const provider = isWebSearchProvider(value.provider)
    ? value.provider
    : DEFAULT_WEB_SEARCH_CONFIG.provider;
  const safeSearchRaw = value.safeSearch;
  const safeSearch =
    safeSearchRaw === 0 || safeSearchRaw === 1 || safeSearchRaw === 2
      ? safeSearchRaw
      : DEFAULT_WEB_SEARCH_CONFIG.safeSearch;
  const maxResults =
    typeof value.maxResults === 'number' &&
    Number.isFinite(value.maxResults) &&
    value.maxResults > 0
      ? Math.min(Math.max(Math.trunc(value.maxResults), 1), 20)
      : DEFAULT_WEB_SEARCH_CONFIG.maxResults;
  const timeoutMs =
    typeof value.timeoutMs === 'number' && Number.isFinite(value.timeoutMs)
      ? Math.min(Math.max(Math.trunc(value.timeoutMs), 3000), 60000)
      : DEFAULT_WEB_SEARCH_CONFIG.timeoutMs;

  return {
    provider,
    baseUrl: typeof value.baseUrl === 'string' ? value.baseUrl.trim() : '',
    authToken: typeof value.authToken === 'string' ? value.authToken.trim() : '',
    language: typeof value.language === 'string' ? value.language.trim() : '',
    categories:
      typeof value.categories === 'string' && value.categories.trim()
        ? value.categories.trim()
        : DEFAULT_WEB_SEARCH_CONFIG.categories,
    safeSearch,
    maxResults,
    timeoutMs,
  };
}

export function isWebSearchProvider(value: unknown): value is WebSearchProvider {
  return value === 'duckduckgo' || value === 'searxng' || value === 'yacy';
}

export function resolveWebSearchBaseUrl(config: WebSearchConfig): string {
  const fromConfig = config.baseUrl?.trim();
  if (fromConfig) {
    return fromConfig;
  }
  if (config.provider === 'searxng') {
    const fromEnv = process.env.SEARXNG_BASE_URL?.trim() || process.env.SEARXNG_URL?.trim();
    if (fromEnv) {
      return fromEnv;
    }
  }
  if (config.provider === 'yacy') {
    const fromEnv = process.env.YACY_BASE_URL?.trim();
    if (fromEnv) {
      return fromEnv;
    }
  }
  return '';
}

export function providerRequiresBaseUrl(provider: WebSearchProvider): boolean {
  return provider === 'searxng' || provider === 'yacy';
}

export function getWebSearchProviderLabel(provider: WebSearchProvider): string {
  switch (provider) {
    case 'searxng':
      return 'SearXNG / SearX / LibreX';
    case 'yacy':
      return 'YaCy';
    default:
      return 'DuckDuckGo Instant Answer';
  }
}

function buildAuthHeaders(config: WebSearchConfig): Record<string, string> {
  const headers: Record<string, string> = {
    'User-Agent': 'open-cowork',
    Accept: 'application/json',
  };
  if (config.authToken) {
    headers.Authorization = `Bearer ${config.authToken}`;
  }
  return headers;
}

function truncateOutput(text: string): string {
  if (text.length <= OUTPUT_CHAR_LIMIT) {
    return text;
  }
  return `${text.slice(0, OUTPUT_CHAR_LIMIT)}\n\n[Truncated ${text.length - OUTPUT_CHAR_LIMIT} chars]`;
}

function normalizeBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  if (!trimmed) {
    throw new Error('Base URL is required for this search provider');
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error('Invalid base URL');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only http/https base URLs are supported');
  }
  return parsed.toString().replace(/\/+$/, '');
}

async function fetchJson(url: string, config: WebSearchConfig): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: buildAuthHeaders(config),
      signal: AbortSignal.timeout(config.timeoutMs ?? DEFAULT_WEB_SEARCH_CONFIG.timeoutMs!),
    });
  } catch (error) {
    if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
      throw new Error('Search request timed out');
    }
    throw error;
  }

  if (!response.ok) {
    if (response.status === 403) {
      throw new Error(
        'Search request forbidden (403). For SearXNG, enable JSON in search.formats in settings.yml.'
      );
    }
    throw new Error(`Search request failed with status ${response.status}`);
  }

  return (await response.json()) as Record<string, unknown>;
}

type DuckTopic = { text: string; url?: string };

function collectDuckTopics(topic: unknown, results: DuckTopic[]): void {
  if (!topic || typeof topic !== 'object') return;
  const record = topic as Record<string, unknown>;
  const text = typeof record.Text === 'string' ? record.Text : '';
  const firstUrl = typeof record.FirstURL === 'string' ? record.FirstURL : '';
  if (text) {
    results.push({ text, url: firstUrl || undefined });
  }
  const nested = Array.isArray(record.Topics) ? record.Topics : [];
  for (const nestedItem of nested) {
    collectDuckTopics(nestedItem, results);
  }
}

async function searchDuckDuckGo(
  query: string,
  config: WebSearchConfig
): Promise<WebSearchResponse> {
  const searchUrl = new URL('https://api.duckduckgo.com/');
  searchUrl.searchParams.set('q', query);
  searchUrl.searchParams.set('format', 'json');
  searchUrl.searchParams.set('no_redirect', '1');
  searchUrl.searchParams.set('no_html', '1');
  searchUrl.searchParams.set('skip_disambig', '1');

  const data = await fetchJson(searchUrl.toString(), config);
  const heading = typeof data.Heading === 'string' ? data.Heading : '';
  const abstractText = typeof data.AbstractText === 'string' ? data.AbstractText : '';
  const relatedTopics = Array.isArray(data.RelatedTopics) ? data.RelatedTopics : [];
  const topics: DuckTopic[] = [];
  for (const topic of relatedTopics) {
    collectDuckTopics(topic, topics);
  }

  const maxResults = config.maxResults ?? DEFAULT_WEB_SEARCH_CONFIG.maxResults!;
  const results: WebSearchResultItem[] = topics.slice(0, maxResults).map((item) => ({
    title: item.text,
    url: item.url,
  }));

  return {
    query,
    provider: 'duckduckgo',
    sourceLabel: getWebSearchProviderLabel('duckduckgo'),
    heading: heading || undefined,
    abstract: abstractText || undefined,
    results,
  };
}

async function searchSearxng(query: string, config: WebSearchConfig): Promise<WebSearchResponse> {
  const baseUrl = normalizeBaseUrl(resolveWebSearchBaseUrl(config));
  const searchUrl = new URL('/search', `${baseUrl}/`);
  searchUrl.searchParams.set('q', query);
  searchUrl.searchParams.set('format', 'json');
  if (config.language) {
    searchUrl.searchParams.set('language', config.language);
  }
  if (config.categories) {
    searchUrl.searchParams.set('categories', config.categories);
  }
  if (typeof config.safeSearch === 'number') {
    searchUrl.searchParams.set('safesearch', String(config.safeSearch));
  }

  const data = await fetchJson(searchUrl.toString(), config);
  const rawResults = Array.isArray(data.results) ? data.results : [];
  const maxResults = config.maxResults ?? DEFAULT_WEB_SEARCH_CONFIG.maxResults!;
  const results: WebSearchResultItem[] = [];

  for (const item of rawResults.slice(0, maxResults)) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const title = typeof record.title === 'string' ? record.title.trim() : '';
    const url = typeof record.url === 'string' ? record.url.trim() : undefined;
    const snippet =
      typeof record.content === 'string'
        ? record.content.trim()
        : typeof record.snippet === 'string'
          ? record.snippet.trim()
          : undefined;
    if (title || url) {
      results.push({ title: title || url || 'Untitled', url, snippet });
    }
  }

  return {
    query,
    provider: 'searxng',
    sourceLabel: getWebSearchProviderLabel('searxng'),
    results,
  };
}

async function searchYacy(query: string, config: WebSearchConfig): Promise<WebSearchResponse> {
  const baseUrl = normalizeBaseUrl(resolveWebSearchBaseUrl(config));
  const searchUrl = new URL('/yacysearch.json', `${baseUrl}/`);
  searchUrl.searchParams.set('query', query);
  searchUrl.searchParams.set('resource', 'global');
  searchUrl.searchParams.set('contentdom', 'text');
  const maxResults = config.maxResults ?? DEFAULT_WEB_SEARCH_CONFIG.maxResults!;
  searchUrl.searchParams.set('maximumRecords', String(maxResults));
  if (config.language) {
    searchUrl.searchParams.set('language', config.language);
  }

  const data = await fetchJson(searchUrl.toString(), config);
  const channels = Array.isArray(data.channels) ? data.channels : [];
  const results: WebSearchResultItem[] = [];

  for (const channel of channels) {
    if (!channel || typeof channel !== 'object') continue;
    const items = Array.isArray((channel as Record<string, unknown>).items)
      ? ((channel as Record<string, unknown>).items as unknown[])
      : [];
    for (const item of items) {
      if (!item || typeof item !== 'object') continue;
      const record = item as Record<string, unknown>;
      const title = typeof record.title === 'string' ? record.title.trim() : '';
      const url = typeof record.link === 'string' ? record.link.trim() : undefined;
      const snippet =
        typeof record.description === 'string' ? record.description.trim() : undefined;
      if (title || url) {
        results.push({ title: title || url || 'Untitled', url, snippet });
      }
      if (results.length >= maxResults) {
        break;
      }
    }
    if (results.length >= maxResults) {
      break;
    }
  }

  return {
    query,
    provider: 'yacy',
    sourceLabel: getWebSearchProviderLabel('yacy'),
    results,
  };
}

export async function executeWebSearch(
  query: string,
  configInput?: Partial<WebSearchConfig>
): Promise<WebSearchResponse> {
  const trimmed = query.trim();
  if (!trimmed) {
    throw new Error('Query is required');
  }

  const config = normalizeWebSearchConfig({
    ...DEFAULT_WEB_SEARCH_CONFIG,
    ...configInput,
  });

  if (providerRequiresBaseUrl(config.provider) && !resolveWebSearchBaseUrl(config)) {
    throw new Error(`Base URL is required for ${getWebSearchProviderLabel(config.provider)}`);
  }

  switch (config.provider) {
    case 'searxng':
      return searchSearxng(trimmed, config);
    case 'yacy':
      return searchYacy(trimmed, config);
    default:
      return searchDuckDuckGo(trimmed, config);
  }
}

export function formatWebSearchResponse(response: WebSearchResponse): string {
  const lines: string[] = [];
  lines.push(`Query: ${response.query}`);
  lines.push(`Source: ${response.sourceLabel}`);
  if (response.heading) {
    lines.push(`Heading: ${response.heading}`);
  }
  if (response.abstract) {
    lines.push(`Abstract: ${response.abstract}`);
  }

  if (response.results.length > 0) {
    lines.push('Results:');
    for (const item of response.results) {
      const suffix = item.url ? ` (${item.url})` : '';
      const snippet = item.snippet ? ` — ${item.snippet}` : '';
      lines.push(`- ${item.title}${suffix}${snippet}`);
    }
  } else if (!response.abstract) {
    lines.push('Results: No related topics found.');
  }

  return truncateOutput(lines.join('\n'));
}

export async function runWebSearch(
  query: string,
  configInput?: Partial<WebSearchConfig>
): Promise<string> {
  const response = await executeWebSearch(query, configInput);
  return formatWebSearchResponse(response);
}
