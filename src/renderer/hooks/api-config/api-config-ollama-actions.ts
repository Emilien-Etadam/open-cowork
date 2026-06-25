import { useCallback, useEffect, useRef } from 'react';
import type { Dispatch } from 'react';
import { DEFAULT_OLLAMA_BASE_URL, normalizeOllamaBaseUrl } from '../../../shared/ollama-base-url';
import { isLoopbackBaseUrl } from '../../../shared/network/loopback';
import type {
  ProviderModelInfo,
  ProviderPresets,
  ProviderProfileKey,
  ProviderType,
} from '../../types';
import type { ApiConfigAction } from './api-config-types';
import {
  isLocalOpenAiMode,
  modelPresetForProfile,
  normalizeDiscoveredOllamaModels,
} from './api-config-profile-utils';

const isElectron = typeof window !== 'undefined' && window.electronAPI !== undefined;

interface UseApiConfigOllamaActionsParams {
  activeProfileKey: ProviderProfileKey;
  apiKey: string;
  baseUrl: string;
  clearError: () => void;
  clearSuccessMessage: () => void;
  dispatch: Dispatch<ApiConfigAction>;
  provider: ProviderType;
  presets: ProviderPresets;
  showErrorKey: (key: string, values?: Record<string, string | number>) => void;
  showErrorText: (text: string) => void;
  showSuccessKey: (key: string, values?: Record<string, string | number>) => void;
}

interface LocalOpenAiTarget {
  activeProfileKey: ProviderProfileKey;
  baseUrl: string;
  provider: ProviderType;
}

function isStaleLocalOpenAiTarget(
  latestTarget: LocalOpenAiTarget,
  requestedProfileKey: ProviderProfileKey,
  requestedBaseUrl: string
): boolean {
  return (
    !isLocalOpenAiMode(latestTarget.provider, latestTarget.baseUrl) ||
    latestTarget.activeProfileKey !== requestedProfileKey ||
    latestTarget.baseUrl !== requestedBaseUrl
  );
}

