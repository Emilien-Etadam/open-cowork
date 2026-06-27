import { Type, type TSchema } from 'typebox';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import { configStore } from '../config/config-store';
import { runWebSearch } from '../../shared/web-search';

const webSearchParameters = Type.Object({
  query: Type.String({ description: 'Search query' }),
});

function createWebSearchTool(name: string, label: string): ToolDefinition<TSchema, unknown> {
  return {
    name,
    label,
    description:
      'Search the web for up-to-date information. Uses the configured search provider (DuckDuckGo or a self-hosted metasearch engine).',
    parameters: webSearchParameters,
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const record =
        typeof params === 'object' && params !== null ? (params as Record<string, unknown>) : {};
      const query = typeof record.query === 'string' ? record.query : '';
      const config = configStore.get('webSearch');
      const text = await runWebSearch(query, config);
      return {
        content: [{ type: 'text' as const, text }],
        details: undefined,
      };
    },
  };
}

export function buildWebSearchCustomTools(): ToolDefinition[] {
  return [
    createWebSearchTool('web_search', 'Web Search'),
    createWebSearchTool('websearch', 'Web Search'),
  ];
}
