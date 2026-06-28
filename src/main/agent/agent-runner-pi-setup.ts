import {
  createBashToolDefinition,
  type AgentSession as PiAgentSession,
  type BashToolOptions,
  type ToolDefinition,
} from '@earendil-works/pi-coding-agent';
import type { Message, Session } from '../../renderer/types';
import { configStore } from '../config/config-store';
import { isLoopbackOpenAIEndpoint, normalizeOpenAICompatibleBaseUrl } from '../config/auth-utils';
import { fetchOllamaModelInfo } from '../config/ollama-api';
import type { BeforeSessionRunResult } from '../extensions/agent-runtime-extension';
import type { SandboxAdapter } from '../sandbox/sandbox-adapter';
import { wslUnixPathToWindowsUnc } from '../sandbox/sandbox-workspace-path';
import { log, logCtx, logCtxWarn, logTiming, logWarn } from '../utils/logger';
import { buildColdStartContextualPrompt } from './agent-runner-history';
import { buildMcpServers } from './agent-runner-mcp-servers';
import { buildMcpCustomTools, safeStringify } from './agent-runner-mcp-bridge';
import { enrichProcessPathForBuild } from './agent-runner-path-env';
import {
  type CachedPiSession,
  createPiSession,
  disposeCachedPiSession,
  reuseCachedPiSession,
  wrapBashToolForSudo,
  wrapBashToolWithDefaultTimeout,
} from './agent-runner-pi-session';
import { buildCoworkAppendPrompt } from './agent-runner-prompts';
import { buildNativeCustomTools } from './agent-runner-native-tools';
import { buildWebSearchCustomTools } from './agent-runner-web-search-tool';
import {
  AgentRunnerRunContext,
  ensureSkillsSetup,
  VIRTUAL_WORKSPACE_PATH,
} from './agent-runner-run-context';
import { getLastInputTokenCount } from './context-budget';
import {
  applyPiModelRuntimeOverrides,
  buildSyntheticPiModel,
  resolvePiRegistryModel,
  resolvePiRouteProtocol,
  resolveSyntheticPiModelFallback,
} from './pi-model-resolution';
import {
  parseSlashCommand,
  normalizePluginSlashPromptForExpansion,
} from '../../shared/slash-commands';
import { mt } from '../i18n';
import { buildPiSessionRuntimeSignature } from './pi-session-runtime';
import { getSharedAuthStorage } from './shared-auth';
import { createWindowsBashOperations } from './windows-bash-operations';
import { createWslSandboxBashOperations } from './wsl-sandbox-bash-operations';

type PiModel = ReturnType<typeof buildSyntheticPiModel>;

export interface PreparedPiSessionRun {
  piSession: PiAgentSession;
  cachedSession?: CachedPiSession;
  provider: string;
  runtimeConfig: ReturnType<typeof configStore.getAll>;
  usedSyntheticModel: boolean;
  piModel: PiModel;
  contextualPrompt: string;
  modelContextWindow: number;
  modelMaxTokens: number;
  thinkingLevel: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
  promptPrefix?: string;
  compactionEnabled: boolean;
}

interface PreparePiSessionRunOptions {
  ctx: AgentRunnerRunContext;
  session: Session;
  prompt: string;
  existingMessages: Message[];
  workingDir?: string;
  sandboxPath: string | null;
  useSandboxIsolation: boolean;
  sandbox: SandboxAdapter;
  runStartTime: number;
}

