import { useCallback, useEffect, useReducer, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { API_PROVIDER_PRESETS } from '../../../shared/api-model-presets';
import { COMMON_PROVIDER_SETUPS } from '../../../shared/api-provider-guidance';
import { useAppStore } from '../../store';
import type { AppConfig, CustomProtocolType, ProviderPresets, ProviderType } from '../../types';
import {
  buildApiConfigBootstrap,
  buildLoadedApiConfigStatePayload,
  buildInitialApiConfigState,
  buildSetupModelState,
} from './api-config-builders';
import { useApiConfigDerivedState } from './api-config-derived-state';
import { useApiConfigMessages } from './api-config-messages';
import { useApiConfigOllamaActions } from './api-config-ollama-actions';
import { API_CONFIG_SET_LIMIT, useApiConfigPersistActions } from './api-config-persist-actions';
import { profileKeyFromProvider } from './api-config-profile-utils';
import { apiConfigReducer } from './api-config-reducer';
import type {
  ApiConfigBootstrap,
  UIProviderProfile,
  UseApiConfigStateOptions,
} from './api-config-types';

const isElectron = typeof window !== 'undefined' && window.electronAPI !== undefined;
const FALLBACK_PROVIDER_PRESETS: ProviderPresets = API_PROVIDER_PRESETS;

export function useApiConfigState(options: UseApiConfigStateOptions = {}) {
  const { t } = useTranslation();
  const { enabled = true, initialConfig, onSave } = options;
  const setAppConfig = useAppStore((s) => s.setAppConfig);
  const setIsConfigured = useAppStore((s) => s.setIsConfigured);
  const initialBootstrapRef = useRef<ApiConfigBootstrap | null>(null);
  if (!initialBootstrapRef.current) {
    initialBootstrapRef.current = buildApiConfigBootstrap(initialConfig, FALLBACK_PROVIDER_PRESETS);
  }

  const [state, dispatch] = useReducer(apiConfigReducer, undefined, () =>
    buildInitialApiConfigState(
      initialConfig,
      initialBootstrapRef.current!,
      FALLBACK_PROVIDER_PRESETS
    )
  );
  const {
    presets,
    profiles,
    activeProfileKey,
    configSets,
    activeConfigSetId,
    pendingConfigSetAction,
    isMutatingConfigSet,
    lastCustomProtocol,
    enableThinking,
    discoveredModels,
    isLoadingConfig,
    savedDraftSignature,
    isSaving,
    isTesting,
    isRefreshingModels,
    isDiscoveringLocalOllama,
    errorText,
    errorKey,
    errorValues,
    successText,
    successKey,
    successValues,
    lastSaveCompletedAt,
    testResult,
    diagnosticResult,
    isDiagnosing,
  } = state;
  const {
    clearError,
    showErrorKey,
    showErrorText,
    clearSuccessMessage,
    showSuccessKey,
    showSuccessText,
  } = useApiConfigMessages(dispatch);

  const error = errorKey ? t(errorKey, errorValues) : errorText;
  const successMessage = successKey ? t(successKey, successValues) : successText;
  const {
    provider,
    customProtocol,
    currentPreset,
    currentConfigSet,
    pendingConfigSet,
    apiKey,
    baseUrl,
    model,
    customModel,
    useCustomModel,
    contextWindow,
    maxTokens,
    modelOptions,
    modelInputGuidance,
    shouldShowOllamaManualModelToggle,
    detectedProviderSetup,
    protocolGuidanceTone,
    protocolGuidanceText,
    baseUrlGuidanceText,
    commonProviderSetups,
    friendlyTestDetails,
    requiresApiKey,
    currentDraftSignature,
    hasUnsavedChanges,
  } = useApiConfigDerivedState({
    activeConfigSetId,
    activeProfileKey,
    configSets,
    discoveredModels,
    enableThinking,
    error,
    pendingConfigSetAction,
    presets,
    profiles,
    savedDraftSignature,
    t,
    testDetails: testResult?.details,
  });

  const applyLoadedState = useCallback(
    (config: AppConfig | null | undefined, loadedPresets: ProviderPresets) => {
      dispatch({
        type: 'APPLY_LOADED_STATE',
        payload: buildLoadedApiConfigStatePayload(config, loadedPresets),
      });
    },
    []
  );
  const applyPersistedConfigToStore = useCallback(
    (config: AppConfig, loadedPresets: ProviderPresets) => {
      applyLoadedState(config, loadedPresets);
      setAppConfig(config);
      setIsConfigured(Boolean(config.isConfigured));
    },
    [applyLoadedState, setAppConfig, setIsConfigured]
  );
  const updateActiveProfile = useCallback(
    (updater: (prev: UIProviderProfile) => UIProviderProfile) => {
      dispatch({ type: 'UPDATE_PROFILE_FN', profileKey: activeProfileKey, updater });
    },
    [activeProfileKey]
  );
  const changeProvider = useCallback(
    (newProvider: ProviderType) => {
      dispatch({
        type: 'SET_ACTIVE_PROFILE_KEY',
        payload: profileKeyFromProvider(
          newProvider,
          newProvider === 'custom' ? lastCustomProtocol : 'anthropic'
        ),
      });
    },
    [lastCustomProtocol]
  );
  const changeProtocol = useCallback((newProtocol: CustomProtocolType) => {
    dispatch({ type: 'SET_LAST_CUSTOM_PROTOCOL', payload: newProtocol });
    dispatch({
      type: 'SET_ACTIVE_PROFILE_KEY',
      payload: profileKeyFromProvider('custom', newProtocol),
    });
  }, []);
  const setApiKey = useCallback(
    (value: string) => updateActiveProfile((prev) => ({ ...prev, apiKey: value })),
    [updateActiveProfile]
  );
  const setBaseUrl = useCallback(
    (value: string) => updateActiveProfile((prev) => ({ ...prev, baseUrl: value })),
    [updateActiveProfile]
  );
  const setModel = useCallback(
    (value: string) =>
      updateActiveProfile((prev) => ({ ...prev, model: value, useCustomModel: false })),
    [updateActiveProfile]
  );
  const setCustomModel = useCallback(
    (value: string) =>
      updateActiveProfile((prev) => ({ ...prev, customModel: value, useCustomModel: true })),
    [updateActiveProfile]
  );
  const setContextWindow = useCallback(
    (value: string) => updateActiveProfile((prev) => ({ ...prev, contextWindow: value })),
    [updateActiveProfile]
  );
  const setMaxTokens = useCallback(
    (value: string) => updateActiveProfile((prev) => ({ ...prev, maxTokens: value })),
    [updateActiveProfile]
  );
  const toggleCustomModel = useCallback(() => {
    updateActiveProfile((prev) =>
      prev.useCustomModel
        ? { ...prev, useCustomModel: false }
        : { ...prev, useCustomModel: true, customModel: prev.customModel || prev.model }
    );
  }, [updateActiveProfile]);
  const setEnableThinking = useCallback((value: boolean) => {
    dispatch({ type: 'SET_ENABLE_THINKING', payload: value });
  }, []);
  const applyCommonProviderSetup = useCallback(
    (setupId: string) => {
      const setup = COMMON_PROVIDER_SETUPS.find((item) => item.id === setupId);
      if (!setup) return;
      const nextProvider = setup.applyProvider;
      const nextProfileKey = profileKeyFromProvider(nextProvider, setup.recommendedProtocol);
      if (nextProvider === 'custom') {
        dispatch({ type: 'SET_LAST_CUSTOM_PROTOCOL', payload: setup.recommendedProtocol });
      }
      dispatch({
        type: 'UPDATE_PROFILE_FN',
        profileKey: nextProfileKey,
        updater: (current) => ({
          ...current,
          baseUrl: setup.recommendedBaseUrl,
          ...buildSetupModelState(setup, nextProfileKey, presets),
        }),
      });
      dispatch({ type: 'SET_ACTIVE_PROFILE_KEY', payload: nextProfileKey });
    },
    [presets]
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
  }, [applyLoadedState, enabled, initialConfig]);

  useEffect(() => {
    clearError();
    dispatch({ type: 'SET_TEST_RESULT', payload: null });
    dispatch({ type: 'SET_DIAGNOSTIC_RESULT', payload: null });
  }, [
    activeConfigSetId,
    activeProfileKey,
    apiKey,
    baseUrl,
    clearError,
    customModel,
    model,
    useCustomModel,
  ]);

  const { refreshModelOptions, discoverLocalOllama } = useApiConfigOllamaActions({
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
  });
  const {
    handleTest,
    handleDiagnose,
    handleDeepDiagnose,
    handleSave,
    createConfigSet,
    renameConfigSet,
    deleteConfigSet,
    requestConfigSetSwitch,
    requestCreateBlankConfigSet,
    cancelPendingConfigSetAction,
    saveAndContinuePendingConfigSetAction,
    discardAndContinuePendingConfigSetAction,
  } = useApiConfigPersistActions({
    activeConfigSetId,
    activeProfileKey,
    apiKey,
    applyPersistedConfigToStore,
    baseUrl,
    clearError,
    clearSuccessMessage,
    configSetCount: configSets.length,
    currentDraftSignature,
    currentPresetBaseUrl: currentPreset.baseUrl,
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
  });

  return {
    isLoadingConfig,
    presets,
    provider,
    customProtocol,
    modelOptions,
    currentPreset,
    apiKey,
    baseUrl,
    model,
    customModel,
    useCustomModel,
    contextWindow,
    maxTokens,
    modelInputPlaceholder: modelInputGuidance.placeholder,
    modelInputHint: modelInputGuidance.hint,
    enableThinking,
    isSaving,
    isTesting,
    isRefreshingModels,
    isDiscoveringLocalOllama,
    error,
    successMessage,
    lastSaveCompletedAt,
    testResult,
    friendlyTestDetails,
    diagnosticResult,
    isDiagnosing,
    handleDiagnose,
    handleDeepDiagnose,
    isOllamaMode: provider === 'ollama',
    shouldShowOllamaManualModelToggle,
    requiresApiKey,
    detectedProviderSetup,
    protocolGuidanceText,
    protocolGuidanceTone,
    baseUrlGuidanceText,
    commonProviderSetups,
    configSets,
    activeConfigSetId,
    currentConfigSet,
    pendingConfigSetAction,
    pendingConfigSet,
    hasUnsavedChanges,
    isMutatingConfigSet,
    canDeleteCurrentConfigSet: Boolean(
      currentConfigSet && !currentConfigSet.isSystem && configSets.length > 1
    ),
    configSetLimit: API_CONFIG_SET_LIMIT,
    setApiKey,
    setBaseUrl,
    setModel,
    setCustomModel,
    setContextWindow,
    setMaxTokens,
    toggleCustomModel,
    setEnableThinking,
    applyCommonProviderSetup,
    changeProvider,
    changeProtocol,
    requestConfigSetSwitch,
    requestCreateBlankConfigSet,
    cancelPendingConfigSetAction,
    saveAndContinuePendingConfigSetAction,
    discardAndContinuePendingConfigSetAction,
    createConfigSet,
    renameConfigSet,
    deleteConfigSet,
    handleSave,
    handleTest,
    refreshModelOptions,
    discoverLocalOllama,
    setError: showErrorText,
    setSuccessMessage: showSuccessText,
  };
}
