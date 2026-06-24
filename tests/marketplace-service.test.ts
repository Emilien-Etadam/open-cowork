import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { CatalogEntry } from '../src/shared/catalog-types';

const manifestEntries: CatalogEntry[] = [
  {
    id: 'demo-skill',
    type: 'skill',
    name: 'Demo Skill',
    description: 'Demo',
    verified: true,
    resolve: { via: 'builtin', path: 'docx' },
  },
];

vi.mock('../src/main/catalog/catalog-aggregator', () => ({
  catalogAggregator: {
    listVerifiedEntries: vi.fn(async () => manifestEntries),
    getEntry: vi.fn(async (id: string) => manifestEntries.find((entry) => entry.id === id)),
  },
}));

describe('MarketplaceService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lists marketplace entries with builtin install state', async () => {
    const { MarketplaceService } = await import('../src/main/catalog/marketplace-service');

    const skillsManager = {
      listSkills: vi.fn(async () => [
        { id: 'builtin-docx', name: 'DOCX', type: 'builtin', enabled: true },
      ]),
      setSkillEnabled: vi.fn(),
      installSkill: vi.fn(),
      uninstallSkill: vi.fn(),
    } as unknown as import('../src/main/skills/skills-manager').SkillsManager;

    const pluginRuntimeService = {
      listInstalled: vi.fn(() => []),
      installFromDirectory: vi.fn(),
      setEnabled: vi.fn(),
      uninstall: vi.fn(),
    } as unknown as import('../src/main/skills/plugin-runtime-service').PluginRuntimeService;

    const service = new MarketplaceService(skillsManager, pluginRuntimeService);
    const entries = await service.list();
    expect(entries).toHaveLength(1);
    expect(entries[0].installState).toBe('builtin');
    expect(entries[0].enabled).toBe(true);
  });
});
