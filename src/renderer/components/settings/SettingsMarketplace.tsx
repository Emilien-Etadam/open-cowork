import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertCircle,
  CheckCircle,
  FolderOpen,
  Globe,
  Loader2,
  Package,
  Plug,
  Power,
  PowerOff,
  RefreshCw,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import type { CatalogEntryType, MarketplaceEntry } from '../../types';
import { SettingsContentSection } from './shared';

const isElectron = typeof window !== 'undefined' && window.electronAPI !== undefined;

type MarketplaceFilter = 'all' | CatalogEntryType;
type MarketplaceView = 'marketplace' | 'installed' | 'storage';

export function SettingsMarketplace({ isActive }: { isActive: boolean }) {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<MarketplaceEntry[]>([]);
  const [storagePath, setStoragePath] = useState('');
  const [filter, setFilter] = useState<MarketplaceFilter>('all');
  const [view, setView] = useState<MarketplaceView>('marketplace');
  const [isLoading, setIsLoading] = useState(false);
  const [actionId, setActionId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [envTarget, setEnvTarget] = useState<MarketplaceEntry | null>(null);
  const [envValues, setEnvValues] = useState<Record<string, string>>({});

  const loadEntries = useCallback(
    async (forceRefresh = false) => {
      if (!isElectron) {
        return;
      }
      setIsLoading(true);
      try {
        const [catalog, path] = await Promise.all([
          window.electronAPI.marketplace.list(forceRefresh),
          window.electronAPI.skills.getStoragePath(),
        ]);
        setEntries(catalog);
        setStoragePath(path || '');
        setError('');
      } catch (err) {
        setError(err instanceof Error ? err.message : t('marketplace.failedToLoad'));
      } finally {
        setIsLoading(false);
      }
    },
    [t]
  );

  useEffect(() => {
    if (isActive) {
      void loadEntries();
    }
  }, [isActive, loadEntries]);

  const filteredEntries = useMemo(() => {
    let list = entries;
    if (view === 'installed') {
      list = list.filter(
        (entry) => entry.installState === 'installed' || entry.installState === 'builtin'
      );
    }
    if (filter === 'all') {
      return list;
    }
    return list.filter((entry) => entry.type === filter);
  }, [entries, filter, view]);

  async function handleInstall(entry: MarketplaceEntry) {
    if (!isElectron) {
      return;
    }
    if (entry.requiresEnv?.length) {
      const initial: Record<string, string> = {};
      for (const key of entry.requiresEnv) {
        initial[key] = envValues[key] || '';
      }
      setEnvValues(initial);
      setEnvTarget(entry);
      return;
    }
    await runInstall(entry.id);
  }

  async function runInstall(catalogId: string, env?: Record<string, string>) {
    if (!isElectron) {
      return;
    }
    setActionId(catalogId);
    setError('');
    try {
      const result = await window.electronAPI.marketplace.install(catalogId, env);
      setSuccess(t('marketplace.installSuccess', { name: result.name }));
      setEnvTarget(null);
      await loadEntries();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('marketplace.installFailed'));
    } finally {
      setActionId(null);
    }
  }

  async function handleToggle(entry: MarketplaceEntry) {
    if (!isElectron) {
      return;
    }
    setActionId(entry.id);
    try {
      await window.electronAPI.marketplace.setEnabled(entry.id, !entry.enabled);
      await loadEntries();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('marketplace.toggleFailed'));
    } finally {
      setActionId(null);
    }
  }

  async function handleUninstall(entry: MarketplaceEntry) {
    if (!isElectron) {
      return;
    }
    if (!confirm(t('marketplace.uninstallConfirm', { name: entry.name }))) {
      return;
    }
    setActionId(entry.id);
    try {
      await window.electronAPI.marketplace.uninstall(entry.id);
      setSuccess(t('marketplace.uninstallSuccess', { name: entry.name }));
      await loadEntries();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('marketplace.uninstallFailed'));
    } finally {
      setActionId(null);
    }
  }

  async function handleInstallFromFolder() {
    if (!isElectron) {
      return;
    }
    const folderPath = await window.electronAPI.invoke<string | null>({
      type: 'folder.select',
      payload: {},
    });
    if (!folderPath) {
      return;
    }
    setIsLoading(true);
    try {
      const validation = await window.electronAPI.skills.validate(folderPath);
      if (!validation.valid) {
        setError(validation.errors.join(', '));
        return;
      }
      await window.electronAPI.skills.install(folderPath);
      setSuccess(t('marketplace.manualSkillSuccess'));
      await loadEntries();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('marketplace.installFailed'));
    } finally {
      setIsLoading(false);
    }
  }

  async function handleSelectStoragePath() {
    if (!isElectron) {
      return;
    }
    const folderPath = await window.electronAPI.invoke<string | null>({
      type: 'folder.select',
      payload: {},
    });
    if (!folderPath) {
      return;
    }
    try {
      const result = await window.electronAPI.skills.setStoragePath(folderPath, true);
      setStoragePath(result.path);
      setSuccess(
        t('skills.storagePathUpdated', {
          migrated: result.migratedCount,
          skipped: result.skippedCount,
        })
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : t('skills.storagePathUpdateFailed'));
    }
  }

  async function handleOpenStoragePath() {
    if (!isElectron) {
      return;
    }
    const result = await window.electronAPI.skills.openStoragePath();
    if (!result.success) {
      setError(result.error || t('skills.storagePathOpenFailed'));
    }
  }

  const filterButtons: Array<{ id: MarketplaceFilter; label: string }> = [
    { id: 'all', label: t('marketplace.filterAll') },
    { id: 'skill', label: t('marketplace.filterSkills') },
    { id: 'mcp', label: t('marketplace.filterMcp') },
    { id: 'plugin', label: t('marketplace.filterPlugins') },
  ];

  const viewButtons: Array<{ id: MarketplaceView; label: string }> = [
    { id: 'marketplace', label: t('marketplace.viewMarketplace') },
    { id: 'installed', label: t('marketplace.viewInstalled') },
    { id: 'storage', label: t('marketplace.viewStorage') },
  ];

  return (
    <div className="space-y-4">
      {error && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-error/10 text-error text-sm">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {error}
        </div>
      )}
      {success && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-success/10 text-success text-sm">
          <CheckCircle className="w-4 h-4 flex-shrink-0" />
          {success}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {viewButtons.map((button) => (
          <button
            key={button.id}
            onClick={() => setView(button.id)}
            className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${
              view === button.id
                ? 'border-accent bg-accent/10 text-accent'
                : 'border-border text-text-secondary hover:border-accent/40'
            }`}
          >
            {button.label}
          </button>
        ))}
        <button
          onClick={() => void loadEntries(true)}
          disabled={isLoading}
          className="ml-auto px-3 py-1.5 rounded-lg border border-border text-sm text-text-secondary hover:border-accent/40 inline-flex items-center gap-2"
        >
          <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          {t('marketplace.refresh')}
        </button>
      </div>

      {view !== 'storage' && (
        <div className="flex flex-wrap gap-2">
          {filterButtons.map((button) => (
            <button
              key={button.id}
              onClick={() => setFilter(button.id)}
              className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${
                filter === button.id
                  ? 'border-accent bg-accent/10 text-accent'
                  : 'border-border text-text-secondary hover:border-accent/40'
              }`}
            >
              {button.label}
            </button>
          ))}
        </div>
      )}

      {view === 'storage' ? (
        <SettingsContentSection
          title={t('skills.storagePathTitle')}
          description={t('skills.storagePathHint')}
        >
          <div className="text-xs text-text-muted break-all">
            {storagePath || t('skills.storagePathUnavailable')}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <button
              onClick={() => void handleSelectStoragePath()}
              className="w-full py-2.5 px-3 rounded-lg border border-border hover:border-accent hover:bg-accent/5 transition-all flex items-center justify-center gap-2 text-text-secondary hover:text-accent"
            >
              <FolderOpen className="w-4 h-4" />
              {t('skills.selectStoragePath')}
            </button>
            <button
              onClick={() => void handleOpenStoragePath()}
              className="w-full py-2.5 px-3 rounded-lg border border-border hover:border-accent hover:bg-accent/5 transition-all flex items-center justify-center gap-2 text-text-secondary hover:text-accent"
            >
              <Globe className="w-4 h-4" />
              {t('skills.openStoragePath')}
            </button>
          </div>
        </SettingsContentSection>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {filteredEntries.map((entry) => (
              <MarketplaceCard
                key={entry.id}
                entry={entry}
                isBusy={actionId === entry.id || isLoading}
                onInstall={() => void handleInstall(entry)}
                onToggle={() => void handleToggle(entry)}
                onUninstall={() => void handleUninstall(entry)}
              />
            ))}
          </div>
          {filteredEntries.length === 0 && !isLoading && (
            <p className="text-sm text-text-muted">{t('marketplace.empty')}</p>
          )}
        </>
      )}

      {view === 'marketplace' && (
        <SettingsContentSection
          title={t('marketplace.manualTitle')}
          description={t('marketplace.manualDesc')}
        >
          <div className="flex items-start gap-2 text-xs text-warning bg-warning/10 border border-warning/20 rounded-lg px-3 py-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>{t('marketplace.manualWarning')}</span>
          </div>
          <button
            onClick={() => void handleInstallFromFolder()}
            disabled={isLoading}
            className="w-full py-2.5 px-3 rounded-lg border border-border hover:border-accent hover:bg-accent/5 transition-all flex items-center justify-center gap-2 text-text-secondary hover:text-accent disabled:opacity-50"
          >
            <FolderOpen className="w-4 h-4" />
            {t('marketplace.manualSkillInstall')}
          </button>
        </SettingsContentSection>
      )}

      {envTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-xl border border-border bg-background p-5 space-y-4">
            <h4 className="text-lg font-semibold text-text-primary">
              {t('marketplace.envTitle', { name: envTarget.name })}
            </h4>
            {(envTarget.requiresEnv || []).map((key) => (
              <label key={key} className="block space-y-1">
                <span className="text-sm text-text-secondary">{key}</span>
                {envTarget.envDescription?.[key] && (
                  <span className="block text-xs text-text-muted">
                    {envTarget.envDescription[key]}
                  </span>
                )}
                <input
                  type="password"
                  value={envValues[key] || ''}
                  onChange={(event) =>
                    setEnvValues((current) => ({ ...current, [key]: event.target.value }))
                  }
                  className="w-full rounded-lg border border-border bg-background-secondary px-3 py-2 text-sm"
                />
              </label>
            ))}
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setEnvTarget(null)}
                className="px-3 py-2 rounded-lg border border-border text-sm"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={() => void runInstall(envTarget.id, envValues)}
                className="px-3 py-2 rounded-lg bg-accent text-white text-sm"
              >
                {t('marketplace.install')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MarketplaceCard({
  entry,
  isBusy,
  onInstall,
  onToggle,
  onUninstall,
}: {
  entry: MarketplaceEntry;
  isBusy: boolean;
  onInstall: () => void;
  onToggle: () => void;
  onUninstall: () => void;
}) {
  const { t } = useTranslation();
  const isInstalled = entry.installState === 'installed' || entry.installState === 'builtin';
  const TypeIcon = entry.type === 'mcp' ? Plug : Package;

  return (
    <div className="rounded-xl border border-border bg-background-secondary/50 p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <TypeIcon className="w-4 h-4 text-accent flex-shrink-0" />
            <h4 className="font-medium text-text-primary truncate">{entry.name}</h4>
          </div>
          <p className="mt-1 text-sm text-text-muted line-clamp-3">{entry.description}</p>
        </div>
        <span className="inline-flex items-center gap-1 rounded-full bg-success/10 text-success text-[11px] px-2 py-1 flex-shrink-0">
          <ShieldCheck className="w-3 h-3" />
          {t('marketplace.verifiedBadge')}
        </span>
      </div>

      <div className="flex items-center gap-2 text-xs text-text-muted">
        <span className="uppercase tracking-wide">{entry.type}</span>
        {entry.deprecated && <span className="text-warning">{t('marketplace.deprecated')}</span>}
      </div>

      <div className="flex flex-wrap gap-2">
        {!isInstalled ? (
          <button
            onClick={onInstall}
            disabled={isBusy || entry.deprecated}
            className="px-3 py-1.5 rounded-lg bg-accent text-white text-sm inline-flex items-center gap-2 disabled:opacity-50"
          >
            {isBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            {t('marketplace.install')}
          </button>
        ) : (
          <>
            <button
              onClick={onToggle}
              disabled={isBusy}
              className="px-3 py-1.5 rounded-lg border border-border text-sm inline-flex items-center gap-2 disabled:opacity-50"
            >
              {entry.enabled ? <PowerOff className="w-4 h-4" /> : <Power className="w-4 h-4" />}
              {entry.enabled ? t('marketplace.disable') : t('marketplace.enable')}
            </button>
            {entry.installState === 'installed' && (
              <button
                onClick={onUninstall}
                disabled={isBusy}
                className="px-3 py-1.5 rounded-lg border border-error/30 text-error text-sm inline-flex items-center gap-2 disabled:opacity-50"
              >
                <Trash2 className="w-4 h-4" />
                {t('marketplace.uninstall')}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
