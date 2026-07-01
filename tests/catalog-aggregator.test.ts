import { describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

vi.mock('electron', () => ({
  app: {
    getAppPath: () => process.cwd(),
    isPackaged: false,
  },
}));

import { CatalogAggregator } from '../src/main/catalog/catalog-aggregator';

describe('CatalogAggregator', () => {
  it('loads bundled curated manifest with verified entries only', async () => {
    const manifestPath = path.resolve(process.cwd(), 'catalog/manifest.json');
    expect(fs.existsSync(manifestPath)).toBe(true);

    const aggregator = new CatalogAggregator(async () =>
      Promise.resolve(new Response('{}', { status: 500 }))
    );
    const entries = await aggregator.listVerifiedEntries(true);
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.every((entry) => entry.verified)).toBe(true);
    expect(entries.some((entry) => entry.id === 'gui-operate-mcp')).toBe(true);
    expect(entries.some((entry) => entry.id === 'notion-mcp')).toBe(true);
  });

  it('returns a specific catalog entry by id', async () => {
    const aggregator = new CatalogAggregator(async () =>
      Promise.resolve(new Response('{}', { status: 500 }))
    );
    const entry = await aggregator.getEntry('chrome-mcp', true);
    expect(entry?.type).toBe('mcp');
    expect(entry?.resolve.via).toBe('preset');
  });
});
