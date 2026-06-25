/**
 * @module main/auto-updater
 *
 * Windows-only auto-update from GitHub Releases on the EE fork.
 * macOS/Linux are intentionally excluded (unsigned builds, no release CI).
 */
import { app, dialog } from 'electron';
import type { AppUpdater, UpdateCheckResult as UpdaterCheckResult } from 'electron-updater';
import { isDev } from './main-app-bootstrap';
import { log, logError } from './utils/logger';

const EE_GITHUB_OWNER = 'Emilien-Etadam';
const EE_GITHUB_REPO = 'open-cowork';

export type AppUpdateCheckStatus =
  | 'unavailable'
  | 'available'
  | 'not-available'
  | 'downloaded'
  | 'error';

export interface AppUpdateCheckResponse {
  status: AppUpdateCheckStatus;
  currentVersion: string;
  latestVersion?: string;
  message?: string;
}

let autoUpdaterInstance: AppUpdater | null = null;
let autoUpdaterReady: Promise<AppUpdater | null> | null = null;

function isAutoUpdateSupported(): boolean {
  return !isDev && process.platform === 'win32' && app.isPackaged;
}

function configureAutoUpdater(autoUpdater: AppUpdater): void {
  // Use GitHub /releases/latest (published only) — draft releases in the Atom
  // feed would otherwise break update checks (404 on latest.yml).
  autoUpdater.allowPrerelease = false;
  autoUpdater.autoDownload = true;

  autoUpdater.setFeedURL({
    provider: 'github',
    owner: EE_GITHUB_OWNER,
    repo: EE_GITHUB_REPO,
  });

  autoUpdater.on('checking-for-update', () => {
    log('[AutoUpdater] Checking for updates…');
  });
  autoUpdater.on('update-available', (info) => {
    log('[AutoUpdater] Update available:', info.version);
  });
  autoUpdater.on('update-not-available', (info) => {
    log('[AutoUpdater] Already up to date:', info.version);
  });
  autoUpdater.on('error', (err) => {
    logError('[AutoUpdater] Error:', err);
  });
  autoUpdater.on('download-progress', (progress) => {
    log(`[AutoUpdater] Download ${Math.round(progress.percent)}%`);
  });
  autoUpdater.on('update-downloaded', (info) => {
    log('[AutoUpdater] Update downloaded, will install on quit:', info.version);
    void promptInstallDownloadedUpdate();
  });
}

async function getAutoUpdater(): Promise<AppUpdater | null> {
  if (!isAutoUpdateSupported()) {
    return null;
  }

  if (autoUpdaterInstance) {
    return autoUpdaterInstance;
  }

  if (!autoUpdaterReady) {
    autoUpdaterReady = import('electron-updater')
      .then(({ autoUpdater }) => {
        configureAutoUpdater(autoUpdater);
        autoUpdaterInstance = autoUpdater;
        return autoUpdater;
      })
      .catch((err: unknown) => {
        logError('[AutoUpdater] Failed to load electron-updater:', err);
        return null;
      });
  }

  return autoUpdaterReady;
}

function mapCheckResult(result: UpdaterCheckResult | null): AppUpdateCheckResponse {
  const currentVersion = app.getVersion();

  if (!result) {
    return {
      status: 'error',
      currentVersion,
      message: 'Update check returned no result',
    };
  }

  if (result.downloadPromise) {
    return {
      status: 'available',
      currentVersion,
      latestVersion: result.updateInfo?.version,
    };
  }

  return {
    status: 'not-available',
    currentVersion,
    latestVersion: result.updateInfo?.version ?? currentVersion,
  };
}

export function initAutoUpdater(): void {
  void getAutoUpdater().then((autoUpdater) => {
    if (!autoUpdater) {
      return;
    }

    autoUpdater.checkForUpdatesAndNotify().catch((err: unknown) => {
      logError('[AutoUpdater] Startup update check failed:', err);
    });
  });
}

export async function checkForAppUpdates(): Promise<AppUpdateCheckResponse> {
  const currentVersion = app.getVersion();

  if (!isAutoUpdateSupported()) {
    return {
      status: 'unavailable',
      currentVersion,
      message: 'Auto-update is only available on packaged Windows builds',
    };
  }

  const autoUpdater = await getAutoUpdater();
  if (!autoUpdater) {
    return {
      status: 'error',
      currentVersion,
      message: 'Failed to initialize auto-updater',
    };
  }

  try {
    const result = await autoUpdater.checkForUpdates();
    const mapped = mapCheckResult(result);

    if (mapped.status === 'available' && result?.downloadPromise) {
      await result.downloadPromise;
      return {
        status: 'downloaded',
        currentVersion,
        latestVersion: result.updateInfo?.version,
      };
    }

    return mapped;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown update check error';
    logError('[AutoUpdater] Manual update check failed:', err);
    return {
      status: 'error',
      currentVersion,
      message,
    };
  }
}

export async function quitAndInstallUpdate(): Promise<boolean> {
  const autoUpdater = await getAutoUpdater();
  if (!autoUpdater) {
    return false;
  }

  autoUpdater.quitAndInstall(false, true);
  return true;
}

export async function promptInstallDownloadedUpdate(): Promise<void> {
  const autoUpdater = await getAutoUpdater();
  if (!autoUpdater) {
    return;
  }

  const { response } = await dialog.showMessageBox({
    type: 'info',
    buttons: ['Restart now', 'Later'],
    defaultId: 0,
    cancelId: 1,
    title: 'Update ready',
    message: 'A new version has been downloaded.',
    detail: 'Restart Open Cowork to install the update.',
  });

  if (response === 0) {
    autoUpdater.quitAndInstall(false, true);
  }
}
