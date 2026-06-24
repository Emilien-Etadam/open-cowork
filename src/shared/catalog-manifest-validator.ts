import type { CatalogEntry, CatalogManifest, ResolveSpec } from './catalog-types';

const ENTRY_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const VALID_TYPES = new Set(['skill', 'mcp', 'plugin']);
const VALID_VIA = new Set(['builtin', 'preset', 'mcp-registry', 'github']);

export interface CatalogManifestValidationResult {
  valid: boolean;
  errors: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function pushResolveErrors(resolve: unknown, prefix: string, errors: string[]): void {
  if (!isRecord(resolve) || typeof resolve.via !== 'string') {
    errors.push(`${prefix}: resolve.via is required`);
    return;
  }
  if (!VALID_VIA.has(resolve.via)) {
    errors.push(`${prefix}: unsupported resolve.via "${resolve.via}"`);
    return;
  }

  switch (resolve.via as ResolveSpec['via']) {
    case 'builtin':
      if (typeof resolve.path !== 'string' || !resolve.path.trim()) {
        errors.push(`${prefix}: resolve.path is required for builtin`);
      }
      break;
    case 'preset':
      if (typeof resolve.presetKey !== 'string' || !resolve.presetKey.trim()) {
        errors.push(`${prefix}: resolve.presetKey is required for preset`);
      }
      break;
    case 'mcp-registry':
      if (typeof resolve.mcpServerName !== 'string' || !resolve.mcpServerName.trim()) {
        errors.push(`${prefix}: resolve.mcpServerName is required for mcp-registry`);
      }
      if (
        resolve.presetFallback !== undefined &&
        (typeof resolve.presetFallback !== 'string' || !resolve.presetFallback.trim())
      ) {
        errors.push(`${prefix}: resolve.presetFallback must be a non-empty string when set`);
      }
      break;
    case 'github':
      if (typeof resolve.repo !== 'string' || !/^[^/]+\/[^/]+$/.test(resolve.repo)) {
        errors.push(`${prefix}: resolve.repo must be "owner/name" for github`);
      }
      if (typeof resolve.subdir !== 'string' || !resolve.subdir.trim()) {
        errors.push(`${prefix}: resolve.subdir is required for github`);
      }
      if (typeof resolve.ref !== 'string' || !resolve.ref.trim()) {
        errors.push(`${prefix}: resolve.ref is required for github`);
      }
      break;
    default:
      break;
  }
}

function validateEntry(entry: unknown, index: number, errors: string[]): void {
  const prefix = `entries[${index}]`;
  if (!isRecord(entry)) {
    errors.push(`${prefix}: must be an object`);
    return;
  }

  if (typeof entry.id !== 'string' || !ENTRY_ID_PATTERN.test(entry.id)) {
    errors.push(`${prefix}: id must match ${ENTRY_ID_PATTERN}`);
  }
  if (typeof entry.name !== 'string' || !entry.name.trim()) {
    errors.push(`${prefix}: name is required`);
  }
  if (typeof entry.description !== 'string' || !entry.description.trim()) {
    errors.push(`${prefix}: description is required`);
  }
  if (typeof entry.type !== 'string' || !VALID_TYPES.has(entry.type)) {
    errors.push(`${prefix}: type must be skill, mcp, or plugin`);
  }
  if (entry.verified !== true) {
    errors.push(`${prefix}: verified must be true in curated-strict manifests`);
  }

  pushResolveErrors(entry.resolve, prefix, errors);

  if (entry.requiresEnv !== undefined) {
    if (
      !Array.isArray(entry.requiresEnv) ||
      entry.requiresEnv.some((value) => typeof value !== 'string' || !value.trim())
    ) {
      errors.push(`${prefix}: requiresEnv must be an array of non-empty strings`);
    }
  }
}

export function validateCatalogManifest(value: unknown): CatalogManifestValidationResult {
  const errors: string[] = [];

  if (!isRecord(value)) {
    return { valid: false, errors: ['manifest must be a JSON object'] };
  }

  if (value.policy !== 'curated-strict') {
    errors.push('policy must be "curated-strict"');
  }
  if (typeof value.version !== 'string' || !value.version.trim()) {
    errors.push('version is required');
  }
  if (typeof value.updatedAt !== 'string' || Number.isNaN(Date.parse(value.updatedAt))) {
    errors.push('updatedAt must be a valid ISO date string');
  }
  if (!Array.isArray(value.entries) || value.entries.length === 0) {
    errors.push('entries must be a non-empty array');
  } else {
    const ids = new Set<string>();
    value.entries.forEach((entry, index) => {
      validateEntry(entry, index, errors);
      if (isRecord(entry) && typeof entry.id === 'string') {
        if (ids.has(entry.id)) {
          errors.push(`duplicate entry id: ${entry.id}`);
        }
        ids.add(entry.id);
      }
    });
  }

  return { valid: errors.length === 0, errors };
}

export function assertValidCatalogManifest(value: unknown): CatalogManifest {
  const result = validateCatalogManifest(value);
  if (!result.valid) {
    throw new Error(`Invalid catalog manifest:\n- ${result.errors.join('\n- ')}`);
  }
  return value as CatalogManifest;
}

export function parseCatalogEntry(value: unknown): CatalogEntry | null {
  const errors: string[] = [];
  validateEntry(value, 0, errors);
  if (errors.length > 0 || !isRecord(value)) {
    return null;
  }
  return value as unknown as CatalogEntry;
}
