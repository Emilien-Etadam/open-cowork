/**
 * Pi-coding-agent session cache helpers, permission hooks, and bash tool wrappers.
 */
import { spawn } from 'child_process';
import { v4 as uuidv4 } from 'uuid';
import {
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  SessionManager as PiSessionManager,
  SettingsManager as PiSettingsManager,
  type AgentSession as PiAgentSession,
  type ToolDefinition,
} from '@earendil-works/pi-coding-agent';
import { decidePermission, rememberAlwaysAllow } from '../config/permission-rules-store';
import type { MCPManager } from '../mcp/mcp-manager';
import { logCtx } from '../utils/logger';
import { log, logError, logWarn } from '../utils/logger';
import { buildCompactionSettings, estimateTokensFromText } from './context-budget';
import type { AgentRunnerRunContext } from './agent-runner-run-context';
import { ModelRegistry } from './shared-auth';

export interface CachedPiSession {
  session: PiAgentSession;
  modelId: string;
  thinkingLevel: string;
  runtimeSignature: string;
  skillsSignature?: string;
  ollamaNumCtx?: { value: number };
  compactionEnabled: boolean;
}

export const MAX_CACHED_PI_SESSIONS = 50;

export function resolveToolDisplayName(
  toolName: string,
  mcpManager: MCPManager | undefined,
  cache: Map<string, string>
): string {
  const cached = cache.get(toolName);
  if (cached) {
    return cached;
  }

  let displayName = toolName;
  if (!toolName.startsWith('mcp__')) {
    cache.set(toolName, displayName);
    return displayName;
  }

  const mcpTool = mcpManager?.getTool(toolName);
  if (mcpTool?.originalName) {
    displayName = mcpTool.originalName;
  } else {
    const match = toolName.match(/^mcp__(.+?)__(.+)$/);
    displayName = match?.[2] || toolName;
  }

  cache.set(toolName, displayName);
  return displayName;
}

export function disposeCachedPiSession(cached: CachedPiSession): void {
  try {
    cached.session.dispose();
  } catch (e) {
    logWarn('[ClaudeAgentRunner] dispose error:', e);
  }
}

export function evictOldestPiSession(sessions: Map<string, CachedPiSession>): void {
  if (sessions.size < MAX_CACHED_PI_SESSIONS) {
    return;
  }
  const oldestKey = sessions.keys().next().value;
  if (!oldestKey) {
    return;
  }
  const oldest = sessions.get(oldestKey);
  if (oldest) {
    disposeCachedPiSession(oldest);
  }
  sessions.delete(oldestKey);
  log('[ClaudeAgentRunner] Evicted oldest cached session:', oldestKey);
}

/**
 * Install a permission-gating hook on the pi-coding-agent session via
 * `agent.setBeforeToolCall`.
 */
