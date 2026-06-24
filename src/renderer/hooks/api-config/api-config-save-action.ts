import { useCallback } from 'react';
import type { Dispatch } from 'react';
import type { TFunction } from 'i18next';
import type {
  AppConfig,
  CustomProtocolType,
  ProviderPresets,
  ProviderProfileKey,
  ProviderType,
} from '../../types';
import { toPersistedProfiles } from './api-config-builders';
import {
  resolveBaseUrl,
  resolveFinalModel,
  translateApiConfigErrorMessage,
} from './api-config-persist-helpers';
import type { ApiConfigAction, UIProviderProfile } from './api-config-types';

interface UseApiConfigSaveActionParams {
  activeConfigSetId: string;
  activeProfileKey: ProviderProfileKey;
  apiKey: string;
  applyPersistedConfigToStore: (config: AppConfig, loadedPresets: ProviderPresets) => void;
  baseUrl: string;
  clearError: () => void;
  clearSuccessMessage: () => void;
  currentDraftSignature: string;
  currentPresetBaseUrl?: string;
  customModel: string;
  customProtocol: CustomProtocolType;
  dispatch: Dispatch<ApiConfigAction>;
  enableThinking: boolean;
  model: string;
  onSave?: (config: Partial<AppConfig>) => Promise<void>;
  presets: ProviderPresets;
  profiles: Record<ProviderProfileKey, UIProviderProfile>;
  provider: ProviderType;
  requiresApiKey: boolean;
  showErrorKey: (key: string, values?: Record<string, string | number>) => void;
  showErrorText: (text: string) => void;
  showSuccessKey: (key: string, values?: Record<string, string | number>) => void;
  t: TFunction;
  useCustomModel: boolean;
}

export function useApiConfigSaveAction({
  activeConfigSetId,
  activeProfileKey,
  apiKey,
  applyPersistedConfigToStore,
  baseUrl,
  clearError,
  clearSuccessMessage,
  currentDraftSignature,
  currentPresetBaseUrl,
  customModel,
  customProtocol,
  dispatch,
  enableThinking,
  model,
  onSave,
  presets,
  profiles,
  provider,
  requiresApiKey,
  showErrorKey,
  showErrorText,
  showSuccessKey,
  t,
  useCustomModel,
}: UseApiConfigSaveActionParams) {
  const handleSave = useCallback(
    async (options?: { silentSuccess?: boolean }) => {
      if (requiresApiKey && !apiKey.trim()) {
        showErrorKey('api.testError.missing_key');
        return false;
      }

      const finalModel = resolveFinalModel(model, customModel, useCustomModel);
      if (!finalModel) {
        showErrorKey('api.selectModelRequired');
        return false;
      }
      if (provider === 'ollama' && !baseUrl.trim()) {
        showErrorKey('api.testError.missing_base_url');
        return false;
      }

      clearError();
      dispatch({ type: 'SET_IS_SAVING', payload: true });
      try {
        const payload: Partial<AppConfig> = {
          provider,
          apiKey: apiKey.trim(),
          baseUrl: resolveBaseUrl(provider, baseUrl, currentPresetBaseUrl) || undefined,
          customProtocol,
          model: finalModel,
          activeProfileKey,
          profiles: toPersistedProfiles(profiles),
          activeConfigSetId,
          enableThinking,
        };

        if (onSave) {
          await onSave(payload);
        } else {
          const result = await window.electronAPI.config.save(payload);
          applyPersistedConfigToStore(result.config, presets);
        }

        dispatch({ type: 'SET_SAVED_DRAFT_SIGNATURE', payload: currentDraftSignature });
        if (!options?.silentSuccess) {
          showSuccessKey('common.saved');
          dispatch({ type: 'SET_LAST_SAVE_COMPLETED_AT', payload: Date.now() });
          setTimeout(() => clearSuccessMessage(), 2000);
        }
        return true;
      } catch (saveError) {
        if (saveError instanceof Error) {
          showErrorText(translateApiConfigErrorMessage(saveError.message, t));
        } else {
          showErrorKey('api.saveFailed');
        }
        return false;
      } finally {
        dispatch({ type: 'SET_IS_SAVING', payload: false });
      }
    },
    [
      activeConfigSetId,
      activeProfileKey,
      apiKey,
      applyPersistedConfigToStore,
      baseUrl,
      clearError,
      clearSuccessMessage,
      currentDraftSignature,
      currentPresetBaseUrl,
      customModel,
      customProtocol,
      dispatch,
      enableThinking,
      model,
      onSave,
      presets,
      profiles,
      provider,
      requiresApiKey,
      showErrorKey,
      showErrorText,
      showSuccessKey,
      t,
      useCustomModel,
    ]
  );

  return { handleSave };
}
