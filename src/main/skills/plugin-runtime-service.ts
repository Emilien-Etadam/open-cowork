import * as fs from 'node:fs';
import * as path from 'node:path';
import { app } from 'electron';
import type {
  InstalledPlugin,
  PluginComponentCounts,
  PluginComponentEnabledState,
  PluginComponentKind,
  PluginInstallResultV2,
  PluginToggleResult,
} from '../../renderer/types';
import { log, logError } from '../utils/logger';
import { isPathWithinRoot } from '../tools/path-containment';
import { withRetry } from '../utils/retry';
import type { PluginSlashCommandInfo } from '../../shared/plugin-slash-commands';
import { discoverPluginSlashCommands } from './plugin-command-catalog';
import { pluginRegistryStore } from './plugin-registry-store';

interface PluginManifest {
  name?: string;
  description?: string;
  version?: string;
  author?: string | { name?: string };
  commands?: string | string[];
  agents?: string | string[];
  hooks?: string | Record<string, unknown>;
  mcpServers?: string | Record<string, unknown>;
  [key: string]: unknown;
}

const EMPTY_COUNTS: PluginComponentCounts = {
  skills: 0,
  commands: 0,
  agents: 0,
  hooks: 0,
  mcp: 0,
};

const EMPTY_COMPONENT_STATE: PluginComponentEnabledState = {
  skills: false,
  commands: false,
  agents: false,
  hooks: false,
  mcp: false,
};

function cloneCounts(counts: PluginComponentCounts): PluginComponentCounts {
  return {
    skills: counts.skills,
    commands: counts.commands,
    agents: counts.agents,
    hooks: counts.hooks,
    mcp: counts.mcp,
  };
}

function cloneComponentState(state: PluginComponentEnabledState): PluginComponentEnabledState {
  return {
    skills: state.skills,
    commands: state.commands,
    agents: state.agents,
    hooks: state.hooks,
    mcp: state.mcp,
  };
}

export class PluginRuntimeService {
  listInstalled(): InstalledPlugin[] {
    return pluginRegistryStore.list().map((plugin) => this.normalizeInstalledPlugin(plugin));
  }

  async installFromDirectory(pluginRootPath: string): Promise<PluginInstallResultV2> {
    if (!fs.existsSync(pluginRootPath) || !fs.statSync(pluginRootPath).isDirectory()) {
      throw new Error('Plugin directory does not exist');
    }
    log(`[PluginRuntime] Importing plugin directory: ${pluginRootPath}`);

    const sourceManifest = this.readManifest(pluginRootPath);
    const displayName = sourceManifest?.name?.trim() || path.basename(pluginRootPath);
    const pluginId = this.sanitizePluginId(displayName);
    const sourcePath = this.getSourcePath(pluginId);
    const runtimePath = this.getRuntimePath(pluginId);
    const componentCounts = this.detectComponentCounts(pluginRootPath, sourceManifest);

    await this.removePathWithRetries(sourcePath);
    await this.removePathWithRetries(runtimePath);
    this.copyDirectory(pluginRootPath, sourcePath);

    const now = Date.now();
    const defaultComponentState = this.getDefaultComponentState(componentCounts);
    const hasAnyComponent = this.hasAnyEnabledComponent(defaultComponentState, componentCounts);
    const installedPlugin: InstalledPlugin = {
      pluginId,
      name: displayName,
      description: sourceManifest?.description,
      version: sourceManifest?.version,
      authorName: this.resolveAuthorName(sourceManifest?.author),
      enabled: hasAnyComponent,
      sourcePath,
      runtimePath,
      componentCounts,
      componentsEnabled: defaultComponentState,
      installedAt: now,
      updatedAt: now,
    };

    pluginRegistryStore.save(installedPlugin);
    await this.materializeRuntime(pluginId);

    const persisted = pluginRegistryStore.get(pluginId);
    if (!persisted) {
      throw new Error(`Failed to persist installed plugin: ${pluginId}`);
    }

    const warnings: string[] = [];
    if (!sourceManifest) {
      warnings.push('plugin.json not found, generated runtime manifest with defaults');
    }

    const result = {
      plugin: this.normalizeInstalledPlugin(persisted),
      installedSkills: this.listSkillNames(sourcePath),
      warnings,
    };
    log(
      `[PluginRuntime] Imported plugin: ${result.plugin.name} (${result.plugin.pluginId}), components=${JSON.stringify(result.plugin.componentCounts)}`
    );
    return result;
  }

