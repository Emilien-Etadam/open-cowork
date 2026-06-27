import type { ContentBlock, Message, ServerEvent, Session } from '../../renderer/types';
import { buildScheduledTaskTitle } from '../../shared/schedule/task-title';
import { generateTitleWithPiAi } from '../agent/pi-ai-one-shot';
import { configStore } from '../config/config-store';
import type { DatabaseInstance } from '../db/database';
import type { AgentRuntimeExtensionManager } from '../extensions/agent-runtime-extension-manager';
import type { SandboxAdapter } from '../sandbox/sandbox-adapter';
import { log, logError } from '../utils/logger';
import { compactSession, handoffSession } from './session-manager-compaction';
import { forkSessionFromMessage, rewindSessionForEdit } from './session-manager-message-branch';
import type { PromptQueues, SessionManagerAgentRunner } from './session-manager-queue';
import {
  batchDeleteSessions,
  createSession,
  deleteSession,
  ensureSandboxInitialized,
  reloadSandbox,
  stopSession,
  updateSessionCwd,
} from './session-manager-session-lifecycle';
import { SessionManagerStore } from './session-manager-store';
import { maybeGenerateSessionTitle } from './session-title-flow';
import {
  buildTitlePrompt,
  getDefaultTitleFromPrompt,
  normalizeGeneratedTitle,
} from './session-title-utils';

const TITLE_GENERATION_TIMEOUT_MS = 20000;

export interface SessionManagerFacadeAgentRunner extends SessionManagerAgentRunner {
  cancel(sessionId: string): void;
  compactSession?(
    session: Session,
    customInstructions?: string
  ): Promise<{ summary: string; tokensBefore: number }>;
  summarizeForHandoff?(
    session: Session,
    messages: Message[],
    customInstructions?: string
  ): Promise<{ summary: string; tokensBefore: number }>;
  clearSdkSession?(sessionId: string): void;
  clearAllSdkSessions?(): void;
}

export interface SessionManagerFacadeSupportDeps {
  db: DatabaseInstance;
  store: SessionManagerStore;
  sendToRenderer: (event: ServerEvent) => void;
  getAgentRunner: () => SessionManagerFacadeAgentRunner;
  activeSessions: Map<string, AbortController>;
  promptQueues: PromptQueues;
  pendingSudoPasswords: Map<
    string,
    { sessionId: string; resolve: (password: string | null) => void }
  >;
  sandboxInitPromises: Map<string, Promise<void>>;
  sessionTitleAttempts: Set<string>;
  titleGenerationTokens: Map<string, symbol>;
  getSandboxAdapter: () => SandboxAdapter;
  setSandboxAdapter: (adapter: SandboxAdapter) => void;
  loadSession: (sessionId: string) => Session | null;
  getMessages: (sessionId: string) => Message[];
  saveMessage: (message: Message) => void;
  startSession: (
    title: string,
    prompt: string,
    cwd?: string,
    allowedTools?: string[],
    content?: ContentBlock[],
    memoryEnabled?: boolean
  ) => Promise<Session>;
  extensionManager?: AgentRuntimeExtensionManager;
  workspaceMountVirtualPath: string;
}

export class SessionManagerFacadeSupport {
  constructor(private readonly deps: SessionManagerFacadeSupportDeps) {}

  async reloadSandbox(): Promise<void> {
    await reloadSandbox(this.deps);
  }
  createSession(
    title: string,
    cwd?: string,
    allowedTools?: string[],
    memoryEnabled?: boolean
  ): Session {
    return createSession(this.deps, title, cwd, allowedTools, memoryEnabled);
  }
  async compactSession(sessionId: string, customInstructions?: string) {
    return compactSession(this.deps, (id) => this.stopSession(id), sessionId, customInstructions);
  }
  async handoffSession(sessionId: string, customInstructions?: string) {
    return handoffSession(this.deps, (id) => this.stopSession(id), sessionId, customInstructions);
  }
  async forkSessionFromMessage(sessionId: string, messageId: string) {
    return forkSessionFromMessage(
      this.deps,
      (id) => this.stopSession(id),
      (title, cwd, allowedTools, memoryEnabled) =>
        this.createSession(title, cwd, allowedTools, memoryEnabled),
      sessionId,
      messageId
    );
  }
  async rewindSessionForEdit(sessionId: string, messageId: string) {
    return rewindSessionForEdit(this.deps, (id) => this.stopSession(id), sessionId, messageId);
  }
  stopSession(sessionId: string): void {
    stopSession(this.deps, sessionId, (id, status) => this.updateSessionStatus(id, status));
  }
  async deleteSession(sessionId: string): Promise<void> {
    await deleteSession(this.deps, (id) => this.stopSession(id), sessionId);
  }
  async batchDeleteSessions(sessionIds: string[]): Promise<void> {
    await batchDeleteSessions(this.deps, (id) => this.stopSession(id), sessionIds);
  }
  updateSessionCwd(sessionId: string, cwd: string): void {
    updateSessionCwd(this.deps, (id) => this.stopSession(id), sessionId, cwd);
  }

