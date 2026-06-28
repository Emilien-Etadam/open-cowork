/**
 * @module main/ipc/ipc-sandbox-logs
 */
import { app, ipcMain, dialog, shell } from 'electron';
import * as fs from 'fs';
import { configStore } from '../config/config-store';
import { resolveAgentCliPath } from '../config/agent-cli-path';
import { getSandboxAdapter } from '../sandbox/sandbox-adapter';
import { WSLBridge } from '../sandbox/wsl-bridge';
import { LimaBridge } from '../sandbox/lima-bridge';
import { getSandboxBootstrap } from '../sandbox/sandbox-bootstrap';
import {
  log,
  logWarn,
  logError,
  getLogFilePath,
  getLogsDirectory,
  getAllLogFiles,
  closeLogFile,
  setDevLogsEnabled,
  isDevLogsEnabled,
} from '../utils/logger';
import { buildDiagnosticsSummary } from '../utils/diagnostics-summary';
import { sanitizeDiagnosticBaseUrl } from '../main-shell-reveal';
import { mainAppState } from '../main-app-state';
import { sendToRenderer } from '../main-renderer-bridge';

export function registerSandboxLogsIpc(): void {
  ipcMain.handle('sandbox.getStatus', async () => {
    try {
      const adapter = getSandboxAdapter();
      const platform = process.platform;

      if (platform === 'win32') {
        const wslStatus = await WSLBridge.checkWSLStatus();
        return {
          platform: 'win32',
          mode: adapter.initialized ? adapter.mode : 'none',
          initialized: adapter.initialized,
          wsl: wslStatus,
          lima: null,
        };
      } else if (platform === 'darwin') {
        const limaStatus = await LimaBridge.checkLimaStatus();
        return {
          platform: 'darwin',
          mode: adapter.initialized ? adapter.mode : 'native',
          initialized: adapter.initialized,
          wsl: null,
          lima: limaStatus,
        };
      } else {
        return {
          platform,
          mode: adapter.initialized ? adapter.mode : 'native',
          initialized: adapter.initialized,
          wsl: null,
          lima: null,
        };
      }
    } catch (error) {
      logError('[Sandbox] Error getting status:', error);
      return {
        platform: process.platform,
        mode: 'none',
        initialized: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  ipcMain.handle('sandbox.checkWSL', async () => {
    try {
      return await WSLBridge.checkWSLStatus();
    } catch (error) {
      logError('[Sandbox] Error checking WSL:', error);
      return { available: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle('sandbox.installNodeInWSL', async (_event, distro: string) => {
    try {
      return await WSLBridge.installNodeInWSL(distro);
    } catch (error) {
      logError('[Sandbox] Error installing Node.js:', error);
      return false;
    }
  });

  ipcMain.handle('sandbox.installPythonInWSL', async (_event, distro: string) => {
    try {
      return await WSLBridge.installPythonInWSL(distro);
    } catch (error) {
      logError('[Sandbox] Error installing Python:', error);
      return false;
    }
  });

  ipcMain.handle('sandbox.checkLima', async () => {
    try {
      return await LimaBridge.checkLimaStatus();
    } catch (error) {
      logError('[Sandbox] Error checking Lima:', error);
      return { available: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle('sandbox.createLimaInstance', async () => {
    try {
      return await LimaBridge.createLimaInstance();
    } catch (error) {
      logError('[Sandbox] Error creating Lima instance:', error);
      return false;
    }
  });

  ipcMain.handle('sandbox.startLimaInstance', async () => {
    try {
      return await LimaBridge.startLimaInstance();
    } catch (error) {
      logError('[Sandbox] Error starting Lima instance:', error);
      return false;
    }
  });

  ipcMain.handle('sandbox.stopLimaInstance', async () => {
    try {
      return await LimaBridge.stopLimaInstance();
    } catch (error) {
      logError('[Sandbox] Error stopping Lima instance:', error);
      return false;
    }
  });

  ipcMain.handle('sandbox.installNodeInLima', async () => {
    try {
      return await LimaBridge.installNodeInLima();
    } catch (error) {
      logError('[Sandbox] Error installing Node.js in Lima:', error);
      return false;
    }
  });

  ipcMain.handle('sandbox.installPythonInLima', async () => {
    try {
      return await LimaBridge.installPythonInLima();
    } catch (error) {
      logError('[Sandbox] Error installing Python in Lima:', error);
      return false;
    }
  });

  ipcMain.handle('sandbox.retryLimaSetup', async () => {
    if (process.platform !== 'darwin') {
      return { success: false, error: 'Lima is only available on macOS' };
    }

    try {
      const bootstrap = getSandboxBootstrap();
      bootstrap.setProgressCallback((progress) => {
        sendToRenderer({
          type: 'sandbox.progress',
          payload: progress,
        });
      });

      try {
        await LimaBridge.stopLimaInstance();
      } catch (error) {
        logError('[Sandbox] Error stopping Lima before retry:', error);
      }

      bootstrap.reset();
      const result = await bootstrap.bootstrap();
      const success = !result.error;
      return { success, result, error: result.error };
    } catch (error) {
      logError('[Sandbox] Error retrying Lima setup:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle('sandbox.retrySetup', async () => {
    try {
      const bootstrap = getSandboxBootstrap();
      bootstrap.setProgressCallback((progress) => {
        sendToRenderer({
          type: 'sandbox.progress',
          payload: progress,
        });
      });

      bootstrap.reset();
      const result = await bootstrap.bootstrap();
      const success = !result.error;
      return { success, result, error: result.error };
    } catch (error) {
      logError('[Sandbox] Error retrying setup:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle('logs.getPath', () => {
    try {
      return getLogFilePath();
    } catch (error) {
      logError('[Logs] Error getting log path:', error);
      return null;
    }
  });

  ipcMain.handle('logs.getDirectory', () => {
    try {
      return getLogsDirectory();
    } catch (error) {
      logError('[Logs] Error getting logs directory:', error);
      return null;
    }
  });

  ipcMain.handle('logs.getAll', () => {
    try {
      return getAllLogFiles();
    } catch (error) {
      logError('[Logs] Error getting all log files:', error);
      return [];
    }
  });

  ipcMain.handle('logs.export', async () => {
    try {
      const logFiles = getAllLogFiles();
      const diagnosticsSummary = buildDiagnosticsSummary({
        app: {
          version: app.getVersion(),
          isPackaged: app.isPackaged,
          platform: process.platform,
          arch: process.arch,
          nodeVersion: process.version,
          electronVersion: process.versions.electron,
          chromeVersion: process.versions.chrome,
        },
        runtime: {
          currentWorkingDir: mainAppState.currentWorkingDir,
          logsDirectory: getLogsDirectory(),
          logFileCount: logFiles.length,
          totalLogSizeBytes: logFiles.reduce((total, file) => total + file.size, 0),
          devLogsEnabled: isDevLogsEnabled(),
        },
        config: {
          provider: configStore.get('provider'),
          model: configStore.get('model'),
          baseUrl: sanitizeDiagnosticBaseUrl(configStore.get('baseUrl') || undefined),
          customProtocol: configStore.get('customProtocol') || null,
          sandboxEnabled: !!configStore.get('sandboxEnabled'),
          thinkingEnabled: !!configStore.get('enableThinking'),
          apiKeyConfigured: !!configStore.get('apiKey'),
          claudeCodePathConfigured: !!resolveAgentCliPath(configStore.getAll()),
          agentCliPathConfigured: !!resolveAgentCliPath(configStore.getAll()),
          defaultWorkdir: configStore.get('defaultWorkdir') || null,
          globalSkillsPathConfigured: !!configStore.get('globalSkillsPath'),
        },
        sandbox: {
          mode: getSandboxAdapter().mode,
          initialized: getSandboxAdapter().initialized,
        },
        sessions: mainAppState.sessionManager ? mainAppState.sessionManager.listSessions() : [],
        logFiles,
        deps: {
          getMessages: (sessionId: string) =>
            mainAppState.sessionManager ? mainAppState.sessionManager.getMessages(sessionId) : [],
          getTraceSteps: (sessionId: string) =>
            mainAppState.sessionManager ? mainAppState.sessionManager.getTraceSteps(sessionId) : [],
        },
      });

      const result = await dialog.showSaveDialog(mainAppState.mainWindow!, {
        title: 'Export Logs',
        defaultPath: `lygodactylus-logs-${new Date().toISOString().split('T')[0]}.zip`,
        filters: [
          { name: 'ZIP Archive', extensions: ['zip'] },
          { name: 'All Files', extensions: ['*'] },
        ],
      });

      if (result.canceled || !result.filePath) {
        return { success: false, error: 'User cancelled' };
      }

      const archiver = await import('archiver');
      const output = fs.createWriteStream(result.filePath);
      const archive = archiver.default('zip', { zlib: { level: 9 } });

      return new Promise((resolve) => {
        let settled = false;
        const settle = (value: {
          success: boolean;
          path?: string;
          size?: number;
          error?: string;
        }) => {
          if (settled) {
            return;
          }
          settled = true;
          resolve(value);
        };

        output.on('close', () => {
          log('[Logs] Exported logs to:', result.filePath);
          settle({
            success: true,
            path: result.filePath,
            size: archive.pointer(),
          });
        });

        output.on('error', (err: Error) => {
          logError('[Logs] Error writing exported archive:', err);
          settle({ success: false, error: err.message });
        });

        archive.on('error', (err: Error) => {
          logError('[Logs] Error creating archive:', err);
          settle({ success: false, error: err.message });
        });

        archive.pipe(output);

        for (const logFile of logFiles) {
          archive.file(logFile.path, { name: logFile.name });
        }

        const systemInfo = {
          platform: process.platform,
          arch: process.arch,
          nodeVersion: process.version,
          electronVersion: process.versions.electron,
          appVersion: app.getVersion(),
          exportDate: new Date().toISOString(),
          logFiles: logFiles.map((f) => ({
            name: f.name,
            size: f.size,
            modified: f.mtime,
          })),
        };
        archive.append(JSON.stringify(systemInfo, null, 2), { name: 'system-info.json' });
        archive.append(JSON.stringify(diagnosticsSummary, null, 2), {
          name: 'diagnostics-summary.json',
        });
        archive.append(
          [
            'Lygodactylus diagnostic bundle',
            `Exported at: ${diagnosticsSummary.exportedAt}`,
            '',
            'Included files:',
            '- Application log files (*.log)',
            '- system-info.json',
            '- diagnostics-summary.json',
            '',
            'diagnostics-summary.json contains a redacted runtime/config snapshot,',
            'plus metadata-only session summaries and recent error traces to speed up debugging.',
          ].join('\n'),
          { name: 'README.txt' }
        );

        archive.finalize();
      });
    } catch (error) {
      logError('[Logs] Error exporting logs:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle('logs.open', async () => {
    try {
      const logsDir = getLogsDirectory();
      await shell.openPath(logsDir);
      return { success: true };
    } catch (error) {
      logError('[Logs] Error opening logs directory:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle('logs.clear', async () => {
    try {
      const logFiles = getAllLogFiles();

      closeLogFile();

      for (const logFile of logFiles) {
        try {
          fs.unlinkSync(logFile.path);
          log('[Logs] Deleted log file:', logFile.name);
        } catch (err) {
          logError('[Logs] Failed to delete log file:', logFile.name, err);
        }
      }

      log('[Logs] Log files cleared and reinitialized');

      return { success: true, deletedCount: logFiles.length };
    } catch (error) {
      logError('[Logs] Error clearing logs:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle('logs.setEnabled', async (_event, enabled: boolean) => {
    try {
      setDevLogsEnabled(enabled);
      configStore.set('enableDevLogs', enabled);
      log('[Logs] Developer logs', enabled ? 'enabled' : 'disabled');
      return { success: true, enabled };
    } catch (error) {
      logError('[Logs] Error setting dev logs enabled:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle('logs.isEnabled', () => {
    try {
      return { success: true, enabled: isDevLogsEnabled() };
    } catch (error) {
      logError('[Logs] Error getting dev logs enabled:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle('logs.write', (_event, level: 'info' | 'warn' | 'error', args: unknown[]) => {
    try {
      if (level === 'warn') {
        logWarn(...args);
      } else if (level === 'error') {
        logError(...args);
      } else {
        log(...args);
      }
      return { success: true };
    } catch (error) {
      console.error('[Logs] Error writing log:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });
}
