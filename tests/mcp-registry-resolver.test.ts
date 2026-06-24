import { describe, expect, it } from 'vitest';
import { McpRegistryResolver } from '../src/main/catalog/mcp-registry-resolver';

describe('McpRegistryResolver', () => {
  it('maps npm stdio server.json packages to MCPServerConfig fields', () => {
    const resolver = new McpRegistryResolver();
    const mapped = resolver.mapServerDetailPublic(
      {
        name: 'io.github.example/demo',
        packages: [
          {
            registryType: 'npm',
            identifier: '@example/demo-mcp',
            version: '1.2.3',
            transport: { type: 'stdio' },
            environmentVariables: [{ name: 'API_KEY', isRequired: true }],
          },
        ],
      },
      'demo'
    );

    expect(mapped).not.toBeNull();
    expect(mapped?.type).toBe('stdio');
    expect(mapped?.command).toBe('npx');
    expect(mapped?.args).toEqual(['-y', '@example/demo-mcp@1.2.3']);
    expect(mapped?.requiresEnv).toEqual(['API_KEY']);
  });

  it('falls back to preset when registry lookup fails', async () => {
    const resolver = new McpRegistryResolver(async () =>
      Promise.resolve(new Response('not found', { status: 404 }))
    );
    const mapped = await resolver.resolveToConfig('io.github.missing/server', 'latest', 'notion');
    expect(mapped.name).toBe('Notion');
    expect(mapped.command).toBe('npx');
  });
});
