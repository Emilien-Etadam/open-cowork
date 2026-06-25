import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, Loader2, RefreshCw } from 'lucide-react';
import { useAppStore } from '../../store';
import { formatEeDisplayVersion } from '../../../shared/app-version';
import type { UpdateCheckResult } from '../../../shared/update-check';

export function SettingsGeneral() {
  const { i18n, t } = useTranslation();
  const settings = useAppStore((s) => s.settings);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const baseLang = i18n.language.split('-')[0];
  const currentLang = baseLang === 'nb' || baseLang === 'nn' ? 'no' : baseLang;
  const [appVer, setAppVer] = useState('');
  const [updateState, setUpdateState] = useState<UpdateCheckResult | null>(null);
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const [updateMessage, setUpdateMessage] = useState<string | null>(null);

  useEffect(() => {
    try {
      const v = window.electronAPI?.getVersion?.();
      if (v instanceof Promise) v.then(setAppVer);
      else if (v) setAppVer(v);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (!window.electronAPI?.on) {
      return;
    }

    return window.electronAPI.on((event) => {
      if (event.type === 'update.checkResult') {
        setUpdateState(event.payload);
        setIsCheckingUpdate(false);
      }
    });
  }, []);

  const displayVersion = appVer ? formatEeDisplayVersion(appVer) : '';

  const applyUpdateResult = useCallback(
    (result: UpdateCheckResult) => {
      setUpdateState(result);

      if (result.status === 'up-to-date') {
        setUpdateMessage(
          t('general.updateUpToDate', {
            version: formatEeDisplayVersion(result.latestVersion ?? result.currentVersion),
          })
        );
        return;
      }

      if (result.status === 'update-available') {
        setUpdateMessage(
          t('general.updateAvailable', {
            version: formatEeDisplayVersion(result.latestVersion ?? ''),
          })
        );
        return;
      }

      if (result.status === 'downloaded') {
        setUpdateMessage(
          t('general.updateDownloaded', {
            version: formatEeDisplayVersion(result.latestVersion ?? result.currentVersion),
          })
        );
        return;
      }

      if (result.status === 'error') {
        setUpdateMessage(t('general.updateError', { error: result.error ?? t('common.error') }));
      }
    },
    [t]
  );

  const handleCheckForUpdates = useCallback(async () => {
    if (!window.electronAPI?.checkForUpdates) {
      return;
    }

    setIsCheckingUpdate(true);
    setUpdateMessage(t('general.updateChecking'));

    try {
      const result = await window.electronAPI.checkForUpdates();
      applyUpdateResult(result);
    } catch (error) {
      setIsCheckingUpdate(false);
      setUpdateMessage(
        t('general.updateError', {
          error: error instanceof Error ? error.message : t('common.error'),
        })
      );
    }
  }, [applyUpdateResult, t]);

  const handleInstallUpdate = useCallback(async () => {
    if (!window.electronAPI?.installUpdate) {
      return;
    }

    await window.electronAPI.installUpdate();
  }, []);

  const handleOpenReleases = useCallback(async () => {
    if (window.electronAPI?.openReleasesPage) {
      await window.electronAPI.openReleasesPage();
      return;
    }

    await window.electronAPI?.openExternal?.(
      'https://github.com/Emilien-Etadam/open-cowork/releases/latest'
    );
  }, []);

  const languages = [
    { code: 'en', nativeName: 'English' },
    { code: 'zh', nativeName: '中文' },
    { code: 'es', nativeName: 'Español' },
    { code: 'fr', nativeName: 'Français' },
    { code: 'de', nativeName: 'Deutsch' },
    { code: 'it', nativeName: 'Italiano' },
    { code: 'uk', nativeName: 'Українська' },
    { code: 'pl', nativeName: 'Polski' },
    { code: 'sv', nativeName: 'Svenska' },
    { code: 'no', nativeName: 'Norsk' },
    { code: 'nl', nativeName: 'Nederlands' },
    { code: 'ro', nativeName: 'Română' },
  ];

  const themeOptions = [
    { value: 'light' as const, label: t('general.themeLight') },
    { value: 'dark' as const, label: t('general.themeDark') },
    { value: 'system' as const, label: t('general.themeSystem', 'System') },
  ];

  const themePresetOptions = [
    { value: 'default' as const, label: t('general.themePresetDefault') },
    { value: 'vscode' as const, label: t('general.themePresetVscode') },
  ];

  const canInstallUpdate = Boolean(updateState?.canInstall);

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <h4 className="text-sm font-medium text-text-primary">{t('general.appearance')}</h4>
        <div className="flex gap-2">
          {themeOptions.map((opt) => (
            <button
              key={opt.value}
              onClick={() => updateSettings({ theme: opt.value })}
              className={`flex-1 px-4 py-2.5 rounded-lg border-2 text-sm font-medium transition-all ${
                settings.theme === opt.value
                  ? 'border-accent bg-accent/5 text-text-primary'
                  : 'border-border bg-surface hover:border-accent/50 text-text-secondary'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-3">
        <h4 className="text-sm font-medium text-text-primary">{t('general.themePreset')}</h4>
        <div className="flex gap-2">
          {themePresetOptions.map((opt) => (
            <button
              key={opt.value}
              onClick={() => updateSettings({ themePreset: opt.value })}
              className={`flex-1 px-4 py-2.5 rounded-lg border-2 text-sm font-medium transition-all ${
                (settings.themePreset ?? 'default') === opt.value
                  ? 'border-accent bg-accent/5 text-text-primary'
                  : 'border-border bg-surface hover:border-accent/50 text-text-secondary'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-3">
        <h4 className="text-sm font-medium text-text-primary">{t('general.language')}</h4>
        <div className="flex gap-2">
          {languages.map((lang) => (
            <button
              key={lang.code}
              onClick={() => i18n.changeLanguage(lang.code)}
              className={`flex-1 px-4 py-2.5 rounded-lg border-2 text-sm font-medium transition-all ${
                currentLang === lang.code
                  ? 'border-accent bg-accent/5 text-text-primary'
                  : 'border-border bg-surface hover:border-accent/50 text-text-secondary'
              }`}
            >
              {lang.nativeName}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-3 pt-4 border-t border-border">
        <h4 className="text-sm font-medium text-text-primary">{t('general.updates')}</h4>
        {displayVersion && (
          <p className="text-sm text-text-secondary">
            {t('general.updateCurrentVersion', { version: displayVersion })}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void handleCheckForUpdates()}
            disabled={isCheckingUpdate}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border border-border bg-surface hover:bg-surface-hover text-sm font-medium text-text-primary disabled:opacity-60"
          >
            {isCheckingUpdate ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4" />
            )}
            {t('general.updateCheck')}
          </button>
          {canInstallUpdate && (
            <button
              type="button"
              onClick={() => void handleInstallUpdate()}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border border-accent bg-accent/10 hover:bg-accent/15 text-sm font-medium text-text-primary"
            >
              <Download className="w-4 h-4" />
              {t('general.updateRestartInstall')}
            </button>
          )}
          <button
            type="button"
            onClick={() => void handleOpenReleases()}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border border-border bg-surface hover:bg-surface-hover text-sm font-medium text-text-secondary"
          >
            {t('general.updateOpenReleases')}
          </button>
        </div>
        {updateMessage && <p className="text-xs text-text-muted">{updateMessage}</p>}
        {updateState?.status === 'update-available' && !canInstallUpdate && (
          <p className="text-xs text-text-muted">{t('general.updateWindowsOnly')}</p>
        )}
      </div>

      {appVer && (
        <div className="pt-2 border-t border-border">
          <p className="text-xs text-text-muted">Open Cowork {displayVersion}</p>
        </div>
      )}
    </div>
  );
}
