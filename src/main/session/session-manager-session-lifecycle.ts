import { v4 as uuidv4 } from 'uuid';
import type { Session } from '../../renderer/types';
import { configStore } from '../config/config-store';
import { forgetSessionPermissions } from '../config/permission-rules-store';
import {
  getSandboxAdapter,
  initializeSandbox,
  reinitializeSandbox,
} from '../sandbox/sandbox-adapter';
import { SandboxSync } from '../sandbox/sandbox-sync';
import { log, logError, logWarn } from '../utils/logger';
import type { SessionManagerFacadeSupportDeps } from './session-manager-facade-support';

type UpdateSessionStatus = (sessionId: string, status: Session['status']) => void;
type StopSession = (sessionId: string) => void;

export async function reloadSandbox(deps: SessionManagerFacadeSupportDeps): Promise<void> {
  try {
    log('[SessionManager] Reinitializing sandbox adapter...');
    await reinitializeSandbox();
    deps.setSandboxAdapter(getSandboxAdapter());
    log('[SessionManager] Sandbox adapter reinitialized, mode:', deps.getSandboxAdapter().mode);
  } catch (error) {
    logError('[SessionManager] Failed to reinitialize sandbox:', error);
  }
}

export function createSession(
  deps: SessionManagerFacadeSupportDeps,
  title: string,
  cwd?: string,
  allowedTools?: string[],
  memoryEnabled?: boolean
): Session {
  const now = Date.now();
  const envCwd = process.env.COWORK_WORKDIR || process.env.WORKDIR || process.env.DEFAULT_CWD;
  const effectiveCwd = cwd || envCwd;
  const resolvedMemoryEnabled =
    typeof memoryEnabled === 'boolean' ? memoryEnabled : configStore.get('memoryEnabled') !== false;

  return {
    id: uuidv4(),
    title,
    status: 'idle',
    cwd: effectiveCwd,
    mountedPaths: effectiveCwd
      ? [{ virtual: deps.workspaceMountVirtualPath, real: effectiveCwd }]
      : [],
    allowedTools: allowedTools || [
      'askuserquestion',
      'todowrite',
      'todoread',
      'webfetch',
      'websearch',
      'read',
      'write',
      'edit',
      'list_directory',
      'glob',
      'grep',
    ],
    memoryEnabled: resolvedMemoryEnabled,
    model: configStore.get('model') || undefined,
    createdAt: now,
    updatedAt: now,
  };
}

export function stopSession(
  deps: SessionManagerFacadeSupportDeps,
  sessionId: string,
  updateSessionStatus: UpdateSessionStatus
): void {
  log('[SessionManager] Stopping session:', sessionId);
  deps.titleGenerationTokens.delete(sessionId);
  deps.getAgentRunner().cancel(sessionId);

  for (const [toolUseId, entry] of deps.pendingSudoPasswords) {
    if (entry.sessionId !== sessionId) {
      continue;
    }
    entry.resolve(null);
    deps.pendingSudoPasswords.delete(toolUseId);
    deps.sendToRenderer({ type: 'sudo.password.dismiss', payload: { toolUseId } });
  }

  deps.activeSessions.get(sessionId)?.abort();
  deps.promptQueues.delete(sessionId);
  deps.store.clearMessageCache(sessionId);
  updateSessionStatus(sessionId, 'idle');
}

export async function deleteSession(
  deps: SessionManagerFacadeSupportDeps,
  stop: StopSession,
  sessionId: string
): Promise<void> {
  const existingSession = deps.loadSession(sessionId);
  stop(sessionId);

  if (SandboxSync.hasSession(sessionId)) {
    log('[SessionManager] Cleaning up sandbox for session:', sessionId);
    try {
      await SandboxSync.syncAndCleanup(sessionId);
      log('[SessionManager] Sandbox cleanup complete for session:', sessionId);
    } catch (error) {
      logError('[SessionManager] Failed to cleanup sandbox:', error);
    }
  }

  deps.db.sessions.delete(sessionId);
  deps.store.clearMessageCache(sessionId);
  deps.sessionTitleAttempts.delete(sessionId);
  deps.titleGenerationTokens.delete(sessionId);

  if (deps.extensionManager) {
    await deps.extensionManager.onSessionDeleted({ sessionId, session: existingSession });
  }
  forgetSessionPermissions(sessionId);
  log('[SessionManager] Session deleted:', sessionId);
}

