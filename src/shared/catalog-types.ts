export type CatalogEntryType = 'skill' | 'mcp' | 'plugin';

export type ResolveVia = 'builtin' | 'preset' | 'mcp-registry' | 'github';

export interface BuiltinResolveSpec {
  via: 'builtin';
  path: string;
}

export interface PresetResolveSpec {
  via: 'preset';
  presetKey: string;
}

export interface McpRegistryResolveSpec {
  via: 'mcp-registry';
  mcpServerName: string;
  pinVersion?: string;
  presetFallback?: string;
}

export interface GithubResolveSpec {
  via: 'github';
  repo: string;
  subdir: string;
  ref: string;
}

export type ResolveSpec =
  | BuiltinResolveSpec
  | PresetResolveSpec
  | McpRegistryResolveSpec
  | GithubResolveSpec;

export interface CatalogEntry {
  id: string;
  type: CatalogEntryType;
  name: string;
  description: string;
  verified: boolean;
  resolve: ResolveSpec;
  requiresEnv?: string[];
  envDescription?: Record<string, string>;
  deprecated?: boolean;
  deprecationMessage?: string;
}

export interface CatalogManifest {
  version: string;
  updatedAt: string;
  policy: 'curated-strict';
  entries: CatalogEntry[];
}

export type MarketplaceInstallState = 'not_installed' | 'installed' | 'builtin';

export interface MarketplaceEntry extends CatalogEntry {
  installState: MarketplaceInstallState;
  enabled: boolean;
  installedRef?: string;
  deprecated: boolean;
}

export interface MarketplaceInstallResult {
  catalogId: string;
  type: CatalogEntryType;
  name: string;
  installedRef?: string;
  warnings?: string[];
}

export interface MarketplaceInstalledRecord {
  catalogId: string;
  type: CatalogEntryType;
  installedRef: string;
  installedAt: number;
  env?: Record<string, string>;
}
