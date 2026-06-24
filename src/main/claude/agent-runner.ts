/**
 * @module main/claude/agent-runner
 *
 * AI query execution engine (1514 lines).
 *
 * Responsibilities:
 * - Runs AI conversations via the Open Cowork agent SDK (createAgentSession)
 * - Routes providers via pi-ai SDK for model resolution
 * - Bridges MCP tools into SDK ToolDefinition format
 * - Streams responses back as ServerEvents (stream.message, stream.partial, trace.step)
 * - Skills injection, system prompt assembly, permission handling
 *
 * Dependencies: session-manager, mcp-manager, config-store, skills-manager
 */
import {
  createAgentSession,
  SessionManager as PiSessionManager,
  SettingsManager as PiSettingsManager,
  createBashToolDefinition,
  getAgentDir,
  type BashToolOptions,
  type AgentSession as PiAgentSession,
  type ToolDefinition,
} from '@mariozechner/pi-coding-agent';
import { Type, type TSchema } from 'typebox';
import { getSharedAuthStorage, ModelRegistry } from './shared-auth';
import type { Session, Message, TraceStep, ServerEvent, ContentBlock } from '../../renderer/types';
import { v4 as uuidv4 } from 'uuid';
import { PathResolver } from '../sandbox/path-resolver';
import { MCPManager } from '../mcp/mcp-manager';
import { mcpConfigStore } from '../mcp/mcp-config-store';
import {
  log,
  logWarn,
  logError,
  logCtx,
  logCtxWarn,
  logCtxError,
  logTiming,
} from '../utils/logger';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { execFileSync } from 'child_process';
import { app } from 'electron';
import { setMaxListeners } from 'node:events';
import { getSandboxAdapter } from '../sandbox/sandbox-adapter';
import { SandboxSync } from '../sandbox/sandbox-sync';
import { extractArtifactsFromText, buildArtifactTraceSteps } from '../utils/artifact-parser';
import { getDefaultShell } from '../utils/shell-resolver';
import { PluginRuntimeService } from '../skills/plugin-runtime-service';
import type { SkillsAdapter } from '../skills/skills-adapter';
import { AgentRuntimeExtensionManager } from '../extensions/agent-runtime-extension-manager';
import { configStore } from '../config/config-store';
import { normalizeOpenAICompatibleBaseUrl } from '../config/auth-utils';
import {
  buildTerminalErrorEmissionDetails,
  buildTerminalErrorMessage,
  resolveAbortDisposition,
  resolveAssistantStreamErrorText,
  resolveMessageEndPayload,
  shouldPreserveExistingTrace,
  toUserFacingErrorText,
} from './agent-runner-message-end';
import {
  applyPiModelRuntimeOverrides,
  buildSyntheticPiModel,
  resolvePiRegistryModel,
  resolvePiRouteProtocol,
  resolveSyntheticPiModelFallback,
} from './pi-model-resolution';
import { buildPiSessionRuntimeSignature } from './pi-session-runtime';
import { ThinkTagStreamParser } from './think-tag-parser';
import {
  LoopGuard,
  buildAbortUserMessage,
  buildHaltSteerMessage,
  buildWarnSteerMessage,
  type LoopGuardDecision,
  type ToolCallDescriptor,
} from './agent-runner-loop-guard';
import {
  normalizeMcpToolResultForModel,
  normalizeToolExecutionResultForUi,
} from './tool-result-utils';
import { fetchOllamaModelInfo } from '../config/ollama-api';
import { createWindowsBashOperations } from './windows-bash-operations';
import { createWslSandboxBashOperations } from './wsl-sandbox-bash-operations';
import { wslUnixPathToWindowsUnc } from '../sandbox/sandbox-workspace-path';
import {
  buildCompactionSettings,
  estimateTokensFromText,
  formatContextOverflowError,
  getLastInputTokenCount,
  shouldBlockForContextOverflow,
} from './context-budget';
import {
  buildConversationTranscriptForHandoff,
  buildHandoffSummaryUserPrompt,
  HANDOFF_SUMMARY_SYSTEM_PROMPT,
} from '../../shared/compaction-handoff';
import { runPiAiOneShot } from './claude-sdk-one-shot';
import { mt } from '../i18n';
import {
  buildColdStartContextualPrompt,
  serializeMessageContentForHistory,
} from './agent-runner-history';
export { serializeMessageContentForHistory } from './agent-runner-history';
import { bootstrapSandboxEnvironment } from './agent-runner-sandbox-bootstrap';
import {
  type CachedPiSession,
  disposeCachedPiSession,
  evictOldestPiSession,
  installPermissionHook,
  resolveToolDisplayName,
  wrapBashToolForSudo,
  wrapBashToolWithDefaultTimeout,
} from './agent-runner-pi-session';

// Virtual workspace path shown to the model (hides real sandbox path)
const VIRTUAL_WORKSPACE_PATH = '/workspace';

// Bundled node/npx paths never change at runtime — resolve once.
let cachedBundledNodePaths: { node: string; npx: string } | null | undefined = undefined;

function getBundledNodePaths(): { node: string; npx: string } | null {
  if (cachedBundledNodePaths !== undefined) {
    return cachedBundledNodePaths;
  }
  const platform = process.platform;
  const arch = process.arch;
  let resourcesPath: string;
  if (!app.isPackaged) {
    const projectRoot = path.join(__dirname, '..', '..');
    resourcesPath = path.join(projectRoot, 'resources', 'node', `${platform}-${arch}`);
  } else {
    resourcesPath = path.join(process.resourcesPath, 'node');
  }
  const binDir = platform === 'win32' ? resourcesPath : path.join(resourcesPath, 'bin');
  const nodePath = path.join(binDir, platform === 'win32' ? 'node.exe' : 'node');
  const npxPath = path.join(binDir, platform === 'win32' ? 'npx.cmd' : 'npx');
  cachedBundledNodePaths =
    fs.existsSync(nodePath) && fs.existsSync(npxPath) ? { node: nodePath, npx: npxPath } : null;
  return cachedBundledNodePaths;
}

/**
 * Resolve bundled Python bin directory path (if available).
 * Checks packaged and dev layouts, returns the bin dir containing python3.
 */
function resolveBundledPythonBinDir(): string | null {
  const platform = process.platform;
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';

  const candidates: string[] = [];
  if (!app.isPackaged) {
    const projectRoot = path.join(__dirname, '..', '..');
    if (platform === 'darwin') {
      candidates.push(path.join(projectRoot, 'resources', 'python', `darwin-${arch}`, 'bin'));
    }
    candidates.push(path.join(projectRoot, 'resources', 'python', 'bin'));
  } else {
    // Packaged layout: Resources/python/bin/python3
    candidates.push(path.join(process.resourcesPath, 'python', 'bin'));
  }

  const pythonExe = platform === 'win32' ? 'python.exe' : 'python3';
  for (const binDir of candidates) {
    if (fs.existsSync(path.join(binDir, pythonExe))) return binDir;
  }
  return null;
}

/**
 * Resolve bundled tools directory (cliclick etc., macOS only).
 */
function resolveBundledToolsBinDir(): string | null {
  if (process.platform !== 'darwin') return null;
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';

  const candidates: string[] = [];
  if (!app.isPackaged) {
    const projectRoot = path.join(__dirname, '..', '..');
    candidates.push(path.join(projectRoot, 'resources', 'tools', `darwin-${arch}`, 'bin'));
    candidates.push(path.join(projectRoot, 'resources', 'tools', 'bin'));
  } else {
    candidates.push(path.join(process.resourcesPath, 'tools', `darwin-${arch}`, 'bin'));
    candidates.push(path.join(process.resourcesPath, 'tools', 'bin'));
  }

  for (const binDir of candidates) {
    if (fs.existsSync(binDir)) return binDir;
  }
  return null;
}

/**
 * One-time enrichment of process.env.PATH for build (production) mode.
 *
 * In dev mode, Electron inherits the user's full shell PATH, so Skill commands
 * like `python3` and `node` just work. In build mode, `process.env.PATH` is
 * minimal (often just `/usr/bin:/bin`).
 *
 * This function:
 * 1. Restores the user's login-shell PATH (safe: uses execFileSync, not execSync)
 * 2. Prepends bundled Node, Python, and tools bin dirs (highest priority)
 * 3. Deduplicates all entries
 * 4. Writes the result back to `process.env.PATH`
 *
 * Called once before the first agent session creation — subsequent calls are no-ops.
 */
let pathEnriched = false;

