/**
 * @module main/main-app-lifecycle
 *
 * Nettoyage sandbox/MCP et gestion de la fermeture de l'application.
 */
import { app } from 'electron';
import { closeDatabase } from './db/database';
import { SandboxSync } from './sandbox/sandbox-sync';
import { shutdownSandbox } from './sandbox/sandbox-adapter';
import { stopNavServer } from './nav-server';
import { stopChatLanServer } from './chat-lan-server';
import { log, logError, closeLogFile } from './utils/logger';
import { mainAppState } from './main-app-state';

function withTimeout<T>(operation: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
      timeoutMs
    );
  });

  return Promise.race([operation, timeoutPromise]).finally(() => {
    if (timer) {
      clearTimeout(timer);
    }
  }) as Promise<T>;
}

async function cleanupSandboxResources(): Promise<void> {
  if (mainAppState.isCleaningUp) {
    log('[App] Cleanup already in progress, skipping...');
    return;
  }
  mainAppState.isCleaningUp = true;

  stopNavServer();
  await stopChatLanServer();
  mainAppState.skillsManager?.stopStorageMonitoring();
  mainAppState.scheduledTaskManager?.stop();
  mainAppState.tray?.destroy();
  mainAppState.tray = null;

  try {
    log('[App] Cleaning up all sandbox sessions...');

    await withTimeout(SandboxSync.cleanupAllSessions(), 30000, 'WSL session cleanup');

    const { LimaSync } = await import('./sandbox/lima-sync');
    await withTimeout(LimaSync.cleanupAllSessions(), 30000, 'Lima session cleanup');

    log('[App] Sandbox sessions cleanup complete');
  } catch (error) {
    logError('[App] Error cleaning up sandbox sessions:', error);
  }

  try {
    await withTimeout(shutdownSandbox(), 8000, 'Sandbox shutdown');
    log('[App] Sandbox shutdown complete');
  } catch (error) {
    logError('[App] Error shutting down sandbox:', error);
  }

  try {
    const mcpManager = mainAppState.sessionManager?.getMCPManager();
    if (mcpManager) {
      log('[App] Shutting down MCP servers...');
      await withTimeout(mcpManager.shutdown(), 5000, 'MCP shutdown');
      log('[App] MCP servers shutdown complete');
    }
  } catch (error) {
    logError('[App] Error shutting down MCP servers:', error);
  }

  try {
    closeDatabase();
  } catch (error) {
    logError('[App] Error closing database:', error);
  }

  closeLogFile();
}

export function registerAppLifecycle(): void {
  app.on('window-all-closed', async () => {
    if (process.platform !== 'darwin' || process.env.VITE_DEV_SERVER_URL) {
      await cleanupSandboxResources();
      app.quit();
    }
  });

  for (const sig of ['SIGTERM', 'SIGINT'] as const) {
    process.on(sig, () => app.quit());
  }

  app.on('before-quit', async (event) => {
    if (!mainAppState.isCleaningUp) {
      if (process.env.VITE_DEV_SERVER_URL) {
        stopNavServer();
        await stopChatLanServer();
        try {
          closeDatabase();
        } catch {
          /* best-effort */
        }
        closeLogFile();
        mainAppState.tray?.destroy();
        mainAppState.tray = null;
        return;
      }
      mainAppState.isCleaningUp = true;
      event.preventDefault();
      try {
        await cleanupSandboxResources();
      } catch (error) {
        logError('[App] before-quit cleanup failed, forcing quit:', error);
      }
      app.quit();
    }
  });
}
