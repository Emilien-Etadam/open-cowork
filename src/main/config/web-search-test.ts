import {
  executeWebSearch,
  formatWebSearchResponse,
  normalizeWebSearchConfig,
  type WebSearchConfig,
} from '../../shared/web-search';
import type { WebSearchTestInput, WebSearchTestResult } from '../../renderer/types';

export async function runWebSearchConfigTest(
  payload: WebSearchTestInput
): Promise<WebSearchTestResult> {
  const config = normalizeWebSearchConfig({
    provider: payload.provider,
    baseUrl: payload.baseUrl,
    authToken: payload.authToken,
    language: payload.language,
    categories: payload.categories,
    safeSearch: payload.safeSearch,
    maxResults: 3,
    timeoutMs: 15000,
  } satisfies Partial<WebSearchConfig>);

  const query = payload.query?.trim() || 'open cowork';

  try {
    const response = await executeWebSearch(query, config);
    const preview = formatWebSearchResponse(response).slice(0, 1200);
    return {
      ok: true,
      resultCount: response.results.length,
      preview,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
