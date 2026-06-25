import { useCallback } from 'react';
import { isLoopbackBaseUrl } from '../../../shared/network/loopback';
import type { Dispatch } from 'react';
import type { CustomProtocolType, ProviderType } from '../../types';
import type { ApiConfigAction } from './api-config-types';
import { resolveBaseUrl, resolveFinalModel } from './api-config-persist-helpers';

interface UseApiConfigTestDiagnoseActionsParams {
  apiKey: string;
  baseUrl: string;
  clearError: () => void;
  clearSuccessMessage: () => void;
  currentPresetBaseUrl?: string;
  customModel: string;
  customProtocol: CustomProtocolType;
  dispatch: Dispatch<ApiConfigAction>;
  hasUnsavedChanges: boolean;
  model: string;
  provider: ProviderType;
  requiresApiKey: boolean;
  showErrorKey: (key: string, values?: Record<string, string | number>) => void;
  showErrorText: (text: string) => void;
  showSuccessKey: (key: string, values?: Record<string, string | number>) => void;
  useCustomModel: boolean;
}

export function useApiConfigTestDiagnoseActions({
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
  showErrorText,
  showSuccessKey,
  useCustomModel,
}: UseApiConfigTestDiagnoseActionsParams) {
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
    if (provider === 'openai' && isLoopbackBaseUrl(baseUrl) && !baseUrl.trim()) {
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

  return {
    handleTest,
    handleDiagnose,
    handleDeepDiagnose,
  };
}
