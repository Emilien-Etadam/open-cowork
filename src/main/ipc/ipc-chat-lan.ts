/**
 * @module main/ipc/ipc-chat-lan
 */
import { ipcMain } from 'electron';
import { logError } from '../utils/logger';
import { applyChatLanConfig, chatLanConfigStore, getChatLanStatus } from '../chat-lan-server';

export function registerChatLanIpc(): void {
  ipcMain.handle('chatLan.getConfig', () => {
    try {
      return chatLanConfigStore.getAll();
    } catch (error) {
      logError('[ChatLan] getConfig failed:', error);
      return { enabled: false, port: 19890, token: '' };
    }
  });

  ipcMain.handle('chatLan.getStatus', () => {
    try {
      return getChatLanStatus();
    } catch (error) {
      logError('[ChatLan] getStatus failed:', error);
      return { running: false, port: 19890, enabled: false, urls: [] };
    }
  });

  ipcMain.handle(
    'chatLan.setConfig',
    async (_event, payload: { enabled?: boolean; port?: number }) => {
      try {
        if (typeof payload.enabled === 'boolean') {
          chatLanConfigStore.setEnabled(payload.enabled);
        }
        if (typeof payload.port === 'number') {
          chatLanConfigStore.setPort(payload.port);
        }
        await applyChatLanConfig();
        return { ok: true, status: getChatLanStatus(), config: chatLanConfigStore.getAll() };
      } catch (error) {
        logError('[ChatLan] setConfig failed:', error);
        throw error;
      }
    }
  );

  ipcMain.handle('chatLan.regenerateToken', async () => {
    try {
      const token = chatLanConfigStore.regenerateToken();
      await applyChatLanConfig();
      return { token, status: getChatLanStatus() };
    } catch (error) {
      logError('[ChatLan] regenerateToken failed:', error);
      throw error;
    }
  });
}
