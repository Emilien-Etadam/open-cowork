import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, Loader2, RefreshCw, Wifi } from 'lucide-react';

interface ChatLanConfig {
  enabled: boolean;
  port: number;
  token: string;
}

interface ChatLanStatus {
  running: boolean;
  port: number;
  enabled: boolean;
  urls: string[];
}

export function SettingsChatLan() {
  const { t } = useTranslation();
  const [config, setConfig] = useState<ChatLanConfig | null>(null);
  const [status, setStatus] = useState<ChatLanStatus | null>(null);
  const [portInput, setPortInput] = useState('19890');
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [nextConfig, nextStatus] = await Promise.all([
      window.electronAPI.chatLan.getConfig(),
      window.electronAPI.chatLan.getStatus(),
    ]);
    setConfig(nextConfig);
    setStatus(nextStatus);
    setPortInput(String(nextConfig.port));
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const applyConfig = async (patch: { enabled?: boolean; port?: number }) => {
    setIsSaving(true);
    setMessage(null);
    try {
      const result = await window.electronAPI.chatLan.setConfig(patch);
      setConfig(result.config);
      setStatus(result.status);
      setMessage(t('chatLan.saved'));
    } catch {
      setMessage(t('common.error'));
    } finally {
      setIsSaving(false);
    }
  };

  const regenerateToken = async () => {
    setIsSaving(true);
    try {
      const result = await window.electronAPI.chatLan.regenerateToken();
      setConfig((current) => (current ? { ...current, token: result.token } : current));
      setStatus(result.status);
      setMessage(t('chatLan.tokenRegenerated'));
    } finally {
      setIsSaving(false);
    }
  };

  const copyToken = async () => {
    if (!config?.token) return;
    await navigator.clipboard.writeText(config.token);
    setMessage(t('chatLan.tokenCopied'));
  };

  if (!config) {
    return (
      <div className="flex items-center gap-2 text-text-muted py-4">
        <Loader2 className="w-4 h-4 animate-spin" />
        {t('common.loading')}
      </div>
    );
  }

  return (
    <div className="space-y-4 py-5 border-b border-border-muted">
      <div>
        <label className="flex items-center gap-2 text-sm font-medium text-text-primary">
          <Wifi className="w-4 h-4" />
          {t('chatLan.title')}
        </label>
        <p className="mt-1 text-xs leading-5 text-text-muted">{t('chatLan.description')}</p>
      </div>

      <label className="flex items-center gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={config.enabled}
          disabled={isSaving}
          onChange={(e) => void applyConfig({ enabled: e.target.checked })}
          className="rounded border-border"
        />
        <span className="text-sm text-text-primary">{t('chatLan.enable')}</span>
      </label>

      <div className="grid gap-2 max-w-md">
        <label className="text-xs text-text-muted">{t('chatLan.port')}</label>
        <div className="flex gap-2">
          <input
            type="number"
            min={1024}
            max={65535}
            value={portInput}
            onChange={(e) => setPortInput(e.target.value)}
            className="flex-1 px-3 py-2 rounded-lg bg-background border border-border text-text-primary"
          />
          <button
            type="button"
            disabled={isSaving}
            onClick={() => void applyConfig({ port: Number(portInput) })}
            className="px-3 py-2 rounded-lg bg-accent text-white text-sm font-medium"
          >
            {t('common.save')}
          </button>
        </div>
      </div>

      <div className="space-y-2 max-w-xl">
        <label className="text-xs text-text-muted">{t('chatLan.token')}</label>
        <div className="flex gap-2">
          <input
            readOnly
            value={config.token}
            className="flex-1 px-3 py-2 rounded-lg bg-background border border-border text-text-primary font-mono text-xs"
          />
          <button
            type="button"
            onClick={() => void copyToken()}
            className="p-2 rounded-lg border border-border"
          >
            <Copy className="w-4 h-4" />
          </button>
          <button
            type="button"
            disabled={isSaving}
            onClick={() => void regenerateToken()}
            className="p-2 rounded-lg border border-border"
            title={t('chatLan.regenerateToken')}
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {status?.running && status.urls.length > 0 && (
        <div className="rounded-lg border border-border-muted bg-background-secondary/50 p-3 space-y-1">
          <p className="text-xs font-medium text-text-primary">{t('chatLan.urls')}</p>
          {status.urls.map((url) => (
            <p key={url} className="text-xs font-mono text-accent break-all">
              {url}
            </p>
          ))}
          <p className="text-[11px] text-text-muted pt-1">{t('chatLan.wireguardHint')}</p>
        </div>
      )}

      {message && <p className="text-xs text-text-muted">{message}</p>}
    </div>
  );
}
