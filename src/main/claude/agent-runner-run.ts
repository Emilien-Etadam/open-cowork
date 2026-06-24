import {
  createAgentSession,
  SessionManager as PiSessionManager,
  SettingsManager as PiSettingsManager,
  createBashToolDefinition,
  getAgentDir,
  type AgentSession as PiAgentSession,
  type BashToolOptions,
  type ToolDefinition,
} from '@mariozechner/pi-coding-agent';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import * as path from 'path';
import { setMaxListeners } from 'node:events';
import type { ContentBlock, Message, Session } from '../../renderer/types';
import { getSharedAuthStorage, ModelRegistry } from './shared-auth';
import type { PathResolver } from '../sandbox/path-resolver';
import type { MCPManager } from '../mcp/mcp-manager';
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
import { getSandboxAdapter } from '../sandbox/sandbox-adapter';
import { SandboxSync } from '../sandbox/sandbox-sync';
import { extractArtifactsFromText, buildArtifactTraceSteps } from '../utils/artifact-parser';
import type { AgentRuntimeExtensionManager } from '../extensions/agent-runtime-extension-manager';
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
import { normalizeToolExecutionResultForUi } from './tool-result-utils';
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
import { buildColdStartContextualPrompt } from './agent-runner-history';
import { bootstrapSandboxEnvironment } from './agent-runner-sandbox-bootstrap';
import {
  type CachedPiSession,
  evictOldestPiSession,
  installPermissionHook,
  wrapBashToolForSudo,
  wrapBashToolWithDefaultTimeout,
} from './agent-runner-pi-session';
import {
  buildMcpCustomTools,
  normalizeTokenUsage,
  safeStringify,
  summarizeMessageForLog,
  toErrorText,
} from './agent-runner-mcp-bridge';
import { enrichProcessPathForBuild, getBundledNodePaths } from './agent-runner-path-env';
import { AgentRunnerSkillsPaths } from './agent-runner-skills-paths';
import { AgentRunnerRenderer } from './agent-runner-renderer-events';
import { mt } from '../i18n';

const VIRTUAL_WORKSPACE_PATH = '/workspace';

interface McpServersCache {
  fingerprint: string;
  servers: Record<string, unknown>;
}

export interface AgentRunnerRunContext {
  renderer: AgentRunnerRenderer;
  pathResolver: PathResolver;
  mcpManager?: MCPManager;
  extensionManager?: AgentRuntimeExtensionManager;
  activeControllers: Map<string, AbortController>;
  piSessions: Map<string, CachedPiSession>;
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
  skillsPaths: AgentRunnerSkillsPaths;
  getToolDisplayName(toolName: string): string;
  getCurrentModelString(preferredModel?: string): string;
  getMcpServersCache(): McpServersCache | null;
  setMcpServersCache(cache: McpServersCache | null): void;
  isSkillsSetupDone(): boolean;
  setSkillsSetupDone(value: boolean): void;
}

function ensureSkillsSetup(ctx: AgentRunnerRunContext): void {
  if (ctx.isSkillsSetupDone()) {
    return;
  }

  ctx.setSkillsSetupDone(true);

  const userClaudeDir = ctx.skillsPaths.getAppClaudeDir();
  if (!fs.existsSync(userClaudeDir)) {
    fs.mkdirSync(userClaudeDir, { recursive: true });
  }

  const appSkillsDir = ctx.skillsPaths.getRuntimeSkillsDir();
  if (!fs.existsSync(appSkillsDir)) {
    fs.mkdirSync(appSkillsDir, { recursive: true });
  }

  const builtinSkillsPath = ctx.skillsPaths.getBuiltinSkillsPath();
  if (builtinSkillsPath && fs.existsSync(builtinSkillsPath)) {
    const sourceInsideAsar = /\.asar[/\\]/.test(builtinSkillsPath);
    const builtinSkills = fs.readdirSync(builtinSkillsPath);
    for (const skillName of builtinSkills) {
      const builtinSkillPath = path.join(builtinSkillsPath, skillName);
      const userSkillPath = path.join(appSkillsDir, skillName);

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

      if (fs.statSync(builtinSkillPath).isDirectory() && !fs.existsSync(userSkillPath)) {
        if (sourceInsideAsar) {
          ctx.skillsPaths.copyDirectorySync(builtinSkillPath, userSkillPath);
          log(`[ClaudeAgentRunner] Copied built-in skill from asar: ${skillName}`);
        } else {
          try {
            fs.symlinkSync(builtinSkillPath, userSkillPath, 'dir');
            log(`[ClaudeAgentRunner] Linked built-in skill: ${skillName}`);
          } catch (err) {
            logWarn(`[ClaudeAgentRunner] Failed to symlink ${skillName}, copying instead:`, err);
            ctx.skillsPaths.copyDirectorySync(builtinSkillPath, userSkillPath);
          }
        }
      }
    }
  }

  ctx.skillsPaths.syncUserSkillsToAppDir(appSkillsDir);
  ctx.skillsPaths.syncConfiguredSkillsToRuntimeDir(appSkillsDir);
}

