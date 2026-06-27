import * as fs from 'node:fs';
import * as path from 'node:path';
import { app } from 'electron';
import type {
  CatalogEntry,
  CatalogManifest,
  CatalogManifestMeta,
} from '../../shared/catalog-types';
import { validateCatalogManifest } from '../../shared/catalog-manifest-validator';
import { log, logWarn } from '../utils/logger';

export const REMOTE_MANIFEST_URL =
  'https://raw.githubusercontent.com/Emilien-Etadam/lygodactylus/main/catalog/manifest.json';
const CACHE_TTL_MS = 60 * 60 * 1000;

interface CachedManifest {
  expiresAt: number;
  manifest: CatalogManifest;
  meta: CatalogManifestMeta;
}

export class CatalogAggregator {
  private cache: CachedManifest | null = null;
  private readonly fetchFn: typeof fetch;

  constructor(fetchFn: typeof fetch = fetch) {
    this.fetchFn = fetchFn;
  }

  async listVerifiedEntries(forceRefresh = false): Promise<CatalogEntry[]> {
    const loaded = await this.loadManifest(forceRefresh);
    return loaded.manifest.entries.filter(
      (entry) => entry.verified === true && entry.deprecated !== true
    );
  }

  async getEntry(catalogId: string, forceRefresh = false): Promise<CatalogEntry | undefined> {
    const loaded = await this.loadManifest(forceRefresh);
    return loaded.manifest.entries.find((entry) => entry.id === catalogId);
  }

  async getMeta(forceRefresh = false): Promise<CatalogManifestMeta> {
    const cached = await this.loadManifest(forceRefresh);
    return cached.meta;
  }

  private async loadManifest(forceRefresh: boolean): Promise<CachedManifest> {
    if (!forceRefresh && this.cache && this.cache.expiresAt > Date.now()) {
      return this.cache;
    }

    const bundled = this.readBundledManifest();
    let manifest = bundled.manifest;
    let meta = bundled.meta;

    try {
      const remote = await this.fetchRemoteManifest();
      if (remote) {
        manifest = remote.manifest;
        meta = remote.meta;
        log('[CatalogAggregator] Loaded remote manifest');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logWarn('[CatalogAggregator] Remote manifest unavailable, using bundled copy:', message);
    }

    this.cache = {
      expiresAt: Date.now() + CACHE_TTL_MS,
      manifest,
      meta,
    };
    return this.cache;
  }

  private readBundledManifest(): CachedManifest {
    const candidates = this.getBundledManifestPaths();
    for (const candidate of candidates) {
      try {
        if (fs.existsSync(candidate)) {
          const raw = fs.readFileSync(candidate, 'utf8');
          const parsed = JSON.parse(raw) as CatalogManifest;
          const validation = validateCatalogManifest(parsed);
          if (validation.valid) {
            return {
              expiresAt: 0,
              manifest: parsed,
              meta: this.buildMeta(parsed, 'bundled'),
            };
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

  private async fetchRemoteManifest(): Promise<CachedManifest | null> {
    const response = await this.fetchFn(REMOTE_MANIFEST_URL, {
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const parsed = (await response.json()) as CatalogManifest;
    const validation = validateCatalogManifest(parsed);
    if (!validation.valid) {
      throw new Error(`Remote manifest failed validation: ${validation.errors.join('; ')}`);
    }
    return {
      expiresAt: 0,
      manifest: parsed,
      meta: this.buildMeta(parsed, 'remote'),
    };
  }

  private buildMeta(
    manifest: CatalogManifest,
    source: CatalogManifestMeta['source']
  ): CatalogManifestMeta {
    return {
      source,
      version: manifest.version,
      updatedAt: manifest.updatedAt,
      entryCount: manifest.entries.filter((entry) => entry.verified && !entry.deprecated).length,
      fetchedAt: Date.now(),
      remoteUrl: REMOTE_MANIFEST_URL,
    };
  }
}

export const catalogAggregator = new CatalogAggregator();
