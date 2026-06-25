/**
 * @module main/index
 *
 * Electron main-process entry point.
 *
 * Responsibilities:
 * - App lifecycle: ready, activate, before-quit, window-will-close
 * - Central IPC hub: ~60 handlers namespaced as config.*, mcp.*, session.*,
 *   sandbox.*, logs.*, remote.*, schedule.*, etc.
 * - BrowserWindow creation and deep-link / protocol handling
 */
import { app, BrowserWindow, dialog, Menu, nativeTheme } from 'electron';
import { resolve } from 'path';
import { config } from 'dotenv';
import { initDatabase } from './db/database';
import { SessionManager } from './session/session-manager';
import { SkillsManager } from './skills/skills-manager';
import { PluginRuntimeService } from './skills/plugin-runtime-service';
import { MarketplaceService } from './catalog/marketplace-service';
import { MemoryService } from './memory/memory-service';
import { MemoryExtension } from './memory/memory-extension';
import { AgentRuntimeExtensionManager } from './extensions/agent-runtime-extension-manager';
import { configStore } from './config/config-store';
import { mt } from './i18n';
import { remoteManager } from './remote/remote-manager';
import { remoteConfigStore } from './remote/remote-config-store';
import { startNavServer } from './nav-server';
import { createScheduledTaskStore } from './schedule/scheduled-task-store';
import { initAutoUpdater } from './auto-updater';
import { log, logWarn, logError, setDevLogsEnabled } from './utils/logger';
import { mainAppState } from './main-app-state';
import { sendToRenderer } from './main-renderer-bridge';
import { initializeDefaultWorkingDir } from './main-working-dir';
import {
  createWindow,
  setupTray,
  buildApplicationMenu,
  getSavedThemePreference,
  getSavedThemePreset,
  applyWindowBackground,
} from './main-app-window';
import { registerAppBootstrap } from './main-app-bootstrap';
import { registerAppLifecycle } from './main-app-lifecycle';
import { registerMainIpc } from './ipc/register-main-ipc';
import { createScheduledTaskManager, createAgentExecutor } from './ipc/ipc-remote-schedule-memory';

const envPath = resolve(__dirname, '../../.env');
log('[dotenv] Loading from:', envPath);
const dotenvResult = config({ path: envPath });
if (dotenvResult.error) {
  logWarn('[dotenv] Failed to load .env:', dotenvResult.error.message);
} else {
  log('[dotenv] Loaded successfully');
}

if (configStore.isConfigured()) {
  log('[Config] Applying saved configuration...');
  configStore.applyToEnv();
}

app.disableHardwareAcceleration();

registerAppBootstrap(createWindow);
registerMainIpc();
registerAppLifecycle();

