import type {
  CatalogEntry,
  MarketplaceEntry,
  MarketplaceInstallResult,
} from '../../shared/catalog-types';
import type { SkillsManager } from '../skills/skills-manager';
import type { PluginRuntimeService } from '../skills/plugin-runtime-service';
import { mcpConfigStore } from '../mcp/mcp-config-store';
import { catalogAggregator } from './catalog-aggregator';
import { InstallResolver } from './install-resolver';
import { marketplaceInstalledStore } from './marketplace-installed-store';

export class MarketplaceService {
  private readonly installResolver: InstallResolver;

  constructor(
    private readonly skillsManager: SkillsManager,
    private readonly pluginRuntimeService: PluginRuntimeService
  ) {
    this.installResolver = new InstallResolver(skillsManager, pluginRuntimeService);
  }

  async list(forceRefresh = false): Promise<MarketplaceEntry[]> {
    const entries = await catalogAggregator.listVerifiedEntries(forceRefresh);
    const skills = await this.skillsManager.listSkills();
    const mcpServers = mcpConfigStore.getServers();
    const plugins = this.pluginRuntimeService.listInstalled();

    return entries.map((entry) => this.toMarketplaceEntry(entry, skills, mcpServers, plugins));
  }

  async install(
    catalogId: string,
    envValues?: Record<string, string>
  ): Promise<MarketplaceInstallResult> {
    const entry = await catalogAggregator.getEntry(catalogId);
    if (!entry || !entry.verified) {
      throw new Error(`Catalog entry not found or not verified: ${catalogId}`);
    }
    return this.installResolver.install(entry, envValues);
  }

  async uninstall(catalogId: string): Promise<{ success: boolean }> {
    const entry = await catalogAggregator.getEntry(catalogId);
    if (!entry) {
      return { success: false };
    }
    await this.installResolver.uninstall(entry);
    return { success: true };
  }

  async setEnabled(catalogId: string, enabled: boolean): Promise<{ success: boolean }> {
    const entry = await catalogAggregator.getEntry(catalogId);
    if (!entry) {
      return { success: false };
    }
    await this.installResolver.setEnabled(entry, enabled);
    return { success: true };
  }

  private toMarketplaceEntry(
    entry: CatalogEntry,
    skills: Awaited<ReturnType<SkillsManager['listSkills']>>,
    mcpServers: ReturnType<typeof mcpConfigStore.getServers>,
    plugins: ReturnType<PluginRuntimeService['listInstalled']>
  ): MarketplaceEntry {
    const record = marketplaceInstalledStore.get(entry.id);
    let installState: MarketplaceEntry['installState'] = 'not_installed';
    let enabled = false;
    let installedRef: string | undefined;

    if (record) {
      installState = 'installed';
      installedRef = record.installedRef;
      if (entry.type === 'skill') {
        const skill = skills.find((item) => item.id === record.installedRef);
        enabled = skill?.enabled ?? false;
      } else if (entry.type === 'mcp') {
        const server = mcpServers.find((item) => item.id === record.installedRef);
        enabled = server?.enabled ?? false;
      } else if (entry.type === 'plugin') {
        const plugin = plugins.find((item) => item.pluginId === record.installedRef);
        enabled = plugin?.enabled ?? false;
      }
    } else if (entry.type === 'skill' && entry.resolve.via === 'builtin') {
      const folderName = entry.resolve.path;
      const builtin = skills.find((skill) => skill.id === `builtin-${folderName}`);
      if (builtin) {
        installState = 'builtin';
        installedRef = builtin.id;
        enabled = builtin.enabled;
      }
    } else if (entry.type === 'mcp' && entry.resolve.via === 'preset') {
      const presetServer = mcpServers.find((server) => server.id === `marketplace-${entry.id}`);
      if (presetServer) {
        installState = 'installed';
        installedRef = presetServer.id;
        enabled = presetServer.enabled;
      }
    }

    return {
      ...entry,
      installState,
      enabled,
      installedRef,
      deprecated: entry.deprecated === true,
    };
  }
}
