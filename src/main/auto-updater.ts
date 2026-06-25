/**
 * @module main/auto-updater
 *
 * Windows-only auto-update from GitHub Releases on the EE fork.
 * macOS/Linux fall back to a GitHub release tag check for manual verification.
 */
import { createRequire } from 'node:module';
import { app } from 'electron';
import type { UpdateCheckResult } from '../shared/update-check';
import { buildUpdateCheckResult } from '../shared/update-check';
import { isEeVersionNewer, normalizeVersionTag } from '../shared/app-version';
import { isDev } from './main-app-bootstrap';
import { sendToRenderer } from './main-renderer-bridge';
import { log, logError } from './utils/logger';

const EE_GITHUB_OWNER = 'Emilien-Etadam';
const EE_GITHUB_REPO = 'open-cowork';
const LATEST_RELEASE_URL = `https://api.github.com/repos/${EE_GITHUB_OWNER}/${EE_GITHUB_REPO}/releases/latest`;

export type { UpdateCheckResult, UpdateCheckStatus } from '../shared/update-check';

type ElectronUpdater = {
  allowPrerelease: boolean;
  autoDownload: boolean;
  setFeedURL: (options: { provider: 'github'; owner: string; repo: string }) => void;
  on: (event: string, listener: (...args: unknown[]) => void) => void;
  checkForUpdates: () => Promise<{
    updateInfo?: { version?: string };
    downloadPromise?: Promise<unknown>;
  } | null>;
  checkForUpdatesAndNotify: () => Promise<unknown>;
  quitAndInstall: () => void;
};

type ElectronUpdaterModule = {
  autoUpdater?: ElectronUpdater;
  default?: { autoUpdater?: ElectronUpdater };
};

/** Resolve autoUpdater from electron-updater (CJS getter export breaks ESM destructuring). */
export function resolveAutoUpdaterExport(mod: ElectronUpdaterModule): ElectronUpdater | null {
  return mod.autoUpdater ?? mod.default?.autoUpdater ?? null;
}

const nodeRequire = createRequire(import.meta.url);

function loadElectronUpdater(): ElectronUpdater {
  // electron-updater is CJS; dynamic import() leaves `autoUpdater` on `default` only.
  const mod = nodeRequire('electron-updater') as ElectronUpdaterModule;
  const instance = resolveAutoUpdaterExport(mod);
  if (!instance) {
    throw new Error('electron-updater autoUpdater export unavailable');
  }
  return instance;
}

let updater: ElectronUpdater | null = null;
let updaterReady = false;
let downloadedVersion: string | null = null;

function canUseElectronUpdater(): boolean {
  return !isDev && process.platform === 'win32' && app.isPackaged;
}

function notifyRenderer(result: UpdateCheckResult): void {
  sendToRenderer({ type: 'update.checkResult', payload: result });
}

async function fetchLatestGitHubReleaseVersion(): Promise<string | null> {
  const response = await fetch(LATEST_RELEASE_URL, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': `${EE_GITHUB_REPO}-update-check`,
    },
  });

  if (!response.ok) {
    throw new Error(`GitHub API ${response.status}`);
  }

  const payload = (await response.json()) as { tag_name?: string };
  if (!payload.tag_name) {
    return null;
  }

  return normalizeVersionTag(payload.tag_name);
}

function buildResultFromVersions(
  currentVersion: string,
  latestVersion: string | null | undefined,
  autoUpdateSupported = false
): UpdateCheckResult {
  return buildUpdateCheckResult({
    currentVersion,
    latestVersion,
    downloadedVersion,
    autoUpdateSupported,
  });
}

async function checkViaGitHub(currentVersion: string): Promise<UpdateCheckResult> {
  const latestVersion = await fetchLatestGitHubReleaseVersion();
  return buildResultFromVersions(currentVersion, latestVersion, false);
}

