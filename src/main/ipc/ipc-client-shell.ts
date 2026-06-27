/**
 * @module main/ipc/ipc-client-shell
 */
import { app, ipcMain, dialog, shell, nativeTheme } from 'electron';
import { isAbsolute } from 'path';
import { logError, logWarn } from '../utils/logger';
import { sendToRenderer } from '../main-renderer-bridge';
import { handleClientEvent } from '../main-client-events';
import { revealFileInFolder } from '../main-shell-reveal';
import { listRecentWorkspaceFiles } from '../utils/recent-workspace-files';
import type { ClientEvent } from '../../renderer/types';
import { isAllowedClientEvent } from '../../shared/client-event-allowlist';

function rejectUnauthorizedClientEvent(data: unknown): data is ClientEvent {
  if (!isAllowedClientEvent(data)) {
    const type =
      data && typeof data === 'object' && 'type' in data ? String((data as { type: unknown }).type) : '(invalid)';
    logWarn('[IPC] Blocked unauthorized client event:', type);
    return false;
  }
  return true;
}

export function registerClientShellIpc(): void {
  ipcMain.on('client-event', async (_event, data: ClientEvent) => {
    if (!rejectUnauthorizedClientEvent(data)) {
      return;
    }
    try {
      await handleClientEvent(data);
    } catch (error) {
      logError('Error handling client event:', error);
      sendToRenderer({
        type: 'error',
        payload: { message: error instanceof Error ? error.message : 'Unknown error' },
      });
    }
  });

  ipcMain.handle('client-invoke', async (_event, data: ClientEvent) => {
    if (!rejectUnauthorizedClientEvent(data)) {
      throw new Error('Unauthorized client event');
    }
    return handleClientEvent(data);
  });

  ipcMain.handle('get-version', () => {
    try {
      return app.getVersion();
    } catch (error) {
      logError('[IPC] Error getting version:', error);
      return 'unknown';
    }
  });

  ipcMain.handle('system.getTheme', () => {
    try {
      return { shouldUseDarkColors: nativeTheme.shouldUseDarkColors };
    } catch (error) {
      logError('[IPC] Error getting theme:', error);
      return { shouldUseDarkColors: true };
    }
  });

  ipcMain.handle('shell.openExternal', async (_event, url: string) => {
    if (!url) {
      return false;
    }

    try {
      const parsed = new URL(url);
      if (!['http:', 'https:', 'mailto:'].includes(parsed.protocol)) {
        logWarn('[shell.openExternal] Blocked URL with disallowed protocol:', parsed.protocol);
        return false;
      }
    } catch {
      logWarn('[shell.openExternal] Blocked invalid URL:', url);
      return false;
    }

    return shell.openExternal(url);
  });

  ipcMain.handle('shell.showItemInFolder', async (_event, filePath: string, cwd?: string) => {
    return revealFileInFolder(filePath, cwd);
  });

  ipcMain.handle(
    'artifacts.listRecentFiles',
    async (_event, cwd: string, sinceMs: number, limit: number = 50) => {
      if (!cwd || !isAbsolute(cwd)) {
        return [];
      }
      return listRecentWorkspaceFiles(cwd, sinceMs, limit);
    }
  );

  ipcMain.handle('dialog.selectFiles', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      title: 'Select Files',
    });

    if (result.canceled) {
      return [];
    }

    return result.filePaths;
  });
}
