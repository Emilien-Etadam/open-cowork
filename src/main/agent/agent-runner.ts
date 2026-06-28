/**
 * @module main/agent/agent-runner
 *
 * Agent runner entrypoint and long-lived runner state.
 */
import type { Message, QuestionItem, ServerEvent, Session } from '../../renderer/types';
import { PathResolver } from '../sandbox/path-resolver';
import { MCPManager } from '../mcp/mcp-manager';
import { log, logCtx } from '../utils/logger';
import { PluginRuntimeService } from '../skills/plugin-runtime-service';
import type { SkillsAdapter } from '../skills/skills-adapter';
import { AgentRuntimeExtensionManager } from '../extensions/agent-runtime-extension-manager';
import { configStore } from '../config/config-store';
import {
  buildConversationTranscriptForHandoff,
  buildHandoffSummaryUserPrompt,
  HANDOFF_SUMMARY_SYSTEM_PROMPT,
} from '../../shared/compaction-handoff';
import { runPiAiOneShot } from './pi-ai-one-shot';
import { mt } from '../i18n';
import { serializeMessageContentForHistory } from './agent-runner-history';
export { serializeMessageContentForHistory } from './agent-runner-history';
import {
  type CachedPiSession,
  disposeCachedPiSession,
  resolveToolDisplayName,
} from './agent-runner-pi-session';
import { getLastInputTokenCount, estimateTokensFromText } from './context-budget';
import { AgentRunnerRenderer } from './agent-runner-renderer-events';
import { AgentRunnerSkillsPaths } from './agent-runner-skills-paths';
import { executeAgentRun } from './agent-runner-run';

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
  requestUserQuestion?: (
    sessionId: string,
    toolUseId: string,
    questions: QuestionItem[]
  ) => Promise<string>;
}

/**
 * AgentRunner - Uses @earendil-works/pi-coding-agent SDK
 *
 * Environment variables should be set before running:
 *   ANTHROPIC_BASE_URL=https://openrouter.ai/api
 *   ANTHROPIC_AUTH_TOKEN=your_openrouter_api_key
 *   ANTHROPIC_API_KEY="" (must be empty)
 */
export class AgentRunner {
  private readonly renderer: AgentRunnerRenderer;
  private readonly pathResolver: PathResolver;
  private readonly mcpManager?: MCPManager;
  private readonly extensionManager?: AgentRuntimeExtensionManager;
  private readonly requestSudoPassword?: (
    sessionId: string,
    toolUseId: string,
    command: string
  ) => Promise<string | null>;
  private readonly requestPermission?: (
    sessionId: string,
    toolUseId: string,
    toolName: string,
    input: Record<string, unknown>
  ) => Promise<'allow' | 'deny' | 'allow_always'>;
  private readonly requestUserQuestion?: (
    sessionId: string,
    toolUseId: string,
    questions: QuestionItem[]
  ) => Promise<string>;
  private readonly skillsPaths: AgentRunnerSkillsPaths;
  private readonly activeControllers: Map<string, AbortController> = new Map();
  private readonly piSessions: Map<string, CachedPiSession> = new Map();
  private readonly toolDisplayNameCache: Map<string, string> = new Map();
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
      log('[AgentRunner] Disposed pi session for:', sessionId);
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
    this.skillsPaths.invalidatePluginPathsCache();
  }

  /** Call after the user changes MCP server config so the next query rebuilds mcpServers. */
  invalidateMcpServersCache(): void {
    this._mcpServersCache = null;
    log('[AgentRunner] MCP servers cache invalidated — tools will rebuild on next query');
  }

  constructor(
    options: AgentRunnerOptions,
    pathResolver: PathResolver,
    mcpManager?: MCPManager,
    pluginRuntimeService?: PluginRuntimeService,
    skillsAdapter?: SkillsAdapter,
    extensionManager?: AgentRuntimeExtensionManager
  ) {
    this.renderer = new AgentRunnerRenderer(options.sendToRenderer, options.saveMessage);
    this.pathResolver = pathResolver;
    this.mcpManager = mcpManager;
    this.extensionManager = extensionManager;
    this.requestSudoPassword = options.requestSudoPassword;
    this.requestPermission = options.requestPermission;
    this.requestUserQuestion = options.requestUserQuestion;
    this.skillsPaths = new AgentRunnerSkillsPaths({
      skillsAdapter,
      pluginRuntimeService,
      sendToRenderer: (event) => this.renderer.dispatch(event),
    });

    log('[AgentRunner] Initialized with Lygodactylus agent SDK');
    log('[AgentRunner] Skills enabled: settingSources=[user, project], Skill tool enabled');
    if (mcpManager) {
      log('[AgentRunner] MCP support enabled');
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
    logCtx('[AgentRunner] Current model:', model);
    logCtx(
      '[AgentRunner] Model source:',
      routeModel ? 'runtimeRoute.model' : configuredModel ? 'configStore.model' : 'default'
    );
    return model;
  }

  async run(session: Session, prompt: string, existingMessages: Message[]): Promise<void> {
    return executeAgentRun(
      {
        renderer: this.renderer,
        pathResolver: this.pathResolver,
        mcpManager: this.mcpManager,
        extensionManager: this.extensionManager,
        activeControllers: this.activeControllers,
        piSessions: this.piSessions,
        requestSudoPassword: this.requestSudoPassword,
        requestPermission: this.requestPermission,
        requestUserQuestion: this.requestUserQuestion,
        skillsPaths: this.skillsPaths,
        getToolDisplayName: (toolName) => this.getToolDisplayName(toolName),
        getCurrentModelString: (preferredModel) => this.getCurrentModelString(preferredModel),
        getMcpServersCache: () => this._mcpServersCache,
        setMcpServersCache: (cache) => {
          this._mcpServersCache = cache;
        },
        isSkillsSetupDone: () => this._skillsSetupDone,
        setSkillsSetupDone: (value) => {
          this._skillsSetupDone = value;
        },
      },
      session,
      prompt,
      existingMessages
    );
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

    this.renderer.sendSessionNotice(session.id, mt('noticeCompactionStart'), 'info');

    try {
      const result = await cached.session.compact(customInstructions);
      this.renderer.sendSessionNotice(session.id, mt('noticeCompactionCompleted'), 'success');
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
      this.renderer.sendSessionNotice(
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

    this.renderer.sendSessionNotice(session.id, mt('noticeHandoffStart'), 'info');

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
      this.renderer.sendSessionNotice(
        session.id,
        mt('noticeHandoffFailed', { error: message }),
        'warning'
      );
      throw new Error('errHandoffFailed');
    }
  }
}