export async function preparePiSessionRun({
  ctx,
  session,
  prompt,
  existingMessages,
  workingDir,
  sandboxPath,
  useSandboxIsolation,
  sandbox,
  runStartTime,
}: PreparePiSessionRunOptions): Promise<PreparedPiSessionRun> {
  const lastUserMessage = existingMessages.at(-1) ?? null;
  logCtx('[AgentRunner] Total messages:', existingMessages.length);
  if (lastUserMessage?.content.some((content) => (content as { type?: string }).type === 'image')) {
    log('[AgentRunner] User message contains images');
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
    configProtocol === 'openai'
      ? isLoopbackOpenAIEndpoint({ provider: runtimeConfig.provider, baseUrl: rawBaseUrl })
        ? rawBaseUrl
        : normalizeOpenAICompatibleBaseUrl(rawBaseUrl) || rawBaseUrl
      : rawBaseUrl;

  let usedSyntheticModel = false;
  let piModel =
    resolvePiRegistryModel(modelString, {
      configProvider: configProtocol,
      customBaseUrl: effectiveBaseUrl,
      rawProvider: runtimeConfig.provider,
      customProtocol: runtimeConfig.customProtocol,
    }) ??
    (() => {
      usedSyntheticModel = true;
      const synthetic = resolveSyntheticPiModelFallback({
        rawModel: runtimeConfig.model,
        resolvedModelString: modelString,
        rawProvider: runtimeConfig.provider,
        routeProtocol: configProtocol,
        baseUrl: effectiveBaseUrl,
      });
      return applyPiModelRuntimeOverrides(
        buildSyntheticPiModel(
          synthetic.modelId,
          synthetic.provider,
          configProtocol,
          effectiveBaseUrl,
          undefined,
          undefined,
          runtimeConfig.contextWindow,
          runtimeConfig.maxTokens
        ),
        {
          configProvider: configProtocol,
          customBaseUrl: effectiveBaseUrl,
          rawProvider: runtimeConfig.provider,
          customProtocol: runtimeConfig.customProtocol,
        }
      );
    })();

  if (usedSyntheticModel) {
    logCtxWarn(
      '[AgentRunner] Model not in pi-ai registry, using synthetic model:',
      modelString,
      '→',
      piModel.api
    );
  }
  logCtx('[AgentRunner] Resolved pi-ai model:', piModel.provider, piModel.id);

  const provider = runtimeConfig.provider || 'anthropic';
  if (
    provider === 'openai' &&
    isLoopbackOpenAIEndpoint({ provider, baseUrl: runtimeConfig.baseUrl }) &&
    !runtimeConfig.contextWindow
  ) {
    const ollamaInfo = await fetchOllamaModelInfo({
      baseUrl: piModel.baseUrl || runtimeConfig.baseUrl || 'http://localhost:11434/v1',
      model: piModel.id,
      apiKey: runtimeConfig.apiKey,
    });
    if (ollamaInfo.contextWindow) {
      log(
        '[AgentRunner] Ollama /api/show reported contextWindow:',
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
    authStorage.setRuntimeApiKey(provider, apiKey);
    if (piModel.provider !== provider) {
      authStorage.setRuntimeApiKey(piModel.provider, apiKey);
      log('[AgentRunner] Set runtime API key for model provider:', piModel.provider);
    }
    log('[AgentRunner] Set runtime API key for config provider:', provider);
  } else if (
    provider === 'openai' &&
    isLoopbackOpenAIEndpoint({ provider, baseUrl: runtimeConfig.baseUrl })
  ) {
    log(
      '[AgentRunner] Ollama configured without explicit API key; relying on OpenAI-compatible placeholder/env auth path',
      safeStringify({
        provider,
        modelProvider: piModel.provider,
        modelId: piModel.id,
        baseUrl: piModel.baseUrl || runtimeConfig.baseUrl || '',
      })
    );
  } else {
    logWarn('[AgentRunner] No API key configured for provider:', provider);
  }

  logCtx('[AgentRunner] Model baseUrl:', piModel.baseUrl, 'api:', piModel.api);
  logTiming('after pi-ai model resolution', runStartTime);

  const imageCapable = true;
  const wslDistro = sandbox.isWSL ? sandbox.wslStatus?.distro : undefined;
  const effectiveCwd =
    useSandboxIsolation && sandboxPath && wslDistro
      ? wslUnixPathToWindowsUnc(wslDistro, sandboxPath)
      : useSandboxIsolation && sandboxPath
        ? sandboxPath
        : workingDir || process.cwd();

  await ensureSkillsSetup(ctx);
  log('[AgentRunner] Runtime skills dir:', ctx.skillsPaths.getRuntimeSkillsDir());
  log('[AgentRunner] User working directory:', workingDir);

  logTiming('before building conversation context', runStartTime);
  logCtx('[AgentRunner] Using pi-ai native routing for:', piModel.provider, piModel.id);
  const thinkingLevel: PreparedPiSessionRun['thinkingLevel'] =
    (configStore.get('enableThinking') ?? false) ? 'medium' : 'off';
  logCtx('[AgentRunner] Enable thinking mode:', thinkingLevel !== 'off');

  const sessionRuntimeSignature = buildPiSessionRuntimeSignature({
    configProvider: runtimeConfig.provider,
    customProtocol: runtimeConfig.customProtocol,
    modelProvider: piModel.provider,
    modelApi: piModel.api,
    modelBaseUrl: piModel.baseUrl,
    effectiveCwd,
    apiKey,
  });
  const pluginSlashCommands = ctx.skillsPaths.listPluginSlashCommands();
  const slashParsed = parseSlashCommand(prompt.trim(), pluginSlashCommands);
  if (slashParsed.kind === 'unknown') {
    const error = new Error(
      mt('errUnknownSlashCommand', { command: `/${slashParsed.token}` })
    ) as Error & { alreadyReportedToUser?: boolean };
    error.alreadyReportedToUser = true;
    throw error;
  }
  const normalizedPrompt = normalizePluginSlashPromptForExpansion(prompt, pluginSlashCommands);

  const skillPaths = await ctx.skillsPaths.resolveSkillPaths(session.id);
  const promptTemplatePaths = await ctx.skillsPaths.resolvePluginPromptTemplatePaths();
  const skillsSignature = JSON.stringify({ skillPaths, promptTemplatePaths });
  log('[AgentRunner] Skill paths for pi ResourceLoader:', skillPaths);
  log('[AgentRunner] Prompt template paths for pi ResourceLoader:', promptTemplatePaths);

  let cachedSession = ctx.piSessions.get(session.id);
  const invalidateCachedSession = (reason: string, warningLabel: string) => {
    if (!cachedSession) {
      return;
    }
    logCtx(reason, session.id);
    try {
      disposeCachedPiSession(cachedSession);
    } catch (error) {
      logWarn(warningLabel, error);
    }
    ctx.piSessions.delete(session.id);
    cachedSession = undefined;
  };
  if (cachedSession?.runtimeSignature !== sessionRuntimeSignature) {
    invalidateCachedSession(
      '[AgentRunner] Runtime changed, recreating cached pi session:',
      '[AgentRunner] dispose error while recreating pi session:'
    );
  }
  if (cachedSession?.skillsSignature !== skillsSignature) {
    invalidateCachedSession(
      '[AgentRunner] Skills changed, recreating cached pi session:',
      '[AgentRunner] dispose error while recreating pi session for skills:'
    );
  }

  const extensionResult: BeforeSessionRunResult = ctx.extensionManager
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

  let contextualPrompt = cachedSession
    ? normalizedPrompt
    : buildColdStartContextualPrompt({
        prompt: normalizedPrompt,
        existingMessages,
        provider,
        contextWindow: modelContextWindow,
      });
  if (cachedSession) {
    logCtx('[AgentRunner] Reusing existing SDK session for:', session.id);
  }
  if (extensionResult.promptPrefix?.trim()) {
    contextualPrompt = `${extensionResult.promptPrefix.trim()}\n\n${contextualPrompt}`;
  }

  logTiming('before building MCP servers config', runStartTime);
  buildMcpServers(ctx, imageCapable);
  logTiming('after building MCP servers config', runStartTime);

  const coworkAppendPrompt = buildCoworkAppendPrompt(
    ctx,
    workingDir,
    sandboxPath,
    useSandboxIsolation,
    configStore.get('sandboxLanNetworkEnabled') === true
  );
  const mcpCustomTools = ctx.mcpManager ? buildMcpCustomTools(ctx.mcpManager) : [];
  const webSearchCustomTools = buildWebSearchCustomTools();
  const nativeCustomTools = buildNativeCustomTools({
    cwd: effectiveCwd,
    sessionId: session.id,
    requestUserQuestion: ctx.requestUserQuestion,
  });
  const extensionCustomTools = extensionResult.customTools || [];
  if (mcpCustomTools.length > 0) {
    log(
      `[AgentRunner] Registered ${mcpCustomTools.length} MCP tools as customTools:`,
      mcpCustomTools.map((tool) => tool.name).join(', ')
    );
  }
  if (webSearchCustomTools.length > 0) {
    log(
      `[AgentRunner] Registered ${webSearchCustomTools.length} web search tools as customTools:`,
      webSearchCustomTools.map((tool) => tool.name).join(', ')
    );
  }
  if (nativeCustomTools.length > 0) {
    log(
      `[AgentRunner] Registered ${nativeCustomTools.length} native tools as customTools:`,
      nativeCustomTools.map((tool) => tool.name).join(', ')
    );
  }
  if (extensionCustomTools.length > 0) {
    log(
      `[AgentRunner] Registered ${extensionCustomTools.length} extension tools as customTools:`,
      extensionCustomTools.map((tool) => tool.name).join(', ')
    );
  }

  await enrichProcessPathForBuild();
  const useWslSandboxBash = Boolean(
    useSandboxIsolation && sandboxPath && sandbox.isWSL && sandbox.wslStatus?.distro
  );
  const bashOptions: BashToolOptions | undefined = useWslSandboxBash
    ? {
        operations: createWslSandboxBashOperations({
          distro: sandbox.wslStatus!.distro!,
          sandboxPath: sandboxPath!,
          virtualWorkspacePath: VIRTUAL_WORKSPACE_PATH,
        }),
      }
    : process.platform === 'win32'
      ? { operations: createWindowsBashOperations() }
      : undefined;
  if (useWslSandboxBash) {
    log(
      `[AgentRunner] Using WSL sandbox bash (distro=${sandbox.wslStatus!.distro}, sandbox=${sandboxPath})`
    );
  }

  const bashDefinition = createBashToolDefinition(effectiveCwd, bashOptions);
  const wrappedBash = wrapBashToolForSudo(
    wrapBashToolWithDefaultTimeout([bashDefinition as ToolDefinition]),
    session.id,
    effectiveCwd,
    ctx.requestSudoPassword
  ).find((tool) => tool.name === 'bash');
  const allCustomTools = [
    ...(wrappedBash ? [wrappedBash] : []),
    ...nativeCustomTools,
    ...webSearchCustomTools,
    ...mcpCustomTools,
    ...extensionCustomTools,
  ];

  logCtx(`[AgentRunner] Session reuse check: cached=${!!cachedSession}`);
  logCtx(`[AgentRunner] Model=${piModel.id}, thinkingLevel=${thinkingLevel}`);
  log('[AgentRunner] Built-in tools: read, bash, edit, write');
  log(
    '[AgentRunner] Native tools: glob, grep, web_fetch, http_request, todo_write, ask_user_question (+ aliases)'
  );
  log(
    `[AgentRunner] Custom tools (${allCustomTools.length}): ${allCustomTools.map((tool) => tool.name).join(', ')}`
  );
  logTiming('before agent session creation', runStartTime);

  const buildResult = (
    piSession: PiAgentSession,
    compactionEnabled: boolean,
    reusedSession?: CachedPiSession
  ): PreparedPiSessionRun => ({
    piSession,
    cachedSession: reusedSession,
    provider,
    runtimeConfig,
    usedSyntheticModel,
    piModel,
    contextualPrompt,
    modelContextWindow,
    modelMaxTokens,
    thinkingLevel,
    promptPrefix: extensionResult.promptPrefix,
    compactionEnabled,
  });

  const reusedSession = await reuseCachedPiSession({
    cachedSession,
    piModel,
    thinkingLevel,
    sessionId: session.id,
  });
  if (reusedSession) {
    logTiming('agent session reused', runStartTime);
    return buildResult(
      reusedSession.piSession,
      reusedSession.compactionEnabled,
      reusedSession.cachedSession
    );
  }

  const { piSession, compactionEnabled } = await createPiSession({
    ctx,
    sessionId: session.id,
    provider,
    piModel,
    thinkingLevel,
    authStorage,
    customTools: allCustomTools,
    skillPaths,
    promptTemplatePaths,
    coworkAppendPrompt,
    effectiveCwd,
    sessionRuntimeSignature,
    skillsSignature,
    promptPrefix: extensionResult.promptPrefix,
    modelContextWindow,
    modelMaxTokens,
  });

  logTiming('agent session created', runStartTime);
  return buildResult(piSession, compactionEnabled);
}
