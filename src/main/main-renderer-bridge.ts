/**
 * @module main/main-renderer-bridge
 *
 * Sends server events to the renderer process.
 */
import type { ServerEvent } from '../renderer/types';
import { mainAppState } from './main-app-state';
import { broadcastChatLanEvent } from './chat-lan-server/chat-lan-event-bus';

export function sendToRenderer(event: ServerEvent): void {
  broadcastChatLanEvent(event);
  const { mainWindow } = mainAppState;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('server-event', event);
  }
}