export async function batchDeleteSessions(
  deps: SessionManagerFacadeSupportDeps,
  stop: StopSession,
  sessionIds: string[]
): Promise<void> {
  const sessionsById = new Map(
    sessionIds.map((sessionId) => [sessionId, deps.loadSession(sessionId)] as const)
  );

  for (const sessionId of sessionIds) {
    stop(sessionId);
    if (!SandboxSync.hasSession(sessionId)) {
      continue;
    }
    try {
      await SandboxSync.syncAndCleanup(sessionId);
    } catch (error) {
      logError('[SessionManager] Failed to cleanup sandbox during batch delete:', error);
    }
  }

  deps.db.raw.transaction(() => {
    for (const sessionId of sessionIds) {
      deps.db.sessions.delete(sessionId);
      deps.store.clearMessageCache(sessionId);
      deps.sessionTitleAttempts.delete(sessionId);
      deps.titleGenerationTokens.delete(sessionId);
      forgetSessionPermissions(sessionId);
    }
  })();

  if (deps.extensionManager) {
    for (const sessionId of sessionIds) {
      await deps.extensionManager.onSessionDeleted({
        sessionId,
        session: sessionsById.get(sessionId) || null,
      });
    }
  }

  log('[SessionManager] Batch deleted sessions:', sessionIds.length);
}

export function updateSessionCwd(
  deps: SessionManagerFacadeSupportDeps,
  stop: StopSession,
  sessionId: string,
  cwd: string
): void {
  if (deps.activeSessions.has(sessionId)) {
    logWarn(
      '[SessionManager] CWD change requested while session running; stopping active run first',
      { sessionId, cwd }
    );
    stop(sessionId);
  }

  const mountedPaths = cwd ? [{ virtual: deps.workspaceMountVirtualPath, real: cwd }] : [];
  deps.db.sessions.update(sessionId, {
    cwd,
    mounted_paths: JSON.stringify(mountedPaths),
    claude_session_id: null,
    openai_thread_id: null,
    updated_at: Date.now(),
  });
  deps.getAgentRunner().clearSdkSession?.(sessionId);
  deps.sendToRenderer({
    type: 'session.update',
    payload: { sessionId, updates: { cwd, mountedPaths } },
  });
  log('[SessionManager] Session cwd updated:', sessionId, '->', cwd, '(SDK session cleared)');
}

export async function ensureSandboxInitialized(
  deps: SessionManagerFacadeSupportDeps,
  session: Session
): Promise<void> {
  if (!session.cwd) {
    log('[SessionManager] No workspace directory, skipping sandbox init');
    return;
  }

  const sandboxAdapter = deps.getSandboxAdapter();
  if (sandboxAdapter.initialized && sandboxAdapter.workspacePath === session.cwd) {
    return;
  }

  const existingPromise = deps.sandboxInitPromises.get(session.cwd);
  if (existingPromise) {
    await existingPromise;
    return;
  }

  const initPromise = initializeSandbox({ workspacePath: session.cwd, mainWindow: null }).then(
    () => undefined
  );
  deps.sandboxInitPromises.set(session.cwd, initPromise);

  try {
    await initPromise;
    log('[SessionManager] Sandbox initialized for workspace:', session.cwd);
    log('[SessionManager] Sandbox mode:', deps.getSandboxAdapter().mode);
  } catch (error) {
    logError('[SessionManager] Failed to initialize sandbox:', error);
    deps.sendToRenderer({
      type: 'error',
      payload: {
        message: `Failed to initialize sandbox: ${error instanceof Error ? error.message : String(error)}`,
      },
    });
  } finally {
    deps.sandboxInitPromises.delete(session.cwd);
  }
}
