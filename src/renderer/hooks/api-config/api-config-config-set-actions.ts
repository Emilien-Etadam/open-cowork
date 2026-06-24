import { useCallback } from 'react';
import type { Dispatch } from 'react';
import type { TFunction } from 'i18next';
import type { AppConfig, ProviderPresets } from '../../types';
import {
  API_CONFIG_SET_LIMIT,
  isElectron,
  translateApiConfigErrorMessage,
} from './api-config-persist-helpers';
import type { ApiConfigAction, CreateMode, PendingConfigSetAction } from './api-config-types';

interface UseApiConfigConfigSetActionsParams {
  activeConfigSetId: string;
  applyPersistedConfigToStore: (config: AppConfig, loadedPresets: ProviderPresets) => void;
  clearError: () => void;
  clearSuccessMessage: () => void;
  configSetCount: number;
  dispatch: Dispatch<ApiConfigAction>;
  handleSave: (options?: { silentSuccess?: boolean }) => Promise<boolean>;
  hasUnsavedChanges: boolean;
  pendingConfigSetAction: PendingConfigSetAction | null;
  presets: ProviderPresets;
  showErrorKey: (key: string, values?: Record<string, string | number>) => void;
  showErrorText: (text: string) => void;
  showSuccessKey: (key: string, values?: Record<string, string | number>) => void;
  t: TFunction;
}

export function useApiConfigConfigSetActions({
  activeConfigSetId,
  applyPersistedConfigToStore,
  clearError,
  clearSuccessMessage,
  configSetCount,
  dispatch,
  handleSave,
  hasUnsavedChanges,
  pendingConfigSetAction,
  presets,
  showErrorKey,
  showErrorText,
  showSuccessKey,
  t,
}: UseApiConfigConfigSetActionsParams) {
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
