import type {
  ContentBlock,
  Message,
  PermissionResult,
  ServerEvent,
  Session,
  TraceStep,
} from '../../renderer/types';
import type { DatabaseInstance } from '../db/database';
import { AgentRunner as AgentRunnerImpl } from '../agent/agent-runner';
import { generateTitleWithPiAi } from '../agent/pi-ai-one-shot';
import { configStore } from '../config/config-store';
import { AgentRuntimeExtensionManager } from '../extensions/agent-runtime-extension-manager';
import { mcpConfigStore } from '../mcp/mcp-config-store';
import { MCPManager } from '../mcp/mcp-manager';
import { PathResolver } from '../sandbox/path-resolver';
import { SandboxAdapter, getSandboxAdapter } from '../sandbox/sandbox-adapter';
import { PluginRuntimeService } from '../skills/plugin-runtime-service';
import { log, logError } from '../utils/logger';
import { processFileAttachments } from './session-manager-attachments';
import {
  SessionManagerFacadeSupport,
  type SessionManagerFacadeAgentRunner,
} from './session-manager-facade-support';
import {
  enqueuePrompt as enqueueSessionPrompt,
  processPrompt as processSessionPrompt,
  processQueue as processSessionQueue,
  type PromptQueues,
} from './session-manager-queue';
import { SessionManagerStore } from './session-manager-store';
import {
  buildTitlePrompt,
  getDefaultTitleFromPrompt,
  normalizeGeneratedTitle,
} from './session-title-utils';
import { buildScheduledTaskTitle } from '../../shared/schedule/task-title';

const WORKSPACE_MOUNT_VIRTUAL_PATH = '/mnt/workspace';
type AgentRunner = SessionManagerFacadeAgentRunner;

export class SessionManager {
  private readonly store: SessionManagerStore;
  private readonly facadeSupport: SessionManagerFacadeSupport;
  private readonly sendToRenderer: (event: ServerEvent) => void;
  private readonly pathResolver = new PathResolver();
  private readonly mcpManager = new MCPManager();
  private sandboxAdapter: SandboxAdapter = getSandboxAdapter();
  private agentRunner!: AgentRunner;
  private readonly activeSessions = new Map<string, AbortController>();
  private readonly promptQueues: PromptQueues = new Map();
  private readonly pendingPermissions = new Map<string, (result: PermissionResult) => void>();
  private readonly pendingSudoPasswords = new Map<
    string,
    { sessionId: string; resolve: (password: string | null) => void }
  >();
  private readonly sandboxInitPromises = new Map<string, Promise<void>>();
  private readonly sessionTitleAttempts = new Set<string>();
  private readonly titleGenerationTokens = new Map<string, symbol>();

  constructor(
    db: DatabaseInstance,
    sendToRenderer: (event: ServerEvent) => void,
    private readonly pluginRuntimeService?: PluginRuntimeService,
    private readonly extensionManager?: AgentRuntimeExtensionManager
  ) {
    this.store = new SessionManagerStore(db);
    this.store.resetStaleRunningSessions();
    this.sendToRenderer = (event) => {
      if (event.type === 'trace.step') {
        this.store.saveTraceStep(event.payload.sessionId, event.payload.step);
      }
      if (event.type === 'trace.update') {
        this.store.updateTraceStep(event.payload.stepId, event.payload.updates);
      }
      sendToRenderer(event);
    };
    this.facadeSupport = new SessionManagerFacadeSupport({
      db,
      store: this.store,
      sendToRenderer: this.sendToRenderer,
      getAgentRunner: () => this.agentRunner,
      activeSessions: this.activeSessions,
      promptQueues: this.promptQueues,
      pendingSudoPasswords: this.pendingSudoPasswords,
      sandboxInitPromises: this.sandboxInitPromises,
      sessionTitleAttempts: this.sessionTitleAttempts,
      titleGenerationTokens: this.titleGenerationTokens,
      getSandboxAdapter: () => this.sandboxAdapter,
      setSandboxAdapter: (adapter) => {
        this.sandboxAdapter = adapter;
      },
      loadSession: (sessionId) => this.loadSession(sessionId),
      getMessages: (sessionId) => this.getMessages(sessionId),
      saveMessage: (message) => this.saveMessage(message),
      startSession: (title, prompt, cwd, allowedTools, content, memoryEnabled) =>
        this.startSession(title, prompt, cwd, allowedTools, content, memoryEnabled),
      extensionManager: this.extensionManager,
      workspaceMountVirtualPath: WORKSPACE_MOUNT_VIRTUAL_PATH,
    });

    this.initializeMCP();
    this.createAgentRunner();
    log('[SessionManager] Initialized with persistent database and MCP support');
  }

