import { isEeVersionNewer } from './app-version';

export type UpdateCheckStatus =
  | 'unsupported'
  | 'up-to-date'
  | 'update-available'
  | 'downloaded'
  | 'error';

export interface UpdateCheckResult {
  status: UpdateCheckStatus;
  currentVersion: string;
  latestVersion?: string;
  downloaded?: boolean;
  /** True when electron-updater can download/install (packaged Windows). */
  autoUpdateSupported?: boolean;
  canInstall?: boolean;
  /** Set when auto-download was attempted but failed (Windows). */
  downloadError?: string;
  message?: string;
  error?: string;
}

export function buildUpdateCheckResult(params: {
  currentVersion: string;
  latestVersion: string | null | undefined;
  downloadedVersion?: string | null;
  autoUpdateSupported?: boolean;
}): UpdateCheckResult {
  const {
    currentVersion,
    latestVersion,
    downloadedVersion = null,
    autoUpdateSupported = false,
  } = params;

  if (!latestVersion) {
    return {
      status: 'error',
      currentVersion,
      error: 'Latest release tag not found',
      autoUpdateSupported,
    };
  }

  if (isEeVersionNewer(latestVersion, currentVersion)) {
    const downloaded = downloadedVersion === latestVersion;
    return {
      status: downloaded ? 'downloaded' : 'update-available',
      currentVersion,
      latestVersion,
      downloaded,
      autoUpdateSupported,
      canInstall: downloaded && autoUpdateSupported,
    };
  }

  return {
    status: 'up-to-date',
    currentVersion,
    latestVersion,
    downloaded: false,
    autoUpdateSupported,
    canInstall: false,
  };
}
