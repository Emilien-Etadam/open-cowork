/**
 * @module main/auto-updater
 *
 * Windows-only auto-update from GitHub Releases on the EE fork.
 * macOS/Linux are intentionally excluded (unsigned builds, no release CI).
 */
import { app } from 'electron';
import { isDev } from './main-app-bootstrap';
import { log, logError } from './utils/logger';

const EE_GITHUB_OWNER = 'Emilien-Etadam';
const EE_GITHUB_REPO = 'open-cowork';

export function initAutoUpdater(): void {
  if (isDev || process.platform !== 'win32' || !app.isPackaged) {
    return;
  }

  import('electron-updater')
    .then(({ autoUpdater }) => {
      autoUpdater.allowPrerelease = true;
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
      autoUpdater.on('update-not-available', () => {
        log('[AutoUpdater] Already up to date');
      });
      autoUpdater.on('error', (err) => {
        logError('[AutoUpdater] Error:', err);
      });
      autoUpdater.on('download-progress', (progress) => {
        log(`[AutoUpdater] Download ${Math.round(progress.percent)}%`);
      });
      autoUpdater.on('update-downloaded', (info) => {
        log('[AutoUpdater] Update downloaded, will install on quit:', info.version);
      });

      autoUpdater.checkForUpdatesAndNotify().catch((err: unknown) => {
        logError('[AutoUpdater] Update check failed:', err);
      });
    })
    .catch((err: unknown) => {
      logError('[AutoUpdater] Failed to load electron-updater:', err);
    });
}