  private createAgentRunner(): void {
    this.agentRunner = new AgentRunnerImpl(
      {
        sendToRenderer: this.sendToRenderer,
        saveMessage: (message) => this.saveMessage(message),
        requestSudoPassword: (sessionId, toolUseId, command) =>
          this.requestSudoPassword(sessionId, toolUseId, command),
        requestPermission: (sessionId, toolUseId, toolName, input) =>
          this.requestPermission(sessionId, toolUseId, toolName, input),
      },
      this.pathResolver,
      this.mcpManager,
      this.pluginRuntimeService,
      undefined,
      this.extensionManager
    );
    log('[SessionManager] Using Lygodactylus agent runner');
  }

  reloadConfig(): void {
    log('[SessionManager] API config changed — will apply on next query');
  }

  async reloadMCP(): Promise<void> {
    log('[SessionManager] Reloading MCP servers');
    await this.initializeMCP();
  }

  invalidateMcpServersCache(): void {
    if ('invalidateMcpServersCache' in this.agentRunner) {
      (this.agentRunner as AgentRunnerImpl).invalidateMcpServersCache();
    }
  }

  invalidateSkillsSetup(): void {
    if ('invalidateSkillsSetup' in this.agentRunner) {
      (this.agentRunner as AgentRunnerImpl).invalidateSkillsSetup();
    }
  }

  async reloadSandbox(): Promise<void> {
    await this.facadeSupport.reloadSandbox();
  }

  private async initializeMCP(): Promise<void> {
    try {
      await this.mcpManager.ensureNodeRuntimeReady();
      if (process.platform === 'darwin' || process.platform === 'linux') {
        await this.mcpManager.ensureGuiRuntimeReady();
      }
      const servers = mcpConfigStore.getEnabledServers();
      await this.mcpManager.initializeServers(servers);
      log(`[SessionManager] Initialized ${servers.length} MCP servers`);
    } catch (error) {
      logError('[SessionManager] Failed to initialize MCP servers:', error);
      this.sendToRenderer({
        type: 'error',
        payload: {
          message: `Failed to initialize MCP servers: ${error instanceof Error ? error.message : String(error)}`,
        },
      });
    }
  }

  getMCPManager(): MCPManager {
    return this.mcpManager;
  }

  getSandboxAdapter(): SandboxAdapter {
    return this.sandboxAdapter;
  }

  async startSession(
    title: string,
    prompt: string,
    cwd?: string,
    allowedTools?: string[],
    content?: ContentBlock[],
    memoryEnabled?: boolean
  ): Promise<Session> {
    log('[SessionManager] Starting new session:', title);
    const session = this.facadeSupport.createSession(title, cwd, allowedTools, memoryEnabled);
    this.store.saveSession(session);
    this.enqueuePrompt(session, prompt, content);
    return session;
  }

  listSessions(): Session[] {
    return this.store.listSessions();
  }

