import type { MCPServerConfig } from '../mcp/mcp-types';
import { MCP_SERVER_PRESETS } from '../mcp/mcp-config-store';
import { log, logWarn } from '../utils/logger';

const REGISTRY_BASE_URL = 'https://registry.modelcontextprotocol.io';

interface RegistryPackage {
  registryType?: string;
  identifier?: string;
  version?: string;
  transport?: {
    type?: string;
    url?: string;
  };
  environmentVariables?: Array<{
    name?: string;
    description?: string;
    isRequired?: boolean;
    isSecret?: boolean;
  }>;
  runtimeArguments?: Array<{
    name?: string;
    value?: string;
    isRequired?: boolean;
  }>;
}

interface RegistryServerDetail {
  name?: string;
  description?: string;
  version?: string;
  packages?: RegistryPackage[];
}

interface CachedServerJson {
  expiresAt: number;
  detail: RegistryServerDetail;
}

export class McpRegistryResolver {
  private cache = new Map<string, CachedServerJson>();
  private readonly fetchFn: typeof fetch;
  private readonly cacheTtlMs: number;

  constructor(fetchFn: typeof fetch = fetch, cacheTtlMs = 24 * 60 * 60 * 1000) {
    this.fetchFn = fetchFn;
    this.cacheTtlMs = cacheTtlMs;
  }

  async resolveToConfig(
    mcpServerName: string,
    pinVersion = 'latest',
    presetFallback?: string
  ): Promise<Omit<MCPServerConfig, 'id' | 'enabled'> & { requiresEnv?: string[] }> {
    try {
      const detail = await this.fetchServerDetail(mcpServerName, pinVersion);
      const mapped = this.mapServerDetailPublic(detail, mcpServerName);
      if (mapped) {
        return mapped;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logWarn('[McpRegistryResolver] Registry lookup failed:', mcpServerName, message);
    }

    if (presetFallback && MCP_SERVER_PRESETS[presetFallback]) {
      log('[McpRegistryResolver] Using preset fallback:', presetFallback);
      const preset = MCP_SERVER_PRESETS[presetFallback];
      return {
        ...preset,
        requiresEnv: preset.requiresEnv,
      };
    }

    throw new Error(`Unable to resolve MCP server: ${mcpServerName}`);
  }

  private async fetchServerDetail(
    mcpServerName: string,
    pinVersion: string
  ): Promise<RegistryServerDetail> {
    const cacheKey = `${mcpServerName}@${pinVersion}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.detail;
    }

    const encodedName = encodeURIComponent(mcpServerName);
    const version = pinVersion || 'latest';
    const url = `${REGISTRY_BASE_URL}/v0.1/servers/${encodedName}/versions/${encodeURIComponent(version)}`;
    const response = await this.fetchFn(url, {
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) {
      throw new Error(`Registry HTTP ${response.status}`);
    }

    const payload = (await response.json()) as
      | { server?: RegistryServerDetail }
      | RegistryServerDetail;
    const detail =
      'server' in payload && payload.server ? payload.server : (payload as RegistryServerDetail);
    this.cache.set(cacheKey, {
      expiresAt: Date.now() + this.cacheTtlMs,
      detail,
    });
    return detail;
  }

  mapServerDetailPublic(
    detail: RegistryServerDetail,
    fallbackName: string
  ): (Omit<MCPServerConfig, 'id' | 'enabled'> & { requiresEnv?: string[] }) | null {
    const pkg = detail.packages?.[0];
    if (!pkg) {
      return null;
    }

    const displayName = (detail.name || fallbackName).split('/').pop() || fallbackName;
    const requiresEnv =
      pkg.environmentVariables
        ?.filter((item) => item.isRequired && item.name)
        .map((item) => item.name as string) ?? [];

    const env: Record<string, string> = {};
    for (const variable of pkg.environmentVariables ?? []) {
      if (variable.name) {
        env[variable.name] = '';
      }
    }

    const transportType = (pkg.transport?.type || 'stdio').toLowerCase();
    if (transportType === 'streamable-http' || transportType === 'sse') {
      if (!pkg.transport?.url) {
        return null;
      }
      return {
        name: displayName,
        type: transportType === 'sse' ? 'sse' : 'streamable-http',
        url: pkg.transport.url,
        headers: {},
        env,
        requiresEnv,
      };
    }

    const registryType = (pkg.registryType || 'npm').toLowerCase();
    if (registryType !== 'npm' || !pkg.identifier) {
      return null;
    }

    const versionSuffix = pkg.version ? `@${pkg.version}` : '';
    const runtimeArgs =
      pkg.runtimeArguments
        ?.filter((arg) => arg.name)
        .flatMap((arg) => {
          if (arg.value) {
            return [arg.name as string, arg.value];
          }
          return [arg.name as string];
        }) ?? [];

    return {
      name: displayName,
      type: 'stdio',
      command: 'npx',
      args: ['-y', `${pkg.identifier}${versionSuffix}`, ...runtimeArgs],
      env,
      requiresEnv,
    };
  }
}

export function mapRegistryServerDetail(
  detail: RegistryServerDetail,
  fallbackName: string
): (Omit<MCPServerConfig, 'id' | 'enabled'> & { requiresEnv?: string[] }) | null {
  const resolver = new McpRegistryResolver();
  return resolver.mapServerDetailPublic(detail, fallbackName);
}
