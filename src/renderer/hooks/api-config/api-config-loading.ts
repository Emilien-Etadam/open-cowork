import { useCallback, useEffect } from 'react';
import type { Dispatch } from 'react';
import { API_PROVIDER_PRESETS } from '../../../shared/api-model-presets';
import type { AppConfig, ProviderPresets } from '../../types';
import { buildLoadedApiConfigStatePayload } from './api-config-builders';
import type { ApiConfigAction } from './api-config-types';

const isElectron = typeof window !== 'undefined' && window.electronAPI !== undefined;
const FALLBACK_PROVIDER_PRESETS: ProviderPresets = API_PROVIDER_PRESETS;

interface UseApiConfigLoadingParams {
  dispatch: Dispatch<ApiConfigAction>;
  enabled: boolean;
  initialConfig?: AppConfig | null;
  setAppConfig: (config: AppConfig) => void;
  setIsConfigured: (configured: boolean) => void;
}

export function useApiConfigLoading({
  dispatch,
  enabled,
  initialConfig,
  setAppConfig,
  setIsConfigured,
}: UseApiConfigLoadingParams) {
  const applyLoadedState = useCallback(
    (config: AppConfig | null | undefined, loadedPresets: ProviderPresets) => {
      dispatch({
        type: 'APPLY_LOADED_STATE',
        payload: buildLoadedApiConfigStatePayload(config, loadedPresets),
      });
    },
    [dispatch]
  );

  const applyPersistedConfigToStore = useCallback(
    (config: AppConfig, loadedPresets: ProviderPresets) => {
      applyLoadedState(config, loadedPresets);
      setAppConfig(config);
      setIsConfigured(Boolean(config.isConfigured));
    },
    [applyLoadedState, setAppConfig, setIsConfigured]
  );

  useEffect(() => {
    if (!enabled) {
      dispatch({ type: 'SET_LAST_SAVE_COMPLETED_AT', payload: 0 });
      return;
    }

    let cancelled = false;
    async function load() {
      dispatch({ type: 'SET_IS_LOADING_CONFIG', payload: true });
      try {
        const loadedPresets = isElectron
          ? await window.electronAPI.config.getPresets()
          : FALLBACK_PROVIDER_PRESETS;
        const config = initialConfig || (isElectron ? await window.electronAPI.config.get() : null);
        if (!cancelled) {
          applyLoadedState(config, loadedPresets);
        }
      } catch (loadError) {
        if (!cancelled) {
          console.error('Failed to load API config:', loadError);
          applyLoadedState(initialConfig, FALLBACK_PROVIDER_PRESETS);
        }
      } finally {
        if (!cancelled) {
          dispatch({ type: 'SET_IS_LOADING_CONFIG', payload: false });
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [applyLoadedState, dispatch, enabled, initialConfig]);

  return { applyPersistedConfigToStore };
}
