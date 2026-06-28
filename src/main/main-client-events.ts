/**
 * @module main/main-client-events
 *
 * Dispatch des événements client (renderer → main) pour sessions, workdir, etc.
 */
import { dialog } from 'electron';
import { isAbsolute } from 'path';
import { configStore, type AppTheme } from './config/config-store';
import { setPermissionRules } from './config/permission-rules-store';
import { mt } from './i18n';
import { eventRequiresSessionManager } from './client-event-utils';
import type { ClientEvent, PermissionRule } from '../renderer/types';
import { logWarn } from './utils/logger';
import { mainAppState } from './main-app-state';
import { sendToRenderer } from './main-renderer-bridge';
import {
  getWorkingDir,
  setWorkingDir,
  getWorkspacePathUnsupportedReason,
} from './main-working-dir';
import {
  applyNativeThemePreference,
  applyWindowBackground,
  getSavedThemePreference,
  resolveEffectiveTheme,
} from './main-app-window';

export async function handleClientEvent(event: ClientEvent): Promise<unknown> {
  if (
    (event.type === 'session.start' ||
      event.type === 'session.compact' ||
      event.type === 'session.handoff') &&
    !configStore.hasUsableCredentialsForActiveSet()
  ) {
    sendToRenderer({
      type: 'error',
      payload: {
        message: mt('errConfigRequired'),
        code: 'CONFIG_REQUIRED_ACTIVE_SET',
        action: 'open_api_settings',
      },
    });
    return null;
  }

  if (eventRequiresSessionManager(event) && !mainAppState.sessionManager) {
    throw new Error('Session manager not initialized');
  }
  const sm = mainAppState.sessionManager!;

  switch (event.type) {
    case 'session.start':
      if (getWorkspacePathUnsupportedReason(event.payload.cwd)) {
        sendToRenderer({
          type: 'error',
          payload: {
            message: getWorkspacePathUnsupportedReason(event.payload.cwd)!,
          },
        });
        return null;
      }
      return sm.startSession(
        event.payload.title,
        event.payload.prompt,
        event.payload.cwd,
        event.payload.allowedTools,
        event.payload.content,
        event.payload.memoryEnabled
      );

    case 'session.continue':
      return sm.continueSession(
        event.payload.sessionId,
        event.payload.prompt,
        event.payload.content
      );

    case 'session.compact':
      return sm.compactSession(event.payload.sessionId, event.payload.customInstructions);

    case 'session.handoff':
      return sm.handoffSession(event.payload.sessionId, event.payload.customInstructions);

    case 'session.forkFromMessage':
      return sm.forkSessionFromMessage(event.payload.sessionId, event.payload.messageId);

    case 'session.rewindToMessage':
      return sm.rewindSessionForEdit(event.payload.sessionId, event.payload.messageId);

    case 'session.stop':
      return sm.stopSession(event.payload.sessionId);

    case 'session.delete':
      return sm.deleteSession(event.payload.sessionId);

    case 'session.batchDelete':
      return sm.batchDeleteSessions(event.payload.sessionIds);

    case 'session.setMemoryEnabled':
      return sm.setSessionMemoryEnabled(event.payload.sessionId, event.payload.memoryEnabled);

    case 'session.list': {
      const sessions = sm.listSessions();
      sendToRenderer({ type: 'session.list', payload: { sessions } });
      return sessions;
    }

    case 'session.getMessages':
      return sm.getMessages(event.payload.sessionId);

    case 'session.getTraceSteps':
      return sm.getTraceSteps(event.payload.sessionId);

    case 'permission.response':
      return sm.handlePermissionResponse(event.payload.toolUseId, event.payload.result);

    case 'question.response':
      return sm.handleQuestionResponse(event.payload.questionId, event.payload.answer);

    case 'sudo.password.response':
      return sm.handleSudoPasswordResponse(event.payload.toolUseId, event.payload.password);

    case 'folder.select': {
      const folderResult = await dialog.showOpenDialog(mainAppState.mainWindow!, {
        properties: ['openDirectory'],
      });
      if (!folderResult.canceled && folderResult.filePaths.length > 0) {
        sendToRenderer({
          type: 'folder.selected',
          payload: { path: folderResult.filePaths[0] },
        });
        return folderResult.filePaths[0];
      }
      return null;
    }

    case 'workdir.get':
      return getWorkingDir();

    case 'workdir.set':
      return setWorkingDir(event.payload.path, event.payload.sessionId);

    case 'workdir.select': {
      const dialogDefaultPath =
        event.payload.currentPath && isAbsolute(event.payload.currentPath)
          ? event.payload.currentPath
          : mainAppState.currentWorkingDir || undefined;
      const workdirResult = await dialog.showOpenDialog(mainAppState.mainWindow!, {
        properties: ['openDirectory'],
        title: 'Select Working Directory',
        defaultPath: dialogDefaultPath,
      });
      if (!workdirResult.canceled && workdirResult.filePaths.length > 0) {
        const selectedPath = workdirResult.filePaths[0];
        return setWorkingDir(selectedPath, event.payload.sessionId);
      }
      return { success: false, path: '', error: 'User cancelled' };
    }

    case 'settings.update': {
      const payload = event.payload as Record<string, unknown>;
      let themeChanged = false;

      if (payload.theme === 'dark' || payload.theme === 'light' || payload.theme === 'system') {
        const nextTheme = payload.theme as AppTheme;
        configStore.update({ theme: nextTheme });
        applyNativeThemePreference(nextTheme);
        themeChanged = true;
      }

      if (themeChanged) {
        const savedTheme = getSavedThemePreference();
        const effectiveTheme = resolveEffectiveTheme(savedTheme);
        applyWindowBackground(effectiveTheme);
        sendToRenderer({
          type: 'config.status',
          payload: {
            isConfigured: configStore.isConfigured(),
            config: configStore.getAll(),
          },
        });
      }

      if (Array.isArray((event.payload as { permissionRules?: unknown }).permissionRules)) {
        setPermissionRules(
          (event.payload as { permissionRules: PermissionRule[] }).permissionRules
        );
      }
      return null;
    }

    default:
      logWarn('Unknown event type:', event);
      return null;
  }
}