  async setEnabled(pluginId: string, enabled: boolean): Promise<PluginToggleResult> {
    const plugin = pluginRegistryStore.get(pluginId);
    if (!plugin) {
      throw new Error(`Plugin not found: ${pluginId}`);
    }

    const normalized = this.normalizeInstalledPlugin(plugin);
    normalized.enabled = enabled;
    normalized.updatedAt = Date.now();
    pluginRegistryStore.save(normalized);

    await this.materializeRuntime(pluginId);
    const updated = pluginRegistryStore.get(pluginId);
    if (!updated) {
      throw new Error(`Plugin not found after update: ${pluginId}`);
    }
    log(`[PluginRuntime] Plugin toggled: ${updated.name} (${pluginId}) enabled=${enabled}`);
    return {
      success: true,
      plugin: this.normalizeInstalledPlugin(updated),
    };
  }

  async setComponentEnabled(
    pluginId: string,
    component: PluginComponentKind,
    enabled: boolean
  ): Promise<PluginToggleResult> {
    const plugin = pluginRegistryStore.get(pluginId);
    if (!plugin) {
      throw new Error(`Plugin not found: ${pluginId}`);
    }

    const normalized = this.normalizeInstalledPlugin(plugin);
    const hasComponent = normalized.componentCounts[component] > 0;
    normalized.componentsEnabled[component] = enabled && hasComponent;
    normalized.updatedAt = Date.now();
    pluginRegistryStore.save(normalized);

    await this.materializeRuntime(pluginId);
    const updated = pluginRegistryStore.get(pluginId);
    if (!updated) {
      throw new Error(`Plugin not found after update: ${pluginId}`);
    }
    log(
      `[PluginRuntime] Plugin component toggled: ${updated.name} (${pluginId}) component=${component} enabled=${normalized.componentsEnabled[component]} available=${hasComponent}`
    );
    return {
      success: true,
      plugin: this.normalizeInstalledPlugin(updated),
    };
  }

  async uninstall(pluginId: string): Promise<{ success: boolean }> {
    log(`[PluginRuntime] Uninstall requested: ${pluginId}`);
    const plugin = pluginRegistryStore.get(pluginId);
    if (!plugin) {
      log(`[PluginRuntime] Uninstall skipped: plugin not found (${pluginId})`);
      return { success: false };
    }

    log(
      `[PluginRuntime] Removing plugin files: ${plugin.name} (${pluginId}), source=${plugin.sourcePath}, runtime=${plugin.runtimePath}`
    );
    await this.removePathWithRetries(plugin.sourcePath);
    await this.removePathWithRetries(plugin.runtimePath);
    const success = pluginRegistryStore.delete(pluginId);
    log(`[PluginRuntime] Uninstall completed: ${plugin.name} (${pluginId}) success=${success}`);
    return { success };
  }

  listAvailableCommands(): PluginSlashCommandInfo[] {
    const commands: PluginSlashCommandInfo[] = [];

    for (const plugin of this.listInstalled()) {
      if (
        !plugin.enabled ||
        !plugin.componentsEnabled.commands ||
        plugin.componentCounts.commands <= 0
      ) {
        continue;
      }

      if (!fs.existsSync(plugin.runtimePath)) {
        continue;
      }

      const manifest = this.readManifest(plugin.sourcePath);
      commands.push(
        ...discoverPluginSlashCommands(plugin.runtimePath, plugin.pluginId, plugin.name, manifest)
      );
    }

    return commands.sort((a, b) => a.command.localeCompare(b.command));
  }

  async getEnabledRuntimePlugins(): Promise<InstalledPlugin[]> {
    const plugins = this.listInstalled().filter(
      (plugin) =>
        plugin.enabled &&
        this.hasAnyEnabledComponent(plugin.componentsEnabled, plugin.componentCounts)
    );

    const ready: InstalledPlugin[] = [];
    for (const plugin of plugins) {
      if (!fs.existsSync(plugin.runtimePath)) {
        await this.materializeRuntime(plugin.pluginId);
      }
      if (fs.existsSync(plugin.runtimePath)) {
        ready.push(plugin);
      }
    }
    return ready;
  }

  private async materializeRuntime(pluginId: string): Promise<void> {
    const plugin = pluginRegistryStore.get(pluginId);
    if (!plugin) {
      return;
    }

    await this.removePathWithRetries(plugin.runtimePath);

    const active =
      plugin.enabled &&
      this.hasAnyEnabledComponent(plugin.componentsEnabled, plugin.componentCounts);
    if (!active) {
      return;
    }

    this.copyDirectory(plugin.sourcePath, plugin.runtimePath);

    const sourceManifest = this.readManifest(plugin.sourcePath);
    const runtimeManifest = this.buildRuntimeManifest(plugin, sourceManifest);
    await this.pruneDisabledComponents(plugin, sourceManifest);
    this.writeRuntimeManifest(plugin.runtimePath, runtimeManifest);

    log(`[PluginRuntime] Materialized runtime plugin: ${plugin.name} (${plugin.pluginId})`);
  }