app
  .whenReady()
  .then(async () => {
    if (process.argv.includes('--smoke-test')) {
      log('[SmokeTest] App launched successfully in smoke test mode');
      log('[SmokeTest] Platform:', process.platform, 'Arch:', process.arch);
      log('[SmokeTest] Electron:', process.versions.electron, 'Node:', process.versions.node);
      try {
        require('better-sqlite3');
        log('[SmokeTest] better-sqlite3: OK');
      } catch (e) {
        log('[SmokeTest] FAIL: better-sqlite3 failed to load:', e);
        process.exit(1);
      }
      log('[SmokeTest] PASSED');
      process.exit(0);
    }

    const enableDevLogs = configStore.get('enableDevLogs');
    setDevLogsEnabled(enableDevLogs);

    log('=== Open Cowork Starting ===');
    log('Config file:', configStore.getPath());
    log('Is configured:', configStore.isConfigured());
    log('[Runtime] Using Open Cowork agent SDK for all providers');
    log('Developer logs:', enableDevLogs ? 'Enabled' : 'Disabled');
    log('Environment Variables:');
    log('  ANTHROPIC_AUTH_TOKEN:', process.env.ANTHROPIC_AUTH_TOKEN ? '✓ Set' : '✗ Not set');
    log('  ANTHROPIC_BASE_URL:', process.env.ANTHROPIC_BASE_URL || '(not set)');
    log('  CLAUDE_MODEL:', process.env.CLAUDE_MODEL || '(not set)');
    log('  CLAUDE_CODE_PATH:', process.env.CLAUDE_CODE_PATH || '(not set)');
    log('  OPENAI_API_KEY:', process.env.OPENAI_API_KEY ? '✓ Set' : '✗ Not set');
    log('  OPENAI_BASE_URL:', process.env.OPENAI_BASE_URL || '(not set)');
    log('  OPENAI_MODEL:', process.env.OPENAI_MODEL || '(not set)');
    log('  OPENAI_API_MODE:', process.env.OPENAI_API_MODE || '(default)');
    log('===========================');

    initializeDefaultWorkingDir();
    log('Working directory:', mainAppState.currentWorkingDir);
    remoteManager.setDefaultWorkingDirectory(mainAppState.currentWorkingDir || undefined);

    const db = initDatabase();

    mainAppState.pluginRuntimeService = new PluginRuntimeService();
    mainAppState.memoryService = new MemoryService(db);
    const extensionManager = new AgentRuntimeExtensionManager([
      new MemoryExtension(mainAppState.memoryService),
    ]);

    mainAppState.sessionManager = new SessionManager(
      db,
      sendToRenderer,
      mainAppState.pluginRuntimeService,
      extensionManager
    );
    mainAppState.skillsManager = new SkillsManager(db, {
      getConfiguredGlobalSkillsPath: () => configStore.get('globalSkillsPath') || '',
      setConfiguredGlobalSkillsPath: (nextPath: string) => {
        configStore.update({ globalSkillsPath: nextPath });
      },
      watchStorage: true,
    });
    mainAppState.marketplaceService = new MarketplaceService(
      mainAppState.skillsManager,
      mainAppState.pluginRuntimeService
    );
    mainAppState.skillsManager.onStorageChanged((event) => {
      sendToRenderer({
        type: 'skills.storageChanged',
        payload: event,
      });
    });

    buildApplicationMenu();
    setupTray();
    createWindow();

    if (process.platform === 'darwin') {
      const dockMenu = Menu.buildFromTemplate([
        {
          label: 'New Session',
          click: () =>
            mainAppState.mainWindow?.webContents.send('server-event', { type: 'new-session' }),
        },
        {
          label: 'Settings',
          click: () =>
            mainAppState.mainWindow?.webContents.send('server-event', {
              type: 'navigate',
              payload: 'settings',
            }),
        },
      ]);
      app.dock?.setMenu(dockMenu);
    }

    if (mainAppState.mainWindow && !mainAppState.mainWindow.isDestroyed()) {
      mainAppState.mainWindow.webContents.on('did-finish-load', () => {
        sendToRenderer({
          type: 'native-theme.changed',
          payload: { shouldUseDarkColors: nativeTheme.shouldUseDarkColors },
        });
      });
    }

    nativeTheme.on('updated', () => {
      sendToRenderer({
        type: 'native-theme.changed',
        payload: { shouldUseDarkColors: nativeTheme.shouldUseDarkColors },
      });
      if (
        getSavedThemePreference() === 'system' &&
        mainAppState.mainWindow &&
        !mainAppState.mainWindow.isDestroyed()
      ) {
        const preset = getSavedThemePreset();
        const effectiveTheme = nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
        applyWindowBackground(preset, effectiveTheme);
      }
    });

    initAutoUpdater();

    startNavServer(() => mainAppState.mainWindow);

    const scheduledTaskStore = createScheduledTaskStore(db);
    mainAppState.scheduledTaskManager = createScheduledTaskManager(scheduledTaskStore);
    mainAppState.scheduledTaskManager.start();

    remoteManager.setRendererCallback(sendToRenderer);
    remoteManager.setAgentExecutor(createAgentExecutor());

    if (remoteConfigStore.isEnabled()) {
      remoteManager.start().catch((error) => {
        logError('[App] Failed to start remote control:', error);
      });
    }

    app.on('activate', () => {
      const hasVisibleWindow = BrowserWindow.getAllWindows().some((w) => !w.isDestroyed());
      if (!hasVisibleWindow) {
        createWindow();
      }
    });
  })
  .catch((error) => {
    logError('[App] Startup failed:', error);
    const message = error instanceof Error ? error.message : 'Unknown startup error';
    dialog.showErrorBox(mt('startupFailedTitle'), mt('startupFailedBody', { message }));
    app.quit();
  });
