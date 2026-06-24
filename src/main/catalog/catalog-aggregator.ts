import * as fs from 'node:fs';
import * as path from 'node:path';
import { app } from 'electron';
import type { CatalogEntry, CatalogManifest } from '../../shared/catalog-types';
import { log, logWarn } from '../utils/logger';

const REMOTE_MANIFEST_URL =
  'https://raw.githubusercontent.com/OpenCoworkAI/open-cowork/main/catalog/manifest.json';
const CACHE_TTL_MS = 60 * 60 * 1000;

interface CachedManifest {
  expiresAt: number;
  manifest: CatalogManifest;
}

export class CatalogAggregator {
  private cache: CachedManifest | null = null;
  private readonly fetchFn: typeof fetch;

  constructor(fetchFn: typeof fetch = fetch) {
    this.fetchFn = fetchFn;
  }

  async listVerifiedEntries(forceRefresh = false): Promise<CatalogEntry[]> {
    const manifest = await this.loadManifest(forceRefresh);
    return manifest.entries.filter((entry) => entry.verified === true && entry.deprecated !== true);
  }

  async getEntry(catalogId: string, forceRefresh = false): Promise<CatalogEntry | undefined> {
    const manifest = await this.loadManifest(forceRefresh);
    return manifest.entries.find((entry) => entry.id === catalogId);
  }

  private async loadManifest(forceRefresh: boolean): Promise<CatalogManifest> {
    if (!forceRefresh && this.cache && this.cache.expiresAt > Date.now()) {
      return this.cache.manifest;
    }

    const bundled = this.readBundledManifest();
    let manifest = bundled;

    try {
      const remote = await this.fetchRemoteManifest();
      if (remote && this.isValidManifest(remote)) {
        manifest = remote;
        log('[CatalogAggregator] Loaded remote manifest');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logWarn('[CatalogAggregator] Remote manifest unavailable, using bundled copy:', message);
    }

    this.cache = {
      expiresAt: Date.now() + CACHE_TTL_MS,
      manifest,
    };
    return manifest;
  }

  private readBundledManifest(): CatalogManifest {
    const candidates = this.getBundledManifestPaths();
    for (const candidate of candidates) {
      try {
        if (fs.existsSync(candidate)) {
          const raw = fs.readFileSync(candidate, 'utf8');
          const parsed = JSON.parse(raw) as CatalogManifest;
          if (this.isValidManifest(parsed)) {
            return parsed;
          }
        }
      } catch (error) {
        logWarn('[CatalogAggregator] Failed to read bundled manifest:', candidate, error);
      }
    }
    throw new Error('Bundled catalog manifest not found');
  }

  private getBundledManifestPaths(): string[] {
    const appPath = app.getAppPath();
    return [
      path.join(process.resourcesPath || '', 'catalog', 'manifest.json'),
      path.join(__dirname, '..', '..', '..', 'catalog', 'manifest.json'),
      path.join(appPath, 'catalog', 'manifest.json'),
    ];
  }

  private async fetchRemoteManifest(): Promise<CatalogManifest | null> {
    const response = await this.fetchFn(REMOTE_MANIFEST_URL, {
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return (await response.json()) as CatalogManifest;
  }

  private isValidManifest(value: CatalogManifest): boolean {
    return (
      value &&
      value.policy === 'curated-strict' &&
      Array.isArray(value.entries) &&
      value.entries.every(
        (entry) =>
          typeof entry.id === 'string' &&
          typeof entry.name === 'string' &&
          typeof entry.description === 'string' &&
          typeof entry.verified === 'boolean' &&
          entry.resolve &&
          typeof entry.resolve.via === 'string'
      )
    );
  }
}

export const catalogAggregator = new CatalogAggregator();