  updateSessionStatus(sessionId: string, status: Session['status']): void {
    this.deps.db.sessions.update(sessionId, { status, updated_at: Date.now() });
    this.deps.sendToRenderer({ type: 'session.status', payload: { sessionId, status } });
  }

  updateSessionModel(session: Session, model: string): void {
    session.model = model;
    this.deps.db.sessions.update(session.id, { model });
    this.deps.sendToRenderer({
      type: 'session.update',
      payload: { sessionId: session.id, updates: { model } },
    });
  }

  async ensureSandboxInitialized(session: Session): Promise<void> {
    await ensureSandboxInitialized(this.deps, session);
  }

  async generateSessionTitleFromPrompt(prompt: string): Promise<string> {
    const normalizedPrompt = prompt.trim();
    if (!normalizedPrompt) {
      return 'New Session';
    }
    const generated = await this.withTimeout(
      this.generateTitleWithConfig(buildTitlePrompt(normalizedPrompt)),
      TITLE_GENERATION_TIMEOUT_MS,
      'session-title-preview'
    );
    return normalizeGeneratedTitle(generated) ?? getDefaultTitleFromPrompt(normalizedPrompt);
  }

  async generateScheduledTaskTitle(prompt: string): Promise<string> {
    return buildScheduledTaskTitle(await this.generateSessionTitleFromPrompt(prompt));
  }

  async runSessionTitleGeneration(
    session: Session,
    prompt: string,
    existingMessages: Message[]
  ): Promise<void> {
    const token = Symbol(`title:${session.id}`);
    this.deps.titleGenerationTokens.set(session.id, token);
    const shouldAbort = () =>
      this.deps.titleGenerationTokens.get(session.id) !== token ||
      !this.deps.db.sessions.get(session.id);

    try {
      await maybeGenerateSessionTitle({
        sessionId: session.id,
        prompt,
        userMessageCount: existingMessages.filter((message) => message.role === 'user').length + 1,
        currentTitle: session.title,
        hasAttempted: this.deps.sessionTitleAttempts.has(session.id),
        generateTitle: async (titlePrompt) => {
          if (shouldAbort()) {
            return null;
          }
          const title = await this.withTimeout(
            this.generateTitleWithConfig(titlePrompt),
            TITLE_GENERATION_TIMEOUT_MS,
            session.id
          );
          return normalizeGeneratedTitle(title);
        },
        getLatestTitle: () => this.deps.db.sessions.get(session.id)?.title ?? null,
        markAttempt: () => this.deps.sessionTitleAttempts.add(session.id),
        updateTitle: async (title) => {
          if (shouldAbort()) {
            log('[SessionTitle] Skip update: session no longer active', session.id);
            return false;
          }
          const updated = this.updateSessionTitle(session.id, title);
          if (updated) {
            session.title = title;
          }
          return updated;
        },
        shouldAbort,
        log,
      });
    } catch (error) {
      logError('[SessionTitle] Unexpected error', session.id, error);
    } finally {
      if (this.deps.titleGenerationTokens.get(session.id) === token) {
        this.deps.titleGenerationTokens.delete(session.id);
      }
    }
  }

  private updateSessionTitle(sessionId: string, title: string): boolean {
    if (!this.deps.db.sessions.get(sessionId)) {
      log('[SessionTitle] Skip title update for deleted session:', sessionId);
      return false;
    }
    this.deps.db.sessions.update(sessionId, { title });
    this.deps.sendToRenderer({
      type: 'session.update',
      payload: { sessionId, updates: { title } },
    });
    return true;
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
    return normalizeGeneratedTitle(
      await generateTitleWithPiAi(titlePrompt, configStore.getAll())
    );
  }
}
