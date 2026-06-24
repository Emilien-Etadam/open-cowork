import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type { CatalogEntry } from '../src/shared/catalog-types';

async function githubSubdirExists(repo: string, subdir: string, ref: string): Promise<boolean> {
  const response = await fetch(
    `https://api.github.com/repos/${repo}/contents/${subdir}?ref=${encodeURIComponent(ref)}`,
    {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'open-cowork-catalog-validator',
      },
    }
  );
  if (response.status === 404) {
    return false;
  }
  if (!response.ok) {
    throw new Error(`GitHub API error for ${repo}/${subdir}@${ref}: ${response.status}`);
  }
  const payload = (await response.json()) as unknown;
  if (Array.isArray(payload)) {
    return payload.length > 0 && payload.every((item) => item && typeof item === 'object');
  }
  return (
    typeof payload === 'object' && payload !== null && (payload as { type?: string }).type === 'dir'
  );
}

describe('catalog github resolve paths', () => {
  const manifestPath = path.resolve(process.cwd(), 'catalog/manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as {
    entries: CatalogEntry[];
  };

  const githubEntries = manifest.entries.filter(
    (
      entry
    ): entry is CatalogEntry & {
      resolve: { via: 'github'; repo: string; subdir: string; ref: string };
    } => entry.resolve.via === 'github'
  );

  it('has at least one github plugin entry to validate', () => {
    expect(githubEntries.length).toBeGreaterThan(0);
  });

  it.each(
    githubEntries.map(
      (entry) => [entry.id, entry.resolve.repo, entry.resolve.subdir, entry.resolve.ref] as const
    )
  )(
    'entry %s resolves to an existing GitHub directory (%s/%s@%s)',
    async (_id, repo, subdir, ref) => {
      const exists = await githubSubdirExists(repo, subdir, ref);
      expect(exists).toBe(true);
    },
    30_000
  );
});