  async continueSession(
    sessionId: string,
    prompt: string,
    content?: ContentBlock[]
  ): Promise<void> {
    log('[SessionManager] Continuing session:', sessionId);
    const session = this.loadSession(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    this.enqueuePrompt(session, prompt, content);
  }

  async compactSession(
    sessionId: string,
    customInstructions?: string
  ): Promise<{ success: boolean; errorKey?: string; error?: string }> {
    return this.facadeSupport.compactSession(sessionId, customInstructions);
  }

  async handoffSession(
    sessionId: string,
    customInstructions?: string
  ): Promise<{
    success: boolean;
    newSession?: Session;
    initialContent?: ContentBlock[];
    errorKey?: string;
    error?: string;
  }> {
    return this.facadeSupport.handoffSession(sessionId, customInstructions);
  }

  async forkSessionFromMessage(
    sessionId: string,
    messageId: string
  ): Promise<{
    success: boolean;
    newSession?: Session;
    messages?: Message[];
    errorKey?: string;
    error?: string;
  }> {
    return this.facadeSupport.forkSessionFromMessage(sessionId, messageId);
  }

  async rewindSessionForEdit(
    sessionId: string,
    messageId: string
  ): Promise<{
    success: boolean;
    promptText?: string;
    messages?: Message[];
    errorKey?: string;
    error?: string;
  }> {
    return this.facadeSupport.rewindSessionForEdit(sessionId, messageId);
  }

  async generateSessionTitleFromPrompt(prompt: string): Promise<string> {
    const normalizedPrompt = prompt.trim();
    if (!normalizedPrompt) {
      return 'New Session';
    }
    const generated = await this.withTimeout(
      this.generateTitleWithConfig(buildTitlePrompt(normalizedPrompt)),
      20000,
      'session-title-preview'
    );
    return normalizeGeneratedTitle(generated) ?? getDefaultTitleFromPrompt(normalizedPrompt);
  }

  async generateScheduledTaskTitle(prompt: string): Promise<string> {
    return buildScheduledTaskTitle(await this.generateSessionTitleFromPrompt(prompt));
  }

  stopSession(sessionId: string): void {
    this.facadeSupport.stopSession(sessionId);
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.facadeSupport.deleteSession(sessionId);
  }

  async batchDeleteSessions(sessionIds: string[]): Promise<void> {
    await this.facadeSupport.batchDeleteSessions(sessionIds);
  }

  updateSessionCwd(sessionId: string, cwd: string): void {
    this.facadeSupport.updateSessionCwd(sessionId, cwd);
  }

  clearAllCachedAgentSessions(): void {
    this.agentRunner.clearAllSdkSessions?.();
  }

  saveMessage(message: Message): void {
    this.store.saveMessage(message);
  }

  getMessages(sessionId: string): Message[] {
    return this.store.getMessages(sessionId);
  }

  getTraceSteps(sessionId: string): TraceStep[] {
    return this.store.getTraceSteps(sessionId);
  }

  handlePermissionResponse(toolUseId: string, result: PermissionResult): void {
    const resolver = this.pendingPermissions.get(toolUseId);
    if (resolver) {
      resolver(result);
      this.pendingPermissions.delete(toolUseId);
    }
  }

  async requestPermission(
    sessionId: string,
    toolUseId: string,
    toolName: string,
    input: Record<string, unknown>
  ): Promise<PermissionResult> {
    return new Promise((resolve) => {
      const timeoutId = setTimeout(() => {
        this.pendingPermissions.delete(toolUseId);
        resolve('deny');
        this.sendToRenderer({ type: 'permission.dismiss', payload: { toolUseId } });
      }, 60_000);

      this.pendingPermissions.set(toolUseId, (result) => {
        clearTimeout(timeoutId);
        resolve(result);
      });
      this.sendToRenderer({
        type: 'permission.request',
        payload: { toolUseId, toolName, input, sessionId },
      });
    });
  }

  async requestSudoPassword(
    sessionId: string,
    toolUseId: string,
    command: string
  ): Promise<string | null> {
    return new Promise((resolve) => {
      const timeoutId = setTimeout(() => {
        this.pendingSudoPasswords.delete(toolUseId);
        resolve(null);
        this.sendToRenderer({ type: 'sudo.password.dismiss', payload: { toolUseId } });
      }, 60_000);

      this.pendingSudoPasswords.set(toolUseId, {
        sessionId,
        resolve: (password) => {
          clearTimeout(timeoutId);
          resolve(password);
        },
      });
      this.sendToRenderer({
        type: 'sudo.password.request',
        payload: { toolUseId, command, sessionId },
      });
    });
  }

  handleSudoPasswordResponse(toolUseId: string, password: string | null): void {
    const entry = this.pendingSudoPasswords.get(toolUseId);
    if (entry) {
      entry.resolve(password);
      this.pendingSudoPasswords.delete(toolUseId);
    }
  }

  private loadSession(sessionId: string): Session | null {
    return this.store.loadSession(sessionId);
  }

  private updateSessionStatus(sessionId: string, status: Session['status']): void {
    this.facadeSupport.updateSessionStatus(sessionId, status);
  }

  private updateSessionModel(session: Session, model: string): void {
    this.facadeSupport.updateSessionModel(session, model);
  }

  private async ensureSandboxInitialized(session: Session): Promise<void> {
    await this.facadeSupport.ensureSandboxInitialized(session);
  }

  private processFileAttachments(
    session: Session,
    content: ContentBlock[]
  ): Promise<ContentBlock[]> {
    return processFileAttachments({ session, content, sendToRenderer: this.sendToRenderer });
  }

  private processPrompt(session: Session, prompt: string, content?: ContentBlock[]): Promise<void> {
    return processSessionPrompt({
      session,
      prompt,
      content,
      agentRunner: this.agentRunner,
      extensionManager: this.extensionManager,
      ensureSandboxInitialized: (currentSession) => this.ensureSandboxInitialized(currentSession),
      processFileAttachments: (currentSession, blocks) =>
        this.processFileAttachments(currentSession, blocks),
      getMessages: (sessionId) => this.getMessages(sessionId),
      saveMessage: (message) => this.saveMessage(message),
      updateSessionModel: (currentSession, model) => this.updateSessionModel(currentSession, model),
      sendToRenderer: this.sendToRenderer,
      runSessionTitleGeneration: (currentSession, currentPrompt, existingMessages) =>
        this.facadeSupport.runSessionTitleGeneration(
          currentSession,
          currentPrompt,
          existingMessages
        ),
    });
  }

  private enqueuePrompt(session: Session, prompt: string, content?: ContentBlock[]): void {
    enqueueSessionPrompt(
      {
        activeSessions: this.activeSessions,
        promptQueues: this.promptQueues,
        processQueue: (queuedSession) => this.processQueue(queuedSession),
        processPrompt: (queuedSession, queuedPrompt, queuedContent) =>
          this.processPrompt(queuedSession, queuedPrompt, queuedContent),
        loadSession: (sessionId) => this.loadSession(sessionId),
        updateSessionStatus: (sessionId, status) => this.updateSessionStatus(sessionId, status),
      },
      session,
      prompt,
      content
    );
  }

  private processQueue(session: Session): Promise<void> {
    return processSessionQueue(
      {
        activeSessions: this.activeSessions,
        promptQueues: this.promptQueues,
        processQueue: (queuedSession) => this.processQueue(queuedSession),
        processPrompt: (queuedSession, queuedPrompt, queuedContent) =>
          this.processPrompt(queuedSession, queuedPrompt, queuedContent),
        loadSession: (sessionId) => this.loadSession(sessionId),
        updateSessionStatus: (sessionId, status) => this.updateSessionStatus(sessionId, status),
      },
      session
    );
  }

  private async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    sessionId: string
  ): Promise<T | null> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        logError('[SessionTitle] Generation timed out', { sessionId, timeoutMs });
        resolve(null);
      }, timeoutMs);
      promise
        .then((value) => {
          clearTimeout(timer);
          resolve(value);
        })
        .catch((error) => {
          clearTimeout(timer);
          logError('[SessionTitle] Generation rejected', { sessionId, error });
          resolve(null);
        });
    });
  }

  private async generateTitleWithConfig(titlePrompt: string): Promise<string | null> {
    return normalizeGeneratedTitle(await generateTitleWithPiAi(titlePrompt, configStore.getAll()));
  }
}
