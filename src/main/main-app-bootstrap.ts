/**
 * @module main/main-app-bootstrap
 *
 * Verrou instance unique, identité app et DevTools en développement.
 */
import { app, BrowserWindow } from 'electron';
import { log, logWarn } from './utils/logger';
import { mainAppState } from './main-app-state';

export const isDev = !!process.env.VITE_DEV_SERVER_URL;
const ELECTRON_DEVTOOLS_DEBUG_PORT = '9223';
const APP_DISPLAY_NAME = 'Lygodactylus';
const APP_ID = 'com.lygodactylus.app';

export function registerAppBootstrap(createWindow: () => void): void {
  if (!app.isPackaged) {
    app.setName(APP_DISPLAY_NAME);
  }
  if (process.platform === 'win32') {
    app.setAppUserModelId(APP_ID);
  }

  if (isDev) {
    app.commandLine.appendSwitch('remote-debugging-port', ELECTRON_DEVTOOLS_DEBUG_PORT);
    app.commandLine.appendSwitch(
      'remote-allow-origins',
      `http://localhost:${ELECTRON_DEVTOOLS_DEBUG_PORT}`
    );
  }

  const hasSingleInstanceLock = isDev || app.requestSingleInstanceLock();
  if (!hasSingleInstanceLock) {
    logWarn('[App] Another instance is already running, quitting this instance');
    app.quit();
  } else if (!isDev) {
    app.on('second-instance', () => {
      const existingWindow =
        mainAppState.mainWindow && !mainAppState.mainWindow.isDestroyed()
          ? mainAppState.mainWindow
          : BrowserWindow.getAllWindows().find((window) => !window.isDestroyed());

      if (!existingWindow) {
        log('[App] No existing window found, creating new one');
        createWindow();
        return;
      }

      if (!mainAppState.mainWindow || mainAppState.mainWindow.isDestroyed()) {
        mainAppState.mainWindow = existingWindow;
      }
      if (existingWindow.isMinimized()) {
        existingWindow.restore();
      }
      existingWindow.show();
      existingWindow.focus();
      log('[App] Blocked second instance and focused existing window');
    });
  }
}
