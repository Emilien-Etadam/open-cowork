import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, CheckCircle, Globe, Loader2 } from 'lucide-react';
import type { AppConfig, WebSearchConfig, WebSearchProvider } from '../../types';

const isElectron = typeof window !== 'undefined' && window.electronAPI !== undefined;

const PROVIDERS: Array<{ value: WebSearchProvider; labelKey: string }> = [
  { value: 'duckduckgo', labelKey: 'webSearch.providerDuckduckgo' },
  { value: 'searxng', labelKey: 'webSearch.providerSearxng' },
  { value: 'yacy', labelKey: 'webSearch.providerYacy' },
];

const DEFAULT_CONFIG: WebSearchConfig = {
  provider: 'duckduckgo',
  baseUrl: '',
  authToken: '',
  language: '',
  categories: 'general',
  safeSearch: 1,
  maxResults: 8,
  timeoutMs: 15000,
};

function mergeWebSearchConfig(config?: WebSearchConfig): WebSearchConfig {
  return {
    ...DEFAULT_CONFIG,
    ...config,
  };
}

export function SettingsWebSearch() {
  const { t } = useTranslation();
  const [config, setConfig] = useState<WebSearchConfig>(DEFAULT_CONFIG);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [testPreview, setTestPreview] = useState<string | null>(null);

  useEffect(() => {
    if (!isElectron) {
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    void window.electronAPI.config
      .get()
      .then((appConfig: AppConfig) => {
        if (cancelled) return;
        setConfig(mergeWebSearchConfig(appConfig.webSearch));
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : t('common.error'));
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [t]);

  const requiresBaseUrl = config.provider === 'searxng' || config.provider === 'yacy';

  const handleSave = useCallback(async () => {
    if (!isElectron) return;
    setIsSaving(true);
    setError(null);
    setMessage(null);
    try {
      const result = await window.electronAPI.config.save({ webSearch: config });
      if (result?.config?.webSearch) {
        setConfig(mergeWebSearchConfig(result.config.webSearch));
      }
      setMessage(t('webSearch.saved'));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.error'));
    } finally {
      setIsSaving(false);
    }
  }, [config, t]);

  const handleTest = useCallback(async () => {
    if (!window.electronAPI?.config?.testWebSearch) return;
    setIsTesting(true);
    setError(null);
    setMessage(null);
    setTestPreview(null);
    try {
      const result = await window.electronAPI.config.testWebSearch({
        provider: config.provider,
        baseUrl: config.baseUrl,
        authToken: config.authToken,
        language: config.language,
        categories: config.categories,
        safeSearch: config.safeSearch,
      });
      if (!result.ok) {
        setError(result.error || t('webSearch.testFailed'));
        return;
      }
      setMessage(t('webSearch.testSuccess', { count: result.resultCount ?? 0 }));
      if (result.preview) {
        setTestPreview(result.preview);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.error'));
    } finally {
      setIsTesting(false);
    }
  }, [config, t]);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-text-muted py-4">
        <Loader2 className="w-4 h-4 animate-spin" />
        {t('common.loading')}
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-lg border border-border bg-surface p-4">
      <div className="flex items-start gap-3">
        <Globe className="w-5 h-5 text-accent mt-0.5" />
        <div className="space-y-1">
          <h4 className="text-sm font-medium text-text-primary">{t('webSearch.title')}</h4>
          <p className="text-sm text-text-muted">{t('webSearch.description')}</p>
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium text-text-primary">{t('webSearch.provider')}</label>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {PROVIDERS.map((provider) => (
            <button
              key={provider.value}
              type="button"
              onClick={() => setConfig((prev) => ({ ...prev, provider: provider.value }))}
              className={`px-3 py-2.5 rounded-lg border-2 text-sm font-medium transition-all text-left ${
                config.provider === provider.value
                  ? 'border-accent bg-accent/5 text-text-primary'
                  : 'border-border bg-surface hover:border-accent/50 text-text-secondary'
              }`}
            >
              {t(provider.labelKey)}
            </button>
          ))}
        </div>
      </div>

      {requiresBaseUrl && (
        <div className="space-y-2">
          <label className="text-sm font-medium text-text-primary" htmlFor="web-search-base-url">
            {t('webSearch.baseUrl')}
          </label>
          <input
            id="web-search-base-url"
            type="url"
            value={config.baseUrl || ''}
            onChange={(event) => setConfig((prev) => ({ ...prev, baseUrl: event.target.value }))}
            placeholder={
              config.provider === 'yacy' ? 'http://localhost:8090' : 'http://localhost:8080'
            }
            className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
          />
          <p className="text-xs text-text-muted">{t('webSearch.baseUrlHint')}</p>
        </div>
      )}

      {config.provider === 'searxng' && (
        <>
          <div className="space-y-2">
            <label
              className="text-sm font-medium text-text-primary"
              htmlFor="web-search-categories"
            >
              {t('webSearch.categories')}
            </label>
            <input
              id="web-search-categories"
              type="text"
              value={config.categories || 'general'}
              onChange={(event) =>
                setConfig((prev) => ({ ...prev, categories: event.target.value }))
              }
              placeholder="general,news"
              className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
            />
          </div>
          <div className="rounded-lg border border-border bg-surface-muted p-3 text-xs text-text-muted whitespace-pre-wrap">
            {t('webSearch.searxngSetupHint')}
          </div>
        </>
      )}

      {requiresBaseUrl && (
        <div className="space-y-2">
          <label className="text-sm font-medium text-text-primary" htmlFor="web-search-auth-token">
            {t('webSearch.authToken')}
          </label>
          <input
            id="web-search-auth-token"
            type="password"
            value={config.authToken || ''}
            onChange={(event) => setConfig((prev) => ({ ...prev, authToken: event.target.value }))}
            placeholder={t('webSearch.authTokenPlaceholder')}
            className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
          />
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <label className="text-sm font-medium text-text-primary" htmlFor="web-search-language">
            {t('webSearch.language')}
          </label>
          <input
            id="web-search-language"
            type="text"
            value={config.language || ''}
            onChange={(event) => setConfig((prev) => ({ ...prev, language: event.target.value }))}
            placeholder="fr"
            className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
          />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium text-text-primary" htmlFor="web-search-max-results">
            {t('webSearch.maxResults')}
          </label>
          <input
            id="web-search-max-results"
            type="number"
            min={1}
            max={20}
            value={config.maxResults ?? 8}
            onChange={(event) =>
              setConfig((prev) => ({
                ...prev,
                maxResults: Number.parseInt(event.target.value, 10) || 8,
              }))
            }
            className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
          />
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-error/10 text-error text-sm">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {message && (
        <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-success/10 text-success text-sm">
          <CheckCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{message}</span>
        </div>
      )}

      {testPreview && (
        <pre className="max-h-48 overflow-auto rounded-lg border border-border bg-surface-muted p-3 text-xs text-text-secondary whitespace-pre-wrap">
          {testPreview}
        </pre>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={isSaving}
          className="px-4 py-2 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent/90 disabled:opacity-60"
        >
          {isSaving ? t('common.saving') : t('common.save')}
        </button>
        <button
          type="button"
          onClick={() => void handleTest()}
          disabled={isTesting}
          className="px-4 py-2 rounded-lg border border-border text-sm font-medium text-text-secondary hover:border-accent/50 disabled:opacity-60"
        >
          {isTesting ? (
            <span className="inline-flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              {t('webSearch.testing')}
            </span>
          ) : (
            t('webSearch.test')
          )}
        </button>
      </div>
    </div>
  );
}
