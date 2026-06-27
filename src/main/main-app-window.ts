/**
 * @module main/main-app-window
 *
 * Fenêtre principale, barre de menu, tray et thème natif.
 */
import { app, BrowserWindow, Menu, shell, Tray, nativeTheme } from 'electron';
import { join } from 'path';
import * as fs from 'fs';
import { configStore, type AppTheme } from './config/config-store';
import { log, logWarn, logError } from './utils/logger';
import { mainAppState } from './main-app-state';
import { sendToRenderer } from './main-renderer-bridge';
import { startSandboxBootstrap } from './main-working-dir';
import { revealFileInFolder } from './main-shell-reveal';
import { localPathFromAppUrlPathname, localPathFromFileUrl } from '../shared/local-file-path';

const WINDOW_BACKGROUNDS = {
  dark: '#1e1e1e',
  light: '#ffffff',
} as const;

const TITLE_BAR_SYMBOL_COLORS = {
  dark: '#cccccc',
  light: '#333333',
} as const;

const editMenuItems: Electron.MenuItemConstructorOptions[] = [
  { role: 'undo' },
  { role: 'redo' },
  { type: 'separator' },
  { role: 'cut' },
  { role: 'copy' },
  { role: 'paste' },
  { role: 'selectAll' },
];

async function waitForDevServer(url: string, maxAttempts = 30, intervalMs = 500): Promise<boolean> {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch(url, { method: 'GET' });
      if (response.ok) {
        if (attempt > 1) {
          log(`[App] Dev server ready after ${attempt} attempt(s): ${url}`);
        }
        return true;
      }
    } catch {
      // Ignore and retry until timeout
    }

    if (attempt < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }

  logWarn(`[App] Dev server did not become ready within timeout: ${url}`);
  return false;
}

function buildContextMenu(params: Electron.ContextMenuParams): Menu | null {
  const template: Electron.MenuItemConstructorOptions[] = [];

  if (params.isEditable) {
    template.push(...editMenuItems);
  } else if (params.selectionText) {
    template.push({ role: 'copy' }, { role: 'selectAll' });
  }

  return template.length > 0 ? Menu.buildFromTemplate(template) : null;
}

export function buildApplicationMenu() {
  const template: Electron.MenuItemConstructorOptions[] =
    process.platform === 'darwin'
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              {
                label: 'Preferences…',
                accelerator: 'CmdOrCtrl+,',
                click: () =>
                  mainAppState.mainWindow?.webContents.send('server-event', {
                    type: 'navigate',
                    payload: 'settings',
                  }),
              },
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' },
            ],
          },
          {
            label: 'Edit',
            submenu: editMenuItems,
          },
          {
            label: 'View',
            submenu: [
              { role: 'togglefullscreen' },
              { type: 'separator' },
              { role: 'zoomIn' },
              { role: 'zoomOut' },
              { role: 'resetZoom' },
            ],
          },
          {
            label: 'Window',
            submenu: [
              { role: 'minimize' },
              { role: 'close' },
              { type: 'separator' },
              { role: 'front' },
            ],
          },
        ]
      : [
          {
            label: 'Edit',
            submenu: editMenuItems,
          },
        ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function getResourcePath(fileName: string): string {
  return app.isPackaged
    ? join(process.resourcesPath, fileName)
    : join(__dirname, '../../resources', fileName);
}

function resolveAppIcon(kind: 'window' | 'tray'): string | undefined {
  const candidates =
    kind === 'window'
      ? process.platform === 'darwin'
        ? ['icon.icns']
        : process.platform === 'win32'
          ? ['icon.ico']
          : ['icon.png']
      : process.platform === 'darwin'
        ? ['tray-iconTemplate.png']
        : process.platform === 'win32'
          ? ['tray-icon.ico', 'tray-icon.png']
          : ['tray-icon.png'];

  for (const candidate of candidates) {
    const resolvedPath = getResourcePath(candidate);
    if (fs.existsSync(resolvedPath)) {
      return resolvedPath;
    }
  }

  return undefined;
}

export function setupTray() {
  if (mainAppState.tray) return;

  const resolvedIconPath = resolveAppIcon('tray');

  if (!resolvedIconPath) {
    log('[Tray] Icon not found — skipping tray setup');
    return;
  }

  mainAppState.tray = new Tray(resolvedIconPath);
  mainAppState.tray.setToolTip('Lygodactylus');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show / Hide Window',
      click: () => {
        if (!mainAppState.mainWindow || mainAppState.mainWindow.isDestroyed()) {
          createWindow();
        } else if (mainAppState.mainWindow.isVisible()) {
          mainAppState.mainWindow.hide();
        } else {
          mainAppState.mainWindow.show();
          mainAppState.mainWindow.focus();
        }
      },
    },
    {
      label: 'New Session',
      click: () => {
        if (mainAppState.mainWindow && !mainAppState.mainWindow.isDestroyed()) {
          mainAppState.mainWindow.show();
          mainAppState.mainWindow.focus();
          mainAppState.mainWindow.webContents.send('server-event', { type: 'new-session' });
        }
      },
    },
    {
      label: 'Settings',
      click: () => {
        if (mainAppState.mainWindow && !mainAppState.mainWindow.isDestroyed()) {
          mainAppState.mainWindow.show();
          mainAppState.mainWindow.focus();
          mainAppState.mainWindow.webContents.send('server-event', {
            type: 'navigate',
            payload: 'settings',
          });
        }
      },
    },
    { type: 'separator' },
    { label: 'Quit', role: 'quit' },
  ]);
  mainAppState.tray.setContextMenu(contextMenu);

  mainAppState.tray.on('click', () => {
    if (!mainAppState.mainWindow || mainAppState.mainWindow.isDestroyed()) {
      createWindow();
    } else if (mainAppState.mainWindow.isVisible()) {
      mainAppState.mainWindow.hide();
    } else {
      mainAppState.mainWindow.show();
      mainAppState.mainWindow.focus();
    }
  });
}

