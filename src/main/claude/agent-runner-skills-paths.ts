import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import type { ServerEvent } from '../../renderer/types';
import { configStore } from '../config/config-store';
import { log, logWarn } from '../utils/logger';
import type { PluginRuntimeService } from '../skills/plugin-runtime-service';
import type { SkillsAdapter } from '../skills/skills-adapter';
import { getBundledNodePaths, resolveBundledPythonBinDir } from './agent-runner-path-env';

export interface AgentRunnerSkillsPathsContext {
  skillsAdapter?: SkillsAdapter;
  pluginRuntimeService?: PluginRuntimeService;
  sendToRenderer: (event: ServerEvent) => void;
}

export class AgentRunnerSkillsPaths {
  constructor(private readonly ctx: AgentRunnerSkillsPathsContext) {}

  /**
   * Generate bundled executable path hints for production mode system prompt.
   * In dev mode returns empty string (user PATH already works).
   * This is a defense-in-depth layer — even if PATH enrichment works, explicit
   * paths help the model avoid ambiguity when Skills reference bare commands.
   */
  getBundledPathHints(): string {
    if (!app.isPackaged) return '';

    const hints: string[] = [];

    const nodePaths = getBundledNodePaths();
    if (nodePaths) {
      hints.push(`- node: ${nodePaths.node}`);
      hints.push(`- npx: ${nodePaths.npx}`);
    }

    const pythonBinDir = resolveBundledPythonBinDir();
    if (pythonBinDir) {
      const pythonExe = process.platform === 'win32' ? 'python.exe' : 'python3';
      const pipExe = process.platform === 'win32' ? 'pip.exe' : 'pip3';
      hints.push(`- python3: ${path.join(pythonBinDir, pythonExe)}`);
      if (fs.existsSync(path.join(pythonBinDir, pipExe))) {
        hints.push(`- pip3: ${path.join(pythonBinDir, pipExe)}`);
      }
    }

    if (hints.length === 0) return '';

    return `<bundled_executables>
This application bundles its own executables. When executing commands, prefer these absolute paths:
${hints.join('\n')}
</bundled_executables>`;
  }

  /** Fallback skill path resolution when SkillsAdapter is not provided. */
  legacySkillPaths(): string[] {
    const paths: string[] = [];
    const builtin = this.getBuiltinSkillsPath();
    if (builtin && fs.existsSync(builtin)) paths.push(builtin);
    const global = this.getConfiguredGlobalSkillsDir();
    if (global && fs.existsSync(global)) paths.push(global);
    return paths;
  }

  async resolveSkillPaths(sessionId?: string): Promise<string[]> {
    const basePaths = this.ctx.skillsAdapter
      ? this.ctx.skillsAdapter.getSkillPaths()
      : this.legacySkillPaths();
    const mergedPaths = new Set(
      basePaths.filter((item): item is string => Boolean(item && fs.existsSync(item)))
    );
    const appliedPlugins: Array<{ name: string; path: string }> = [];

    if (this.ctx.pluginRuntimeService) {
      try {
        const runtimePlugins = await this.ctx.pluginRuntimeService.getEnabledRuntimePlugins();
        for (const plugin of runtimePlugins) {
          if (!plugin.componentsEnabled.skills || plugin.componentCounts.skills <= 0) {
            continue;
          }
          const runtimeSkillsPath = path.join(plugin.runtimePath, 'skills');
          if (!fs.existsSync(runtimeSkillsPath)) {
            continue;
          }
          mergedPaths.add(runtimeSkillsPath);
          appliedPlugins.push({ name: plugin.name, path: runtimeSkillsPath });
        }
      } catch (error) {
        logWarn('[ClaudeAgentRunner] Failed to resolve runtime plugin skill paths:', error);
      }
    }

    if (sessionId && appliedPlugins.length > 0) {
      this.ctx.sendToRenderer({
        type: 'plugins.runtimeApplied',
        payload: { sessionId, plugins: appliedPlugins },
      });
    }

    return Array.from(mergedPaths);
  }

  /**
   * Get the built-in skills directory (shipped with the app)
   */
  getBuiltinSkillsPath(): string {
    // In development, skills are in the project's .claude/skills directory
    // In production, they're extracted via extraResources to resources/skills
    const appPath = app.getAppPath();
    const unpackedPath = appPath.replace(/\.asar$/, '.asar.unpacked');

    const possiblePaths = [
      // Development: relative to this file
      path.join(__dirname, '..', '..', '..', '.claude', 'skills'),
      // Production: extraResources extracts .claude/skills → resources/skills
      // This is the preferred production path (real directory, no asar issues)
      path.join(process.resourcesPath || '', 'skills'),
      // Legacy: in app.asar.unpacked (for older builds with asarUnpack)
      ...(this.physicalDirExists(path.join(unpackedPath, '.claude', 'skills'))
        ? [path.join(unpackedPath, '.claude', 'skills')]
        : []),
      // Last resort: read from inside the asar archive (Electron intercepts this)
      path.join(appPath, '.claude', 'skills'),
    ];

    for (const candidatePath of possiblePaths) {
      if (fs.existsSync(candidatePath)) {
        log('[ClaudeAgentRunner] Found built-in skills at:', candidatePath);
        return candidatePath;
      }
    }

    logWarn('[ClaudeAgentRunner] No built-in skills directory found');
    return '';
  }

