import * as fs from 'node:fs';
import type { CatalogEntry, MarketplaceInstallResult } from '../../shared/catalog-types';
import { mcpConfigStore } from '../mcp/mcp-config-store';
import type { MCPServerConfig } from '../mcp/mcp-types';
import type { SkillsManager } from '../skills/skills-manager';
import type { PluginRuntimeService } from '../skills/plugin-runtime-service';
import { downloadGithubSubdir } from './github-downloader';
import { McpRegistryResolver } from './mcp-registry-resolver';
import { marketplaceInstalledStore } from './marketplace-installed-store';
import { ensureHeavySkill } from '../runtime/skills-bundle-runtime';
import { isBuiltinHeavySkill, resolveBuiltinSkillPath } from '../skills/builtin-skills-paths';

export class InstallResolver {
  constructor(
    private readonly skillsManager: SkillsManager,
    private readonly pluginRuntimeService: PluginRuntimeService,
    private readonly mcpRegistryResolver: McpRegistryResolver = new McpRegistryResolver()
  ) {}

  async install(
    entry: CatalogEntry,
    envValues?: Record<string, string>
  ): Promise<MarketplaceInstallResult> {
    const warnings: string[] = [];

    switch (entry.resolve.via) {
      case 'builtin':
        return this.installBuiltinSkill(entry, warnings);
      case 'preset':
        return this.installPresetMcp(entry, envValues, warnings);
      case 'mcp-registry':
        return this.installRegistryMcp(entry, envValues, warnings);
      case 'github':
        return this.installGithubPlugin(entry, warnings);
      default:
        throw new Error(`Unsupported resolve strategy: ${(entry.resolve as { via: string }).via}`);
    }
  }

  async uninstall(entry: CatalogEntry): Promise<void> {
    const record = marketplaceInstalledStore.get(entry.id);
    if (!record) {
      return;
    }

    if (entry.type === 'skill') {
      if (record.installedRef.startsWith('builtin-')) {
        const skill = (await this.skillsManager.listSkills()).find(
          (item) => item.id === record.installedRef
        );
        if (skill) {
          this.skillsManager.setSkillEnabled(skill.id, false);
        }
      } else {
        await this.skillsManager.uninstallSkill(record.installedRef);
      }
    } else if (entry.type === 'mcp') {
      mcpConfigStore.deleteServer(record.installedRef);
    } else if (entry.type === 'plugin') {
      await this.pluginRuntimeService.uninstall(record.installedRef);
    }

    marketplaceInstalledStore.remove(entry.id);
  }

  async setEnabled(entry: CatalogEntry, enabled: boolean): Promise<void> {
    const record = marketplaceInstalledStore.get(entry.id);
    if (!record) {
      if (entry.resolve.via === 'builtin' && entry.type === 'skill') {
        const skill = await this.findBuiltinSkill(entry.resolve.path);
        if (skill) {
          this.skillsManager.setSkillEnabled(skill.id, enabled);
          marketplaceInstalledStore.save({
            catalogId: entry.id,
            type: entry.type,
            installedRef: skill.id,
            installedAt: Date.now(),
          });
        }
      }
      return;
    }

    if (entry.type === 'skill') {
      this.skillsManager.setSkillEnabled(record.installedRef, enabled);
      return;
    }

    if (entry.type === 'mcp') {
      const server = mcpConfigStore.getServer(record.installedRef);
      if (server) {
        mcpConfigStore.saveServer({ ...server, enabled });
      }
      return;
    }

    if (entry.type === 'plugin') {
      await this.pluginRuntimeService.setEnabled(record.installedRef, enabled);
    }
  }

  private async installBuiltinSkill(
    entry: CatalogEntry,
    warnings: string[]
  ): Promise<MarketplaceInstallResult> {
    if (entry.resolve.via !== 'builtin') {
      throw new Error('Invalid builtin resolve spec');
    }

    if (isBuiltinHeavySkill(entry.resolve.path)) {
      await ensureHeavySkill(entry.resolve.path);
    }

    const sourcePath = resolveBuiltinSkillPath(entry.resolve.path);
    if (!sourcePath || !fs.existsSync(sourcePath)) {
      throw new Error(`Built-in skill path not found: ${entry.resolve.path}`);
    }

    const existingBuiltin = await this.findBuiltinSkill(entry.resolve.path);
    if (existingBuiltin) {
      this.skillsManager.setSkillEnabled(existingBuiltin.id, true);
      marketplaceInstalledStore.save({
        catalogId: entry.id,
        type: entry.type,
        installedRef: existingBuiltin.id,
        installedAt: Date.now(),
      });
      return {
        catalogId: entry.id,
        type: entry.type,
        name: entry.name,
        installedRef: existingBuiltin.id,
        warnings,
      };
    }

    const installed = await this.skillsManager.installSkill(sourcePath);
    marketplaceInstalledStore.save({
      catalogId: entry.id,
      type: entry.type,
      installedRef: installed.id,
      installedAt: Date.now(),
    });

    return {
      catalogId: entry.id,
      type: entry.type,
      name: installed.name,
      installedRef: installed.id,
      warnings,
    };
  }