async function enrichProcessPathForBuild(): Promise<void> {
  if (pathEnriched) return;
  pathEnriched = true;

  if (!app.isPackaged) {
    log('[ClaudeAgentRunner] Dev mode — skipping PATH enrichment');
    return;
  }

  const platform = process.platform;
  const delimiter = platform === 'win32' ? ';' : ':';
  const currentPaths = (process.env.PATH || '').split(delimiter).filter((p: string) => p.trim());

  // 1. Restore user's login-shell PATH
  let shellPaths: string[] = [];
  if (platform === 'darwin' || platform === 'linux') {
    try {
      const shell = getDefaultShell();
      const output = (
        execFileSync(shell, ['-l', '-c', 'echo $PATH'], {
          encoding: 'utf-8',
          timeout: 5000,
          env: { ...process.env, HOME: os.homedir() },
        }) as string
      ).trim();
      if (output) {
        shellPaths = output.split(':').filter((p: string) => p.trim());
        log(`[ClaudeAgentRunner] Restored ${shellPaths.length} paths from login shell`);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logWarn(`[ClaudeAgentRunner] Could not restore shell PATH: ${message}`);
    }
  } else if (platform === 'win32') {
    try {
      const output = (
        execFileSync(
          'powershell.exe',
          [
            '-NoProfile',
            '-Command',
            "[Environment]::GetEnvironmentVariable('Path', 'User') + ';' + [Environment]::GetEnvironmentVariable('Path', 'Machine')",
          ],
          { encoding: 'utf-8', timeout: 5000 }
        ) as string
      ).trim();
      if (output) {
        shellPaths = output.split(';').filter((p: string) => p.trim());
        log(`[ClaudeAgentRunner] Restored ${shellPaths.length} paths from Windows registry`);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logWarn(`[ClaudeAgentRunner] Could not restore Windows PATH: ${message}`);
    }
  }

  // 2. Collect bundled bin directories (highest priority)
  const bundledDirs: string[] = [];

  const nodePaths = getBundledNodePaths();
  if (nodePaths) {
    bundledDirs.push(path.dirname(nodePaths.node));
  }

  const pythonBinDir = resolveBundledPythonBinDir();
  if (pythonBinDir) {
    bundledDirs.push(pythonBinDir);
  }

  const toolsBinDir = resolveBundledToolsBinDir();
  if (toolsBinDir) {
    bundledDirs.push(toolsBinDir);
  }

  // 3. Merge: bundled (highest) → shell → current process, deduplicate
  const seen = new Set<string>();
  const merged: string[] = [];

  for (const p of [...bundledDirs, ...shellPaths, ...currentPaths]) {
    const normalized = platform === 'win32' ? p.toLowerCase() : p;
    if (!seen.has(normalized)) {
      seen.add(normalized);
      merged.push(p);
    }
  }

  process.env.PATH = merged.join(delimiter);
  log(
    `[ClaudeAgentRunner] Enriched process.env.PATH for build mode: ${bundledDirs.length} bundled + ${shellPaths.length} shell + ${currentPaths.length} process → ${merged.length} total`
  );
}

// Shared pi-ai auth storage — created once, reused across sessions.

/**
 * Bridge MCP tools from MCPManager into ToolDefinition[] format for the agent SDK.
 * Each MCP tool becomes a customTool whose execute() delegates to mcpManager.callTool().
 */
function buildMcpCustomTools(mcpManager: MCPManager): ToolDefinition[] {
  const mcpTools = mcpManager.getTools();
  return mcpTools.map((mcpTool) => {
    // Wrap the raw JSON Schema inputSchema as a TypeBox TSchema
    const parameters = Type.Unsafe<Record<string, unknown>>(
      mcpTool.inputSchema as Record<string, unknown>
    );

    const toolDef: ToolDefinition<TSchema, unknown> = {
      name: mcpTool.name,
      label: `${mcpTool.serverName} → ${mcpTool.originalName || mcpTool.name}`,
      description: mcpTool.description || `MCP tool from ${mcpTool.serverName}`,
      parameters,
      async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
        try {
          const result = await mcpManager.callTool(mcpTool.name, params as Record<string, unknown>);
          const normalizedResult = normalizeMcpToolResultForModel(result);
          return {
            content: [{ type: 'text' as const, text: normalizedResult.text }],
            details:
              normalizedResult.images.length > 0
                ? { openCoworkImages: normalizedResult.images }
                : undefined,
          };
        } catch (err: unknown) {
          logError(`[ClaudeAgentRunner] MCP tool ${mcpTool.name} failed:`, err);
          throw err instanceof Error ? err : new Error(String(err));
        }
      },
    };
    return toolDef;
  });
}

/**
 * Get shell environment with proper PATH (including node, npm, etc.)
 * GUI apps on macOS don't inherit shell PATH, so we need to extract it
 */

function safeStringify(value: unknown, space = 0): string {
  try {
    return JSON.stringify(value, null, space);
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    return `[Unserializable: ${details}]`;
  }
}

function summarizeMessageForLog(message: unknown): Record<string, unknown> {
  if (!message || typeof message !== 'object') {
    return { present: false };
  }

  const typedMessage = message as {
    role?: unknown;
    stopReason?: unknown;
    content?: unknown[];
    usage?: unknown;
  };
  const content = Array.isArray(typedMessage.content) ? typedMessage.content : [];

  return {
    present: true,
    role: typeof typedMessage.role === 'string' ? typedMessage.role : undefined,
    stopReason: typedMessage.stopReason ?? undefined,
    contentBlocks: content.length,
    contentTypes: content.slice(0, 8).map((block) => {
      if (!block || typeof block !== 'object') {
        return typeof block;
      }
      const type = (block as { type?: unknown }).type;
      return typeof type === 'string' ? type : 'unknown';
    }),
    usage: normalizeTokenUsage(typedMessage.usage),
  };
}

function toErrorText(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  if (error && typeof error === 'object') {
    const maybeMessage = (error as { message?: unknown }).message;
    if (typeof maybeMessage === 'string' && maybeMessage.trim()) {
      return maybeMessage;
    }
  }
  const serialized = safeStringify(error);
  if (serialized.startsWith('[Unserializable:')) {
    return String(error);
  }
  return serialized;
}

function normalizeTokenUsage(usage: unknown): Message['tokenUsage'] | undefined {
  if (!usage || typeof usage !== 'object') {
    return undefined;
  }

  const raw = usage as {
    input?: unknown;
    output?: unknown;
    input_tokens?: unknown;
    output_tokens?: unknown;
    inputTokens?: unknown;
    outputTokens?: unknown;
  };

  const input = raw.input ?? raw.input_tokens ?? raw.inputTokens;
  const output = raw.output ?? raw.output_tokens ?? raw.outputTokens;

  if (typeof input !== 'number' || typeof output !== 'number') {
    return undefined;
  }

  return { input, output };
}

interface AgentRunnerOptions {
  sendToRenderer: (event: ServerEvent) => void;
  saveMessage?: (message: Message) => void;
  requestSudoPassword?: (
    sessionId: string,
    toolUseId: string,
    command: string
  ) => Promise<string | null>;
  requestPermission?: (
    sessionId: string,
    toolUseId: string,
    toolName: string,
    input: Record<string, unknown>
  ) => Promise<'allow' | 'deny' | 'allow_always'>;
}

/**
 * ClaudeAgentRunner - Uses @mariozechner/pi-coding-agent SDK
 *
 * Environment variables should be set before running:
 *   ANTHROPIC_BASE_URL=https://openrouter.ai/api
 *   ANTHROPIC_AUTH_TOKEN=your_openrouter_api_key
 *   ANTHROPIC_API_KEY="" (must be empty)
 */
export class ClaudeAgentRunner {
  private sendToRenderer: (event: ServerEvent) => void;
  private saveMessage?: (message: Message) => void;
  private requestSudoPassword?: (
    sessionId: string,
    toolUseId: string,
    command: string
  ) => Promise<string | null>;
  private requestPermission?: (
    sessionId: string,
    toolUseId: string,
    toolName: string,
    input: Record<string, unknown>
  ) => Promise<'allow' | 'deny' | 'allow_always'>;
  private pathResolver: PathResolver;
  private mcpManager?: MCPManager;
  private _pluginRuntimeService?: PluginRuntimeService;
  private _skillsAdapter?: SkillsAdapter;
  private extensionManager?: AgentRuntimeExtensionManager;
  private activeControllers: Map<string, AbortController> = new Map();
  private piSessions: Map<string, CachedPiSession> = new Map();
  private toolDisplayNameCache: Map<string, string> = new Map();

  // Per-instance caches — invalidated when the underlying config changes.
  private _mcpServersCache: { fingerprint: string; servers: Record<string, unknown> } | null = null;
  private _skillsSetupDone = false;

  /**
   * Clear SDK session cache for a session
   * Called when session's cwd changes - SDK sessions are bound to cwd
   */
  clearSdkSession(sessionId: string): void {
    const cached = this.piSessions.get(sessionId);
    if (cached) {
      disposeCachedPiSession(cached);
      this.piSessions.delete(sessionId);
      log('[ClaudeAgentRunner] Disposed pi session for:', sessionId);
    }
  }

  clearAllSdkSessions(): void {
    for (const sessionId of Array.from(this.piSessions.keys())) {
      this.clearSdkSession(sessionId);
    }
  }

  /** Call after the user installs / removes a skill so the next query re-links everything. */
  invalidateSkillsSetup(): void {
    this._skillsSetupDone = false;
  }

  /** Call after the user changes MCP server config so the next query rebuilds mcpServers. */
  invalidateMcpServersCache(): void {
    this._mcpServersCache = null;
    // Sessions stay alive — MCP tools are rebuilt each query via buildMcpCustomTools()
    log('[ClaudeAgentRunner] MCP servers cache invalidated — tools will rebuild on next query');
  }

  // TODO: Credentials should be served via a secure MCP tool or IPC channel,
  // not injected as plaintext into the system prompt. The getCredentialsPrompt()
  // method was removed to eliminate credential leakage risk.

  /**
   * Generate bundled executable path hints for production mode system prompt.
   * In dev mode returns empty string (user PATH already works).
   * This is a defense-in-depth layer — even if PATH enrichment works, explicit
   * paths help the model avoid ambiguity when Skills reference bare commands.
   */
  private getBundledPathHints(): string {
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
  private legacySkillPaths(): string[] {
    const paths: string[] = [];
    const builtin = this.getBuiltinSkillsPath();
    if (builtin && fs.existsSync(builtin)) paths.push(builtin);
    const global = this.getConfiguredGlobalSkillsDir();
    if (global && fs.existsSync(global)) paths.push(global);
    return paths;
  }

  private async resolveSkillPaths(sessionId?: string): Promise<string[]> {
    const basePaths = this._skillsAdapter
      ? this._skillsAdapter.getSkillPaths()
      : this.legacySkillPaths();
    const mergedPaths = new Set(
      basePaths.filter((item): item is string => Boolean(item && fs.existsSync(item)))
    );
    const appliedPlugins: Array<{ name: string; path: string }> = [];

    if (this._pluginRuntimeService) {
      try {
        const runtimePlugins = await this._pluginRuntimeService.getEnabledRuntimePlugins();
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
      this.sendToRenderer({
        type: 'plugins.runtimeApplied',
        payload: { sessionId, plugins: appliedPlugins },
      });
    }

    return Array.from(mergedPaths);
  }

  /**
   * Get the built-in skills directory (shipped with the app)
   */
  private getBuiltinSkillsPath(): string {
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

    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        log('[ClaudeAgentRunner] Found built-in skills at:', p);
        return p;
      }
    }

    logWarn('[ClaudeAgentRunner] No built-in skills directory found');
    return '';
  }

  /**
   * Check if a directory physically exists on disk, bypassing Electron's
   * asar interception.
   */
  private physicalDirExists(dirPath: string): boolean {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const originalFs = require('original-fs') as typeof import('fs');
      return originalFs.existsSync(dirPath) && originalFs.statSync(dirPath).isDirectory();
    } catch {
      return false;
    }
  }

  private getAppClaudeDir(): string {
    return path.join(app.getPath('userData'), 'claude');
  }

  private getRuntimeSkillsDir(): string {
    return path.join(this.getAppClaudeDir(), 'skills');
  }

  private getConfiguredGlobalSkillsDir(): string {
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

  private getUserClaudeSkillsDir(): string {
    return path.join(app.getPath('home'), '.claude', 'skills');
  }

  private syncUserSkillsToAppDir(appSkillsDir: string): void {
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

  private syncConfiguredSkillsToRuntimeDir(runtimeSkillsDir: string): void {
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

  private copyDirectorySync(source: string, target: string): void {
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

  constructor(
    options: AgentRunnerOptions,
    pathResolver: PathResolver,
    mcpManager?: MCPManager,
    pluginRuntimeService?: PluginRuntimeService,
    skillsAdapter?: SkillsAdapter,
    extensionManager?: AgentRuntimeExtensionManager
  ) {
    this.sendToRenderer = options.sendToRenderer;
    this.saveMessage = options.saveMessage;
    this.requestSudoPassword = options.requestSudoPassword;
    this.requestPermission = options.requestPermission;
    this.pathResolver = pathResolver;
    this.mcpManager = mcpManager;
    this._pluginRuntimeService = pluginRuntimeService;
    this._skillsAdapter = skillsAdapter;
    this.extensionManager = extensionManager;

    log('[ClaudeAgentRunner] Initialized with Open Cowork agent SDK');
    log('[ClaudeAgentRunner] Skills enabled: settingSources=[user, project], Skill tool enabled');
    if (mcpManager) {
      log('[ClaudeAgentRunner] MCP support enabled');
    }
  }

  private getToolDisplayName(toolName: string): string {
    return resolveToolDisplayName(toolName, this.mcpManager, this.toolDisplayNameCache);
  }

  /**
   * Resolve current model string from runtime config.
   */
  private getCurrentModelString(preferredModel?: string): string {
    const routeModel = preferredModel?.trim();
    const configuredModel = configStore.get('model')?.trim();
    const model = routeModel || configuredModel || 'anthropic/claude-sonnet-4-6';
    logCtx('[ClaudeAgentRunner] Current model:', model);
    logCtx(
      '[ClaudeAgentRunner] Model source:',
      routeModel ? 'runtimeRoute.model' : configuredModel ? 'configStore.model' : 'default'
    );
    return model;
  }

  async run(session: Session, prompt: string, existingMessages: Message[]): Promise<void> {
    const runStartTime = Date.now();
    logCtx('[ClaudeAgentRunner] run() started');

    const controller = new AbortController();
    try {
      // SDK 会在同一 AbortSignal 上挂载较多监听器，放开上限避免无意义告警干扰排错。
      setMaxListeners(0, controller.signal);
    } catch {
      // 旧运行时不支持 EventTarget 调整监听上限时忽略即可。
    }
    this.activeControllers.set(session.id, controller);

    // Sandbox isolation state (defined outside try for finally access)
    let sandboxPath: string | null = null;
    let useSandboxIsolation = false;

    // Helper to convert real sandbox paths back to virtual workspace paths in output
    // Cache the compiled regex to avoid recompilation on every call
    let sandboxPathRegex: RegExp | null = null;
    const sanitizeOutputPaths = (content: string): string => {
      if (!sandboxPath || !useSandboxIsolation) return content;
      if (!sandboxPathRegex) {
        sandboxPathRegex = new RegExp(sandboxPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
      }
      // Replace real sandbox path with virtual workspace path
      return content.replace(sandboxPathRegex, VIRTUAL_WORKSPACE_PATH);
    };

    const thinkingStepId = uuidv4();
    let abortedByTimeout = false;
    // Set to true when the loop-guard unilaterally aborts (hash_abort / freq_abort).
    // The catch block consults this flag to avoid overwriting the 'error' trace
    // status that handleLoopGuardDecision has already published.
    let abortedByLoopGuard = false;
    // Set to true when the provider emits a terminal stream error mid-turn.
    // The catch block consults this flag to avoid overwriting the published
    // 'Request failed' trace state with a generic 'Cancelled' update.
    let abortedByStreamError = false;

    try {
      this.pathResolver.registerSession(session.id, session.mountedPaths);
      logTiming('pathResolver.registerSession', runStartTime);

      // Note: User message is now added by the frontend immediately for better UX
      // No need to send it again from backend

      // Send initial thinking trace
      this.sendTraceStep(session.id, {
        id: thinkingStepId,
        type: 'thinking',
        status: 'running',
        title: 'Processing request...',
        timestamp: Date.now(),
      });
      logTiming('sendTraceStep (thinking)', runStartTime);

      // Use session's cwd - each session has its own working directory
      const workingDir = session.cwd || undefined;
      logCtx('[ClaudeAgentRunner] Working directory:', workingDir || '(none)');

      const sandbox = getSandboxAdapter();
      const sandboxEnabled = configStore.get('sandboxEnabled') !== false;
      const sandboxBootstrap = await bootstrapSandboxEnvironment({
        sessionId: session.id,
        workingDir,
        thinkingStepId,
        sandboxEnabled,
        sandbox,
        sendToRenderer: (event) => this.sendToRenderer(event),
        sendMessage: (sessionId, message) => this.sendMessage(sessionId, message),
        sendTraceUpdate: (sessionId, stepId, updates) =>
          this.sendTraceUpdate(sessionId, stepId, updates),
        getBuiltinSkillsPath: () => this.getBuiltinSkillsPath(),
        getRuntimeSkillsDir: () => this.getRuntimeSkillsDir(),
        syncUserSkillsToAppDir: (appSkillsDir) => this.syncUserSkillsToAppDir(appSkillsDir),
        syncConfiguredSkillsToRuntimeDir: (runtimeSkillsDir) =>
          this.syncConfiguredSkillsToRuntimeDir(runtimeSkillsDir),
      });
      if (sandboxBootstrap.aborted) {
        return;
      }
      sandboxPath = sandboxBootstrap.sandboxPath;
      useSandboxIsolation = sandboxBootstrap.useSandboxIsolation;

      // Check if current user message includes images
      const lastUserMessage =
        existingMessages.length > 0 ? existingMessages[existingMessages.length - 1] : null;

      logCtx('[ClaudeAgentRunner] Total messages:', existingMessages.length);

      const hasImages =
        lastUserMessage?.content.some((c) => (c as { type?: string }).type === 'image') || false;
      if (hasImages) {
        log('[ClaudeAgentRunner] User message contains images');
      }

      logTiming('before pi-ai model resolution', runStartTime);

      // Resolve model via pi-ai
      const runtimeConfig = configStore.getAll();
      const modelString = this.getCurrentModelString(runtimeConfig.model);
      const configProtocol = resolvePiRouteProtocol(
        runtimeConfig.provider,
        runtimeConfig.customProtocol
      );

      // Normalize base URL for OpenAI-compatible providers (strips copy-pasted endpoint suffixes)
      const rawBaseUrl = runtimeConfig.baseUrl?.trim() || undefined;
      const effectiveBaseUrl =
        configProtocol === 'openai' && runtimeConfig.provider !== 'ollama'
          ? normalizeOpenAICompatibleBaseUrl(rawBaseUrl) || rawBaseUrl
          : rawBaseUrl;

      let usedSyntheticModel = false;
      let piModel = resolvePiRegistryModel(modelString, {
        configProvider: configProtocol,
        customBaseUrl: effectiveBaseUrl,
        rawProvider: runtimeConfig.provider,
        customProtocol: runtimeConfig.customProtocol,
      });

      if (!piModel) {
        usedSyntheticModel = true;
        // Synthetic fallback: construct a Model for unknown/custom models
        const synthetic = resolveSyntheticPiModelFallback({
          rawModel: runtimeConfig.model,
          resolvedModelString: modelString,
          rawProvider: runtimeConfig.provider,
          routeProtocol: configProtocol,
          baseUrl: effectiveBaseUrl,
        });
        piModel = buildSyntheticPiModel(
          synthetic.modelId,
          synthetic.provider,
          configProtocol,
          effectiveBaseUrl,
          undefined,
          undefined,
          runtimeConfig.contextWindow,
          runtimeConfig.maxTokens
        );
        // Apply the same runtime overrides (developer role compat, base URL, API downgrade)
        // that resolvePiRegistryModel applies to registry models
        piModel = applyPiModelRuntimeOverrides(piModel, {
          configProvider: configProtocol,
          customBaseUrl: effectiveBaseUrl,
          rawProvider: runtimeConfig.provider,
          customProtocol: runtimeConfig.customProtocol,
        });
        logCtxWarn(
          '[ClaudeAgentRunner] Model not in pi-ai registry, using synthetic model:',
          modelString,
          '→',
          piModel.api
        );
      }
      logCtx('[ClaudeAgentRunner] Resolved pi-ai model:', piModel.provider, piModel.id);

      // For Ollama: query actual context window from /api/show if user hasn't configured one
      const provider = runtimeConfig.provider || 'anthropic';
      if (provider === 'ollama' && !runtimeConfig.contextWindow) {
        const ollamaBaseUrl =
          piModel.baseUrl || runtimeConfig.baseUrl || 'http://localhost:11434/v1';
        const ollamaInfo = await fetchOllamaModelInfo({
          baseUrl: ollamaBaseUrl,
          model: piModel.id,
          apiKey: runtimeConfig.apiKey,
        });
        if (ollamaInfo.contextWindow) {
          log(
            '[ClaudeAgentRunner] Ollama /api/show reported contextWindow:',
            ollamaInfo.contextWindow,
            '(was:',
            piModel.contextWindow,
            ')'
          );
          piModel = { ...piModel, contextWindow: ollamaInfo.contextWindow };
        }
      }

      // Send context window info to renderer for UI display
      const modelContextWindow = piModel.contextWindow || 128000;
      const modelMaxTokens = piModel.maxTokens || 16384;
      this.sendToRenderer({
        type: 'session.contextInfo',
        payload: {
          sessionId: session.id,
          contextWindow: modelContextWindow,
          maxTokens: modelMaxTokens,
        },
      });

      // Set up API keys via AuthStorage
      const authStorage = getSharedAuthStorage();
      const apiKey = runtimeConfig.apiKey?.trim();
      if (apiKey) {
        // Map our config provider to pi-ai provider name
        const piProvider =
          provider === 'custom' ? runtimeConfig.customProtocol || 'anthropic' : provider;
        authStorage.setRuntimeApiKey(piProvider, apiKey);
        // Also set the key for the model's native provider (e.g., when using
        // google/gemini via openrouter, pi-ai looks up "google" not "openrouter")
        if (piModel.provider !== piProvider) {
          authStorage.setRuntimeApiKey(piModel.provider, apiKey);
          log('[ClaudeAgentRunner] Set runtime API key for model provider:', piModel.provider);
        }
        log('[ClaudeAgentRunner] Set runtime API key for config provider:', piProvider);
      } else {
        if (provider === 'ollama') {
          log(
            '[ClaudeAgentRunner] Ollama configured without explicit API key; relying on OpenAI-compatible placeholder/env auth path',
            safeStringify({
              provider,
              modelProvider: piModel.provider,
              modelId: piModel.id,
              baseUrl: piModel.baseUrl || runtimeConfig.baseUrl || '',
            })
          );
        } else {
          logWarn('[ClaudeAgentRunner] No API key configured for provider:', provider);
        }
      }

      // baseUrl is now embedded in the model object via resolvePiModel()
      logCtx('[ClaudeAgentRunner] Model baseUrl:', piModel.baseUrl, 'api:', piModel.api);

      logTiming('after pi-ai model resolution', runStartTime);

      // the agent SDK handles path sandboxing via its own tools
      const imageCapable = true; // pi-ai models generally support images; let the model handle unsupported cases
      const wslDistro = sandbox.isWSL ? sandbox.wslStatus?.distro : undefined;
      const effectiveCwd =
        useSandboxIsolation && sandboxPath && wslDistro
          ? wslUnixPathToWindowsUnc(wslDistro, sandboxPath)
          : useSandboxIsolation && sandboxPath
            ? sandboxPath
            : workingDir || process.cwd();

      // Use app-specific Claude config directory to avoid conflicts with user settings
      // SDK uses CLAUDE_CONFIG_DIR to locate skills
      const userClaudeDir = this.getAppClaudeDir();

      // Skills directory setup: only run on the first query per runner instance.
      // Symlinks and directories are stable across queries; re-running every time
      // wastes ~10-30 syscalls per query for no benefit. Call invalidateSkillsSetup()
      // to force a re-run after the user installs or removes a skill.
      if (!this._skillsSetupDone) {
        // Set flag at start to prevent re-entrant calls from concurrent queries
        this._skillsSetupDone = true;

        // Ensure app Claude config directory exists
        if (!fs.existsSync(userClaudeDir)) {
          fs.mkdirSync(userClaudeDir, { recursive: true });
        }

        // Ensure app Claude skills directory exists
        const appSkillsDir = this.getRuntimeSkillsDir();
        if (!fs.existsSync(appSkillsDir)) {
          fs.mkdirSync(appSkillsDir, { recursive: true });
        }

        // Copy built-in skills to app Claude skills directory if they don't exist
        const builtinSkillsPath = this.getBuiltinSkillsPath();
        if (builtinSkillsPath && fs.existsSync(builtinSkillsPath)) {
          // Symlinks into .asar archives don't work at the OS level (ENOTDIR),
          // so always copy when the source is inside an asar archive.
          // Use regex to match .asar/ but NOT .asar.unpacked/ (which is a real directory).
          const sourceInsideAsar = /\.asar[/\\]/.test(builtinSkillsPath);
          const builtinSkills = fs.readdirSync(builtinSkillsPath);
          for (const skillName of builtinSkills) {
            const builtinSkillPath = path.join(builtinSkillsPath, skillName);
            const userSkillPath = path.join(appSkillsDir, skillName);

            // Clean up broken symlinks pointing into .asar from previous versions
            try {
              const lstat = fs.lstatSync(userSkillPath);
              if (lstat.isSymbolicLink()) {
                const linkTarget = fs.readlinkSync(userSkillPath);
                if (/\.asar[/\\]/.test(linkTarget)) {
                  fs.unlinkSync(userSkillPath);
                  log(`[ClaudeAgentRunner] Removed broken asar symlink: ${userSkillPath}`);
                }
              }
            } catch {
              // Path doesn't exist — fine, we'll create it below
            }

            // Only set up if it's a directory and doesn't exist in app directory
            if (fs.statSync(builtinSkillPath).isDirectory() && !fs.existsSync(userSkillPath)) {
              if (sourceInsideAsar) {
                // Source is inside .asar — must copy (symlinks to asar paths fail at OS level)
                this.copyDirectorySync(builtinSkillPath, userSkillPath);
                log(`[ClaudeAgentRunner] Copied built-in skill from asar: ${skillName}`);
              } else {
                // Source is a real directory — symlink for space efficiency
                try {
                  fs.symlinkSync(builtinSkillPath, userSkillPath, 'dir');
                  log(`[ClaudeAgentRunner] Linked built-in skill: ${skillName}`);
                } catch (err) {
                  logWarn(
                    `[ClaudeAgentRunner] Failed to symlink ${skillName}, copying instead:`,
                    err
                  );
                  this.copyDirectorySync(builtinSkillPath, userSkillPath);
                }
              }
            }
          }
        }

        this.syncUserSkillsToAppDir(appSkillsDir);
        this.syncConfiguredSkillsToRuntimeDir(appSkillsDir);
      }

      // Build available skills section dynamically — now handled by pi's DefaultResourceLoader
      // via additionalSkillPaths. No custom prompt building needed.

      log('[ClaudeAgentRunner] App claude dir:', userClaudeDir);
      log('[ClaudeAgentRunner] User working directory:', workingDir);

      logTiming('before building conversation context', runStartTime);

      // pi-ai handles auth and model routing natively — no proxy, no env overrides needed.
      logCtx('[ClaudeAgentRunner] Using pi-ai native routing for:', piModel.provider, piModel.id);

      // Resolve thinking level early — needed for session reuse check below
      const enableThinking = configStore.get('enableThinking') ?? false;
      logCtx('[ClaudeAgentRunner] Enable thinking mode:', enableThinking);
      type PiThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
      const thinkingLevel: PiThinkingLevel = enableThinking ? 'medium' : 'off';
      const sessionRuntimeSignature = buildPiSessionRuntimeSignature({
        configProvider: runtimeConfig.provider,
        customProtocol: runtimeConfig.customProtocol,
        modelProvider: piModel.provider,
        modelApi: piModel.api,
        modelBaseUrl: piModel.baseUrl,
        effectiveCwd,
        apiKey,
      });
      const skillPaths = await this.resolveSkillPaths(session.id);
      const skillsSignature = JSON.stringify(skillPaths);
      log('[ClaudeAgentRunner] Skill paths for pi ResourceLoader:', skillPaths);

      // Build contextual prompt — if reusing an existing SDK session, the SDK
      // already has conversation history so we only pass the new prompt.
      // For cold starts (new SDK session with existing DB history), we inject
      // a token-budgeted summary of recent history as a preamble.
      let cachedSession = this.piSessions.get(session.id);
      if (cachedSession && cachedSession.runtimeSignature !== sessionRuntimeSignature) {
        logCtx('[ClaudeAgentRunner] Runtime changed, recreating cached pi session:', session.id);
        try {
          cachedSession.session.dispose();
        } catch (disposeError) {
          logWarn('[ClaudeAgentRunner] dispose error while recreating pi session:', disposeError);
        }
        this.piSessions.delete(session.id);
        cachedSession = undefined;
      }
      if (cachedSession && cachedSession.skillsSignature !== skillsSignature) {
        logCtx('[ClaudeAgentRunner] Skills changed, recreating cached pi session:', session.id);
        try {
          cachedSession.session.dispose();
        } catch (disposeError) {
          logWarn(
            '[ClaudeAgentRunner] dispose error while recreating pi session for skills:',
            disposeError
          );
        }
        this.piSessions.delete(session.id);
        cachedSession = undefined;
      }

      const extensionResult = this.extensionManager
        ? await this.extensionManager.beforeSessionRun({
            session,
            prompt,
            existingMessages,
            isColdStart: !cachedSession,
            contextBudget: {
              contextWindow: modelContextWindow,
              maxTokens: modelMaxTokens,
              currentInputTokens: getLastInputTokenCount(existingMessages),
            },
          })
        : { promptPrefix: undefined, customTools: [] };

      let contextualPrompt = prompt;
      if (!cachedSession) {
        contextualPrompt = buildColdStartContextualPrompt({
          prompt,
          existingMessages,
          provider,
          contextWindow: piModel.contextWindow || 128000,
        });
      } else {
        // Reusing session — SDK already has the full conversation context
        logCtx('[ClaudeAgentRunner] Reusing existing SDK session for:', session.id);
      }
      if (extensionResult.promptPrefix?.trim()) {
        contextualPrompt = `${extensionResult.promptPrefix.trim()}\n\n${contextualPrompt}`;
      }

      logTiming('before building MCP servers config', runStartTime);

      // Build MCP servers configuration for SDK
      // IMPORTANT: SDK uses tool names in format: mcp__<ServerKey>__<toolName>
      const mcpServers: Record<string, unknown> = {};
      if (this.mcpManager) {
        const serverStatuses = this.mcpManager.getServerStatus();
        const connectedServers = serverStatuses.filter((s) => s.connected);
        log('[ClaudeAgentRunner] MCP server statuses:', safeStringify(serverStatuses));
        log('[ClaudeAgentRunner] Connected MCP servers:', connectedServers.length);

        let allConfigs: ReturnType<typeof mcpConfigStore.getEnabledServers> = [];
        try {
          allConfigs = mcpConfigStore.getEnabledServers();
          log(
            '[ClaudeAgentRunner] Enabled MCP configs:',
            allConfigs.map((c) => c.name)
          );
        } catch (error) {
          logWarn(
            '[ClaudeAgentRunner] Failed to read enabled MCP configs; MCP tools will be unavailable this query',
            error
          );
          allConfigs = [];
        }

        // Cache key: serialized config list + imageCapable flag.  The bundled node
        // paths are stable for the lifetime of the process so they don't need to be
        // part of the fingerprint.
        const mcpFingerprint = JSON.stringify(allConfigs) + String(imageCapable);
        if (this._mcpServersCache?.fingerprint === mcpFingerprint) {
          Object.assign(mcpServers, this._mcpServersCache.servers);
          log('[ClaudeAgentRunner] MCP servers config reused from cache');
        } else {
          // Use the module-level memoized helper — no more per-query fs.existsSync calls.
          const bundledNodePaths = getBundledNodePaths();
          const bundledNpx = bundledNodePaths?.npx ?? null;

          for (const config of allConfigs) {
            try {
              // Use a simpler key without spaces to avoid issues
              const serverKey = config.name;

              if (config.type === 'stdio') {
                // 当命令是 npx 或 node 时优先使用内置路径
                const command =
                  config.command === 'npx' && bundledNpx
                    ? bundledNpx
                    : config.command === 'node' && bundledNodePaths
                      ? bundledNodePaths.node
                      : config.command;

                // 使用内置 npx/node 时，将内置 node bin 注入 PATH
                const serverEnv = { ...config.env };
                if (bundledNodePaths && (config.command === 'npx' || config.command === 'node')) {
                  const nodeBinDir = path.dirname(bundledNodePaths.node);
                  const currentPath = process.env.PATH || '';
                  // Prepend bundled node bin to PATH so npx can find node
                  serverEnv.PATH = `${nodeBinDir}${path.delimiter}${currentPath}`;
                  log(`[ClaudeAgentRunner]   Added bundled node bin to PATH: ${nodeBinDir}`);
                }

                if (!imageCapable) {
                  serverEnv.OPEN_COWORK_DISABLE_IMAGE_TOOL_OUTPUT = '1';
                }

                // Resolve path placeholders for presets
                let resolvedArgs = config.args || [];

                // Check if any args contain placeholders that need resolving
                const hasPlaceholders = resolvedArgs.some(
                  (arg) =>
                    arg.includes('{SOFTWARE_DEV_SERVER_PATH}') ||
                    arg.includes('{GUI_OPERATE_SERVER_PATH}')
                );

                if (hasPlaceholders) {
                  // Get the appropriate preset based on config name
                  let presetKey: string | null = null;
                  if (
                    config.name === 'Software_Development' ||
                    config.name === 'Software Development'
                  ) {
                    presetKey = 'software-development';
                  } else if (config.name === 'GUI_Operate' || config.name === 'GUI Operate') {
                    presetKey = 'gui-operate';
                  }

                  if (presetKey) {
                    const preset = mcpConfigStore.createFromPreset(presetKey, true);
                    if (preset && preset.args) {
                      resolvedArgs = preset.args;
                    }
                  }
                }

                mcpServers[serverKey] = {
                  type: 'stdio',
                  command,
                  args: resolvedArgs,
                  env: serverEnv,
                };
                log(`[ClaudeAgentRunner] Added STDIO MCP server: ${serverKey}`);
                log(`[ClaudeAgentRunner]   Command: ${command} ${resolvedArgs.join(' ')}`);
                log(`[ClaudeAgentRunner]   Tools will be named: mcp__${serverKey}__<toolName>`);
              } else if (config.type === 'sse') {
                mcpServers[serverKey] = {
                  type: 'sse',
                  url: config.url,
                  headers: config.headers || {},
                };
                log(`[ClaudeAgentRunner] Added SSE MCP server: ${serverKey}`);
              }
            } catch (error) {
              logError('[ClaudeAgentRunner] Failed to prepare MCP server config, skipping server', {
                serverId: config.id,
                serverName: config.name,
                error: toErrorText(error),
              });
            }
          }

          // Store in cache for subsequent queries
          this._mcpServersCache = { fingerprint: mcpFingerprint, servers: { ...mcpServers } };
        }

        const mcpServersSummary = Object.entries(mcpServers).map(([name, serverConfig]) => {
          const typedServerConfig = serverConfig as {
            type?: string;
            command?: string;
            args?: unknown[];
            env?: Record<string, unknown>;
          };
          return {
            name,
            type: typedServerConfig.type ?? 'unknown',
            command: typedServerConfig.command ?? '',
            argsCount: Array.isArray(typedServerConfig.args) ? typedServerConfig.args.length : 0,
            envKeys: typedServerConfig.env ? Object.keys(typedServerConfig.env).length : 0,
          };
        });
        log('[ClaudeAgentRunner] Final mcpServers summary:', safeStringify(mcpServersSummary, 2));
        if (process.env.COWORK_LOG_SDK_MESSAGES_FULL === '1') {
          log('[ClaudeAgentRunner] Final mcpServers config:', safeStringify(mcpServers, 2));
        }
      }
      logTiming('after building MCP servers config', runStartTime);

      const workspaceInfoPrompt =
        useSandboxIsolation && sandboxPath
          ? `<workspace_info>
Your current workspace is located at: ${VIRTUAL_WORKSPACE_PATH}
This is an isolated sandbox environment. Use ${VIRTUAL_WORKSPACE_PATH} as the root path for file operations.
</workspace_info>`
          : workingDir
            ? `<workspace_info>Your current workspace is: ${workingDir}</workspace_info>`
            : '';

      const coworkAppendPrompt = [
        'You are an Open Cowork assistant. Be concise, accurate, and tool-capable.',
        `CRITICAL BEHAVIORAL RULES:
1. CHAT FIRST: By default, respond to the user in plain text within the conversation. Do NOT create, write, or edit files unless the user explicitly asks you to (e.g., "create a file", "write this to...", "edit the code", "save as...", mentions a specific file path, or describes code changes they want applied). For questions, summaries, explanations, analysis, and general conversation — always reply directly in chat text.
2. When a request is actionable, proceed immediately with reasonable assumptions. If you need clarification, ask briefly in plain text.
3. For relative time windows like "within two days" in browsing or research tasks, assume the most recent two relevant publication days unless the user explicitly defines another date range.
4. For bracketed placeholders like [Agent], [Topic], etc., treat the word inside brackets as the literal search keyword unless the user says otherwise.
5. When given a task, START DOING IT. Do not restate the task, do not list what you will do, do not ask for confirmation. Just execute.`,
        workspaceInfoPrompt,
        `<citation_requirements>
If your answer uses linkable content from MCP tools, include a "Sources:" section and otherwise use standard Markdown links: [Title](https://claude.ai/chat/URL).
</citation_requirements>`,
        `<tool_behavior>
Tool routing:
- If user explicitly asks to use Chrome/browser/web navigation, prioritize Chrome MCP tools (mcp__Chrome__*) over generic WebSearch/WebFetch.
- Use WebSearch/WebFetch only when Chrome MCP is unavailable or the user explicitly asks for generic web search.
</tool_behavior>`,
        this.getBundledPathHints(),
      ].filter((section): section is string => Boolean(section && section.trim()));

      logTiming('before agent session creation', runStartTime);

      // Create or reuse agent session
      // Bridge MCP tools as customTools for the agent SDK.
      // Re-read every query so newly added/removed MCP servers take effect immediately.
      const mcpCustomTools = this.mcpManager ? buildMcpCustomTools(this.mcpManager) : [];
      const extensionCustomTools = extensionResult.customTools || [];
      if (mcpCustomTools.length > 0) {
        log(
          `[ClaudeAgentRunner] Registered ${mcpCustomTools.length} MCP tools as customTools:`,
          mcpCustomTools.map((t) => t.name).join(', ')
        );
      }
      if (extensionCustomTools.length > 0) {
        log(
          `[ClaudeAgentRunner] Registered ${extensionCustomTools.length} extension tools as customTools:`,
          extensionCustomTools.map((t) => t.name).join(', ')
        );
      }

      // Enrich process.env.PATH for build mode — ensures Skill commands (python3, node)
      // executed via Pi SDK's Bash tool can find bundled and user-installed executables.
      await enrichProcessPathForBuild();

      const isolatedSandboxPath = sandboxPath;
      const useWslSandboxBash = Boolean(
        useSandboxIsolation && isolatedSandboxPath && sandbox.isWSL && sandbox.wslStatus?.distro
      );
      const bashOptions: BashToolOptions | undefined = useWslSandboxBash
        ? {
            operations: createWslSandboxBashOperations({
              distro: sandbox.wslStatus!.distro!,
              sandboxPath: isolatedSandboxPath!,
              virtualWorkspacePath: VIRTUAL_WORKSPACE_PATH,
            }),
          }
        : process.platform === 'win32'
          ? { operations: createWindowsBashOperations() }
          : undefined;
      if (useWslSandboxBash) {
        log(
          `[ClaudeAgentRunner] Using WSL sandbox bash (distro=${sandbox.wslStatus!.distro}, sandbox=${sandboxPath})`
        );
      }
      const bashDefinition = createBashToolDefinition(effectiveCwd, bashOptions);

      // Inject a default 120s timeout for bash commands when the model omits one
      const withTimeout = wrapBashToolWithDefaultTimeout([bashDefinition as ToolDefinition]);

      // Wrap the bash tool to intercept sudo commands and request passwords.
      // Passed via customTools to override the SDK built-in bash tool.
      const wrappedBashTools = wrapBashToolForSudo(
        withTimeout,
        session.id,
        effectiveCwd,
        this.requestSudoPassword
      );
      const wrappedBash = wrappedBashTools.find((tool) => tool.name === 'bash');
      const allCustomTools = [
        ...(wrappedBash ? [wrappedBash] : []),
        ...mcpCustomTools,
        ...extensionCustomTools,
      ];

      // Diagnostic: log tools being passed to SDK (helps debug Ollama tool use)
      logCtx(`[ClaudeAgentRunner] Session reuse check: cached=${!!cachedSession}`);
      logCtx(`[ClaudeAgentRunner] Model=${piModel.id}, thinkingLevel=${thinkingLevel}`);
      log('[ClaudeAgentRunner] Built-in tools: read, bash, edit, write');
      log(
        `[ClaudeAgentRunner] Custom tools (${allCustomTools.length}): ${allCustomTools.map((t) => t.name).join(', ')}`
      );

      let piSession: PiAgentSession;
      if (cachedSession) {
        // Reuse existing session — SDK retains full conversation history and handles compaction
        piSession = cachedSession.session;

        // Hot-swap model/thinking if changed — SDK supports this natively
        if (cachedSession.modelId !== piModel.id) {
          logCtx(
            '[ClaudeAgentRunner] Model changed, hot-swapping:',
            cachedSession.modelId,
            '→',
            piModel.id
          );
          await piSession.setModel(piModel);
          cachedSession.modelId = piModel.id;
          // Update Ollama num_ctx ref if present
          if (cachedSession.ollamaNumCtx) {
            cachedSession.ollamaNumCtx.value = piModel.contextWindow || 128000;
            log(
              '[ClaudeAgentRunner] Updated Ollama num_ctx on hot-swap:',
              cachedSession.ollamaNumCtx.value
            );
          }
        }
        if (cachedSession.thinkingLevel !== thinkingLevel) {
          logCtx(
            '[ClaudeAgentRunner] Thinking level changed, hot-swapping:',
            cachedSession.thinkingLevel,
            '→',
            thinkingLevel
          );
          piSession.setThinkingLevel(thinkingLevel);
          cachedSession.thinkingLevel = thinkingLevel;
        }

        logCtx('[ClaudeAgentRunner] Reusing cached pi session for:', session.id);
        logTiming('agent session reused', runStartTime);
      } else {
        // First query in this session — create new agent session
        // ResourceLoader + ModelRegistry only needed for session creation — skip on reuse
        const { DefaultResourceLoader } = await import('@mariozechner/pi-coding-agent');
        const resourceLoader = new DefaultResourceLoader({
          cwd: effectiveCwd,
          agentDir: getAgentDir(),
          additionalSkillPaths: skillPaths,
          appendSystemPrompt: coworkAppendPrompt,
        });
        await resourceLoader.reload();

        const modelRegistry = ModelRegistry.create(authStorage);

        const memoryPrefixTokenEstimate = estimateTokensFromText(
          extensionResult.promptPrefix || ''
        );
        const compactionSettings = buildCompactionSettings(
          provider,
          modelContextWindow,
          modelMaxTokens,
          memoryPrefixTokenEstimate
        );
        if (!compactionSettings.enabled) {
          log(
            '[ClaudeAgentRunner] Auto-compaction disabled (contextWindow:',
            modelContextWindow,
            ')'
          );
        } else {
          log('[ClaudeAgentRunner] Compaction settings:', JSON.stringify(compactionSettings));
        }

        const { session: newPiSession } = await createAgentSession({
          model: piModel,
          thinkingLevel,
          authStorage,
          modelRegistry,
          customTools: allCustomTools,
          sessionManager: PiSessionManager.inMemory(),
          settingsManager: PiSettingsManager.inMemory({
            compaction: compactionSettings,
            retry: { enabled: true, maxRetries: 2 },
          }),
          resourceLoader,
          cwd: effectiveCwd,
        });
        piSession = newPiSession;

        // Install permission-gating hook via the SDK's tool_call extension event.
        // This must happen once per new session — the hook persists across reuses.
        installPermissionHook(piSession, session.id, this.requestPermission, (toolName) =>
          this.getToolDisplayName(toolName)
        );

        // Store session for reuse — evict oldest if cache is full
        evictOldestPiSession(this.piSessions);
        this.piSessions.set(session.id, {
          session: piSession,
          modelId: piModel.id,
          thinkingLevel,
          runtimeSignature: sessionRuntimeSignature,
          skillsSignature,
          compactionEnabled: compactionSettings.enabled,
        });

        // Ollama: wrap _onPayload to inject num_ctx into every request
        if (provider === 'ollama') {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const agent = piSession.agent as any;
          // Guard: only patch if the SDK exposes _onPayload (private API)
          if (!('_onPayload' in agent)) {
            logWarn(
              '[ClaudeAgentRunner] SDK agent does not expose _onPayload — skipping Ollama num_ctx patch'
            );
          } else {
            const originalOnPayload = agent._onPayload as
              | ((
                  payload: Record<string, unknown>,
                  modelArg: unknown
                ) => Promise<Record<string, unknown>>)
              | undefined;
            const ollamaNumCtx = {
              value: piModel.contextWindow || 128000,
            };
            agent._onPayload = async (payload: Record<string, unknown>, modelArg: unknown) => {
              let result = originalOnPayload
                ? await originalOnPayload.call(agent, payload, modelArg)
                : payload;
              if (result === undefined) result = payload;
              return { ...result, num_ctx: ollamaNumCtx.value };
            };
            this.piSessions.get(session.id)!.ollamaNumCtx = ollamaNumCtx;
            log(
              '[ClaudeAgentRunner] Ollama _onPayload wrapper installed, num_ctx:',
              ollamaNumCtx.value
            );
          } // end else (_onPayload exists)
        }

        logTiming('agent session created', runStartTime);
      }

      // Set up event handler to bridge agent SDK events → our ServerEvent protocol

      // Accumulate streamed text deltas in case message_end.content is empty (pi SDK streaming behaviour)
      let streamedText = '';
      let compactionStepId: string | undefined;
      let hasEmittedError = false;
      let terminalErrorText: string | undefined;
      const thinkParser = new ThinkTagStreamParser();
      const promptStartedAt = Date.now();
      const streamEventCounts = new Map<string, number>();

      // ── Loop guard: protect against runaway tool-call loops ──
      // (e.g. gemini-3.1-pro with thinking=off has been observed producing hundreds
      //  of empty-text + single-tool-call responses in a single turn)
      // Two layers: hash of whole tool-call group (window=20, warn=3/halt=5/abort=8)
      //             + per-tool frequency (warn=30/halt=50/abort=80).
      const loopGuard = new LoopGuard();
      const handleLoopGuardDecision = (decision: LoopGuardDecision, context: string): void => {
        if (decision.action === 'none' || controller.signal.aborted) return;
        logWarn(`[LoopGuard] ${context}: action=${decision.action} reason=${decision.reason}`);

        if (decision.action === 'hash_abort' || decision.action === 'freq_abort') {
          // Always surface the loop-guard explanation, even if an earlier
          // error already set hasEmittedError — the user must see why the
          // session stopped. Mark the flag afterward to suppress duplicate
          // generic-error chatter from later paths in this turn.
          this.sendMessage(session.id, {
            id: uuidv4(),
            sessionId: session.id,
            role: 'assistant',
            content: [{ type: 'text', text: buildAbortUserMessage(decision) }],
            timestamp: Date.now(),
          });
          hasEmittedError = true;
          this.sendTraceUpdate(session.id, thinkingStepId, {
            status: 'error',
            title: 'Stopped: tool-call loop detected',
          });
          try {
            // Mark BEFORE calling abort() so the AbortError handler in the
            // outer catch can distinguish a loop-guard abort from a user
            // cancel and skip the "Cancelled" trace overwrite.
            abortedByLoopGuard = true;
            controller.abort();
          } catch (abortErr) {
            logWarn('[LoopGuard] abort error:', abortErr);
          }
          return;
        }

        const steerText =
          decision.action === 'hash_halt' || decision.action === 'freq_halt'
            ? buildHaltSteerMessage(decision)
            : buildWarnSteerMessage(decision);
        // fire-and-forget: SDK queues the steering message for the next turn
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const sessionAny = piSession as any;
          if (typeof sessionAny.sendUserMessage === 'function') {
            Promise.resolve(sessionAny.sendUserMessage(steerText, { deliverAs: 'steer' })).catch(
              (err: unknown) => {
                logWarn('[LoopGuard] sendUserMessage(steer) failed:', err);
              }
            );
          } else {
            logWarn('[LoopGuard] piSession.sendUserMessage is not available; skipping steer');
          }
        } catch (steerErr) {
          logWarn('[LoopGuard] sendUserMessage(steer) threw:', steerErr);
        }
      };

      // Ollama cold-start feedback: if provider is 'ollama' and no stream event arrives
      // within 10 seconds, show a "model loading" trace update so users know what's happening.
      let ollamaColdStartTimerId: ReturnType<typeof setTimeout> | undefined;
      let receivedFirstStreamEvent = false;
      let firstStreamEventAt: number | undefined;
      if (provider === 'ollama') {
        ollamaColdStartTimerId = setTimeout(() => {
          if (!receivedFirstStreamEvent && !controller.signal.aborted) {
            this.sendTraceUpdate(session.id, thinkingStepId, {
              title: 'Waiting for model to load into memory...',
            });
          }
        }, 10000);
      }

      const markFirstStreamEvent = (eventType: string) => {
        if (receivedFirstStreamEvent) {
          return;
        }
        receivedFirstStreamEvent = true;
        firstStreamEventAt = Date.now();
        if (ollamaColdStartTimerId) {
          clearTimeout(ollamaColdStartTimerId);
        }
        this.sendTraceUpdate(session.id, thinkingStepId, {
          title: 'Processing request...',
        });
        if (provider === 'ollama') {
          log(
            '[ClaudeAgentRunner] Ollama first stream event received',
            safeStringify({
              sessionId: session.id,
              eventType,
              modelId: piModel.id,
              modelProvider: piModel.provider,
              baseUrl: piModel.baseUrl || runtimeConfig.baseUrl || '',
              latencyMs: firstStreamEventAt - promptStartedAt,
            })
          );
        }
      };

      // Activity-based timeout: reset the 5-min timer whenever the SDK sends events
      const PROMPT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
      let activityTimeoutId: ReturnType<typeof setTimeout> | undefined;
      const resetActivityTimeout = () => {
        if (activityTimeoutId) clearTimeout(activityTimeoutId);
        activityTimeoutId = setTimeout(() => {
          logWarn('[ClaudeAgentRunner] Prompt timed out (no activity for 5 min), aborting');
          abortedByTimeout = true;
          controller.abort();
        }, PROMPT_TIMEOUT_MS);
      };

      const recordStreamEvent = (eventType: string) => {
        streamEventCounts.set(eventType, (streamEventCounts.get(eventType) ?? 0) + 1);
      };

      const getStreamEventSummary = () =>
        Object.fromEntries(
          Array.from(streamEventCounts.entries()).sort(([left], [right]) =>
            left.localeCompare(right)
          )
        );

      const emitTerminalError = (
        errorText: string,
        options: { abort?: boolean; includePartialText?: boolean } = {}
      ): void => {
        terminalErrorText = errorText;

        let flushedThinking = '';
        let flushedText = '';

        if (options.includePartialText) {
          const flushed = thinkParser.flush();
          flushedThinking = flushed.thinking;
          flushedText = flushed.text;
        }

        const emission = buildTerminalErrorEmissionDetails({
          errorText,
          streamedText,
          flushedThinking,
          flushedText,
        });

        if (emission.thinkingDelta) {
          this.sendToRenderer({
            type: 'stream.thinking',
            payload: { sessionId: session.id, delta: emission.thinkingDelta },
          });
        }
        if (emission.textDelta) {
          this.sendPartial(session.id, emission.textDelta);
        }

        const partialText = emission.partialText ? sanitizeOutputPaths(emission.partialText) : '';
        const messageText = buildTerminalErrorMessage(errorText, partialText);
        streamedText = '';
        this.sendToRenderer({
          type: 'stream.partial',
          payload: { sessionId: session.id, delta: '' },
        });

        if (!hasEmittedError) {
          hasEmittedError = true;
          this.sendMessage(session.id, {
            id: uuidv4(),
            sessionId: session.id,
            role: 'assistant',
            content: [{ type: 'text', text: messageText }],
            timestamp: Date.now(),
          });
        }

        this.sendTraceUpdate(session.id, thinkingStepId, {
          status: 'error',
          title: 'Request failed',
        });

        if (options.abort && !controller.signal.aborted) {
          try {
            // Mark BEFORE calling abort() so AbortError handling preserves the
            // 'Request failed' state instead of treating this as a user cancel.
            abortedByStreamError = true;
            controller.abort();
          } catch (abortErr) {
            logWarn('[ClaudeAgentRunner] stream-error abort failed:', abortErr);
          }
        }
      };

      const compactionEnabled = cachedSession?.compactionEnabled ?? true;
      const lastInputTokens = getLastInputTokenCount(existingMessages);
      const memoryPrefixTokens = estimateTokensFromText(extensionResult.promptPrefix || '');
      const newPromptTokens = estimateTokensFromText(prompt);
      const projectedInputTokens = cachedSession
        ? lastInputTokens + newPromptTokens + memoryPrefixTokens
        : estimateTokensFromText(contextualPrompt);
      const contextWouldOverflow = shouldBlockForContextOverflow(
        cachedSession ? lastInputTokens : 0,
        cachedSession ? newPromptTokens + memoryPrefixTokens : projectedInputTokens,
        modelMaxTokens,
        modelContextWindow
      );

      if (contextWouldOverflow && !compactionEnabled) {
        const errorText = formatContextOverflowError(
          modelContextWindow,
          projectedInputTokens,
          modelMaxTokens
        );
        this.sendMessage(session.id, {
          id: uuidv4(),
          sessionId: session.id,
          role: 'assistant',
          content: [{ type: 'text', text: buildTerminalErrorMessage(errorText) }],
          timestamp: Date.now(),
        });
        this.sendTraceUpdate(session.id, thinkingStepId, {
          status: 'error',
          title: 'Context full',
        });
        return;
      }

      if (contextWouldOverflow && compactionEnabled) {
        this.sendSessionNotice(session.id, mt('noticeCompactionStart'), 'info');
      }

      const unsubscribe = piSession.subscribe((event) => {
        try {
          if (controller.signal.aborted) return;

          // Reset activity timeout on meaningful events
          resetActivityTimeout();

          if (event.type === 'message_update') {
            const updateType = event.assistantMessageEvent.type;
            recordStreamEvent(updateType);
            if (updateType !== 'text_delta' && updateType !== 'thinking_delta') {
              log(`[ClaudeAgentRunner] Event: ${event.type} → ${updateType}`);
            }
          } else if (event.type === 'message_start') {
            log(
              '[ClaudeAgentRunner] Event: message_start',
              safeStringify(summarizeMessageForLog(event.message), 2)
            );
          } else if (event.type === 'message_end') {
            log(
              '[ClaudeAgentRunner] Event: message_end',
              safeStringify(
                {
                  message: summarizeMessageForLog(event.message),
                  messageUpdateCounts: getStreamEventSummary(),
                },
                2
              )
            );
          } else if (event.type === 'turn_end') {
            log(`[ClaudeAgentRunner] Event: ${event.type}`);
          } else {
            log(`[ClaudeAgentRunner] Event: ${event.type}`);
          }

          switch (event.type) {
            case 'message_update': {
              if (controller.signal.aborted) break;
              const ame = event.assistantMessageEvent;
              if (ame.type === 'text_delta') {
                markFirstStreamEvent(ame.type);
                const parsed = thinkParser.push(ame.delta);
                if (parsed.thinking) {
                  this.sendToRenderer({
                    type: 'stream.thinking',
                    payload: { sessionId: session.id, delta: parsed.thinking },
                  });
                }
                if (parsed.text) {
                  streamedText += parsed.text;
                  this.sendPartial(session.id, parsed.text);
                }
              } else if (ame.type === 'thinking_delta') {
                markFirstStreamEvent(ame.type);
                // Forward thinking delta to renderer for real-time display
                this.sendToRenderer({
                  type: 'stream.thinking',
                  payload: { sessionId: session.id, delta: ame.delta },
                });
              } else if (ame.type === 'toolcall_start') {
                markFirstStreamEvent(ame.type);
                const partial = ame.partial;
                const toolContent = partial?.content?.[ame.contentIndex];
                const toolName = toolContent?.type === 'toolCall' ? toolContent.name : 'unknown';
                const toolCallId = toolContent?.type === 'toolCall' ? toolContent.id : uuidv4();
                const toolDisplayName = this.getToolDisplayName(toolName);
                this.sendTraceStep(session.id, {
                  id: toolCallId,
                  type: 'tool_call',
                  status: 'running',
                  title: toolDisplayName,
                  toolName,
                  toolInput:
                    toolContent?.type === 'toolCall'
                      ? (toolContent.arguments as Record<string, unknown>) || {}
                      : undefined,
                  timestamp: Date.now(),
                });
              } else if (ame.type === 'done') {
                // Some providers emit 'done' via message_update — we handle it
                // in message_end below as a unified path for all providers.
                log('[ClaudeAgentRunner] message_update done event (handled in message_end)');
              } else if (ame.type === 'error') {
                markFirstStreamEvent(ame.type);
                const errorDetail = JSON.stringify(ame.error?.content || 'no content');
                logCtxError('[ClaudeAgentRunner] pi-ai stream error:', ame.reason, errorDetail);
                emitTerminalError(resolveAssistantStreamErrorText(ame), {
                  abort: true,
                  includePartialText: true,
                });
              }
              break;
            }

            case 'message_end': {
              // Unified handler: send the final assistant message to the renderer.
              // Works for all providers (some emit 'done' via message_update, others don't).
              if (controller.signal.aborted) break;

              // Flush any buffered content from the think-tag parser
              const flushed = thinkParser.flush();
              if (flushed.thinking) {
                this.sendToRenderer({
                  type: 'stream.thinking',
                  payload: { sessionId: session.id, delta: flushed.thinking },
                });
              }
              if (flushed.text) {
                streamedText += flushed.text;
                this.sendPartial(session.id, flushed.text);
              }

              const msg = event.message;
              if (process.env.COWORK_LOG_SDK_MESSAGES_FULL === '1') {
                log('[ClaudeAgentRunner] message_end raw message:', safeStringify(msg, 2));
              }
              const resolvedPayload = resolveMessageEndPayload({
                message: msg as Parameters<typeof resolveMessageEndPayload>[0]['message'],
                streamedText,
              });
              streamedText = resolvedPayload.nextStreamedText;
              if (provider === 'ollama') {
                log(
                  '[ClaudeAgentRunner] Ollama message_end diagnostics',
                  safeStringify({
                    sessionId: session.id,
                    modelId: piModel.id,
                    modelProvider: piModel.provider,
                    usedSyntheticModel,
                    receivedFirstStreamEvent,
                    firstStreamLatencyMs: firstStreamEventAt
                      ? firstStreamEventAt - promptStartedAt
                      : null,
                    stopReason: (msg as { stopReason?: unknown })?.stopReason ?? null,
                    contentBlocks: Array.isArray((msg as { content?: unknown[] })?.content)
                      ? ((msg as { content?: unknown[] }).content?.length ?? 0)
                      : 0,
                    emittedError: Boolean(resolvedPayload.errorText),
                  })
                );
              }
              if (resolvedPayload.errorText) {
                emitTerminalError(resolvedPayload.errorText, { includePartialText: true });
                break;
              }
              if (resolvedPayload.shouldEmitMessage) {
                const contentBlocks: ContentBlock[] = [];
                for (const block of resolvedPayload.effectiveContent) {
                  if (block.type === 'text') {
                    const { cleanText, artifacts } = extractArtifactsFromText(block.text);
                    if (cleanText) {
                      contentBlocks.push({ type: 'text', text: sanitizeOutputPaths(cleanText) });
                    }
                    if (artifacts.length > 0) {
                      for (const step of buildArtifactTraceSteps(artifacts)) {
                        this.sendTraceStep(session.id, step);
                      }
                    }
                  } else if (block.type === 'toolCall') {
                    const displayName = this.getToolDisplayName(block.name);
                    contentBlocks.push({
                      type: 'tool_use',
                      id: block.id,
                      name: block.name,
                      displayName,
                      input: block.arguments,
                    });
                  } else if (block.type === 'thinking') {
                    // Include thinking blocks in the final message for UI display
                    contentBlocks.push({
                      type: 'thinking',
                      thinking: block.thinking,
                    });
                  } else {
                    // Unknown block type — pass through as text so content isn't silently lost
                    const unknownBlock = block as { type?: string; text?: string };
                    log(`[ClaudeAgentRunner] Unknown content block type: ${unknownBlock.type}`);
                    const text = unknownBlock.text || JSON.stringify(block);
                    if (text) contentBlocks.push({ type: 'text', text });
                  }
                }
                // Always clear partial text; send message even if only artifacts were extracted
                this.sendToRenderer({
                  type: 'stream.partial',
                  payload: { sessionId: session.id, delta: '' },
                });

                // ── Loop guard layer 1: hash of this message's tool-call group ──
                const toolUseDescriptors: ToolCallDescriptor[] = [];
                for (const block of resolvedPayload.effectiveContent) {
                  if (block.type === 'toolCall') {
                    toolUseDescriptors.push({
                      name: block.name || '',
                      input: (block.arguments as Record<string, unknown>) || undefined,
                    });
                  }
                }
                if (toolUseDescriptors.length > 0) {
                  handleLoopGuardDecision(
                    loopGuard.recordAssistantMessage(toolUseDescriptors),
                    'message_end'
                  );
                  if (controller.signal.aborted) break;
                }

                if (contentBlocks.length > 0) {
                  const msgWithUsage = msg as { usage?: unknown };
                  const tokenUsage = normalizeTokenUsage(msgWithUsage.usage);
                  if (msgWithUsage.usage) {
                    log(
                      '[ClaudeAgentRunner] normalized usage:',
                      safeStringify(
                        {
                          raw: msgWithUsage.usage,
                          normalized: tokenUsage,
                        },
                        2
                      )
                    );
                  }
                  const assistantMsg: Message = {
                    id: uuidv4(),
                    sessionId: session.id,
                    role: 'assistant',
                    content: contentBlocks,
                    timestamp: Date.now(),
                    api: piModel.api,
                    provider: piModel.provider,
                    model: piModel.id,
                    tokenUsage,
                  };
                  this.sendMessage(session.id, assistantMsg);
                }
              }
              break;
            }

            case 'tool_execution_start': {
              logCtx(`[ClaudeAgentRunner] Tool execution start: ${event.toolName}`);
              // ── Loop guard layer 2: per-tool cumulative frequency ──
              handleLoopGuardDecision(
                loopGuard.recordToolInvocation(event.toolName),
                'tool_execution_start'
              );
              break;
            }

            case 'tool_execution_end': {
              if (controller.signal.aborted) break;
              const toolCallId = event.toolCallId;
              const isError = event.isError;
              const normalizedToolResult = normalizeToolExecutionResultForUi(event.result);
              const outputText = normalizedToolResult.content;
              const toolDisplayName = this.getToolDisplayName(event.toolName);
              this.sendTraceUpdate(session.id, toolCallId, {
                status: isError ? 'error' : 'completed',
                title: toolDisplayName,
                toolName: event.toolName,
                toolOutput: sanitizeOutputPaths(outputText).slice(0, 800),
              });

              // Send tool result message
              const toolResultMsg: Message = {
                id: uuidv4(),
                sessionId: session.id,
                role: 'assistant',
                content: [
                  {
                    type: 'tool_result',
                    toolUseId: toolCallId,
                    content: sanitizeOutputPaths(outputText),
                    isError,
                    ...(normalizedToolResult.images.length > 0
                      ? { images: normalizedToolResult.images }
                      : {}),
                  },
                ],
                timestamp: Date.now(),
              };
              this.sendMessage(session.id, toolResultMsg);
              break;
            }

            case 'agent_end': {
              logCtx('[ClaudeAgentRunner] Agent finished');
              break;
            }

            case 'compaction_start': {
              log('[ClaudeAgentRunner] Auto-compaction started, reason:', event.reason);
              this.sendSessionNotice(session.id, mt('noticeCompactionStart'), 'info');
              compactionStepId = `compaction-${Date.now()}`;
              this.sendTraceStep(session.id, {
                id: compactionStepId,
                type: 'thinking',
                status: 'running',
                title: `Compacting context (${event.reason})...`,
                timestamp: Date.now(),
              });
              break;
            }

            case 'compaction_end': {
              const status = event.aborted ? 'error' : event.errorMessage ? 'error' : 'completed';
              const title = event.aborted
                ? 'Context compaction aborted'
                : event.errorMessage
                  ? `Context compaction failed: ${event.errorMessage}`
                  : 'Context compaction completed';
              log(
                '[ClaudeAgentRunner] Auto-compaction ended:',
                title,
                'willRetry:',
                event.willRetry
              );
              if (compactionStepId) {
                this.sendTraceUpdate(session.id, compactionStepId, { status, title });
                compactionStepId = undefined;
              } else {
                // Fallback: no matching start event, send as new step
                this.sendTraceStep(session.id, {
                  id: `compaction-end-${Date.now()}`,
                  type: 'thinking',
                  status,
                  title,
                  timestamp: Date.now(),
                });
              }
              if (event.aborted) {
                this.sendSessionNotice(
                  session.id,
                  mt('noticeCompactionFailed', { error: title }),
                  'warning'
                );
              } else if (event.errorMessage) {
                this.sendSessionNotice(
                  session.id,
                  mt('noticeCompactionFailed', { error: event.errorMessage }),
                  'warning'
                );
              } else {
                this.sendSessionNotice(session.id, mt('noticeCompactionCompleted'), 'success');
              }
              break;
            }
          }
        } catch (subscribeErr) {
          logError('[ClaudeAgentRunner] Error in subscribe callback:', subscribeErr);
          if (compactionStepId) {
            this.sendTraceUpdate(session.id, compactionStepId, {
              status: 'error',
              title: 'Error during context compaction',
            });
            compactionStepId = undefined;
          }
          if (!hasEmittedError) {
            hasEmittedError = true;
            const errorText = toUserFacingErrorText(toErrorText(subscribeErr));
            this.sendMessage(session.id, {
              id: uuidv4(),
              sessionId: session.id,
              role: 'assistant',
              content: [{ type: 'text', text: `**Error**: ${errorText}` }],
              timestamp: Date.now(),
            });
          }
        }
      });

      // Execute the prompt — unsubscribe in finally to prevent event listener leak
      try {
        resetActivityTimeout();
        if (provider === 'ollama') {
          log(
            '[ClaudeAgentRunner] Starting Ollama prompt',
            safeStringify({
              sessionId: session.id,
              modelId: piModel.id,
              modelProvider: piModel.provider,
              baseUrl: piModel.baseUrl || runtimeConfig.baseUrl || '',
              usedSyntheticModel,
              hasExplicitApiKey: Boolean(apiKey),
              thinkingLevel,
            })
          );
        }
        const promptResult = await piSession.prompt(contextualPrompt);
        log(
          '[ClaudeAgentRunner] prompt() returned:',
          JSON.stringify(promptResult ?? 'void').substring(0, 1000)
        );
      } finally {
        try {
          unsubscribe();
        } catch (e) {
          logWarn('[ClaudeAgentRunner] unsubscribe error:', e);
        }
        if (activityTimeoutId) clearTimeout(activityTimeoutId);
        if (ollamaColdStartTimerId) clearTimeout(ollamaColdStartTimerId);
      }

      logTiming('agent prompt completed', runStartTime);

      // If the SDK swallowed the AbortError and returned void, detect timeout here
      if (controller.signal.aborted && abortedByTimeout) {
        logCtx('[ClaudeAgentRunner] Aborted due to timeout (detected after prompt returned)');
        const errorMsg: Message = {
          id: uuidv4(),
          sessionId: session.id,
          role: 'assistant',
          content: [{ type: 'text', text: '**请求超时**：长时间未收到响应，操作已中止。' }],
          timestamp: Date.now(),
        };
        this.sendMessage(session.id, errorMsg);
        this.sendTraceUpdate(session.id, thinkingStepId, {
          status: 'error',
          title: 'Request timed out',
        });
        return;
      }
      // If the SDK swallowed the AbortError after a loop-guard abort, preserve
      // the 'error' trace status that handleLoopGuardDecision already published.
      // The user-facing message and trace step are already set; do not overwrite
      // them with the default "Task completed" below.
      const abortDisposition = resolveAbortDisposition({
        abortedByTimeout,
        abortedByLoopGuard,
        abortedByStreamError,
      });
      if (controller.signal.aborted && shouldPreserveExistingTrace(abortDisposition)) {
        logCtx(
          `[ClaudeAgentRunner] Aborted by ${abortDisposition === 'loop_guard' ? 'loop guard' : 'stream error'} (detected after prompt returned)`
        );
        return;
      }
      // Complete - update the initial thinking step
      this.sendTraceUpdate(session.id, thinkingStepId, {
        status: terminalErrorText ? 'error' : 'completed',
        title: terminalErrorText ? 'Request failed' : 'Task completed',
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        const abortDisposition = resolveAbortDisposition({
          abortedByTimeout,
          abortedByLoopGuard,
          abortedByStreamError,
        });
        if (abortDisposition === 'timeout') {
          logCtx('[ClaudeAgentRunner] Aborted due to timeout');
          const errorMsg: Message = {
            id: uuidv4(),
            sessionId: session.id,
            role: 'assistant',
            content: [{ type: 'text', text: '**请求超时**：长时间未收到响应，操作已中止。' }],
            timestamp: Date.now(),
          };
          this.sendMessage(session.id, errorMsg);
          this.sendTraceUpdate(session.id, thinkingStepId, {
            status: 'error',
            title: 'Request timed out',
          });
        } else if (abortDisposition === 'loop_guard') {
          // Loop guard already published the user-facing assistant message and
          // an 'error' trace step with the loop-detected title. Do NOT overwrite
          // them here with a 'completed/Cancelled' state.
          logCtx('[ClaudeAgentRunner] Aborted by loop guard');
        } else if (abortDisposition === 'stream_error') {
          // Stream-error handling already published the user-facing assistant
          // message and the 'Request failed' trace state. Preserve them.
          logCtx('[ClaudeAgentRunner] Aborted by stream error');
        } else {
          logCtx('[ClaudeAgentRunner] Aborted by user');
          this.sendTraceUpdate(session.id, thinkingStepId, {
            status: 'completed',
            title: 'Cancelled',
          });
        }
      } else {
        logCtxError('[ClaudeAgentRunner] Error:', error);

        const errorText = toUserFacingErrorText(toErrorText(error));
        const errorMsg: Message = {
          id: uuidv4(),
          sessionId: session.id,
          role: 'assistant',
          content: [{ type: 'text', text: `**Error**: ${errorText}` }],
          timestamp: Date.now(),
        };
        this.sendMessage(session.id, errorMsg);

        this.sendTraceStep(session.id, {
          id: uuidv4(),
          type: 'thinking',
          status: 'error',
          title: 'Error occurred',
          timestamp: Date.now(),
        });

        // Mark so session-manager doesn't report again
        if (error instanceof Error) {
          (error as Error & { alreadyReportedToUser?: boolean }).alreadyReportedToUser = true;
        }
      }
    } finally {
      this.activeControllers.delete(session.id);
      this.pathResolver.unregisterSession(session.id);

      // Sync changes from sandbox back to host OS (but don't cleanup - sandbox persists)
      if (useSandboxIsolation && sandboxPath) {
        try {
          const sandbox = getSandboxAdapter();

          if (sandbox.isWSL) {
            log('[ClaudeAgentRunner] Syncing sandbox changes to Windows...');
            const syncResult = await SandboxSync.syncToWindows(session.id);
            if (syncResult.success) {
              log('[ClaudeAgentRunner] Sync completed successfully');
            } else {
              logError('[ClaudeAgentRunner] Sync failed:', syncResult.error);
            }
          } else if (sandbox.isLima) {
            log('[ClaudeAgentRunner] Syncing sandbox changes to macOS...');
            const { LimaSync } = await import('../sandbox/lima-sync');
            const syncResult = await LimaSync.syncToMac(session.id);
            if (syncResult.success) {
              log('[ClaudeAgentRunner] Sync completed successfully');
            } else {
              logError('[ClaudeAgentRunner] Sync failed:', syncResult.error);
            }
          }
        } catch (syncErr) {
          logError('[ClaudeAgentRunner] Sandbox sync error:', syncErr);
          this.sendMessage(session.id, {
            id: uuidv4(),
            sessionId: session.id,
            role: 'assistant',
            content: [
              {
                type: 'text',
                text: `**Warning**: Sandbox sync failed: ${syncErr instanceof Error ? syncErr.message : String(syncErr)}`,
              },
            ],
            timestamp: Date.now(),
          });
        }
      }
    }
  }

  cancel(sessionId: string): void {
    const controller = this.activeControllers.get(sessionId);
    if (controller) controller.abort();
  }

  async compactSession(
    session: Session,
    customInstructions?: string
  ): Promise<{ summary: string; tokensBefore: number }> {
    const cached = this.piSessions.get(session.id);
    if (!cached) {
      throw new Error('errCompactNoSession');
    }

    this.sendSessionNotice(session.id, mt('noticeCompactionStart'), 'info');

    try {
      const result = await cached.session.compact(customInstructions);
      this.sendSessionNotice(session.id, mt('noticeCompactionCompleted'), 'success');
      return {
        summary: result.summary,
        tokensBefore: result.tokensBefore,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('Nothing to compact')) {
        throw new Error('errCompactNothingToCompact');
      }
      if (message.includes('Already compacted')) {
        throw new Error('errCompactAlreadyCompacted');
      }
      this.sendSessionNotice(
        session.id,
        mt('noticeCompactionFailed', { error: message }),
        'warning'
      );
      throw new Error('errCompactFailed');
    }
  }

  async summarizeForHandoff(
    session: Session,
    messages: Message[],
    customInstructions?: string
  ): Promise<{ summary: string; tokensBefore: number }> {
    const transcript = buildConversationTranscriptForHandoff(
      messages,
      serializeMessageContentForHistory
    );
    if (!transcript.trim()) {
      throw new Error('errHandoffNothingToSummarize');
    }

    const tokensBefore = getLastInputTokenCount(messages) || estimateTokensFromText(transcript);

    this.sendSessionNotice(session.id, mt('noticeHandoffStart'), 'info');

    try {
      const config = configStore.getAll();
      const result = await runPiAiOneShot(
        buildHandoffSummaryUserPrompt(transcript, customInstructions),
        HANDOFF_SUMMARY_SYSTEM_PROMPT,
        config,
        { maxTokens: 4096 }
      );
      const summary = result.text.trim();
      if (!summary) {
        throw new Error('errHandoffFailed');
      }
      return { summary, tokensBefore };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.sendSessionNotice(session.id, mt('noticeHandoffFailed', { error: message }), 'warning');
      throw new Error('errHandoffFailed');
    }
  }

  private sendTraceStep(sessionId: string, step: TraceStep): void {
    log(`[Trace] ${step.type}: ${step.title}`);
    this.sendToRenderer({ type: 'trace.step', payload: { sessionId, step } });
  }

  private sendTraceUpdate(sessionId: string, stepId: string, updates: Partial<TraceStep>): void {
    log(`[Trace] Update step ${stepId}:`, updates);
    this.sendToRenderer({ type: 'trace.update', payload: { sessionId, stepId, updates } });
  }

  private sendSessionNotice(
    sessionId: string,
    message: string,
    noticeType: 'info' | 'warning' | 'error' | 'success' = 'info'
  ): void {
    this.sendToRenderer({
      type: 'session.notice',
      payload: { sessionId, message, noticeType },
    });
  }

  private sendMessage(sessionId: string, message: Message): void {
    // Save message to database for persistence
    if (this.saveMessage) {
      this.saveMessage(message);
    }
    // Send to renderer for UI update
    this.sendToRenderer({ type: 'stream.message', payload: { sessionId, message } });
  }

  private sendPartial(sessionId: string, delta: string): void {
    this.sendToRenderer({ type: 'stream.partial', payload: { sessionId, delta } });
  }
}
