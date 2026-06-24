import type { TFunction } from 'i18next';
import type { Dispatch } from 'react';
import type {
  AppConfig,
  CustomProtocolType,
  ProviderPresets,
  ProviderProfileKey,
  ProviderType,
} from '../../types';
import { useApiConfigConfigSetActions } from './api-config-config-set-actions';
import { useApiConfigSaveAction } from './api-config-save-action';
import { useApiConfigTestDiagnoseActions } from './api-config-test-diagnose-actions';
import type {
  ApiConfigAction,
  PendingConfigSetAction,
  UIProviderProfile,
} from './api-config-types';

export { API_CONFIG_SET_LIMIT } from './api-config-persist-helpers';

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

export function useApiConfigPersistActions(params: UseApiConfigPersistActionsParams) {
  const { handleTest, handleDiagnose, handleDeepDiagnose } =
    useApiConfigTestDiagnoseActions(params);
  const { handleSave } = useApiConfigSaveAction(params);
  const configSetActions = useApiConfigConfigSetActions({ ...params, handleSave });

  return {
    handleTest,
    handleDiagnose,
    handleDeepDiagnose,
    handleSave,
    ...configSetActions,
  };
}