export function installPermissionHook(
  piSession: PiAgentSession,
  sessionId: string,
  requestPermission:
    | ((
        sessionId: string,
        toolUseId: string,
        toolName: string,
        input: Record<string, unknown>
      ) => Promise<'allow' | 'deny' | 'allow_always'>)
    | undefined,
  getToolDisplayName: (toolName: string) => string
): void {
  if (!requestPermission) {
    log('[ClaudeAgentRunner] No requestPermission callback — skipping permission hook');
    return;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const agent = (piSession as any).agent;
  if (!agent || typeof agent.setBeforeToolCall !== 'function') {
    logWarn('[ClaudeAgentRunner] Cannot access agent.setBeforeToolCall — skipping permission hook');
    return;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sdkBeforeToolCall: ((ctx: any, signal?: AbortSignal) => Promise<any>) | undefined =
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (agent as any)._beforeToolCall;

  agent.setBeforeToolCall(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (ctx: any, signal?: AbortSignal): Promise<any> => {
      const toolName: string = ctx.toolCall?.name ?? '';
      const input: Record<string, unknown> = ctx.args ?? {};

      const decision = decidePermission(sessionId, toolName, input);
      const displayName = getToolDisplayName(toolName);

      if (decision === 'deny') {
        log(`[ClaudeAgentRunner] Tool '${toolName}' denied by rule`);
        return {
          block: true,
          reason: `Tool '${displayName}' is denied by your permission rules.`,
        };
      }

      if (decision === 'ask') {
        const toolUseId = `${ctx.toolCall?.id ?? 'unknown'}-perm-${uuidv4().slice(0, 8)}`;
        let result: 'allow' | 'deny' | 'allow_always';
        try {
          result = await requestPermission(sessionId, toolUseId, displayName, input);
        } catch (permErr) {
          logError(
            `[ClaudeAgentRunner] Permission request failed for '${toolName}' — failing closed`,
            permErr
          );
          return {
            block: true,
            reason: `Permission request failed for '${displayName}'; tool not executed.`,
          };
        }

        if (result === 'deny') {
          log(`[ClaudeAgentRunner] Tool '${toolName}' denied by user`);
          return { block: true, reason: `User denied permission for '${displayName}'.` };
        }

        if (result === 'allow_always') {
          rememberAlwaysAllow(sessionId, toolName);
        }
      }

      return sdkBeforeToolCall ? sdkBeforeToolCall(ctx, signal) : undefined;
    }
  );

  log(
    `[ClaudeAgentRunner] Permission hook installed on session ${sessionId} via agent.setBeforeToolCall`
  );
}

function isSudoCommand(command: string): boolean {
  return /\bsudo\b/.test(command);
}

/**
 * Wrap the bash tool to intercept sudo commands and request passwords.
 */
export function wrapBashToolForSudo(
  tools: ToolDefinition[],
  sessionId: string,
  effectiveCwd: string,
  requestSudoPassword:
    | ((sessionId: string, toolUseId: string, command: string) => Promise<string | null>)
    | undefined
): ToolDefinition[] {
  if (!requestSudoPassword) return tools;

  return tools.map((tool) => {
    if (tool.name !== 'bash') return tool;

    const originalExecute = tool.execute;
    return {
      ...tool,
      execute: async (
        toolCallId: string,
        params: { command: string; timeout?: number },
        signal: AbortSignal | undefined,
        onUpdate: ((update: unknown) => void) | undefined,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ctx: any
      ) => {
        const command = params.command;

        if (isSudoCommand(command)) {
          log('[ClaudeAgentRunner] Sudo command detected, requesting password');
          const password = await requestSudoPassword(sessionId, toolCallId, command);

          if (!password) {
            log('[ClaudeAgentRunner] Sudo password cancelled by user');
            return {
              content: [
                { type: 'text' as const, text: 'Command cancelled: user denied sudo password.' },
              ],
              details: undefined as unknown,
            };
          }

          const rewrittenCommand = command.replace(/\bsudo\b(?!\s+-S)/g, 'sudo -S');

          log(
            '[ClaudeAgentRunner] Executing sudo command with password injection (via stdin pipe)'
          );
          try {
            const shell = process.platform === 'win32' ? 'cmd.exe' : '/bin/sh';
            const shellArgs =
              process.platform === 'win32' ? ['/c', rewrittenCommand] : ['-c', rewrittenCommand];
            const timeoutMs = (params.timeout ?? 120) * 1000;
            const output = await new Promise<string>((resolve, reject) => {
              const child = spawn(shell, shellArgs, {
                stdio: ['pipe', 'pipe', 'pipe'],
                cwd: effectiveCwd,
              });
              let stdout = '';
              let stderr = '';
              const timer = setTimeout(() => {
                child.kill('SIGKILL');
                reject(new Error(`Sudo command timed out after ${timeoutMs}ms`));
              }, timeoutMs);
              child.stdout.on('data', (chunk: Buffer) => {
                stdout += chunk.toString();
              });
              child.stderr.on('data', (chunk: Buffer) => {
                stderr += chunk.toString();
              });
              child.on('error', (err) => {
                clearTimeout(timer);
                reject(err);
              });
              child.on('close', () => {
                clearTimeout(timer);
                resolve(stdout + stderr);
              });
              child.stdin.write(password + '\n');
              child.stdin.end();
            });
            return {
              content: [{ type: 'text' as const, text: output || '(no output)' }],
              details: undefined as unknown,
            };
          } catch (sudoErr) {
            logError('[ClaudeAgentRunner] Sudo command failed:', sudoErr);
            throw sudoErr instanceof Error ? sudoErr : new Error(String(sudoErr));
          }
        }

        return originalExecute(toolCallId, params, signal, onUpdate, ctx);
      },
    } as ToolDefinition;
  });
}

/**
 * Inject a default timeout when the model omits one on bash commands.
 */
export function wrapBashToolWithDefaultTimeout(tools: ToolDefinition[]): ToolDefinition[] {
  const DEFAULT_BASH_TIMEOUT_SECONDS = 120;

  return tools.map((tool) => {
    if (tool.name !== 'bash') return tool;

    const originalExecute = tool.execute;
    return {
      ...tool,
      execute: async (
        toolCallId: string,
        params: { command: string; timeout?: number },
        signal: AbortSignal | undefined,
        onUpdate: ((update: unknown) => void) | undefined,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ctx: any
      ) => {
        const effectiveParams =
          params.timeout != null ? params : { ...params, timeout: DEFAULT_BASH_TIMEOUT_SECONDS };
        return originalExecute(toolCallId, effectiveParams, signal, onUpdate, ctx);
      },
    } as ToolDefinition;
  });
}

type PiSessionModel = Parameters<PiAgentSession['setModel']>[0];
type PiThinkingLevel = NonNullable<Parameters<PiAgentSession['setThinkingLevel']>[0]>;
type PiAuthStorage = Parameters<typeof ModelRegistry.create>[0];

interface ReuseCachedPiSessionOptions {
  cachedSession?: CachedPiSession;
  piModel: PiSessionModel;
  thinkingLevel: PiThinkingLevel;
  sessionId: string;
}

export async function reuseCachedPiSession({
  cachedSession,
  piModel,
  thinkingLevel,
  sessionId,
}: ReuseCachedPiSessionOptions): Promise<{
  piSession: PiAgentSession;
  cachedSession: CachedPiSession;
  compactionEnabled: boolean;
} | null> {
  if (!cachedSession) {
    return null;
  }

  const piSession = cachedSession.session;
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
    cachedSession.session.setThinkingLevel(thinkingLevel);
    cachedSession.thinkingLevel = thinkingLevel;
  }

  logCtx('[ClaudeAgentRunner] Reusing cached pi session for:', sessionId);
  return { piSession, cachedSession, compactionEnabled: cachedSession.compactionEnabled ?? true };
}

const RESOURCE_LOADER_RELOAD_TIMEOUT_MS = 90_000;

async function reloadResourceLoaderWithTimeout(
  resourceLoader: { reload: () => Promise<void> },
  promptTemplatePaths: string[]
): Promise<void> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      resourceLoader.reload(),
      new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(
            new Error(
              `resourceLoader.reload() timed out after ${RESOURCE_LOADER_RELOAD_TIMEOUT_MS}ms (promptTemplatePaths=${promptTemplatePaths.length})`
            )
          );
        }, RESOURCE_LOADER_RELOAD_TIMEOUT_MS);
      }),
    ]);
  } catch (error) {
    logWarn('[ClaudeAgentRunner] Resource loader reload failed:', error);
    throw error;
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

interface CreatePiSessionOptions {
  ctx: AgentRunnerRunContext;
  sessionId: string;
  provider: string;
  piModel: PiSessionModel;
  thinkingLevel: PiThinkingLevel;
  authStorage: PiAuthStorage;
  customTools: ToolDefinition[];
  skillPaths: string[];
  promptTemplatePaths: string[];
  coworkAppendPrompt: string[];
  effectiveCwd: string;
  sessionRuntimeSignature: string;
  skillsSignature: string;
  promptPrefix?: string;
  modelContextWindow: number;
  modelMaxTokens: number;
}

export async function createPiSession({
  ctx,
  sessionId,
  provider,
  piModel,
  thinkingLevel,
  authStorage,
  customTools,
  skillPaths,
  promptTemplatePaths,
  coworkAppendPrompt,
  effectiveCwd,
  sessionRuntimeSignature,
  skillsSignature,
  promptPrefix,
  modelContextWindow,
  modelMaxTokens,
}: CreatePiSessionOptions): Promise<{ piSession: PiAgentSession; compactionEnabled: boolean }> {
  const resourceLoader = new DefaultResourceLoader({
    cwd: effectiveCwd,
    agentDir: getAgentDir(),
    additionalSkillPaths: skillPaths,
    additionalPromptTemplatePaths: promptTemplatePaths,
    appendSystemPrompt: coworkAppendPrompt,
  });
  await reloadResourceLoaderWithTimeout(resourceLoader, promptTemplatePaths);

  const compactionSettings = buildCompactionSettings(
    provider,
    modelContextWindow,
    modelMaxTokens,
    estimateTokensFromText(promptPrefix || '')
  );
  if (!compactionSettings.enabled) {
    log('[ClaudeAgentRunner] Auto-compaction disabled (contextWindow:', modelContextWindow, ')');
  } else {
    log('[ClaudeAgentRunner] Compaction settings:', JSON.stringify(compactionSettings));
  }

  const { session: piSession } = await createAgentSession({
    model: piModel,
    thinkingLevel,
    authStorage,
    modelRegistry: ModelRegistry.create(authStorage),
    customTools,
    sessionManager: PiSessionManager.inMemory(),
    settingsManager: PiSettingsManager.inMemory({
      compaction: compactionSettings,
      retry: { enabled: true, maxRetries: 2 },
    }),
    resourceLoader,
    cwd: effectiveCwd,
  });

  installPermissionHook(piSession, sessionId, ctx.requestPermission, (toolName) =>
    ctx.getToolDisplayName(toolName)
  );
  evictOldestPiSession(ctx.piSessions);
  ctx.piSessions.set(sessionId, {
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
      const ollamaNumCtx = { value: piModel.contextWindow || 128000 };
      agent._onPayload = async (payload: Record<string, unknown>, modelArg: unknown) => {
        let result = originalOnPayload
          ? await originalOnPayload.call(agent, payload, modelArg)
          : payload;
        if (result === undefined) {
          result = payload;
        }
        return { ...result, num_ctx: ollamaNumCtx.value };
      };
      ctx.piSessions.get(sessionId)!.ollamaNumCtx = ollamaNumCtx;
      log('[ClaudeAgentRunner] Ollama _onPayload wrapper installed, num_ctx:', ollamaNumCtx.value);
    }
  }

  return { piSession, compactionEnabled: compactionSettings.enabled };
}
