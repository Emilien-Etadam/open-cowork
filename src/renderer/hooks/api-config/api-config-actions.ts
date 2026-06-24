import type { Dispatch } from 'react';
import type { TFunction } from 'i18next';
import type {
  AppConfig,
  CustomProtocolType,
  ProviderPresets,
  ProviderProfileKey,
  ProviderType,
} from '../../types';
import { useApiConfigOllamaActions } from './api-config-ollama-actions';
import { useApiConfigPersistActions } from './api-config-persist-actions';
import type {
  ApiConfigAction,
  PendingConfigSetAction,
  UIProviderProfile,
} from './api-config-types';

interface UseApiConfigActionsParams {
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

export function useApiConfigActions({
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
}: UseApiConfigActionsParams) {
  const ollamaActions = useApiConfigOllamaActions({
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
  const persistActions = useApiConfigPersistActions({
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
  });

  return { ...ollamaActions, ...persistActions };
}