export function useApiConfigOllamaActions({
  activeProfileKey,
  apiKey,
  baseUrl,
  clearError,
  clearSuccessMessage,
  dispatch,
  presets,
  provider,
  showErrorKey,
  showErrorText,
  showSuccessKey,
}: UseApiConfigOllamaActionsParams) {
  const refreshRequestIdRef = useRef(0);
  const discoverRequestIdRef = useRef(0);
  const latestTargetRef = useRef<LocalOpenAiTarget>({
    activeProfileKey,
    baseUrl: '',
    provider: 'openai',
  });

  useEffect(() => {
    latestTargetRef.current = { activeProfileKey, baseUrl: baseUrl.trim(), provider };
  }, [activeProfileKey, baseUrl, provider]);

  useEffect(() => {
    if (!isLocalOpenAiMode(provider, baseUrl)) {
      return;
    }

    dispatch({ type: 'DELETE_DISCOVERED_MODELS', profileKey: activeProfileKey });
    const preset = modelPresetForProfile(activeProfileKey, presets);
    dispatch({
      type: 'UPDATE_PROFILE_FN',
      profileKey: activeProfileKey,
      updater: (current) => {
        if (current && !current.useCustomModel && current.model) {
          const inPreset = preset.models.some((item) => item.id === current.model);
          if (!inPreset) {
            return { ...current, model: '', useCustomModel: false };
          }
        }
        return current;
      },
    });
  }, [activeProfileKey, baseUrl, dispatch, presets, provider]);

  const applyDiscoveredLocalModels = useCallback(
    (
      targetProfileKey: ProviderProfileKey,
      discoveredBaseUrl: string,
      models: ProviderModelInfo[],
      options?: { autoSelectModelId?: string }
    ) => {
      const normalizedBaseUrl =
        normalizeOllamaBaseUrl(discoveredBaseUrl) || DEFAULT_OLLAMA_BASE_URL;

      dispatch({
        type: 'UPDATE_PROFILE_FN',
        profileKey: targetProfileKey,
        updater: (current) => {
          const autoSelectModelId = options?.autoSelectModelId?.trim() || '';
          const explicitManualModel = current.useCustomModel ? current.customModel.trim() : '';
          const currentModel = explicitManualModel || current.model.trim();
          const hasDiscoveredMatch = models.some((item) => item.id === currentModel);
          const shouldAutoSelectModel =
            Boolean(autoSelectModelId) &&
            !explicitManualModel &&
            (!currentModel || !hasDiscoveredMatch);

          return {
            ...current,
            baseUrl: normalizedBaseUrl,
            model: shouldAutoSelectModel ? autoSelectModelId : current.model,
            useCustomModel: shouldAutoSelectModel ? false : current.useCustomModel,
          };
        },
      });

      dispatch({ type: 'SET_DISCOVERED_MODELS', profileKey: targetProfileKey, models });
    },
    [dispatch]
  );

  const refreshModelOptions = useCallback(async () => {
    if (!isElectron || !isLocalOpenAiMode(provider, baseUrl)) {
      return [];
    }

    const requestedProfileKey = activeProfileKey;
    const requestedBaseUrl = baseUrl.trim();
    const requestId = ++refreshRequestIdRef.current;

    dispatch({ type: 'SET_IS_REFRESHING_MODELS', payload: true });
    clearError();
    try {
      const models = await window.electronAPI.config.listModels({
        provider,
        apiKey: apiKey.trim(),
        baseUrl: requestedBaseUrl || undefined,
      });

      const latestTarget = latestTargetRef.current;
      if (
        requestId !== refreshRequestIdRef.current ||
        isStaleLocalOpenAiTarget(latestTarget, requestedProfileKey, requestedBaseUrl)
      ) {
        return models;
      }

      dispatch({ type: 'SET_DISCOVERED_MODELS', profileKey: requestedProfileKey, models });
      dispatch({
        type: 'UPDATE_PROFILE_FN',
        profileKey: requestedProfileKey,
        updater: (current) => {
          const explicitManualModel = current.useCustomModel ? current.customModel.trim() : '';
          const currentModel = explicitManualModel || current.model.trim();
          const hasDiscoveredMatch = models.some((item) => item.id === currentModel);
          const shouldAutoSelectModel =
            Boolean(models[0]?.id) &&
            !explicitManualModel &&
            (!currentModel || !hasDiscoveredMatch);

          return {
            ...current,
            model: shouldAutoSelectModel ? models[0]!.id : current.model,
            useCustomModel: shouldAutoSelectModel ? false : current.useCustomModel,
          };
        },
      });
      return models;
    } catch (refreshError) {
      const latestTarget = latestTargetRef.current;
      if (
        requestId !== refreshRequestIdRef.current ||
        isStaleLocalOpenAiTarget(latestTarget, requestedProfileKey, requestedBaseUrl)
      ) {
        return [];
      }

      dispatch({ type: 'CLEAR_DISCOVERED_MODELS', profileKey: requestedProfileKey });
      if (refreshError instanceof Error) {
        showErrorText(refreshError.message);
      } else {
        showErrorKey('api.refreshModelsFailed');
      }
      return [];
    } finally {
      if (requestId === refreshRequestIdRef.current) {
        dispatch({ type: 'SET_IS_REFRESHING_MODELS', payload: false });
      }
    }
  }, [
    activeProfileKey,
    apiKey,
    baseUrl,
    clearError,
    dispatch,
    provider,
    showErrorKey,
    showErrorText,
  ]);

  const discoverLocalOllama = useCallback(
    async (options?: { silent?: boolean }) => {
      if (!isElectron || !isLocalOpenAiMode(provider, baseUrl)) {
        return null;
      }

      const requestedProfileKey = activeProfileKey;
      const requestedBaseUrl = baseUrl.trim();
      const shouldClearDiscoveredModels = !requestedBaseUrl || isLoopbackBaseUrl(requestedBaseUrl);
      const requestId = ++discoverRequestIdRef.current;
      dispatch({ type: 'SET_IS_DISCOVERING_LOCAL_OLLAMA', payload: true });
      if (!options?.silent) {
        clearError();
      }

      try {
        const result = await window.electronAPI.config.discoverLocal({
          baseUrl: requestedBaseUrl || undefined,
        });

        const latestTarget = latestTargetRef.current;
        if (
          requestId !== discoverRequestIdRef.current ||
          isStaleLocalOpenAiTarget(latestTarget, requestedProfileKey, requestedBaseUrl)
        ) {
          return result;
        }

        if (!result.available) {
          if (shouldClearDiscoveredModels) {
            dispatch({ type: 'CLEAR_DISCOVERED_MODELS', profileKey: requestedProfileKey });
          }
          if (!options?.silent) {
            showErrorKey('api.localOllamaNotFound');
          }
          return result;
        }

        const models = normalizeDiscoveredOllamaModels(result.models);
        applyDiscoveredLocalModels(requestedProfileKey, result.baseUrl, models, {
          autoSelectModelId: models[0]?.id,
        });

        if (!options?.silent) {
          if (result.status === 'service_available') {
            showErrorKey('api.localOllamaNoModels');
          } else {
            showSuccessKey('api.localOllamaDiscovered', { count: models.length });
            setTimeout(() => clearSuccessMessage(), 2500);
          }
        }
        return result;
      } catch (discoveryError) {
        const latestTarget = latestTargetRef.current;
        if (
          requestId !== discoverRequestIdRef.current ||
          isStaleLocalOpenAiTarget(latestTarget, requestedProfileKey, requestedBaseUrl)
        ) {
          return null;
        }

        if (shouldClearDiscoveredModels) {
          dispatch({ type: 'CLEAR_DISCOVERED_MODELS', profileKey: requestedProfileKey });
        }
        if (!options?.silent) {
          if (discoveryError instanceof Error) {
            showErrorText(discoveryError.message);
          } else {
            showErrorKey('api.localOllamaNotFound');
          }
        }
        return null;
      } finally {
        if (requestId === discoverRequestIdRef.current) {
          dispatch({ type: 'SET_IS_DISCOVERING_LOCAL_OLLAMA', payload: false });
        }
      }
    },
    [
      activeProfileKey,
      applyDiscoveredLocalModels,
      baseUrl,
      clearError,
      clearSuccessMessage,
      dispatch,
      provider,
      showErrorKey,
      showErrorText,
      showSuccessKey,
    ]
  );

  useEffect(() => {
    if (!isLocalOpenAiMode(provider, baseUrl)) {
      return;
    }
    const trimmed = baseUrl.trim();
    if (!trimmed || !/^https?:\/\/.{3,}/i.test(trimmed)) {
      return;
    }

    const timer = setTimeout(() => {
      void refreshModelOptions();
    }, 800);
    return () => clearTimeout(timer);
  }, [baseUrl, provider, refreshModelOptions]);

  return {
    applyDiscoveredOllamaState: applyDiscoveredLocalModels,
    discoverLocalOllama,
    refreshModelOptions,
  };
}