async function ensureUpdaterReady(): Promise<ElectronUpdater | null> {
  if (!canUseElectronUpdater()) {
    return null;
  }

  if (updaterReady && updater) {
    return updater;
  }

  const instance = loadElectronUpdater();
  updater = instance;
  updater.allowPrerelease = false;
  updater.autoDownload = true;
  updater.setFeedURL({
    provider: 'github',
    owner: EE_GITHUB_OWNER,
    repo: EE_GITHUB_REPO,
  });

  updater.on('checking-for-update', () => {
    log('[AutoUpdater] Checking for updates…');
  });
  updater.on('update-available', (info) => {
    const version = (info as { version?: string })?.version;
    log('[AutoUpdater] Update available:', version);
  });
  updater.on('update-not-available', () => {
    log('[AutoUpdater] Already up to date');
  });
  updater.on('error', (err) => {
    logError('[AutoUpdater] Error:', err);
  });
  updater.on('download-progress', (progress) => {
    const percent = (progress as { percent?: number })?.percent ?? 0;
    log(`[AutoUpdater] Download ${Math.round(percent)}%`);
  });
  updater.on('update-downloaded', (info) => {
    const version = (info as { version?: string })?.version;
    downloadedVersion = version ?? downloadedVersion;
    log('[AutoUpdater] Update downloaded, will install on quit:', version);
    notifyRenderer({
      status: 'downloaded',
      currentVersion: app.getVersion(),
      latestVersion: version,
      downloaded: true,
      autoUpdateSupported: true,
      canInstall: true,
    });
  });

  updaterReady = true;
  return updater;
}

export function initAutoUpdater(): void {
  if (!canUseElectronUpdater()) {
    return;
  }

  void ensureUpdaterReady()
    .then((instance) => {
      if (!instance) {
        return;
      }
      return instance.checkForUpdatesAndNotify();
    })
    .catch((err: unknown) => {
      logError('[AutoUpdater] Update check failed:', err);
    });
}

export async function checkForAppUpdates(): Promise<UpdateCheckResult> {
  const currentVersion = app.getVersion();

  try {
    if (canUseElectronUpdater()) {
      try {
        const instance = await ensureUpdaterReady();
        if (instance) {
          const result = await instance.checkForUpdates();
          const latestVersion =
            result?.updateInfo?.version ?? (await fetchLatestGitHubReleaseVersion());

          let downloadError: string | undefined;

          if (
            latestVersion &&
            isEeVersionNewer(latestVersion, currentVersion) &&
            result?.downloadPromise
          ) {
            try {
              await result.downloadPromise;
              downloadedVersion = latestVersion;
            } catch (downloadErr) {
              downloadError =
                downloadErr instanceof Error ? downloadErr.message : 'Update download failed';
              logError('[AutoUpdater] Update download failed:', downloadErr);
            }
          } else if (
            latestVersion &&
            isEeVersionNewer(latestVersion, currentVersion) &&
            !result?.downloadPromise
          ) {
            downloadError = 'Update metadata found but download did not start';
            logError('[AutoUpdater]', downloadError);
          }

          const checkResult = buildResultFromVersions(currentVersion, latestVersion, true);
          if (downloadError && checkResult.status === 'update-available') {
            checkResult.downloadError = downloadError;
          }
          notifyRenderer(checkResult);
          return checkResult;
        }
      } catch (electronUpdaterError) {
        logError(
          '[AutoUpdater] electron-updater unavailable, falling back to GitHub API:',
          electronUpdaterError
        );
      }
    }

    const checkResult = await checkViaGitHub(currentVersion);
    notifyRenderer(checkResult);
    return checkResult;
  } catch (error) {
    const checkResult: UpdateCheckResult = {
      status: 'error',
      currentVersion,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
    notifyRenderer(checkResult);
    return checkResult;
  }
}

export function installDownloadedUpdate(): { success: boolean; error?: string } {
  if (!canUseElectronUpdater() || !updater || !downloadedVersion) {
    return { success: false, error: 'No downloaded update available' };
  }

  try {
    updater.quitAndInstall();
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to install update',
    };
  }
}

export function isUpdateCheckSupported(): boolean {
  return canUseElectronUpdater() || app.isPackaged;
}