  /**
   * Check if a directory physically exists on disk, bypassing Electron's
   * asar interception.
   */
  physicalDirExists(dirPath: string): boolean {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const originalFs = require('original-fs') as typeof import('fs');
      return originalFs.existsSync(dirPath) && originalFs.statSync(dirPath).isDirectory();
    } catch {
      return false;
    }
  }

  getAppClaudeDir(): string {
    return path.join(app.getPath('userData'), 'claude');
  }

  getRuntimeSkillsDir(): string {
    return path.join(this.getAppClaudeDir(), 'skills');
  }

  getConfiguredGlobalSkillsDir(): string {
    const configuredPath = (configStore.get('globalSkillsPath') || '').trim();
    if (!configuredPath) {
      return this.getRuntimeSkillsDir();
    }

    const resolvedPath = path.resolve(configuredPath);
    try {
      if (!fs.existsSync(resolvedPath)) {
        fs.mkdirSync(resolvedPath, { recursive: true });
      }
      if (fs.statSync(resolvedPath).isDirectory()) {
        return resolvedPath;
      }
      logWarn(
        '[ClaudeAgentRunner] Configured skills path is not a directory, fallback to runtime path:',
        resolvedPath
      );
    } catch (error) {
      logWarn(
        '[ClaudeAgentRunner] Configured skills path is unavailable, fallback to runtime path:',
        resolvedPath,
        error
      );
    }

    return this.getRuntimeSkillsDir();
  }

  getUserClaudeSkillsDir(): string {
    return path.join(app.getPath('home'), '.claude', 'skills');
  }

  syncUserSkillsToAppDir(appSkillsDir: string): void {
    const userSkillsDir = this.getUserClaudeSkillsDir();
    if (!fs.existsSync(userSkillsDir)) {
      return;
    }

    const entries = fs.readdirSync(userSkillsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const sourcePath = path.join(userSkillsDir, entry.name);
      const targetPath = path.join(appSkillsDir, entry.name);

      if (fs.existsSync(targetPath)) {
        try {
          const stat = fs.lstatSync(targetPath);
          if (!stat.isSymbolicLink()) {
            continue;
          }
          fs.unlinkSync(targetPath);
        } catch {
          continue;
        }
      }

      try {
        fs.symlinkSync(sourcePath, targetPath, 'dir');
      } catch (err) {
        try {
          this.copyDirectorySync(sourcePath, targetPath);
        } catch (copyErr) {
          logWarn('[ClaudeAgentRunner] Failed to import user skill:', entry.name, copyErr);
        }
      }
    }
  }

  syncConfiguredSkillsToRuntimeDir(runtimeSkillsDir: string): void {
    const configuredSkillsDir = this.getConfiguredGlobalSkillsDir();
    if (configuredSkillsDir === runtimeSkillsDir) {
      return;
    }
    if (!fs.existsSync(configuredSkillsDir) || !fs.statSync(configuredSkillsDir).isDirectory()) {
      return;
    }

    const entries = fs.readdirSync(configuredSkillsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const sourcePath = path.join(configuredSkillsDir, entry.name);
      const targetPath = path.join(runtimeSkillsDir, entry.name);
      try {
        if (fs.existsSync(targetPath)) {
          // Use lstatSync so we don't follow symlinks — check the entry itself
          const stat = fs.lstatSync(targetPath);
          if (stat.isSymbolicLink()) {
            fs.unlinkSync(targetPath);
          } else {
            fs.rmSync(targetPath, { recursive: true, force: true });
          }
        }
        fs.symlinkSync(sourcePath, targetPath, 'dir');
      } catch (err) {
        try {
          this.copyDirectorySync(sourcePath, targetPath);
        } catch (copyErr) {
          logWarn('[ClaudeAgentRunner] Failed to sync configured skill:', entry.name, copyErr);
        }
      }
    }
  }

  copyDirectorySync(source: string, target: string): void {
    if (!fs.existsSync(target)) {
      fs.mkdirSync(target, { recursive: true });
    }

    const entries = fs.readdirSync(source);
    for (const entry of entries) {
      const sourcePath = path.join(source, entry);
      const targetPath = path.join(target, entry);
      const stat = fs.statSync(sourcePath);

      if (stat.isDirectory()) {
        this.copyDirectorySync(sourcePath, targetPath);
      } else {
        fs.copyFileSync(sourcePath, targetPath);
      }
    }
  }
}
