/**
 * @module main/ipc/ipc-remote-schedule-memory
 */
import { ipcMain } from 'electron';
import * as fs from 'fs';
import { configStore } from '../config/config-store';
import { remoteManager } from '../remote/remote-manager';
import { remoteConfigStore } from '../remote/remote-config-store';
import type { GatewayConfig, SlackChannelConfig, ChannelType } from '../remote/types';
import {
  ScheduledTaskManager,
  type ScheduledTaskCreateInput,
  type ScheduledTaskUpdateInput,
} from '../schedule/scheduled-task-manager';
import {
  buildScheduledTaskFallbackTitle,
  buildScheduledTaskTitle,
} from '../../shared/schedule/task-title';
import { logError } from '../utils/logger';
import { mainAppState } from '../main-app-state';
import { sendToRenderer } from '../main-renderer-bridge';
import { getWorkspacePathUnsupportedReason, setWorkingDir } from '../main-working-dir';
import { resolveScheduledTaskTitle } from '../main-scheduled-task-title';
import type { AgentExecutor } from '../remote/remote-manager';

export function registerRemoteScheduleMemoryIpc(): void {
  ipcMain.handle('remote.getConfig', () => {
    try {
      return remoteConfigStore.getAll();
    } catch (error) {
      logError('[Remote] Error getting config:', error);
      return null;
    }
  });

  ipcMain.handle('remote.getStatus', () => {
    try {
      return remoteManager.getStatus();
    } catch (error) {
      logError('[Remote] Error getting status:', error);
      return { running: false, channels: [], activeSessions: 0, pendingPairings: 0 };
    }
  });

  ipcMain.handle('remote.setEnabled', async (_event, enabled: boolean) => {
    try {
      remoteConfigStore.setEnabled(enabled);

      if (enabled) {
        await remoteManager.start();
      } else {
        await remoteManager.stop();
      }

      return { success: true };
    } catch (error) {
      logError('[Remote] Error setting enabled:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle('remote.updateGatewayConfig', async (_event, config: Partial<GatewayConfig>) => {
    try {
      await remoteManager.updateGatewayConfig(config);
      return { success: true };
    } catch (error) {
      logError('[Remote] Error updating gateway config:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle('remote.updateSlackConfig', async (_event, config: SlackChannelConfig) => {
    try {
      await remoteManager.updateSlackConfig(config);
      return { success: true };
    } catch (error) {
      logError('[Remote] Error updating Slack config:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle('remote.getPairedUsers', () => {
    try {
      return remoteManager.getPairedUsers();
    } catch (error) {
      logError('[Remote] Error getting paired users:', error);
      return [];
    }
  });

  ipcMain.handle('remote.getPendingPairings', () => {
    try {
      return remoteManager.getPendingPairings();
    } catch (error) {
      logError('[Remote] Error getting pending pairings:', error);
      return [];
    }
  });

  ipcMain.handle('remote.approvePairing', (_event, channelType: ChannelType, userId: string) => {
    try {
      const success = remoteManager.approvePairing(channelType, userId);
      return { success };
    } catch (error) {
      logError('[Remote] Error approving pairing:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle('remote.revokePairing', (_event, channelType: ChannelType, userId: string) => {
    try {
      const success = remoteManager.revokePairing(channelType, userId);
      return { success };
    } catch (error) {
      logError('[Remote] Error revoking pairing:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle('remote.rejectPairing', (_event, channelType: ChannelType, userId: string) => {
    try {
      const success = remoteManager.rejectPairing(channelType, userId);
      return { success };
    } catch (error) {
      logError('[Remote] Error rejecting pairing:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle('remote.getRemoteSessions', () => {
    try {
      return remoteManager.getRemoteSessions();
    } catch (error) {
      logError('[Remote] Error getting remote sessions:', error);
      return [];
    }
  });

  ipcMain.handle('remote.clearRemoteSession', (_event, sessionId: string) => {
    try {
      const success = remoteManager.clearRemoteSession(sessionId);
      return { success };
    } catch (error) {
      logError('[Remote] Error clearing remote session:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle('remote.getTunnelStatus', () => {
    try {
      return remoteManager.getTunnelStatus();
    } catch (error) {
      logError('[Remote] Error getting tunnel status:', error);
      return { connected: false, url: null, provider: 'none' };
    }
  });

  ipcMain.handle('remote.getWebhookUrl', () => {
    try {
      return remoteManager.getSlackWebhookUrl();
    } catch (error) {
      logError('[Remote] Error getting webhook URL:', error);
      return null;
    }
  });

  ipcMain.handle('remote.restart', async () => {
    try {
      await remoteManager.restart();
      return { success: true };
    } catch (error) {
      logError('[Remote] Error restarting:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle('schedule.list', () => {
    try {
      if (!mainAppState.scheduledTaskManager) return [];
      return mainAppState.scheduledTaskManager.list();
    } catch (error) {
      logError('[Schedule] Error listing tasks:', error);
      return [];
    }
  });

  ipcMain.handle('schedule.create', async (_event, payload: ScheduledTaskCreateInput) => {
    if (!mainAppState.scheduledTaskManager) {
      throw new Error('Scheduled task manager not initialized');
    }
    const unsupportedReason = getWorkspacePathUnsupportedReason(payload.cwd);
    if (unsupportedReason) {
      throw new Error(unsupportedReason);
    }
    const normalizedPrompt = payload.prompt.trim();
    const title = await resolveScheduledTaskTitle(normalizedPrompt, payload.cwd, payload.title);
    return mainAppState.scheduledTaskManager.create({
      ...payload,
      prompt: normalizedPrompt,
      title,
    });
  });

  ipcMain.handle(
    'schedule.update',
    async (_event, id: string, updates: ScheduledTaskUpdateInput) => {
      if (!mainAppState.scheduledTaskManager) {
        throw new Error('Scheduled task manager not initialized');
      }
      const existing = mainAppState.scheduledTaskManager.get(id);
      if (!existing) return null;
      const nextCwd = updates.cwd ?? existing.cwd;
      const unsupportedReason = getWorkspacePathUnsupportedReason(nextCwd);
      if (unsupportedReason) {
        throw new Error(unsupportedReason);
      }
      const normalizedPrompt =
        updates.prompt === undefined ? existing.prompt : updates.prompt.trim();
      const normalizedUpdates: ScheduledTaskUpdateInput = {
        ...updates,
        prompt: normalizedPrompt,
      };

      if (updates.prompt !== undefined) {
        normalizedUpdates.title = await resolveScheduledTaskTitle(
          normalizedPrompt,
          updates.cwd ?? existing.cwd,
          updates.title ?? existing.title
        );
      } else if (updates.title !== undefined) {
        normalizedUpdates.title = buildScheduledTaskTitle(updates.title);
      }

      return mainAppState.scheduledTaskManager.update(id, normalizedUpdates);
    }
  );

  ipcMain.handle('schedule.delete', (_event, id: string) => {
    if (!mainAppState.scheduledTaskManager) {
      throw new Error('Scheduled task manager not initialized');
    }
    return { success: mainAppState.scheduledTaskManager.delete(id) };
  });

  ipcMain.handle('schedule.toggle', (_event, id: string, enabled: boolean) => {
    if (!mainAppState.scheduledTaskManager) {
      throw new Error('Scheduled task manager not initialized');
    }
    return mainAppState.scheduledTaskManager.toggle(id, enabled);
  });

  ipcMain.handle('schedule.runNow', async (_event, id: string) => {
    if (!mainAppState.scheduledTaskManager) {
      throw new Error('Scheduled task manager not initialized');
    }
    return mainAppState.scheduledTaskManager.runNow(id);
  });

  ipcMain.handle('memory.getOverview', (_event, cwd?: string) => {
    if (!mainAppState.memoryService) {
      throw new Error('Memory service not initialized');
    }
    return mainAppState.memoryService.getOverview(cwd);
  });

  ipcMain.handle(
    'memory.search',
    (
      _event,
      payload: {
        query: string;
        cwd?: string;
        sourceWorkspace?: string | null;
        scope?: 'workspace' | 'global' | 'all';
        limit?: number;
      }
    ) => {
      if (!mainAppState.memoryService) {
        throw new Error('Memory service not initialized');
      }
      return mainAppState.memoryService.search(payload);
    }
  );

  ipcMain.handle('memory.read', (_event, id: string) => {
    if (!mainAppState.memoryService) {
      throw new Error('Memory service not initialized');
    }
    return mainAppState.memoryService.read(id);
  });

  ipcMain.handle('memory.rebuildWorkspace', async (_event, cwd: string) => {
    if (!mainAppState.memoryService) {
      throw new Error('Memory service not initialized');
    }
    return mainAppState.memoryService.rebuildWorkspace(cwd);
  });

  ipcMain.handle('memory.clearWorkspace', (_event, cwd: string) => {
    if (!mainAppState.memoryService) {
      throw new Error('Memory service not initialized');
    }
    return mainAppState.memoryService.clearWorkspace(cwd);
  });

  ipcMain.handle('memory.clearCoreMemory', () => {
    if (!mainAppState.memoryService) {
      throw new Error('Memory service not initialized');
    }
    return mainAppState.memoryService.clearCoreMemory();
  });

  ipcMain.handle('memory.rebuildAll', async () => {
    if (!mainAppState.memoryService) {
      throw new Error('Memory service not initialized');
    }
    return mainAppState.memoryService.rebuildAll();
  });

  ipcMain.handle('memory.listFiles', () => {
    if (!mainAppState.memoryService) {
      throw new Error('Memory service not initialized');
    }
    return mainAppState.memoryService.listFiles();
  });

  ipcMain.handle('memory.readFile', (_event, filePath: string) => {
    if (!mainAppState.memoryService) {
      throw new Error('Memory service not initialized');
    }
    return mainAppState.memoryService.readFile(filePath);
  });

  ipcMain.handle('memory.inspectSession', (_event, sessionId: string, workspaceKey?: string) => {
    if (!mainAppState.memoryService) {
      throw new Error('Memory service not initialized');
    }
    return mainAppState.memoryService.inspectSession(sessionId, workspaceKey);
  });

  ipcMain.handle('memory.setEnabled', (_event, enabled: boolean) => {
    if (!mainAppState.memoryService) {
      throw new Error('Memory service not initialized');
    }
    const result = mainAppState.memoryService.setEnabled(enabled);
    mainAppState.sessionManager?.clearAllCachedAgentSessions();
    sendToRenderer({
      type: 'config.status',
      payload: {
        isConfigured: configStore.isConfigured(),
        config: configStore.getAll(),
      },
    });
    return result;
  });
}

export function createScheduledTaskManager(
  store: ReturnType<typeof import('../schedule/scheduled-task-store').createScheduledTaskStore>
): ScheduledTaskManager {
  return new ScheduledTaskManager({
    store,
    executeTask: async (task) => {
      if (!mainAppState.sessionManager) {
        throw new Error('Session manager not initialized');
      }
      const unsupportedReason = getWorkspacePathUnsupportedReason(task.cwd);
      if (unsupportedReason) {
        throw new Error(unsupportedReason);
      }
      const fallbackTitle = buildScheduledTaskFallbackTitle(task.prompt);
      const needsRegeneratedTitle = !task.title?.trim() || task.title === fallbackTitle;
      const title = needsRegeneratedTitle
        ? await resolveScheduledTaskTitle(task.prompt, task.cwd, task.title)
        : buildScheduledTaskTitle(task.title);
      if (title !== task.title) {
        store.update(task.id, { title });
      }
      const started = await mainAppState.sessionManager.startSession(title, task.prompt, task.cwd);
      sendToRenderer({
        type: 'session.update',
        payload: { sessionId: started.id, updates: started },
      });
      return { sessionId: started.id };
    },
    onTaskError: (taskId, error) => {
      sendToRenderer({
        type: 'scheduled-task.error',
        payload: { taskId, error },
      });
    },
    now: () => Date.now(),
  });
}

export function createAgentExecutor(): AgentExecutor {
  return {
    startSession: async (title, prompt, cwd) => {
      if (!mainAppState.sessionManager) throw new Error('Session manager not initialized');
      const unsupportedReason = getWorkspacePathUnsupportedReason(cwd);
      if (unsupportedReason) {
        throw new Error(unsupportedReason);
      }
      return mainAppState.sessionManager.startSession(title, prompt, cwd);
    },
    continueSession: async (sessionId, prompt, content, cwd) => {
      if (!mainAppState.sessionManager) throw new Error('Session manager not initialized');
      if (cwd) {
        const result = await setWorkingDir(cwd, sessionId);
        if (!result.success) {
          throw new Error(result.error || 'Failed to update working directory');
        }
      }
      await mainAppState.sessionManager.continueSession(sessionId, prompt, content);
    },
    stopSession: async (sessionId) => {
      if (!mainAppState.sessionManager) throw new Error('Session manager not initialized');
      await mainAppState.sessionManager.stopSession(sessionId);
    },
    validateWorkingDirectory: async (cwd) => {
      const unsupportedReason = getWorkspacePathUnsupportedReason(cwd);
      if (unsupportedReason) {
        return unsupportedReason;
      }
      if (!fs.existsSync(cwd)) {
        return 'Directory does not exist';
      }
      return null;
    },
  };
}
