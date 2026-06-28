import { useEffect, useCallback } from 'react';
import { useAppStore } from '../store';
import type {
  AppConfig,
  ClientEvent,
  ServerEvent,
  PermissionResult,
  Session,
  Message,
  TraceStep,
  ContentBlock,
} from '../types';
import i18n from '../i18n/config';
import { createIpcStreamBatching } from './use-ipc-stream-batching';

// Check if running in Electron
const isElectron = typeof window !== 'undefined' && window.electronAPI !== undefined;

// Module-level singleton guard so only the FIRST useIPC() caller installs the
// server-event listener. Other callers (PermissionDialog, Sidebar, ChatView,
// etc.) still get the callback API but must NOT re-register the listener —
// the preload's `on()` is a "single-slot" bridge and re-registering (or
// unmounting a subsequent useIPC caller) tears down the single shared
// listener, silently dropping subsequent events from main.
let ipcListenerInstalled = false;

export function useIPC() {
  // Handle incoming server events - only setup once across all useIPC() callers.
  // See module-level `ipcListenerInstalled` guard above for the full reason.
  useEffect(() => {
    if (!isElectron) {
      console.log('[useIPC] Not in Electron, skipping IPC setup');
      return;
    }

    if (ipcListenerInstalled) {
      // A previous useIPC() caller already installed the shared listener.
      // Do nothing here — and crucially return no cleanup, so unmounting
      // this component does NOT tear down the shared listener.
      return;
    }
    ipcListenerInstalled = true;

    console.log('[useIPC] Setting up IPC listener (once)');

    const streamBatching = createIpcStreamBatching(() => useAppStore.getState());
    const { bufferPartial, bufferThinking, bufferTrace, clearPartial, clearThinking } =
      streamBatching;

    const applyConfigSnapshot = (config: AppConfig, isConfigured: boolean) => {
      const store = useAppStore.getState();
      const isInitialConfigStatus = !store.hasSeenInitialConfigStatus;
      store.setIsConfigured(isConfigured);
      store.setAppConfig(config);
      store.setSettings({
        theme: config.theme || 'light',
      });
      if (isInitialConfigStatus) {
        store.markInitialConfigStatusSeen();
      }
    };

    const cleanup = window.electronAPI.on((event: ServerEvent) => {
      const store = useAppStore.getState();
      console.log('[useIPC] Received event:', event.type);

      try {
        switch (event.type) {
          case 'session.list':
            store.setSessions(event.payload.sessions);
            break;

          case 'session.status':
            store.updateSession(event.payload.sessionId, {
              status: event.payload.status,
            });
            if (event.payload.status !== 'running') {
              store.finishExecutionClock(event.payload.sessionId);
              store.setLoading(false);
              store.clearActiveTurn(event.payload.sessionId);
              store.clearPendingTurns(event.payload.sessionId);
              store.clearQueuedMessages(event.payload.sessionId);
            }
            break;

          case 'session.update':
            store.updateSession(event.payload.sessionId, event.payload.updates);
            break;

          case 'stream.message':
            console.log(
              '[useIPC] stream.message received:',
              event.payload.message.role,
              'content:',
              JSON.stringify(event.payload.message.content)
            );
            // Clear pending partial buffer to prevent RAF from appending stale chunks
            clearPartial(event.payload.sessionId);
            // Clear thinking buffer too — final thinking is in the message content blocks
            clearThinking(event.payload.sessionId);
            store.addMessage(event.payload.sessionId, event.payload.message);
            if (event.payload.message.role === 'assistant') {
              store.clearActiveTurn(event.payload.sessionId);
            }
            break;

          case 'stream.partial':
            bufferPartial(event.payload.sessionId, event.payload.delta);
            break;

          case 'stream.thinking':
            bufferThinking(event.payload.sessionId, event.payload.delta);
            break;

          case 'trace.step': {
            if (event.payload.step.type === 'thinking' && event.payload.step.status === 'running') {
              const currentState = useAppStore.getState();
              const ss = currentState.sessionStates[event.payload.sessionId];
              const pending = ss?.pendingTurns || [];
              const activeTurn = ss?.activeTurn;
              if (pending.length > 0) {
                store.activateNextTurn(event.payload.sessionId, event.payload.step.id);
              } else if (activeTurn) {
                // 绑定真实 stepId，避免 mock stepId 导致无法清理
                store.updateActiveTurnStep(event.payload.sessionId, event.payload.step.id);
              } else {
                const latestUserMessage = [...(ss?.messages ?? [])]
                  .reverse()
                  .find((message) => message.role === 'user');
                if (latestUserMessage) {
                  store.startActiveTurn(
                    event.payload.sessionId,
                    event.payload.step.id,
                    latestUserMessage.id
                  );
                }
              }
            }
            bufferTrace({
              kind: 'add',
              sessionId: event.payload.sessionId,
              step: event.payload.step,
            });
            break;
          }

          case 'trace.update':
            if (
              event.payload.updates.status &&
              (event.payload.updates.status === 'completed' ||
                event.payload.updates.status === 'error')
            ) {
              store.clearActiveTurn(event.payload.sessionId, event.payload.stepId);
            }
            bufferTrace({
              kind: 'update',
              sessionId: event.payload.sessionId,
              stepId: event.payload.stepId,
              updates: event.payload.updates,
            });
            break;

          case 'permission.request':
            store.setPendingPermission(event.payload);
            break;

          case 'permission.dismiss': {
            const currentPermission = useAppStore.getState().pendingPermission;
            if (currentPermission?.toolUseId === event.payload.toolUseId) {
              store.setPendingPermission(null);
            }
            break;
          }

          case 'question.request':
            store.setPendingQuestion(event.payload);
            break;

          case 'question.dismiss': {
            const currentQuestion = useAppStore.getState().pendingQuestion;
            if (currentQuestion?.questionId === event.payload.questionId) {
              store.setPendingQuestion(null);
            }
            break;
          }

          case 'stream.executionTime':
            store.updateMessage(event.payload.sessionId, event.payload.messageId, {
              executionTimeMs: event.payload.executionTimeMs,
            });
            break;

          case 'sudo.password.request':
            store.setPendingSudoPassword(event.payload);
            break;

          case 'sudo.password.dismiss': {
            const currentSudo = useAppStore.getState().pendingSudoPassword;
            if (currentSudo?.toolUseId === event.payload.toolUseId) {
              store.setPendingSudoPassword(null);
            }
            break;
          }

          case 'config.status': {
            console.log('[useIPC] config.status received:', event.payload.isConfigured);
            applyConfigSnapshot(event.payload.config, event.payload.isConfigured);
            break;
          }

          case 'sandbox.progress':
            console.log(
              '[useIPC] sandbox.progress received:',
              event.payload.phase,
              event.payload.message
            );
            store.setSandboxSetupProgress(event.payload);
            break;

          case 'sandbox.sync':
            console.log(
              '[useIPC] sandbox.sync received:',
              event.payload.phase,
              event.payload.message
            );
            store.setSandboxSyncStatus(event.payload);
            break;

          case 'skills.storageChanged':
            console.log(
              '[useIPC] skills.storageChanged received:',
              event.payload.path,
              event.payload.reason
            );
            store.setSkillsStorageChangeEvent(event.payload);
            store.setSkillsStorageChangedAt(Date.now());
            break;

          case 'workdir.changed':
            console.log('[useIPC] workdir.changed received:', event.payload.path);
            store.setWorkingDir(event.payload.path || null);
            break;

          case 'session.contextInfo':
            store.setSessionContextInfo(event.payload.sessionId, {
              contextWindow: event.payload.contextWindow,
              maxTokens: event.payload.maxTokens,
            });
            break;

          case 'session.memoryContext':
            store.setSessionMemoryContext(event.payload.sessionId, event.payload.items);
            break;

          case 'plugins.commandsChanged':
          case 'plugins.runtimeApplied':
            store.bumpPluginCommandsRevision();
            break;

          case 'update.checkResult':
            break;

          case 'session.notice':
            if (event.payload.sessionId === store.activeSessionId) {
              store.setGlobalNotice({
                id: `notice-session-${Date.now()}`,
                type: event.payload.noticeType,
                message: event.payload.message,
              });
            }
            break;

          case 'error':
            console.error('[useIPC] Server error:', event.payload.message);
            store.setLoading(false);
            if (event.payload.code === 'CONFIG_REQUIRED_ACTIVE_SET') {
              store.setGlobalNotice({
                id: `notice-config-required-${Date.now()}`,
                type: 'warning',
                message: i18n.t('api.configRequiredActiveSet'),
                messageKey: 'api.configRequiredActiveSet',
                action:
                  event.payload.action === 'open_api_settings' ? 'open_api_settings' : undefined,
              });
            } else {
              store.setGlobalNotice({
                id: `notice-error-${Date.now()}`,
                type: 'error',
                message: event.payload.message,
              });
            }
            break;

          case 'native-theme.changed':
            store.setSystemDarkMode(event.payload.shouldUseDarkColors);
            break;

          case 'new-session':
            store.setActiveSession(null);
            store.setShowSettings(false);
            break;

          case 'navigate':
            if (event.payload === 'settings') {
              store.setShowSettings(true);
            }
            break;

          default:
            console.log('[useIPC] Unknown server event:', event);
        }
      } catch (err) {
        console.error('[useIPC] Error handling server event:', event.type, err);
      }
    });

    let disposed = false;
    void (async () => {
      try {
        const [config, isConfigured, systemTheme] = await Promise.all([
          window.electronAPI.config.get(),
          window.electronAPI.config.isConfigured(),
          window.electronAPI.getSystemTheme(),
        ]);
        if (disposed) {
          return;
        }
        const store = useAppStore.getState();
        store.setSystemDarkMode(Boolean(systemTheme?.shouldUseDarkColors));
        applyConfigSnapshot(config, Boolean(isConfigured));

        // Hydrate main-process permission rules from the renderer's (possibly
        // persisted) settings so the agent has them before the first tool call.
        // Re-read the store after applyConfigSnapshot so we send the latest
        // persisted rules, not a stale pre-hydration snapshot.
        try {
          const latest = useAppStore.getState();
          window.electronAPI.send({
            type: 'settings.update',
            payload: { permissionRules: latest.settings.permissionRules } as Record<
              string,
              unknown
            >,
          });
        } catch (syncErr) {
          console.warn('[useIPC] Failed to sync permissionRules to main:', syncErr);
        }
      } catch (error) {
        console.error('[useIPC] Failed to bootstrap config/theme state:', error);
      }
    })();

    // Cleanup on unmount only
    return () => {
      disposed = true;
      console.log('[useIPC] Cleaning up IPC listener');
      streamBatching.dispose();
      cleanup?.();
      // Reset guard so a subsequent mount (e.g., React Strict Mode double-
      // invoke in dev) re-installs the listener instead of silently running
      // with a torn-down bridge.
      ipcListenerInstalled = false;
    };
  }, []); // Empty deps - setup listener only once!

  // Get actions for the rest of the hook
  const addSession = useAppStore((s) => s.addSession);
  const updateSession = useAppStore((s) => s.updateSession);
  const addMessage = useAppStore((s) => s.addMessage);
  const setLoading = useAppStore((s) => s.setLoading);
  const setPendingPermission = useAppStore((s) => s.setPendingPermission);
  const setPendingQuestion = useAppStore((s) => s.setPendingQuestion);
  const clearActiveTurn = useAppStore((s) => s.clearActiveTurn);
  const activateNextTurn = useAppStore((s) => s.activateNextTurn);
  const startActiveTurn = useAppStore((s) => s.startActiveTurn);
  const clearPendingTurns = useAppStore((s) => s.clearPendingTurns);
  const cancelQueuedMessages = useAppStore((s) => s.cancelQueuedMessages);
  const startExecutionClock = useAppStore((s) => s.startExecutionClock);
  const finishExecutionClock = useAppStore((s) => s.finishExecutionClock);

  // Send event to main process
  const send = useCallback((event: ClientEvent) => {
    if (!isElectron) {
      console.log('[useIPC] Browser mode - would send:', event.type);
      return;
    }
    console.log('[useIPC] Sending:', event.type);
    window.electronAPI.send(event);
  }, []);

  // Invoke and wait for response
  const invoke = useCallback(async <T>(event: ClientEvent): Promise<T> => {
    if (!isElectron) {
      console.log('[useIPC] Browser mode - would invoke:', event.type);
      return null as T;
    }
    console.log('[useIPC] Invoking:', event.type);
    return window.electronAPI.invoke<T>(event);
  }, []);

  // Start a new session
  const startSession = useCallback(
    async (title: string, promptOrContent: string | ContentBlock[], cwd?: string) => {
      setLoading(true);
      console.log('[useIPC] Starting session:', title);

      // Normalize input to ContentBlock array
      const content: ContentBlock[] =
        typeof promptOrContent === 'string'
          ? [{ type: 'text', text: promptOrContent }]
          : promptOrContent;

      // Extract text for legacy backend and session title (if needed)
      const textContent = content.find((block) => block.type === 'text');
      const prompt = textContent && 'text' in textContent ? textContent.text : '';

      // Browser mode mock
      if (!isElectron) {
        const sessionId = `mock-session-${Date.now()}`;
        const session: Session = {
          id: sessionId,
          title: title || 'New Session',
          status: 'running',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          cwd: cwd || '',
          mountedPaths: [],
          allowedTools: [
            'webfetch',
            'websearch',
            'read',
            'write',
            'edit',
            'list_directory',
            'glob',
            'grep',
          ],
          memoryEnabled: true,
        };

        addSession(session);
        useAppStore.getState().setActiveSession(sessionId);

        const userMessage: Message = {
          id: `msg-user-${Date.now()}`,
          sessionId,
          role: 'user',
          content,
          timestamp: Date.now(),
        };
        addMessage(sessionId, userMessage);
        startExecutionClock(sessionId, userMessage.timestamp);
        const mockStepId = `mock-step-${Date.now()}`;
        startActiveTurn(sessionId, mockStepId, userMessage.id);

        await new Promise((resolve) => setTimeout(resolve, 500));

        const assistantMessage: Message = {
          id: `msg-assistant-${Date.now()}`,
          sessionId,
          role: 'assistant',
          content: [{ type: 'text', text: `Mock response to: "${prompt}"` }],
          timestamp: Date.now(),
        };
        addMessage(sessionId, assistantMessage);

        updateSession(sessionId, { status: 'idle' });
        clearActiveTurn(sessionId, mockStepId);
        setLoading(false);

        return session;
      }

      // Electron mode
      try {
        const session = await invoke<Session>({
          type: 'session.start',
          payload: {
            title,
            prompt,
            cwd,
            content, // Send full content blocks including images
          },
        });
        if (session) {
          addSession(session);
          useAppStore.getState().setActiveSession(session.id);

          // Immediately add user message to UI
          const userMessage: Message = {
            id: `msg-user-${Date.now()}`,
            sessionId: session.id,
            role: 'user',
            content,
            timestamp: Date.now(),
          };
          addMessage(session.id, userMessage);
          startExecutionClock(session.id, userMessage.timestamp);

          // Immediately activate turn to show processing indicator while waiting for API
          const mockStepId = `pending-step-${Date.now()}`;
          startActiveTurn(session.id, mockStepId, userMessage.id);
        }
        // Loading will be reset when we receive session.status event
        return session;
      } catch (e) {
        setLoading(false);
        useAppStore.getState().setGlobalNotice({
          id: `notice-session-start-${Date.now()}`,
          type: 'error',
          message: e instanceof Error ? e.message : i18n.t('chat.startFailed'),
          messageKey: e instanceof Error ? undefined : 'chat.startFailed',
        });
        return null;
      }
    },
    [
      invoke,
      addSession,
      addMessage,
      updateSession,
      setLoading,
      activateNextTurn,
      startActiveTurn,
      clearActiveTurn,
      startExecutionClock,
    ]
  );

  // Continue an existing session
  const continueSession = useCallback(
    async (sessionId: string, promptOrContent: string | ContentBlock[]) => {
      setLoading(true);
      console.log('[useIPC] Continuing session:', sessionId);

      // Normalize input to ContentBlock array
      const content: ContentBlock[] =
        typeof promptOrContent === 'string'
          ? [{ type: 'text', text: promptOrContent }]
          : promptOrContent;

      // Extract text for legacy backend (if needed)
      const textContent = content.find((block) => block.type === 'text');
      const prompt = textContent && 'text' in textContent ? textContent.text : '';

      // Immediately add user message to UI (for both modes)
      const store = useAppStore.getState();
      const isSessionRunning =
        store.sessions.find((session) => session.id === sessionId)?.status === 'running';
      const ss = store.sessionStates[sessionId];
      const hasPending = (ss?.pendingTurns?.length ?? 0) > 0;
      const shouldQueue = isSessionRunning || hasPending;
      const userMessage: Message = {
        id: `msg-user-${Date.now()}`,
        sessionId,
        role: 'user',
        content,
        timestamp: Date.now(),
        localStatus: shouldQueue ? 'queued' : undefined,
      };
      addMessage(sessionId, userMessage);
      startExecutionClock(sessionId, userMessage.timestamp);

      // Browser mode mock
      if (!isElectron) {
        updateSession(sessionId, { status: 'running' });
        const mockStepId = `mock-step-${Date.now()}`;
        startActiveTurn(sessionId, mockStepId, userMessage.id);

        await new Promise((resolve) => setTimeout(resolve, 500));

        const assistantMessage: Message = {
          id: `msg-assistant-${Date.now()}`,
          sessionId,
          role: 'assistant',
          content: [{ type: 'text', text: `Mock response to: "${prompt}"` }],
          timestamp: Date.now(),
        };
        addMessage(sessionId, assistantMessage);

        updateSession(sessionId, { status: 'idle' });
        clearActiveTurn(sessionId, mockStepId);
        clearPendingTurns(sessionId);
        setLoading(false);
        return;
      }

      // Electron mode - send to backend (user message already added above)
      // Immediately activate turn to show processing indicator while waiting for API
      if (!shouldQueue) {
        const mockStepId = `pending-step-${Date.now()}`;
        startActiveTurn(sessionId, mockStepId, userMessage.id);
      }

      try {
        send({
          type: 'session.continue',
          payload: {
            sessionId,
            prompt,
            content, // Send full content blocks including images
          },
        });
        // Loading will be reset when we receive session.status event
      } catch (e) {
        setLoading(false);
        useAppStore.getState().setGlobalNotice({
          id: `notice-session-continue-${Date.now()}`,
          type: 'error',
          message: e instanceof Error ? e.message : i18n.t('chat.startFailed'),
          messageKey: e instanceof Error ? undefined : 'chat.startFailed',
        });
      }
    },
    [
      send,
      addMessage,
      updateSession,
      setLoading,
      activateNextTurn,
      startActiveTurn,
      clearActiveTurn,
      clearPendingTurns,
      startExecutionClock,
    ]
  );

  const compactSession = useCallback(
    async (
      sessionId: string,
      customInstructions?: string
    ): Promise<{ success: boolean; errorKey?: string }> => {
      if (!isElectron) {
        return { success: false, errorKey: 'errCompactFailed' };
      }

      try {
        const result = await invoke<{ success: boolean; errorKey?: string; error?: string }>({
          type: 'session.compact',
          payload: { sessionId, customInstructions },
        });
        if (!result.success) {
          const noticeKey = result.errorKey || 'errCompactFailed';
          useAppStore.getState().setGlobalNotice({
            id: `notice-compact-${Date.now()}`,
            type: 'warning',
            message: i18n.t(`chat.compactErrors.${noticeKey}`, {
              defaultValue: result.error || noticeKey,
            }),
            messageKey: `chat.compactErrors.${noticeKey}`,
          });
        }
        return result;
      } catch (error) {
        useAppStore.getState().setGlobalNotice({
          id: `notice-compact-${Date.now()}`,
          type: 'error',
          message:
            error instanceof Error ? error.message : i18n.t('chat.compactErrors.errCompactFailed'),
          messageKey: 'chat.compactErrors.errCompactFailed',
        });
        return { success: false, errorKey: 'errCompactFailed' };
      }
    },
    [invoke]
  );

  const handoffSession = useCallback(
    async (
      sessionId: string,
      customInstructions?: string
    ): Promise<{ success: boolean; errorKey?: string }> => {
      if (!isElectron) {
        return { success: false, errorKey: 'errHandoffFailed' };
      }

      setLoading(true);
      try {
        const result = await invoke<{
          success: boolean;
          newSession?: Session;
          initialContent?: ContentBlock[];
          errorKey?: string;
          error?: string;
        } | null>({
          type: 'session.handoff',
          payload: { sessionId, customInstructions },
        });

        if (!result?.success || !result.newSession) {
          setLoading(false);
          const noticeKey = result?.errorKey || 'errHandoffFailed';
          useAppStore.getState().setGlobalNotice({
            id: `notice-handoff-${Date.now()}`,
            type: 'warning',
            message: i18n.t(`chat.handoffErrors.${noticeKey}`, {
              defaultValue: result?.error || noticeKey,
            }),
            messageKey: `chat.handoffErrors.${noticeKey}`,
          });
          return { success: false, errorKey: noticeKey };
        }

        const { newSession, initialContent } = result;
        addSession(newSession);
        const store = useAppStore.getState();
        store.setShowSettings(false);
        store.setActiveSession(newSession.id);

        const content: ContentBlock[] =
          initialContent && initialContent.length > 0
            ? initialContent
            : [{ type: 'text', text: '' }];

        const userMessage: Message = {
          id: `msg-user-${Date.now()}`,
          sessionId: newSession.id,
          role: 'user',
          content,
          timestamp: Date.now(),
        };
        addMessage(newSession.id, userMessage);
        startExecutionClock(newSession.id, userMessage.timestamp);

        const mockStepId = `pending-handoff-${Date.now()}`;
        startActiveTurn(newSession.id, mockStepId, userMessage.id);
        store.setGlobalNotice({
          id: `notice-handoff-${Date.now()}`,
          type: 'success',
          message: i18n.t('chat.handoffSuccess'),
          messageKey: 'chat.handoffSuccess',
        });

        return { success: true };
      } catch (error) {
        setLoading(false);
        useAppStore.getState().setGlobalNotice({
          id: `notice-handoff-${Date.now()}`,
          type: 'error',
          message:
            error instanceof Error ? error.message : i18n.t('chat.handoffErrors.errHandoffFailed'),
          messageKey: 'chat.handoffErrors.errHandoffFailed',
        });
        return { success: false, errorKey: 'errHandoffFailed' };
      }
    },
    [invoke, addSession, addMessage, setLoading, startActiveTurn, startExecutionClock]
  );

  const forkSessionFromMessage = useCallback(
    async (
      sessionId: string,
      messageId: string
    ): Promise<{ success: boolean; newSessionId?: string; errorKey?: string }> => {
      if (!isElectron) {
        return { success: false, errorKey: 'errForkFailed' };
      }

      try {
        const result = await invoke<{
          success: boolean;
          newSession?: Session;
          messages?: Message[];
          errorKey?: string;
          error?: string;
        }>({
          type: 'session.forkFromMessage',
          payload: { sessionId, messageId },
        });

        if (!result?.success || !result.newSession) {
          const noticeKey = result?.errorKey || 'errForkFailed';
          useAppStore.getState().setGlobalNotice({
            id: `notice-fork-${Date.now()}`,
            type: 'warning',
            message: i18n.t(`chat.forkErrors.${noticeKey}`, {
              defaultValue: result?.error || noticeKey,
            }),
            messageKey: `chat.forkErrors.${noticeKey}`,
          });
          return { success: false, errorKey: noticeKey };
        }

        const store = useAppStore.getState();
        store.addSession(result.newSession);
        if (result.messages) {
          store.setMessages(result.newSession.id, result.messages);
        }
        store.setShowSettings(false);
        store.setActiveSession(result.newSession.id);
        store.setGlobalNotice({
          id: `notice-fork-${Date.now()}`,
          type: 'success',
          message: i18n.t('chat.forkSuccess'),
          messageKey: 'chat.forkSuccess',
        });

        return { success: true, newSessionId: result.newSession.id };
      } catch (error) {
        useAppStore.getState().setGlobalNotice({
          id: `notice-fork-${Date.now()}`,
          type: 'error',
          message: error instanceof Error ? error.message : i18n.t('chat.forkErrors.errForkFailed'),
          messageKey: 'chat.forkErrors.errForkFailed',
        });
        return { success: false, errorKey: 'errForkFailed' };
      }
    },
    [invoke]
  );

  const rewindSessionForEdit = useCallback(
    async (
      sessionId: string,
      messageId: string
    ): Promise<{ success: boolean; promptText?: string; errorKey?: string }> => {
      if (!isElectron) {
        return { success: false, errorKey: 'errRewindFailed' };
      }

      try {
        const result = await invoke<{
          success: boolean;
          promptText?: string;
          messages?: Message[];
          errorKey?: string;
          error?: string;
        }>({
          type: 'session.rewindToMessage',
          payload: { sessionId, messageId },
        });

        if (!result?.success) {
          const noticeKey = result?.errorKey || 'errRewindFailed';
          useAppStore.getState().setGlobalNotice({
            id: `notice-rewind-${Date.now()}`,
            type: 'warning',
            message: i18n.t(`chat.rewindErrors.${noticeKey}`, {
              defaultValue: result?.error || noticeKey,
            }),
            messageKey: `chat.rewindErrors.${noticeKey}`,
          });
          return { success: false, errorKey: noticeKey };
        }

        const store = useAppStore.getState();
        if (result.messages) {
          store.setMessages(sessionId, result.messages);
        }
        store.setTraceSteps(sessionId, []);
        store.clearPartialMessage(sessionId);
        store.clearPartialThinking(sessionId);
        store.clearActiveTurn(sessionId);
        store.clearPendingTurns(sessionId);
        store.clearExecutionClock(sessionId);
        store.clearQueuedMessages(sessionId);
        store.setLoading(false);

        return { success: true, promptText: result.promptText ?? '' };
      } catch (error) {
        useAppStore.getState().setGlobalNotice({
          id: `notice-rewind-${Date.now()}`,
          type: 'error',
          message:
            error instanceof Error ? error.message : i18n.t('chat.rewindErrors.errRewindFailed'),
          messageKey: 'chat.rewindErrors.errRewindFailed',
        });
        return { success: false, errorKey: 'errRewindFailed' };
      }
    },
    [invoke]
  );

  const stopSession = useCallback(
    (sessionId: string) => {
      cancelQueuedMessages(sessionId);
      clearPendingTurns(sessionId);
      clearActiveTurn(sessionId);
      finishExecutionClock(sessionId);
      if (!isElectron) {
        updateSession(sessionId, { status: 'idle' });
        setLoading(false);
        return;
      }
      send({ type: 'session.stop', payload: { sessionId } });
      setLoading(false);
    },
    [
      send,
      updateSession,
      setLoading,
      cancelQueuedMessages,
      clearPendingTurns,
      clearActiveTurn,
      finishExecutionClock,
    ]
  );

  const deleteSession = useCallback(
    (sessionId: string) => {
      useAppStore.getState().removeSession(sessionId);
      if (isElectron) {
        send({ type: 'session.delete', payload: { sessionId } });
      }
    },
    [send]
  );

  const batchDeleteSessions = useCallback(
    (sessionIds: string[]) => {
      useAppStore.getState().removeSessions(sessionIds);
      if (isElectron) {
        send({ type: 'session.batchDelete', payload: { sessionIds } });
      }
    },
    [send]
  );

  const listSessions = useCallback(() => {
    if (!isElectron) return;
    send({ type: 'session.list', payload: {} });
  }, [send]);

  // Get messages for a session (from persistent storage)
  const getSessionMessages = useCallback(
    async (sessionId: string): Promise<Message[]> => {
      if (!isElectron) {
        console.log('[useIPC] Browser mode - no persistent messages');
        return [];
      }
      console.log('[useIPC] Getting messages for session:', sessionId);
      const messages = await invoke<Message[]>({
        type: 'session.getMessages',
        payload: { sessionId },
      });
      return messages || [];
    },
    [invoke]
  );

  const getSessionTraceSteps = useCallback(
    async (sessionId: string): Promise<TraceStep[]> => {
      if (!isElectron) {
        console.log('[useIPC] Browser mode - no persistent trace steps');
        return [];
      }
      return (
        (await invoke<TraceStep[]>({ type: 'session.getTraceSteps', payload: { sessionId } })) || []
      );
    },
    [invoke]
  );

  const respondToPermission = useCallback(
    (toolUseId: string, result: PermissionResult) => {
      send({
        type: 'permission.response',
        payload: { toolUseId, result },
      });
      setPendingPermission(null);
    },
    [send, setPendingPermission]
  );

  const respondToQuestion = useCallback(
    (questionId: string, answer: string) => {
      send({
        type: 'question.response',
        payload: { questionId, answer },
      });
      setPendingQuestion(null);
    },
    [send, setPendingQuestion]
  );

  const setPendingSudoPassword = useAppStore((s) => s.setPendingSudoPassword);

  const respondToSudoPassword = useCallback(
    (toolUseId: string, password: string | null) => {
      send({
        type: 'sudo.password.response',
        payload: { toolUseId, password },
      });
      setPendingSudoPassword(null);
    },
    [send, setPendingSudoPassword]
  );

  const selectFolder = useCallback(async (): Promise<string | null> => {
    if (!isElectron) {
      return '/mock/folder/path';
    }
    return invoke<string | null>({ type: 'folder.select', payload: {} });
  }, [invoke]);

  const getWorkingDir = useCallback(async (): Promise<string | null> => {
    if (!isElectron) {
      return '/mock/working/dir';
    }
    return invoke<string | null>({ type: 'workdir.get', payload: {} });
  }, [invoke]);

  const changeWorkingDir = useCallback(
    async (
      sessionId?: string,
      currentPath?: string
    ): Promise<{ success: boolean; path: string; error?: string }> => {
      if (!isElectron) {
        return { success: true, path: '/mock/working/dir' };
      }
      return invoke<{ success: boolean; path: string; error?: string }>({
        type: 'workdir.select',
        payload: { sessionId, currentPath },
      });
    },
    [invoke]
  );

  const getMCPServers = useCallback(async () => {
    if (!isElectron) {
      return [];
    }
    // Use the exposed mcp.getServerStatus method
    return window.electronAPI.mcp.getServerStatus();
  }, []);

  const setSessionMemoryEnabled = useCallback(
    async (sessionId: string, memoryEnabled: boolean) => {
      updateSession(sessionId, { memoryEnabled });
      if (!isElectron) {
        return;
      }
      await invoke({
        type: 'session.setMemoryEnabled',
        payload: { sessionId, memoryEnabled },
      });
    },
    [invoke, isElectron, updateSession]
  );

  return {
    send,
    invoke,
    startSession,
    continueSession,
    compactSession,
    handoffSession,
    forkSessionFromMessage,
    rewindSessionForEdit,
    stopSession,
    setSessionMemoryEnabled,
    deleteSession,
    batchDeleteSessions,
    listSessions,
    getSessionMessages,
    getSessionTraceSteps,
    respondToPermission,
    respondToQuestion,
    respondToSudoPassword,
    selectFolder,
    getWorkingDir,
    changeWorkingDir,
    getMCPServers,
    isElectron,
  };
}
