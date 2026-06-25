/**
 * @module main/ipc/ipc-schedule-memory
 */
import { ipcMain } from 'electron';
import { configStore } from '../config/config-store';
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
import { getWorkspacePathUnsupportedReason } from '../main-working-dir';
import { resolveScheduledTaskTitle } from '../main-scheduled-task-title';

export function registerScheduleMemoryIpc(): void {
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
