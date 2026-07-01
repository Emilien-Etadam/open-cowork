import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { CatalogEntry } from '../src/shared/catalog-types';

const downloadGithubSubdir = vi.fn();
const marketplaceSave = vi.fn();

vi.mock('../src/main/catalog/github-downloader', () => ({
  downloadGithubSubdir: (...args: unknown[]) => downloadGithubSubdir(...args),
}));

vi.mock('../src/main/catalog/marketplace-installed-store', () => ({
  marketplaceInstalledStore: {
    get: vi.fn(),
    save: (...args: unknown[]) => marketplaceSave(...args),
    remove: vi.fn(),
  },
}));

import { InstallResolver } from '../src/main/catalog/install-resolver';

const githubSkillEntry: CatalogEntry = {
  id: 'requesting-code-review-skill',
  type: 'skill',
  name: 'Requesting Code Review',
  description: 'Pre-commit review: security scan, quality gates, auto-fix.',
  verified: true,
  resolve: {
    via: 'github',
    repo: 'NousResearch/hermes-agent',
    subdir: 'skills/software-development/requesting-code-review',
    ref: 'main',
  },
};

const githubPluginEntry: CatalogEntry = {
  id: 'code-review-plugin',
  type: 'plugin',
  name: 'Code Review',
  description: 'Automated pull request review.',
  verified: true,
  resolve: {
    via: 'github',
    repo: 'anthropics/claude-plugins-official',
    subdir: 'plugins/code-review',
    ref: 'main',
  },
};

describe('InstallResolver github routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('installs github skill entries via skillsManager.installSkill', async () => {
    downloadGithubSubdir.mockResolvedValue('/tmp/requesting-code-review-skill');
    const installSkill = vi.fn(async () => ({
      id: 'skill-code-review',
      name: 'Requesting Code Review',
    }));
    const installFromDirectory = vi.fn();

    const resolver = new InstallResolver(
      {
        installSkill,
        listSkills: vi.fn(),
        setSkillEnabled: vi.fn(),
        uninstallSkill: vi.fn(),
      } as unknown as import('../src/main/skills/skills-manager').SkillsManager,
      {
        installFromDirectory,
        listInstalled: vi.fn(),
        setEnabled: vi.fn(),
        uninstall: vi.fn(),
      } as unknown as import('../src/main/skills/plugin-runtime-service').PluginRuntimeService
    );

    const result = await resolver.install(githubSkillEntry);

    expect(downloadGithubSubdir).toHaveBeenCalledWith(
      'NousResearch/hermes-agent',
      'skills/software-development/requesting-code-review',
      'main'
    );
    expect(installSkill).toHaveBeenCalledWith('/tmp/requesting-code-review-skill');
    expect(installFromDirectory).not.toHaveBeenCalled();
    expect(marketplaceSave).toHaveBeenCalledWith({
      catalogId: 'requesting-code-review-skill',
      type: 'skill',
      installedRef: 'skill-code-review',
      installedAt: expect.any(Number),
    });
    expect(result).toEqual({
      catalogId: 'requesting-code-review-skill',
      type: 'skill',
      name: 'Requesting Code Review',
      installedRef: 'skill-code-review',
      warnings: [],
    });
  });

  it('installs github plugin entries via pluginRuntimeService.installFromDirectory', async () => {
    downloadGithubSubdir.mockResolvedValue('/tmp/code-review-plugin');
    const installSkill = vi.fn();
    const installFromDirectory = vi.fn(async () => ({
      plugin: { pluginId: 'plugin-code-review', name: 'Code Review' },
      warnings: ['dep warning'],
    }));

    const resolver = new InstallResolver(
      {
        installSkill,
        listSkills: vi.fn(),
        setSkillEnabled: vi.fn(),
        uninstallSkill: vi.fn(),
      } as unknown as import('../src/main/skills/skills-manager').SkillsManager,
      {
        installFromDirectory,
        listInstalled: vi.fn(),
        setEnabled: vi.fn(),
        uninstall: vi.fn(),
      } as unknown as import('../src/main/skills/plugin-runtime-service').PluginRuntimeService
    );

    const result = await resolver.install(githubPluginEntry);

    expect(installSkill).not.toHaveBeenCalled();
    expect(installFromDirectory).toHaveBeenCalledWith('/tmp/code-review-plugin');
    expect(result.installedRef).toBe('plugin-code-review');
    expect(result.warnings).toEqual(['dep warning']);
  });
});
