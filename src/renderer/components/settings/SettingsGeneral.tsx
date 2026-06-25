import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../store';

export function SettingsGeneral() {
  const { i18n, t } = useTranslation();
  const settings = useAppStore((s) => s.settings);
  const updateSettings = useAppStore((s) => s.updateSettings);
  // Normalize the active language to its base code so the highlight matches
  // every supported language (e.g. "es-ES" -> "es", "zh-CN" -> "zh"), and map
  // Norwegian variants (nb/nn) to the "no" locale we ship.
  const baseLang = i18n.language.split('-')[0];
  const currentLang = baseLang === 'nb' || baseLang === 'nn' ? 'no' : baseLang;
  const [appVer, setAppVer] = useState('');
  const [updateStatus, setUpdateStatus] = useState<string | null>(null);
  const [updateChecking, setUpdateChecking] = useState(false);
  const [updateReady, setUpdateReady] = useState(false);
  const isWindowsDesktop =
    typeof window !== 'undefined' &&
    window.electronAPI?.platform === 'win32' &&
    !!window.electronAPI?.getVersion;
  useEffect(() => {
    try {
      const v = window.electronAPI?.getVersion?.();
      if (v instanceof Promise) v.then(setAppVer);
      else if (v) setAppVer(v);
    } catch {
      /* ignore */
    }
  }, []);

  const handleCheckForUpdates = async () => {
    if (!window.electronAPI?.checkForUpdates) {
      setUpdateStatus(t('general.updateUnavailable'));
      return;
    }

    setUpdateChecking(true);
    setUpdateStatus(t('general.checkingForUpdates'));
    setUpdateReady(false);

    try {
      const result = await window.electronAPI.checkForUpdates();
      switch (result.status) {
        case 'downloaded':
          setUpdateReady(true);
          setUpdateStatus(
            t('general.updateDownloaded', { version: result.latestVersion ?? '?' })
          );
          break;
        case 'available':
          setUpdateStatus(
            t('general.updateAvailable', { version: result.latestVersion ?? '?' })
          );
          break;
        case 'not-available':
          setUpdateStatus(
            t('general.updateNotAvailable', { version: result.latestVersion ?? result.currentVersion })
          );
          break;
        case 'unavailable':
          setUpdateStatus(t('general.updateUnavailable'));
          break;
        case 'error':
        default:
          setUpdateStatus(
            t('general.updateError', { message: result.message ?? 'Unknown error' })
          );
          break;
      }
    } catch {
      setUpdateStatus(t('general.updateError', { message: 'Unknown error' }));
    } finally {
      setUpdateChecking(false);
    }
  };

  const handleRestartToUpdate = async () => {
    await window.electronAPI?.quitAndInstallUpdate?.();
  };

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

  return (
    <div className="space-y-6">
      {/* Theme */}
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

      {/* Theme preset */}
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

      {/* Language */}
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

      {/* About & updates */}
      {appVer && (
        <div className="pt-4 border-t border-border space-y-3">
          <p className="text-xs text-text-muted">Open Cowork v{appVer}</p>
          {isWindowsDesktop && (
            <div className="space-y-2">
              <h4 className="text-sm font-medium text-text-primary">{t('general.updates')}</h4>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void handleCheckForUpdates()}
                  disabled={updateChecking}
                  className="px-3 py-1.5 rounded-lg border border-border bg-surface text-sm text-text-primary hover:border-accent/50 disabled:opacity-60"
                >
                  {updateChecking ? t('general.checkingForUpdates') : t('general.checkForUpdates')}
                </button>
                {updateReady && (
                  <button
                    type="button"
                    onClick={() => void handleRestartToUpdate()}
                    className="px-3 py-1.5 rounded-lg border border-accent bg-accent/10 text-sm text-text-primary hover:bg-accent/20"
                  >
                    {t('general.restartToUpdate')}
                  </button>
                )}
              </div>
              {updateStatus && <p className="text-xs text-text-secondary">{updateStatus}</p>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
