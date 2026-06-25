/**
 * @module main/main-renderer-bridge
 *
 * Sends server events to the renderer process.
 */
import type { ServerEvent } from '../renderer/types';
import { mainAppState } from './main-app-state';

export function sendToRenderer(event: ServerEvent): void {
  const { mainWindow } = mainAppState;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('server-event', event);
  }
}
