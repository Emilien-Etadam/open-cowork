/**
 * @module main/ipc/ipc-auto-update
 */
import { ipcMain, shell } from 'electron';
import {
  checkForAppUpdates,
  installDownloadedUpdate,
  isUpdateCheckSupported,
} from '../auto-updater';
import { logError } from '../utils/logger';

const RELEASES_URL = 'https://github.com/Emilien-Etadam/open-cowork/releases/latest';

export function registerAutoUpdateIpc(): void {
  ipcMain.handle('app.checkForUpdates', async () => {
    try {
      return await checkForAppUpdates();
    } catch (error) {
      logError('[AutoUpdate] Manual check failed:', error);
      throw error;
    }
  });

  ipcMain.handle('app.installUpdate', async () => {
    try {
      return installDownloadedUpdate();
    } catch (error) {
      logError('[AutoUpdate] Install update failed:', error);
      throw error;
    }
  });

  ipcMain.handle('app.isUpdateCheckSupported', () => isUpdateCheckSupported());

  ipcMain.handle('app.openReleasesPage', async () => {
    await shell.openExternal(RELEASES_URL);
    return { success: true };
  });
}
