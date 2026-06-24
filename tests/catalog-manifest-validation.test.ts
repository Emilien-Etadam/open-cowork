import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { validateCatalogManifest } from '../src/shared/catalog-manifest-validator';

describe('catalog/manifest.json', () => {
  const manifestPath = path.resolve(process.cwd(), 'catalog/manifest.json');

  it('exists and parses as JSON', () => {
    expect(fs.existsSync(manifestPath)).toBe(true);
    const raw = fs.readFileSync(manifestPath, 'utf8');
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  it('passes curated-strict validation', () => {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const result = validateCatalogManifest(manifest);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('rejects manifests with unverified entries', () => {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const tampered = {
      ...manifest,
      entries: [
        ...manifest.entries,
        {
          id: 'bad-entry',
          type: 'skill',
          name: 'Bad',
          description: 'Bad',
          verified: false,
          resolve: { via: 'builtin', path: 'docx' },
        },
      ],
    };
    const result = validateCatalogManifest(tampered);
    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.includes('verified'))).toBe(true);
  });
});