  private buildRuntimeManifest(
    plugin: InstalledPlugin,
    sourceManifest: PluginManifest | null
  ): PluginManifest {
    const metadata: PluginManifest = sourceManifest ? { ...sourceManifest } : {};
    metadata.name = plugin.name;
    metadata.version = plugin.version ?? metadata.version ?? '0.1.0';
    metadata.description = plugin.description ?? metadata.description;
    if (plugin.authorName && !metadata.author) {
      metadata.author = plugin.authorName;
    }

    if (!this.isRuntimeComponentEnabled(plugin, 'commands')) {
      delete metadata.commands;
    }
    if (!this.isRuntimeComponentEnabled(plugin, 'agents')) {
      delete metadata.agents;
    }
    if (!this.isRuntimeComponentEnabled(plugin, 'hooks')) {
      delete metadata.hooks;
    }
    if (!this.isRuntimeComponentEnabled(plugin, 'mcp')) {
      delete metadata.mcpServers;
    }

    return metadata;
  }

  private async pruneDisabledComponents(
    plugin: InstalledPlugin,
    sourceManifest: PluginManifest | null
  ): Promise<void> {
    if (!this.isRuntimeComponentEnabled(plugin, 'skills')) {
      await this.removeRelativePath(plugin.runtimePath, './skills');
    }

    if (!this.isRuntimeComponentEnabled(plugin, 'commands')) {
      for (const componentPath of this.resolveComponentPaths(sourceManifest?.commands, [
        './commands',
      ])) {
        await this.removeRelativePath(plugin.runtimePath, componentPath);
      }
    }

    if (!this.isRuntimeComponentEnabled(plugin, 'agents')) {
      for (const componentPath of this.resolveComponentPaths(sourceManifest?.agents, [
        './agents',
      ])) {
        await this.removeRelativePath(plugin.runtimePath, componentPath);
      }
    }

    if (!this.isRuntimeComponentEnabled(plugin, 'hooks')) {
      if (typeof sourceManifest?.hooks === 'string') {
        await this.removeRelativePath(plugin.runtimePath, sourceManifest.hooks);
      } else {
        await this.removeRelativePath(plugin.runtimePath, './hooks/hooks.json');
      }
      await this.removeRelativePath(plugin.runtimePath, './hooks');
      await this.removeRelativePath(plugin.runtimePath, './hooks-handlers');
    }

    if (!this.isRuntimeComponentEnabled(plugin, 'mcp')) {
      if (typeof sourceManifest?.mcpServers === 'string') {
        await this.removeRelativePath(plugin.runtimePath, sourceManifest.mcpServers);
      } else {
        await this.removeRelativePath(plugin.runtimePath, './.mcp.json');
      }
      await this.removeRelativePath(plugin.runtimePath, './mcp');
    }
  }

  private writeRuntimeManifest(runtimeRootPath: string, manifest: PluginManifest): void {
    const manifestDir = path.join(runtimeRootPath, '.claude-plugin');
    fs.mkdirSync(manifestDir, { recursive: true });
    const manifestPath = path.join(manifestDir, 'plugin.json');
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
  }

  private detectComponentCounts(
    pluginRootPath: string,
    manifest: PluginManifest | null
  ): PluginComponentCounts {
    const counts = cloneCounts(EMPTY_COUNTS);
    counts.skills = this.countSkills(pluginRootPath);
    counts.commands = this.countMarkdownComponent(
      pluginRootPath,
      this.resolveComponentPaths(manifest?.commands, ['./commands'])
    );
    counts.agents = this.countMarkdownComponent(
      pluginRootPath,
      this.resolveComponentPaths(manifest?.agents, ['./agents'])
    );
    counts.hooks = this.countHooks(pluginRootPath, manifest);
    counts.mcp = this.countMcp(pluginRootPath, manifest);
    return counts;
  }

  private countSkills(pluginRootPath: string): number {
    const skillsRoot = path.join(pluginRootPath, 'skills');
    if (!fs.existsSync(skillsRoot) || !fs.statSync(skillsRoot).isDirectory()) {
      return 0;
    }
    const entries = fs.readdirSync(skillsRoot, { withFileTypes: true });
    return entries.reduce((count, entry) => {
      if (!entry.isDirectory()) {
        return count;
      }
      const skillFile = path.join(skillsRoot, entry.name, 'SKILL.md');
      return fs.existsSync(skillFile) ? count + 1 : count;
    }, 0);
  }

