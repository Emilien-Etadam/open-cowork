import * as fs from 'node:fs';
import * as path from 'node:path';
import type { PluginSlashCommandInfo } from '../../shared/plugin-slash-commands';
import { isPathWithinRoot } from '../tools/path-containment';

interface PluginCommandSource {
  pluginId: string;
  pluginName: string;
  filePath: string;
  name: string;
  description: string;
}

interface PluginManifestCommands {
  commands?: string | string[];
}

function resolveComponentPaths(value: string | string[] | undefined, fallback: string[]): string[] {
  if (!value) {
    return fallback;
  }
  return Array.isArray(value) ? value : [value];
}

function resolveSafePath(rootPath: string, relativePath: string): string | null {
  const normalized = relativePath.trim().replace(/\\/g, '/').replace(/^\.\//, '');
  if (!normalized || normalized.startsWith('/')) {
    return null;
  }
  const resolved = path.resolve(rootPath, relativePath);
  if (!isPathWithinRoot(resolved, rootPath)) {
    return null;
  }
  return resolved;
}

function collectMarkdownFiles(targetPath: string, output: Set<string>): void {
  if (!fs.existsSync(targetPath)) {
    return;
  }

  const stat = fs.statSync(targetPath);
  if (stat.isFile()) {
    if (targetPath.toLowerCase().endsWith('.md')) {
      output.add(targetPath);
    }
    return;
  }

  const entries = fs.readdirSync(targetPath, { withFileTypes: true });
  for (const entry of entries) {
    collectMarkdownFiles(path.join(targetPath, entry.name), output);
  }
}

function parseCommandDescription(content: string): string {
  const frontMatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const frontMatter = frontMatterMatch ? frontMatterMatch[1] : '';
  const body = frontMatterMatch ? content.slice(frontMatterMatch[0].length) : content;

  const descMatch = frontMatter.match(/description:\s*["']?([^"'\r\n]+)["']?/);
  if (descMatch) {
    return descMatch[1].trim();
  }

  const firstLine = body.split('\n').find((line) => line.trim());
  if (!firstLine) {
    return '';
  }

  const trimmed = firstLine.trim();
  return trimmed.length > 60 ? `${trimmed.slice(0, 60)}...` : trimmed;
}

function loadCommandFromFile(
  filePath: string,
  pluginId: string,
  pluginName: string
): PluginCommandSource | null {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const name = path.basename(filePath, path.extname(filePath));
    if (!name) {
      return null;
    }

    return {
      pluginId,
      pluginName,
      filePath,
      name,
      description: parseCommandDescription(content),
    };
  } catch {
    return null;
  }
}

export function discoverPluginCommandSources(
  runtimePath: string,
  pluginId: string,
  pluginName: string,
  manifest: PluginManifestCommands | null
): PluginCommandSource[] {
  const commandPaths = resolveComponentPaths(manifest?.commands, ['./commands']);
  const uniqueFiles = new Set<string>();

  for (const relativePath of commandPaths) {
    const absolutePath = resolveSafePath(runtimePath, relativePath);
    if (!absolutePath) {
      continue;
    }
    collectMarkdownFiles(absolutePath, uniqueFiles);
  }

  const sources: PluginCommandSource[] = [];
  for (const filePath of uniqueFiles) {
    const source = loadCommandFromFile(filePath, pluginId, pluginName);
    if (source) {
      sources.push(source);
    }
  }

  return sources.sort((a, b) => a.name.localeCompare(b.name));
}

export function resolvePluginSlashCommands(
  sources: PluginCommandSource[]
): PluginSlashCommandInfo[] {
  const nameOwners = new Map<string, PluginCommandSource[]>();

  for (const source of sources) {
    const key = source.name.toLowerCase();
    const owners = nameOwners.get(key) ?? [];
    owners.push(source);
    nameOwners.set(key, owners);
  }

  return sources.map((source) => {
    const owners = nameOwners.get(source.name.toLowerCase()) ?? [source];
    const command = owners.length > 1 ? `/${source.pluginId}:${source.name}` : `/${source.name}`;

    return {
      pluginId: source.pluginId,
      pluginName: source.pluginName,
      name: source.name,
      command,
      description: source.description,
    };
  });
}

export function discoverPluginSlashCommands(
  runtimePath: string,
  pluginId: string,
  pluginName: string,
  manifest: PluginManifestCommands | null
): PluginSlashCommandInfo[] {
  const sources = discoverPluginCommandSources(runtimePath, pluginId, pluginName, manifest);
  return resolvePluginSlashCommands(sources);
}

export function discoverPluginPromptTemplatePaths(
  runtimePath: string,
  manifest: PluginManifestCommands | null
): string[] {
  const commandPaths = resolveComponentPaths(manifest?.commands, ['./commands']);
  const resolvedPaths: string[] = [];

  for (const relativePath of commandPaths) {
    const absolutePath = resolveSafePath(runtimePath, relativePath);
    if (absolutePath && fs.existsSync(absolutePath)) {
      resolvedPaths.push(absolutePath);
    }
  }

  return resolvedPaths;
}
