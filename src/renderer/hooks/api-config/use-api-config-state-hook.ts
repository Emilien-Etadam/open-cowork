import { useCallback, useEffect, useReducer, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { API_PROVIDER_PRESETS } from '../../../shared/api-model-presets';
import { COMMON_PROVIDER_SETUPS } from '../../../shared/api-provider-guidance';
import { useAppStore } from '../../store';
import type { CustomProtocolType, ProviderPresets, ProviderType } from '../../types';
import {
  buildApiConfigBootstrap,
  buildInitialApiConfigState,
  buildSetupModelState,
} from './api-config-builders';
import { useApiConfigActions } from './api-config-actions';
import { useApiConfigDerivedState } from './api-config-derived-state';
import { useApiConfigLoading } from './api-config-loading';
import { useApiConfigMessages } from './api-config-messages';
import { API_CONFIG_SET_LIMIT } from './api-config-persist-actions';
import { profileKeyFromProvider } from './api-config-profile-utils';
import { apiConfigReducer } from './api-config-reducer';
import { buildApiConfigStateResult } from './api-config-state-result';
import type {
  ApiConfigBootstrap,
  UIProviderProfile,
  UseApiConfigStateOptions,
} from './api-config-types';

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

  const { applyPersistedConfigToStore } = useApiConfigLoading({
    dispatch,
    enabled,
    initialConfig,
    setAppConfig,
    setIsConfigured,
  });
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

  const {
    createConfigSet,
    cancelPendingConfigSetAction,
    deleteConfigSet,
    discardAndContinuePendingConfigSetAction,
    discoverLocalOllama,
    handleDeepDiagnose,
    handleDiagnose,
    handleSave,
    handleTest,
    refreshModelOptions,
    renameConfigSet,
    requestConfigSetSwitch,
    requestCreateBlankConfigSet,
    saveAndContinuePendingConfigSetAction,
  } = useApiConfigActions({
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

  return buildApiConfigStateResult({
    activeConfigSetId,
    apiKey,
    applyCommonProviderSetup,
    baseUrl,
    baseUrlGuidanceText,
    cancelPendingConfigSetAction,
    changeProtocol,
    changeProvider,
    commonProviderSetups,
    configSetLimit: API_CONFIG_SET_LIMIT,
    configSets,
    contextWindow,
    createConfigSet,
    currentConfigSet,
    currentPreset,
    customModel,
    customProtocol,
    deleteConfigSet,
    detectedProviderSetup,
    diagnosticResult,
    discoverLocalOllama,
    discardAndContinuePendingConfigSetAction,
    enableThinking,
    error,
    friendlyTestDetails,
    handleDeepDiagnose,
    handleDiagnose,
    handleSave,
    handleTest,
    hasUnsavedChanges,
    isDiagnosing,
    isDiscoveringLocalOllama,
    isLoadingConfig,
    isMutatingConfigSet,
    isRefreshingModels,
    isSaving,
    isTesting,
    lastSaveCompletedAt,
    maxTokens,
    model,
    modelInputGuidance,
    modelOptions,
    pendingConfigSet,
    pendingConfigSetAction,
    presets,
    protocolGuidanceText,
    protocolGuidanceTone,
    provider,
    refreshModelOptions,
    renameConfigSet,
    requestConfigSetSwitch,
    requestCreateBlankConfigSet,
    requiresApiKey,
    saveAndContinuePendingConfigSetAction,
    setApiKey,
    setBaseUrl,
    setContextWindow,
    setCustomModel,
    setEnableThinking,
    setError: showErrorText,
    setMaxTokens,
    setModel,
    setSuccessMessage: showSuccessText,
    shouldShowOllamaManualModelToggle,
    successMessage,
    testResult,
    toggleCustomModel,
    useCustomModel,
  });
}
