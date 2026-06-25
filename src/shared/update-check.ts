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
  canInstall?: boolean;
  message?: string;
  error?: string;
}