  private countMarkdownComponent(pluginRootPath: string, relativePaths: string[]): number {
    const uniqueFiles = new Set<string>();
    for (const relativePath of relativePaths) {
      const absolutePath = this.resolveSafePath(pluginRootPath, relativePath);
      if (!absolutePath || !fs.existsSync(absolutePath)) {
        continue;
      }
      this.collectMarkdownFiles(absolutePath, uniqueFiles);
    }
    return uniqueFiles.size;
  }

  private countHooks(pluginRootPath: string, manifest: PluginManifest | null): number {
    if (manifest?.hooks && typeof manifest.hooks === 'object') {
      return 1;
    }

    const hookPaths =
      typeof manifest?.hooks === 'string' ? [manifest.hooks] : ['./hooks/hooks.json'];

    for (const hookPath of hookPaths) {
      const absolutePath = this.resolveSafePath(pluginRootPath, hookPath);
      if (absolutePath && fs.existsSync(absolutePath)) {
        return 1;
      }
    }
    return 0;
  }

  private countMcp(pluginRootPath: string, manifest: PluginManifest | null): number {
    if (manifest?.mcpServers && typeof manifest.mcpServers === 'object') {
      return 1;
    }

    const mcpPaths =
      typeof manifest?.mcpServers === 'string' ? [manifest.mcpServers] : ['./.mcp.json'];

    for (const mcpPath of mcpPaths) {
      const absolutePath = this.resolveSafePath(pluginRootPath, mcpPath);
      if (absolutePath && fs.existsSync(absolutePath)) {
        return 1;
      }
    }
    return 0;
  }

  private getDefaultComponentState(
    componentCounts: PluginComponentCounts
  ): PluginComponentEnabledState {
    return {
      skills: componentCounts.skills > 0,
      commands: componentCounts.commands > 0,
      agents: componentCounts.agents > 0,
      hooks: false,
      mcp: false,
    };
  }

  private hasAnyEnabledComponent(
    componentsEnabled: PluginComponentEnabledState,
    componentCounts: PluginComponentCounts
  ): boolean {
    return (Object.keys(componentsEnabled) as PluginComponentKind[]).some(
      (component) => componentsEnabled[component] && componentCounts[component] > 0
    );
  }

  private isRuntimeComponentEnabled(
    plugin: InstalledPlugin,
    component: PluginComponentKind
  ): boolean {
    return plugin.componentsEnabled[component] && plugin.componentCounts[component] > 0;
  }

  private resolveComponentPaths(
    value: string | string[] | undefined,
    fallback: string[]
  ): string[] {
    if (!value) {
      return fallback;
    }
    return Array.isArray(value) ? value : [value];
  }

