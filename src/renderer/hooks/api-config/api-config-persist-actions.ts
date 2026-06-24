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
import type {
  ApiConfigAction,
  CreateMode,
  PendingConfigSetAction,
  UIProviderProfile,
} from './api-config-types';

const isElectron = typeof window !== 'undefined' && window.electronAPI !== undefined;
export const API_CONFIG_SET_LIMIT = 20;

interface UseApiConfigPersistActionsParams {
  activeConfigSetId: string;
  activeProfileKey: ProviderProfileKey;
  apiKey: string;
  applyPersistedConfigToStore: (config: AppConfig, loadedPresets: ProviderPresets) => void;
  baseUrl: string;
  clearError: () => void;
  clearSuccessMessage: () => void;
  configSetCount: number;
  currentDraftSignature: string;
  currentPresetBaseUrl?: string;
  customModel: string;
  customProtocol: CustomProtocolType;
  dispatch: Dispatch<ApiConfigAction>;
  enableThinking: boolean;
  hasUnsavedChanges: boolean;
  model: string;
  onSave?: (config: Partial<AppConfig>) => Promise<void>;
  pendingConfigSetAction: PendingConfigSetAction | null;
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

function translateApiConfigErrorMessage(message: string, t: TFunction): string {
  if (message === 'Config set name is required') return t('api.configSetNameRequired');
  if (message === 'Config set clone source not found') return t('api.configSetCloneSourceMissing');
  if (message === 'Config set not found') return t('api.configSetMissing');
  if (message === 'System config set cannot be deleted') {
    return t('api.configSetSystemDeleteForbidden');
  }
  if (message === 'At least one config set must be kept') return t('api.configSetKeepOne');

  const limitMatch = message.match(/^Config set limit reached: max\s+(\d+)$/);
  if (limitMatch) {
    return t('api.configSetLimitReached', { count: Number(limitMatch[1]) });
  }
  return message;
}

function resolveBaseUrl(
  provider: ProviderType,
  baseUrl: string,
  currentPresetBaseUrl?: string
): string {
  return provider === 'custom' || provider === 'ollama'
    ? baseUrl.trim()
    : (baseUrl.trim() || currentPresetBaseUrl || '').trim();
}

function resolveFinalModel(model: string, customModel: string, useCustomModel: boolean): string {
  return useCustomModel ? customModel.trim() : model;
}

export function useApiConfigPersistActions({
  activeConfigSetId,
  activeProfileKey,
  apiKey,
  applyPersistedConfigToStore,
  baseUrl,
  clearError,
  clearSuccessMessage,
  configSetCount,
  currentDraftSignature,
  currentPresetBaseUrl,
  customModel,
  customProtocol,
  dispatch,
  enableThinking,
  hasUnsavedChanges,
  model,
  onSave,
  pendingConfigSetAction,
  presets,
  profiles,
  provider,
  requiresApiKey,
  showErrorKey,
  showErrorText,
  showSuccessKey,
  t,
  useCustomModel,
}: UseApiConfigPersistActionsParams) {
  const handleTest = useCallback(async () => {
    if (requiresApiKey && !apiKey.trim()) {
      showErrorKey('api.testError.missing_key');
      return;
    }

    const finalModel = resolveFinalModel(model, customModel, useCustomModel);
    if (!finalModel) {
      showErrorKey('api.selectModelRequired');
      return;
    }
    if (provider === 'ollama' && !baseUrl.trim()) {
      showErrorKey('api.testError.missing_base_url');
      return;
    }

    clearError();
    dispatch({ type: 'SET_IS_TESTING', payload: true });
    dispatch({ type: 'SET_TEST_RESULT', payload: null });
    try {
      const result = await window.electronAPI.config.test({
        provider,
        apiKey: apiKey.trim(),
        baseUrl: resolveBaseUrl(provider, baseUrl, currentPresetBaseUrl) || undefined,
        customProtocol,
        model: finalModel,
      });
      dispatch({ type: 'SET_TEST_RESULT', payload: result });
      if (result.ok && hasUnsavedChanges) {
        showSuccessKey('api.testSuccessNeedSave');
        setTimeout(() => clearSuccessMessage(), 2500);
      }
    } catch (testError) {
      dispatch({
        type: 'SET_TEST_RESULT',
        payload: {
          ok: false,
          errorType: 'unknown',
          details: testError instanceof Error ? testError.message : String(testError),
        },
      });
    } finally {
      dispatch({ type: 'SET_IS_TESTING', payload: false });
    }
  }, [
    apiKey,
    baseUrl,
    clearError,
    clearSuccessMessage,
    currentPresetBaseUrl,
    customModel,
    customProtocol,
    dispatch,
    hasUnsavedChanges,
    model,
    provider,
    requiresApiKey,
    showErrorKey,
    showSuccessKey,
    useCustomModel,
  ]);

  const handleDiagnose = useCallback(
    async (verificationLevel: 'fast' | 'deep' = 'fast') => {
      if (requiresApiKey && !apiKey.trim()) {
        showErrorKey('api.testError.missing_key');
        return;
      }

      clearError();
      dispatch({ type: 'SET_IS_DIAGNOSING', payload: true });
      dispatch({ type: 'SET_DIAGNOSTIC_RESULT', payload: null });
      dispatch({ type: 'SET_TEST_RESULT', payload: null });
      try {
        const finalModel = resolveFinalModel(model, customModel, useCustomModel);
        const result = await window.electronAPI.config.diagnose({
          provider,
          apiKey: apiKey.trim(),
          baseUrl: resolveBaseUrl(provider, baseUrl, currentPresetBaseUrl) || undefined,
          customProtocol,
          model: finalModel || undefined,
          verificationLevel,
        });
        dispatch({ type: 'SET_DIAGNOSTIC_RESULT', payload: result });
      } catch (error) {
        showErrorText((error as Error).message || 'Diagnosis failed');
      } finally {
        dispatch({ type: 'SET_IS_DIAGNOSING', payload: false });
      }
    },
    [
      apiKey,
      baseUrl,
      clearError,
      currentPresetBaseUrl,
      customModel,
      customProtocol,
      dispatch,
      model,
      provider,
      requiresApiKey,
      showErrorKey,
      showErrorText,
      useCustomModel,
    ]
  );

  const handleDeepDiagnose = useCallback(async () => {
    await handleDiagnose('deep');
  }, [handleDiagnose]);

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

  const switchConfigSet = useCallback(
    async (setId: string, options?: { silentSuccess?: boolean }) => {
      if (!isElectron) {
        return false;
      }

      dispatch({ type: 'SET_IS_MUTATING_CONFIG_SET', payload: true });
      clearError();
      try {
        const result = await window.electronAPI.config.switchSet({ id: setId });
        applyPersistedConfigToStore(result.config, presets);
        if (!options?.silentSuccess) {
          showSuccessKey('api.configSetSwitched');
          setTimeout(() => clearSuccessMessage(), 1500);
        }
        return true;
      } catch (switchError) {
        if (switchError instanceof Error) {
          showErrorText(translateApiConfigErrorMessage(switchError.message, t));
        } else {
          showErrorKey('api.saveFailed');
        }
        return false;
      } finally {
        dispatch({ type: 'SET_IS_MUTATING_CONFIG_SET', payload: false });
      }
    },
    [
      applyPersistedConfigToStore,
      clearError,
      clearSuccessMessage,
      dispatch,
      presets,
      showErrorKey,
      showErrorText,
      showSuccessKey,
      t,
    ]
  );

  const createConfigSet = useCallback(
    async (payload: { name: string; mode: CreateMode }) => {
      if (!isElectron) {
        return false;
      }
      if (configSetCount >= API_CONFIG_SET_LIMIT) {
        showErrorKey('api.configSetLimitReached', { count: API_CONFIG_SET_LIMIT });
        return false;
      }

      const trimmed = payload.name.trim();
      if (!trimmed) {
        showErrorKey('api.configSetNameRequired');
        return false;
      }

      dispatch({ type: 'SET_IS_MUTATING_CONFIG_SET', payload: true });
      clearError();
      try {
        const result = await window.electronAPI.config.createSet({
          name: trimmed,
          mode: payload.mode,
          fromSetId: payload.mode === 'clone' ? activeConfigSetId : undefined,
        });
        applyPersistedConfigToStore(result.config, presets);
        showSuccessKey('api.configSetCreated');
        setTimeout(() => clearSuccessMessage(), 1500);
        return true;
      } catch (createError) {
        if (createError instanceof Error) {
          showErrorText(translateApiConfigErrorMessage(createError.message, t));
        } else {
          showErrorKey('api.saveFailed');
        }
        return false;
      } finally {
        dispatch({ type: 'SET_IS_MUTATING_CONFIG_SET', payload: false });
      }
    },
    [
      activeConfigSetId,
      applyPersistedConfigToStore,
      clearError,
      clearSuccessMessage,
      configSetCount,
      dispatch,
      presets,
      showErrorKey,
      showErrorText,
      showSuccessKey,
      t,
    ]
  );

  const renameConfigSet = useCallback(
    async (id: string, name: string) => {
      if (!isElectron) {
        return false;
      }

      const trimmed = name.trim();
      if (!trimmed) {
        showErrorKey('api.configSetNameRequired');
        return false;
      }

      dispatch({ type: 'SET_IS_MUTATING_CONFIG_SET', payload: true });
      clearError();
      try {
        const result = await window.electronAPI.config.renameSet({ id, name: trimmed });
        applyPersistedConfigToStore(result.config, presets);
        showSuccessKey('api.configSetRenamed');
        setTimeout(() => clearSuccessMessage(), 1500);
        return true;
      } catch (renameError) {
        if (renameError instanceof Error) {
          showErrorText(translateApiConfigErrorMessage(renameError.message, t));
        } else {
          showErrorKey('api.saveFailed');
        }
        return false;
      } finally {
        dispatch({ type: 'SET_IS_MUTATING_CONFIG_SET', payload: false });
      }
    },
    [
      applyPersistedConfigToStore,
      clearError,
      clearSuccessMessage,
      dispatch,
      presets,
      showErrorKey,
      showErrorText,
      showSuccessKey,
      t,
    ]
  );

  const deleteConfigSet = useCallback(
    async (id: string) => {
      if (!isElectron) {
        return false;
      }

      dispatch({ type: 'SET_IS_MUTATING_CONFIG_SET', payload: true });
      clearError();
      try {
        const result = await window.electronAPI.config.deleteSet({ id });
        applyPersistedConfigToStore(result.config, presets);
        showSuccessKey('api.configSetDeleted');
        setTimeout(() => clearSuccessMessage(), 1500);
        return true;
      } catch (deleteError) {
        if (deleteError instanceof Error) {
          showErrorText(translateApiConfigErrorMessage(deleteError.message, t));
        } else {
          showErrorKey('api.saveFailed');
        }
        return false;
      } finally {
        dispatch({ type: 'SET_IS_MUTATING_CONFIG_SET', payload: false });
      }
    },
    [
      applyPersistedConfigToStore,
      clearError,
      clearSuccessMessage,
      dispatch,
      presets,
      showErrorKey,
      showErrorText,
      showSuccessKey,
      t,
    ]
  );

  const requestConfigSetSwitch = useCallback(
    async (setId: string) => {
      if (!setId || setId === activeConfigSetId) {
        return;
      }

      const action: PendingConfigSetAction = { type: 'switch', targetSetId: setId };
      if (hasUnsavedChanges) {
        dispatch({ type: 'SET_PENDING_CONFIG_SET_ACTION', payload: action });
        return;
      }

      await switchConfigSet(setId);
    },
    [activeConfigSetId, dispatch, hasUnsavedChanges, switchConfigSet]
  );

  const continuePendingConfigSetAction = useCallback(
    async (action: PendingConfigSetAction) => {
      await switchConfigSet(action.targetSetId);
    },
    [switchConfigSet]
  );

  const cancelPendingConfigSetAction = useCallback(() => {
    dispatch({ type: 'SET_PENDING_CONFIG_SET_ACTION', payload: null });
  }, [dispatch]);

  const saveAndContinuePendingConfigSetAction = useCallback(async () => {
    if (!pendingConfigSetAction) {
      return;
    }

    const action = pendingConfigSetAction;
    const saved = await handleSave({ silentSuccess: true });
    if (!saved) {
      return;
    }

    dispatch({ type: 'SET_PENDING_CONFIG_SET_ACTION', payload: null });
    await continuePendingConfigSetAction(action);
  }, [continuePendingConfigSetAction, dispatch, handleSave, pendingConfigSetAction]);

  const discardAndContinuePendingConfigSetAction = useCallback(async () => {
    if (!pendingConfigSetAction) {
      return;
    }

    const action = pendingConfigSetAction;
    dispatch({ type: 'SET_PENDING_CONFIG_SET_ACTION', payload: null });
    await continuePendingConfigSetAction(action);
  }, [continuePendingConfigSetAction, dispatch, pendingConfigSetAction]);

  const requestCreateBlankConfigSet = useCallback(async () => {
    if (hasUnsavedChanges) {
      const saved = await handleSave({ silentSuccess: true });
      if (!saved) {
        return;
      }
    }

    await createConfigSet({ name: t('api.newSetDefaultName'), mode: 'blank' });
  }, [createConfigSet, handleSave, hasUnsavedChanges, t]);

  return {
    handleTest,
    handleDiagnose,
    handleDeepDiagnose,
    handleSave,
    switchConfigSet,
    createConfigSet,
    renameConfigSet,
    deleteConfigSet,
    requestConfigSetSwitch,
    cancelPendingConfigSetAction,
    saveAndContinuePendingConfigSetAction,
    discardAndContinuePendingConfigSetAction,
    requestCreateBlankConfigSet,
  };
}