function sendTimeoutMessage(
  ctx: AgentRunnerRunContext,
  sessionId: string,
  thinkingStepId: string
): void {
  const errorMsg: Message = {
    id: uuidv4(),
    sessionId,
    role: 'assistant',
    content: [{ type: 'text', text: '**请求超时**：长时间未收到响应，操作已中止。' }],
    timestamp: Date.now(),
  };
  ctx.renderer.sendMessage(sessionId, errorMsg);
  ctx.renderer.sendTraceUpdate(sessionId, thinkingStepId, {
    status: 'error',
    title: 'Request timed out',
  });
}

export async function executeAgentRun(
  ctx: AgentRunnerRunContext,
  session: Session,
  prompt: string,
  existingMessages: Message[]
): Promise<void> {
  const runStartTime = Date.now();
  logCtx('[ClaudeAgentRunner] run() started');

  const controller = new AbortController();
  try {
    // SDK 会在同一 AbortSignal 上挂载较多监听器，放开上限避免无意义告警干扰排错。
    setMaxListeners(0, controller.signal);
  } catch {
    // 旧运行时不支持 EventTarget 调整监听上限时忽略即可。
  }
  ctx.activeControllers.set(session.id, controller);

  let sandboxPath: string | null = null;
  let useSandboxIsolation = false;
  let sandboxPathRegex: RegExp | null = null;
  const sanitizeOutputPaths = (content: string): string => {
    if (!sandboxPath || !useSandboxIsolation) return content;
    if (!sandboxPathRegex) {
      sandboxPathRegex = new RegExp(sandboxPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
    }
    return content.replace(sandboxPathRegex, VIRTUAL_WORKSPACE_PATH);
  };

  const thinkingStepId = uuidv4();
  let abortedByTimeout = false;
  let abortedByLoopGuard = false;
  let abortedByStreamError = false;

  try {
    ctx.pathResolver.registerSession(session.id, session.mountedPaths);
    logTiming('pathResolver.registerSession', runStartTime);

    ctx.renderer.sendTraceStep(session.id, {
      id: thinkingStepId,
      type: 'thinking',
      status: 'running',
      title: 'Processing request...',
      timestamp: Date.now(),
    });
    logTiming('sendTraceStep (thinking)', runStartTime);

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
      sendToRenderer: (event) => ctx.renderer.dispatch(event),
      sendMessage: (sessionId, message) => ctx.renderer.sendMessage(sessionId, message),
      sendTraceUpdate: (sessionId, stepId, updates) =>
        ctx.renderer.sendTraceUpdate(sessionId, stepId, updates),
      getBuiltinSkillsPath: () => ctx.skillsPaths.getBuiltinSkillsPath(),
      getRuntimeSkillsDir: () => ctx.skillsPaths.getRuntimeSkillsDir(),
      syncUserSkillsToAppDir: (appSkillsDir) =>
        ctx.skillsPaths.syncUserSkillsToAppDir(appSkillsDir),
      syncConfiguredSkillsToRuntimeDir: (runtimeSkillsDir) =>
        ctx.skillsPaths.syncConfiguredSkillsToRuntimeDir(runtimeSkillsDir),
    });
    if (sandboxBootstrap.aborted) {
      return;
    }
    sandboxPath = sandboxBootstrap.sandboxPath;
    useSandboxIsolation = sandboxBootstrap.useSandboxIsolation;

    const lastUserMessage =
      existingMessages.length > 0 ? existingMessages[existingMessages.length - 1] : null;

    logCtx('[ClaudeAgentRunner] Total messages:', existingMessages.length);

    const hasImages =
      lastUserMessage?.content.some((c) => (c as { type?: string }).type === 'image') || false;
    if (hasImages) {
      log('[ClaudeAgentRunner] User message contains images');
    }

    logTiming('before pi-ai model resolution', runStartTime);

    const runtimeConfig = configStore.getAll();
    const modelString = ctx.getCurrentModelString(runtimeConfig.model);
    const configProtocol = resolvePiRouteProtocol(
      runtimeConfig.provider,
      runtimeConfig.customProtocol
    );

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

    const provider = runtimeConfig.provider || 'anthropic';
    if (provider === 'ollama' && !runtimeConfig.contextWindow) {
      const ollamaBaseUrl = piModel.baseUrl || runtimeConfig.baseUrl || 'http://localhost:11434/v1';
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

    const modelContextWindow = piModel.contextWindow || 128000;
    const modelMaxTokens = piModel.maxTokens || 16384;
    ctx.renderer.dispatch({
      type: 'session.contextInfo',
      payload: {
        sessionId: session.id,
        contextWindow: modelContextWindow,
        maxTokens: modelMaxTokens,
      },
    });

    const authStorage = getSharedAuthStorage();
    const apiKey = runtimeConfig.apiKey?.trim();
    if (apiKey) {
      const piProvider =
        provider === 'custom' ? runtimeConfig.customProtocol || 'anthropic' : provider;
      authStorage.setRuntimeApiKey(piProvider, apiKey);
      if (piModel.provider !== piProvider) {
        authStorage.setRuntimeApiKey(piModel.provider, apiKey);
        log('[ClaudeAgentRunner] Set runtime API key for model provider:', piModel.provider);
      }
      log('[ClaudeAgentRunner] Set runtime API key for config provider:', piProvider);
    } else if (provider === 'ollama') {
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

    logCtx('[ClaudeAgentRunner] Model baseUrl:', piModel.baseUrl, 'api:', piModel.api);

    logTiming('after pi-ai model resolution', runStartTime);

    const imageCapable = true;
    const wslDistro = sandbox.isWSL ? sandbox.wslStatus?.distro : undefined;
    const effectiveCwd =
      useSandboxIsolation && sandboxPath && wslDistro
        ? wslUnixPathToWindowsUnc(wslDistro, sandboxPath)
        : useSandboxIsolation && sandboxPath
          ? sandboxPath
          : workingDir || process.cwd();

    const userClaudeDir = ctx.skillsPaths.getAppClaudeDir();
    ensureSkillsSetup(ctx);

    log('[ClaudeAgentRunner] App claude dir:', userClaudeDir);
    log('[ClaudeAgentRunner] User working directory:', workingDir);

    logTiming('before building conversation context', runStartTime);
    logCtx('[ClaudeAgentRunner] Using pi-ai native routing for:', piModel.provider, piModel.id);

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
    const skillPaths = await ctx.skillsPaths.resolveSkillPaths(session.id);
    const skillsSignature = JSON.stringify(skillPaths);
    log('[ClaudeAgentRunner] Skill paths for pi ResourceLoader:', skillPaths);

    let cachedSession = ctx.piSessions.get(session.id);
    if (cachedSession && cachedSession.runtimeSignature !== sessionRuntimeSignature) {
      logCtx('[ClaudeAgentRunner] Runtime changed, recreating cached pi session:', session.id);
      try {
        cachedSession.session.dispose();
      } catch (disposeError) {
        logWarn('[ClaudeAgentRunner] dispose error while recreating pi session:', disposeError);
      }
      ctx.piSessions.delete(session.id);
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
      ctx.piSessions.delete(session.id);
      cachedSession = undefined;
    }

    const extensionResult = ctx.extensionManager
      ? await ctx.extensionManager.beforeSessionRun({
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
      logCtx('[ClaudeAgentRunner] Reusing existing SDK session for:', session.id);
    }
    if (extensionResult.promptPrefix?.trim()) {
      contextualPrompt = `${extensionResult.promptPrefix.trim()}\n\n${contextualPrompt}`;
    }

    logTiming('before building MCP servers config', runStartTime);

    const mcpServers: Record<string, unknown> = {};
    if (ctx.mcpManager) {
      const serverStatuses = ctx.mcpManager.getServerStatus();
      const connectedServers = serverStatuses.filter((status) => status.connected);
      log('[ClaudeAgentRunner] MCP server statuses:', safeStringify(serverStatuses));
      log('[ClaudeAgentRunner] Connected MCP servers:', connectedServers.length);

      let allConfigs: ReturnType<typeof mcpConfigStore.getEnabledServers> = [];
      try {
        allConfigs = mcpConfigStore.getEnabledServers();
        log(
          '[ClaudeAgentRunner] Enabled MCP configs:',
          allConfigs.map((config) => config.name)
        );
      } catch (error) {
        logWarn(
          '[ClaudeAgentRunner] Failed to read enabled MCP configs; MCP tools will be unavailable this query',
          error
        );
        allConfigs = [];
      }

      const mcpFingerprint = JSON.stringify(allConfigs) + String(imageCapable);
      const cachedMcpServers = ctx.getMcpServersCache();
      if (cachedMcpServers?.fingerprint === mcpFingerprint) {
        Object.assign(mcpServers, cachedMcpServers.servers);
        log('[ClaudeAgentRunner] MCP servers config reused from cache');
      } else {
        const bundledNodePaths = getBundledNodePaths();
        const bundledNpx = bundledNodePaths?.npx ?? null;

        for (const config of allConfigs) {
          try {
            const serverKey = config.name;

            if (config.type === 'stdio') {
              const command =
                config.command === 'npx' && bundledNpx
                  ? bundledNpx
                  : config.command === 'node' && bundledNodePaths
                    ? bundledNodePaths.node
                    : config.command;

              const serverEnv = { ...config.env };
              if (bundledNodePaths && (config.command === 'npx' || config.command === 'node')) {
                const nodeBinDir = path.dirname(bundledNodePaths.node);
                const currentPath = process.env.PATH || '';
                serverEnv.PATH = `${nodeBinDir}${path.delimiter}${currentPath}`;
                log(`[ClaudeAgentRunner]   Added bundled node bin to PATH: ${nodeBinDir}`);
              }

              if (!imageCapable) {
                serverEnv.OPEN_COWORK_DISABLE_IMAGE_TOOL_OUTPUT = '1';
              }

              let resolvedArgs = config.args || [];
              const hasPlaceholders = resolvedArgs.some(
                (arg) =>
                  arg.includes('{SOFTWARE_DEV_SERVER_PATH}') ||
                  arg.includes('{GUI_OPERATE_SERVER_PATH}')
              );

              if (hasPlaceholders) {
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

        ctx.setMcpServersCache({ fingerprint: mcpFingerprint, servers: { ...mcpServers } });
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
      ctx.skillsPaths.getBundledPathHints(),
    ].filter((section): section is string => Boolean(section && section.trim()));

    logTiming('before agent session creation', runStartTime);

    const mcpCustomTools = ctx.mcpManager ? buildMcpCustomTools(ctx.mcpManager) : [];
    const extensionCustomTools = extensionResult.customTools || [];
    if (mcpCustomTools.length > 0) {
      log(
        `[ClaudeAgentRunner] Registered ${mcpCustomTools.length} MCP tools as customTools:`,
        mcpCustomTools.map((tool) => tool.name).join(', ')
      );
    }
    if (extensionCustomTools.length > 0) {
      log(
        `[ClaudeAgentRunner] Registered ${extensionCustomTools.length} extension tools as customTools:`,
        extensionCustomTools.map((tool) => tool.name).join(', ')
      );
    }

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

    const withTimeout = wrapBashToolWithDefaultTimeout([bashDefinition as ToolDefinition]);
    const wrappedBashTools = wrapBashToolForSudo(
      withTimeout,
      session.id,
      effectiveCwd,
      ctx.requestSudoPassword
    );
    const wrappedBash = wrappedBashTools.find((tool) => tool.name === 'bash');
    const allCustomTools = [
      ...(wrappedBash ? [wrappedBash] : []),
      ...mcpCustomTools,
      ...extensionCustomTools,
    ];

    logCtx(`[ClaudeAgentRunner] Session reuse check: cached=${!!cachedSession}`);
    logCtx(`[ClaudeAgentRunner] Model=${piModel.id}, thinkingLevel=${thinkingLevel}`);
    log('[ClaudeAgentRunner] Built-in tools: read, bash, edit, write');
    log(
      `[ClaudeAgentRunner] Custom tools (${allCustomTools.length}): ${allCustomTools.map((tool) => tool.name).join(', ')}`
    );

    let piSession: PiAgentSession;
    if (cachedSession) {
      piSession = cachedSession.session;

      if (cachedSession.modelId !== piModel.id) {
        logCtx(
          '[ClaudeAgentRunner] Model changed, hot-swapping:',
          cachedSession.modelId,
          '→',
          piModel.id
        );
        await piSession.setModel(piModel);
        cachedSession.modelId = piModel.id;
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
      const { DefaultResourceLoader } = await import('@mariozechner/pi-coding-agent');
      const resourceLoader = new DefaultResourceLoader({
        cwd: effectiveCwd,
        agentDir: getAgentDir(),
        additionalSkillPaths: skillPaths,
        appendSystemPrompt: coworkAppendPrompt,
      });
      await resourceLoader.reload();

      const modelRegistry = ModelRegistry.create(authStorage);

      const memoryPrefixTokenEstimate = estimateTokensFromText(extensionResult.promptPrefix || '');
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

      installPermissionHook(piSession, session.id, ctx.requestPermission, (toolName) =>
        ctx.getToolDisplayName(toolName)
      );

      evictOldestPiSession(ctx.piSessions);
      ctx.piSessions.set(session.id, {
        session: piSession,
        modelId: piModel.id,
        thinkingLevel,
        runtimeSignature: sessionRuntimeSignature,
        skillsSignature,
        compactionEnabled: compactionSettings.enabled,
      });

      if (provider === 'ollama') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const agent = piSession.agent as any;
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
          ctx.piSessions.get(session.id)!.ollamaNumCtx = ollamaNumCtx;
          log(
            '[ClaudeAgentRunner] Ollama _onPayload wrapper installed, num_ctx:',
            ollamaNumCtx.value
          );
        }
      }

      logTiming('agent session created', runStartTime);
    }

    let streamedText = '';
    let compactionStepId: string | undefined;
    let hasEmittedError = false;
    let terminalErrorText: string | undefined;
    const thinkParser = new ThinkTagStreamParser();
    const promptStartedAt = Date.now();
    const streamEventCounts = new Map<string, number>();

    const loopGuard = new LoopGuard();
    const handleLoopGuardDecision = (decision: LoopGuardDecision, context: string): void => {
      if (decision.action === 'none' || controller.signal.aborted) return;
      logWarn(`[LoopGuard] ${context}: action=${decision.action} reason=${decision.reason}`);

      if (decision.action === 'hash_abort' || decision.action === 'freq_abort') {
        ctx.renderer.sendMessage(session.id, {
          id: uuidv4(),
          sessionId: session.id,
          role: 'assistant',
          content: [{ type: 'text', text: buildAbortUserMessage(decision) }],
          timestamp: Date.now(),
        });
        hasEmittedError = true;
        ctx.renderer.sendTraceUpdate(session.id, thinkingStepId, {
          status: 'error',
          title: 'Stopped: tool-call loop detected',
        });
        try {
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

    let ollamaColdStartTimerId: ReturnType<typeof setTimeout> | undefined;
    let receivedFirstStreamEvent = false;
    let firstStreamEventAt: number | undefined;
    if (provider === 'ollama') {
      ollamaColdStartTimerId = setTimeout(() => {
        if (!receivedFirstStreamEvent && !controller.signal.aborted) {
          ctx.renderer.sendTraceUpdate(session.id, thinkingStepId, {
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
      ctx.renderer.sendTraceUpdate(session.id, thinkingStepId, {
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

    const PROMPT_TIMEOUT_MS = 5 * 60 * 1000;
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
        Array.from(streamEventCounts.entries()).sort(([left], [right]) => left.localeCompare(right))
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
        ctx.renderer.dispatch({
          type: 'stream.thinking',
          payload: { sessionId: session.id, delta: emission.thinkingDelta },
        });
      }
      if (emission.textDelta) {
        ctx.renderer.sendPartial(session.id, emission.textDelta);
      }

      const partialText = emission.partialText ? sanitizeOutputPaths(emission.partialText) : '';
      const messageText = buildTerminalErrorMessage(errorText, partialText);
      streamedText = '';
      ctx.renderer.dispatch({
        type: 'stream.partial',
        payload: { sessionId: session.id, delta: '' },
      });

      if (!hasEmittedError) {
        hasEmittedError = true;
        ctx.renderer.sendMessage(session.id, {
          id: uuidv4(),
          sessionId: session.id,
          role: 'assistant',
          content: [{ type: 'text', text: messageText }],
          timestamp: Date.now(),
        });
      }

      ctx.renderer.sendTraceUpdate(session.id, thinkingStepId, {
        status: 'error',
        title: 'Request failed',
      });

      if (options.abort && !controller.signal.aborted) {
        try {
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
      ctx.renderer.sendMessage(session.id, {
        id: uuidv4(),
        sessionId: session.id,
        role: 'assistant',
        content: [{ type: 'text', text: buildTerminalErrorMessage(errorText) }],
        timestamp: Date.now(),
      });
      ctx.renderer.sendTraceUpdate(session.id, thinkingStepId, {
        status: 'error',
        title: 'Context full',
      });
      return;
    }

    if (contextWouldOverflow && compactionEnabled) {
      ctx.renderer.sendSessionNotice(session.id, mt('noticeCompactionStart'), 'info');
    }

    const unsubscribe = piSession.subscribe((event) => {
      try {
        if (controller.signal.aborted) return;

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
                ctx.renderer.dispatch({
                  type: 'stream.thinking',
                  payload: { sessionId: session.id, delta: parsed.thinking },
                });
              }
              if (parsed.text) {
                streamedText += parsed.text;
                ctx.renderer.sendPartial(session.id, parsed.text);
              }
            } else if (ame.type === 'thinking_delta') {
              markFirstStreamEvent(ame.type);
              ctx.renderer.dispatch({
                type: 'stream.thinking',
                payload: { sessionId: session.id, delta: ame.delta },
              });
            } else if (ame.type === 'toolcall_start') {
              markFirstStreamEvent(ame.type);
              const partial = ame.partial;
              const toolContent = partial?.content?.[ame.contentIndex];
              const toolName = toolContent?.type === 'toolCall' ? toolContent.name : 'unknown';
              const toolCallId = toolContent?.type === 'toolCall' ? toolContent.id : uuidv4();
              const toolDisplayName = ctx.getToolDisplayName(toolName);
              ctx.renderer.sendTraceStep(session.id, {
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
            if (controller.signal.aborted) break;

            const flushed = thinkParser.flush();
            if (flushed.thinking) {
              ctx.renderer.dispatch({
                type: 'stream.thinking',
                payload: { sessionId: session.id, delta: flushed.thinking },
              });
            }
            if (flushed.text) {
              streamedText += flushed.text;
              ctx.renderer.sendPartial(session.id, flushed.text);
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
                      ctx.renderer.sendTraceStep(session.id, step);
                    }
                  }
                } else if (block.type === 'toolCall') {
                  const displayName = ctx.getToolDisplayName(block.name);
                  contentBlocks.push({
                    type: 'tool_use',
                    id: block.id,
                    name: block.name,
                    displayName,
                    input: block.arguments,
                  });
                } else if (block.type === 'thinking') {
                  contentBlocks.push({
                    type: 'thinking',
                    thinking: block.thinking,
                  });
                } else {
                  const unknownBlock = block as { type?: string; text?: string };
                  log(`[ClaudeAgentRunner] Unknown content block type: ${unknownBlock.type}`);
                  const text = unknownBlock.text || JSON.stringify(block);
                  if (text) contentBlocks.push({ type: 'text', text });
                }
              }
              ctx.renderer.dispatch({
                type: 'stream.partial',
                payload: { sessionId: session.id, delta: '' },
              });

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
                ctx.renderer.sendMessage(session.id, assistantMsg);
              }
            }
            break;
          }

          case 'tool_execution_start': {
            logCtx(`[ClaudeAgentRunner] Tool execution start: ${event.toolName}`);
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
            const toolDisplayName = ctx.getToolDisplayName(event.toolName);
            ctx.renderer.sendTraceUpdate(session.id, toolCallId, {
              status: isError ? 'error' : 'completed',
              title: toolDisplayName,
              toolName: event.toolName,
              toolOutput: sanitizeOutputPaths(outputText).slice(0, 800),
            });

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
            ctx.renderer.sendMessage(session.id, toolResultMsg);
            break;
          }

          case 'agent_end': {
            logCtx('[ClaudeAgentRunner] Agent finished');
            break;
          }

          case 'compaction_start': {
            log('[ClaudeAgentRunner] Auto-compaction started, reason:', event.reason);
            ctx.renderer.sendSessionNotice(session.id, mt('noticeCompactionStart'), 'info');
            compactionStepId = `compaction-${Date.now()}`;
            ctx.renderer.sendTraceStep(session.id, {
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
            log('[ClaudeAgentRunner] Auto-compaction ended:', title, 'willRetry:', event.willRetry);
            if (compactionStepId) {
              ctx.renderer.sendTraceUpdate(session.id, compactionStepId, { status, title });
              compactionStepId = undefined;
            } else {
              ctx.renderer.sendTraceStep(session.id, {
                id: `compaction-end-${Date.now()}`,
                type: 'thinking',
                status,
                title,
                timestamp: Date.now(),
              });
            }
            if (event.aborted) {
              ctx.renderer.sendSessionNotice(
                session.id,
                mt('noticeCompactionFailed', { error: title }),
                'warning'
              );
            } else if (event.errorMessage) {
              ctx.renderer.sendSessionNotice(
                session.id,
                mt('noticeCompactionFailed', { error: event.errorMessage }),
                'warning'
              );
            } else {
              ctx.renderer.sendSessionNotice(
                session.id,
                mt('noticeCompactionCompleted'),
                'success'
              );
            }
            break;
          }
        }
      } catch (subscribeErr) {
        logError('[ClaudeAgentRunner] Error in subscribe callback:', subscribeErr);
        if (compactionStepId) {
          ctx.renderer.sendTraceUpdate(session.id, compactionStepId, {
            status: 'error',
            title: 'Error during context compaction',
          });
          compactionStepId = undefined;
        }
        if (!hasEmittedError) {
          hasEmittedError = true;
          const errorText = toUserFacingErrorText(toErrorText(subscribeErr));
          ctx.renderer.sendMessage(session.id, {
            id: uuidv4(),
            sessionId: session.id,
            role: 'assistant',
            content: [{ type: 'text', text: `**Error**: ${errorText}` }],
            timestamp: Date.now(),
          });
        }
      }
    });

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

    if (controller.signal.aborted && abortedByTimeout) {
      logCtx('[ClaudeAgentRunner] Aborted due to timeout (detected after prompt returned)');
      sendTimeoutMessage(ctx, session.id, thinkingStepId);
      return;
    }
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
    ctx.renderer.sendTraceUpdate(session.id, thinkingStepId, {
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
        sendTimeoutMessage(ctx, session.id, thinkingStepId);
      } else if (abortDisposition === 'loop_guard') {
        logCtx('[ClaudeAgentRunner] Aborted by loop guard');
      } else if (abortDisposition === 'stream_error') {
        logCtx('[ClaudeAgentRunner] Aborted by stream error');
      } else {
        logCtx('[ClaudeAgentRunner] Aborted by user');
        ctx.renderer.sendTraceUpdate(session.id, thinkingStepId, {
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
      ctx.renderer.sendMessage(session.id, errorMsg);

      ctx.renderer.sendTraceStep(session.id, {
        id: uuidv4(),
        type: 'thinking',
        status: 'error',
        title: 'Error occurred',
        timestamp: Date.now(),
      });

      if (error instanceof Error) {
        (error as Error & { alreadyReportedToUser?: boolean }).alreadyReportedToUser = true;
      }
    }
  } finally {
    ctx.activeControllers.delete(session.id);
    ctx.pathResolver.unregisterSession(session.id);

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
        ctx.renderer.sendMessage(session.id, {
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