  private resolveSafePath(rootPath: string, relativePath: string): string | null {
    const normalized = relativePath.trim().replace(/\\/g, '/').replace(/^\.\//, '');
    if (!normalized || normalized.startsWith('/')) {
      return null;
    }
    const resolved = path.resolve(rootPath, normalized);
    if (!isPathWithinRoot(resolved, rootPath)) {
      return null;
    }
    return resolved;
  }

  private collectMarkdownFiles(targetPath: string, output: Set<string>): void {
    const stat = fs.statSync(targetPath);
    if (stat.isFile()) {
      if (targetPath.toLowerCase().endsWith('.md')) {
        output.add(targetPath);
      }
      return;
    }

    const entries = fs.readdirSync(targetPath, { withFileTypes: true });
    for (const entry of entries) {
      this.collectMarkdownFiles(path.join(targetPath, entry.name), output);
    }
  }

  private async removeRelativePath(rootPath: string, relativePath: string): Promise<void> {
    const absolutePath = this.resolveSafePath(rootPath, relativePath);
    if (!absolutePath) {
      return;
    }
    await this.removePathWithRetries(absolutePath);
  }

  private async removePathWithRetries(targetPath: string): Promise<void> {
    try {
      await this.ensurePathRemoved(targetPath);
    } catch (error) {
      if (!fs.existsSync(targetPath)) {
        return;
      }

      const movedPath = this.movePathToTrash(targetPath);
      if (!movedPath) {
        throw error;
      }

      try {
        fs.rmSync(movedPath, { recursive: true, force: true });
      } catch (cleanupError) {
        logError(
          `[PluginRuntime] Failed to fully delete moved-aside path: ${movedPath}`,
          cleanupError
        );
      }
    }
  }

  private async ensurePathRemoved(targetPath: string): Promise<void> {
    await withRetry(
      async () => {
        if (!fs.existsSync(targetPath)) {
          return;
        }

        fs.rmSync(targetPath, { recursive: true, force: true });

        if (fs.existsSync(targetPath)) {
          const error = new Error(`Path still exists after removal: ${targetPath}`) as Error & {
            code?: string;
          };
          error.code = 'ENOTEMPTY';
          throw error;
        }
      },
      {
        maxRetries: 5,
        delayMs: 25,
        backoffMultiplier: 2,
        shouldRetry: (error) => {
          const code = (error as Error & { code?: string }).code;
          return code === 'EBUSY' || code === 'EPERM' || code === 'ENOTEMPTY';
        },
      }
    );
  }

  private movePathToTrash(targetPath: string): string | null {
    if (!fs.existsSync(targetPath)) {
      return null;
    }

    try {
      const trashRoot = path.join(this.getPluginsRootPath(), '.trash');
      fs.mkdirSync(trashRoot, { recursive: true });

      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const trashPath = path.join(trashRoot, `${path.basename(targetPath)}-${uniqueSuffix}`);
      fs.renameSync(targetPath, trashPath);
      return trashPath;
    } catch (error) {
      logError(`[PluginRuntime] Failed to move path to trash: ${targetPath}`, error);
      return null;
    }
  }

  private copyDirectory(sourcePath: string, targetPath: string): void {
    if (!fs.existsSync(targetPath)) {
      fs.mkdirSync(targetPath, { recursive: true });
    }

    const entries = fs.readdirSync(sourcePath, { withFileTypes: true });
    for (const entry of entries) {
      const sourceEntryPath = path.join(sourcePath, entry.name);
      const targetEntryPath = path.join(targetPath, entry.name);
      if (entry.isDirectory()) {
        this.copyDirectory(sourceEntryPath, targetEntryPath);
      } else if (entry.isSymbolicLink()) {
        // Validate symlink target is within allowed directory
        const linkTarget = fs.readlinkSync(sourceEntryPath);
        const resolvedTarget = path.resolve(path.dirname(sourceEntryPath), linkTarget);
        if (!isPathWithinRoot(resolvedTarget, sourcePath)) {
          throw new Error(`Symlink target outside allowed directory: ${resolvedTarget}`);
        }
        fs.symlinkSync(linkTarget, targetEntryPath);
      } else {
        fs.copyFileSync(sourceEntryPath, targetEntryPath);
      }
    }
  }

  private listSkillNames(pluginRootPath: string): string[] {
    const skillsRoot = path.join(pluginRootPath, 'skills');
    if (!fs.existsSync(skillsRoot) || !fs.statSync(skillsRoot).isDirectory()) {
      return [];
    }
    const entries = fs.readdirSync(skillsRoot, { withFileTypes: true });
    const names: string[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const skillFile = path.join(skillsRoot, entry.name, 'SKILL.md');
      if (fs.existsSync(skillFile)) {
        names.push(entry.name);
      }
    }
    return names.sort((a, b) => a.localeCompare(b));
  }

  private readManifest(pluginRootPath: string): PluginManifest | null {
    const manifestPath = path.join(pluginRootPath, '.claude-plugin', 'plugin.json');
    if (!fs.existsSync(manifestPath)) {
      return null;
    }
    try {
      return JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as PluginManifest;
    } catch (error) {
      logError(`[PluginRuntime] Failed to parse plugin manifest: ${manifestPath}`, error);
      return null;
    }
  }

  private sanitizePluginId(name: string): string {
    const sanitized = name
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '');
    return sanitized || `plugin-${Date.now()}`;
  }

  private resolveAuthorName(author: PluginManifest['author']): string | undefined {
    if (!author) {
      return undefined;
    }
    if (typeof author === 'string') {
      return author;
    }
    return author.name;
  }

  private normalizeInstalledPlugin(plugin: InstalledPlugin): InstalledPlugin {
    return {
      ...plugin,
      componentCounts: plugin.componentCounts
        ? cloneCounts(plugin.componentCounts)
        : cloneCounts(EMPTY_COUNTS),
      componentsEnabled: plugin.componentsEnabled
        ? cloneComponentState(plugin.componentsEnabled)
        : cloneComponentState(EMPTY_COMPONENT_STATE),
    };
  }

  private getPluginsRootPath(): string {
    return path.join(app.getPath('userData'), 'claude', 'plugins');
  }

  private getSourcePath(pluginId: string): string {
    return path.join(this.getPluginsRootPath(), 'source', pluginId);
  }

  private getRuntimePath(pluginId: string): string {
    return path.join(this.getPluginsRootPath(), 'runtime', pluginId);
  }
}