  private async installPresetMcp(
    entry: CatalogEntry,
    envValues: Record<string, string> | undefined,
    warnings: string[]
  ): Promise<MarketplaceInstallResult> {
    if (entry.resolve.via !== 'preset') {
      throw new Error('Invalid preset resolve spec');
    }

    const existing = marketplaceInstalledStore.get(entry.id);
    if (existing) {
      const server = mcpConfigStore.getServer(existing.installedRef);
      if (server) {
        mcpConfigStore.saveServer({
          ...server,
          enabled: true,
          env: { ...server.env, ...envValues },
        });
        return {
          catalogId: entry.id,
          type: entry.type,
          name: entry.name,
          installedRef: existing.installedRef,
          warnings,
        };
      }
    }

    const created = mcpConfigStore.createFromPreset(entry.resolve.presetKey, true);
    if (!created) {
      throw new Error(`Unknown MCP preset: ${entry.resolve.presetKey}`);
    }

    const config: MCPServerConfig = {
      ...created,
      id: `marketplace-${entry.id}`,
      env: { ...(created.env || {}), ...(envValues || {}) },
      enabled: true,
    };
    mcpConfigStore.saveServer(config);
    marketplaceInstalledStore.save({
      catalogId: entry.id,
      type: entry.type,
      installedRef: config.id,
      installedAt: Date.now(),
      env: envValues,
    });

    return {
      catalogId: entry.id,
      type: entry.type,
      name: config.name,
      installedRef: config.id,
      warnings,
    };
  }

  private async installRegistryMcp(
    entry: CatalogEntry,
    envValues: Record<string, string> | undefined,
    warnings: string[]
  ): Promise<MarketplaceInstallResult> {
    if (entry.resolve.via !== 'mcp-registry') {
      throw new Error('Invalid MCP registry resolve spec');
    }

    const resolved = await this.mcpRegistryResolver.resolveToConfig(
      entry.resolve.mcpServerName,
      entry.resolve.pinVersion || 'latest',
      entry.resolve.presetFallback
    );

    const config: MCPServerConfig = {
      name: entry.name,
      type: resolved.type,
      command: resolved.command,
      args: resolved.args,
      env: { ...(resolved.env || {}), ...(envValues || {}) },
      cwd: resolved.cwd,
      url: resolved.url,
      headers: resolved.headers,
      id: `marketplace-${entry.id}`,
      enabled: true,
    };
    mcpConfigStore.saveServer(config);
    marketplaceInstalledStore.save({
      catalogId: entry.id,
      type: entry.type,
      installedRef: config.id,
      installedAt: Date.now(),
      env: envValues,
    });

    return {
      catalogId: entry.id,
      type: entry.type,
      name: config.name,
      installedRef: config.id,
      warnings,
    };
  }

  private async installGithubPlugin(
    entry: CatalogEntry,
    warnings: string[]
  ): Promise<MarketplaceInstallResult> {
    if (entry.resolve.via !== 'github') {
      throw new Error('Invalid GitHub resolve spec');
    }

    const pluginDir = await downloadGithubSubdir(
      entry.resolve.repo,
      entry.resolve.subdir,
      entry.resolve.ref
    );
    const result = await this.pluginRuntimeService.installFromDirectory(pluginDir);
    marketplaceInstalledStore.save({
      catalogId: entry.id,
      type: entry.type,
      installedRef: result.plugin.pluginId,
      installedAt: Date.now(),
    });

    return {
      catalogId: entry.id,
      type: entry.type,
      name: result.plugin.name,
      installedRef: result.plugin.pluginId,
      warnings: [...warnings, ...(result.warnings || [])],
    };
  }

  private async findBuiltinSkill(folderName: string) {
    const skills = await this.skillsManager.listSkills();
    return skills.find((skill) => skill.type === 'builtin' && skill.id === `builtin-${folderName}`);
  }
}