export function getSavedThemePreference(): AppTheme {
  const theme = configStore.get('theme');
  return theme === 'dark' || theme === 'system' ? theme : 'light';
}

function getWindowBackground(effectiveTheme: 'dark' | 'light'): string {
  return WINDOW_BACKGROUNDS[effectiveTheme];
}

export function applyWindowBackground(effectiveTheme: 'dark' | 'light'): void {
  if (mainAppState.mainWindow && !mainAppState.mainWindow.isDestroyed()) {
    mainAppState.mainWindow.setBackgroundColor(getWindowBackground(effectiveTheme));
  }
}

export function resolveEffectiveTheme(theme: AppTheme): 'dark' | 'light' {
  if (theme === 'system') {
    return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
  }
  return theme;
}

export function applyNativeThemePreference(theme: AppTheme): void {
  nativeTheme.themeSource = theme;
}

export function createWindow() {
  const savedTheme = getSavedThemePreference();
  applyNativeThemePreference(savedTheme);
  const effectiveTheme = resolveEffectiveTheme(savedTheme);
  const THEME =
    effectiveTheme === 'dark'
      ? {
          background: getWindowBackground('dark'),
          titleBar: getWindowBackground('dark'),
          titleBarSymbol: TITLE_BAR_SYMBOL_COLORS.dark,
        }
      : {
          background: getWindowBackground('light'),
          titleBar: getWindowBackground('light'),
          titleBarSymbol: TITLE_BAR_SYMBOL_COLORS.light,
        };

  const isMac = process.platform === 'darwin';
  const isWindows = process.platform === 'win32';

  const windowOptions: Electron.BrowserWindowConstructorOptions = {
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: THEME.background,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  };

  const windowIcon = resolveAppIcon('window');
  if (windowIcon) {
    windowOptions.icon = windowIcon;
  }

  if (isMac) {
    windowOptions.titleBarStyle = 'hiddenInset';
    windowOptions.trafficLightPosition = { x: 16, y: 12 };
  } else if (isWindows) {
    windowOptions.frame = false;
  } else {
    windowOptions.frame = false;
  }

  mainAppState.mainWindow = new BrowserWindow(windowOptions);

  if (!isMac) {
    mainAppState.mainWindow.setMenuBarVisibility(false);
  }

  mainAppState.mainWindow.webContents.on('context-menu', (_event, params) => {
    const menu = buildContextMenu(params);
    if (menu && mainAppState.mainWindow) {
      menu.popup({ window: mainAppState.mainWindow });
    }
  });

  const allowedOrigins = new Set<string>();
  if (process.env.VITE_DEV_SERVER_URL) {
    try {
      allowedOrigins.add(new URL(process.env.VITE_DEV_SERVER_URL).origin);
    } catch {
      // 忽略无效的开发服务地址
    }
  }
  const allowedProtocols = new Set<string>(['file:', 'devtools:']);

  const isExternalUrl = (url: string) => {
    try {
      const parsed = new URL(url);
      if (allowedProtocols.has(parsed.protocol)) {
        return false;
      }
      if (allowedOrigins.has(parsed.origin)) {
        return false;
      }
      return true;
    } catch {
      return true;
    }
  };

  const extractLocalPathFromNavigationUrl = (url: string): string | null => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === 'file:') {
        return localPathFromFileUrl(url);
      }
      if (!allowedOrigins.has(parsed.origin)) {
        return null;
      }
      return localPathFromAppUrlPathname(parsed.pathname || '');
    } catch {
      return null;
    }
  };

  async function revealNavigationTarget(url: string): Promise<boolean> {
    const localPath = extractLocalPathFromNavigationUrl(url);
    if (!localPath) {
      return false;
    }
    return revealFileInFolder(localPath);
  }

  mainAppState.mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    const localPath = extractLocalPathFromNavigationUrl(url);
    if (localPath) {
      void revealNavigationTarget(url);
      return { action: 'deny' };
    }
    if (isExternalUrl(url)) {
      void shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  mainAppState.mainWindow.webContents.on('will-navigate', (event, url) => {
    const localPath = extractLocalPathFromNavigationUrl(url);
    if (localPath) {
      event.preventDefault();
      void revealNavigationTarget(url);
      return;
    }
    if (isExternalUrl(url)) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    const devServerUrl = process.env.VITE_DEV_SERVER_URL;
    void (async () => {
      await waitForDevServer(devServerUrl, 40, 500);
      if (!mainAppState.mainWindow || mainAppState.mainWindow.isDestroyed()) return;

      try {
        await mainAppState.mainWindow.loadURL(devServerUrl);
      } catch (error) {
        logError('[App] Failed to load dev server URL:', error);
      }
    })();
  } else {
    mainAppState.mainWindow.loadFile(join(__dirname, '../../dist/index.html'));
  }

  mainAppState.mainWindow.on('closed', () => {
    mainAppState.mainWindow = null;
  });

  mainAppState.mainWindow.webContents.on('did-finish-load', () => {
    const isConfigured = configStore.isConfigured();
    log('[Config] Notifying renderer, isConfigured:', isConfigured);
    sendToRenderer({
      type: 'config.status',
      payload: {
        isConfigured,
        config: configStore.getAll(),
      },
    });

    sendToRenderer({
      type: 'workdir.changed',
      payload: { path: mainAppState.currentWorkingDir || '' },
    });

    startSandboxBootstrap();
  });
}
