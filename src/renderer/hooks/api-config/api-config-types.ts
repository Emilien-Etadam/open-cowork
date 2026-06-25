import type {
  ApiConfigSet,
  AppConfig,
  ApiTestResult,
  DiagnosticResult,
  ProviderModelInfo,
  ProviderProfileKey,
  ProviderPresets,
} from '../../types';

export interface UseApiConfigStateOptions {
  enabled?: boolean;
  initialConfig?: AppConfig | null;
  onSave?: (config: Partial<AppConfig>) => Promise<void>;
}

export interface UIProviderProfile {
  apiKey: string;
  baseUrl: string;
  model: string;
  customModel: string;
  useCustomModel: boolean;
  contextWindow: string;
  maxTokens: string;
}

export interface ConfigStateSnapshot {
  activeProfileKey: ProviderProfileKey;
  profiles: Record<ProviderProfileKey, UIProviderProfile>;
  enableThinking: boolean;
}

export interface ApiConfigBootstrap {
  snapshot: ConfigStateSnapshot;
  configSets: ApiConfigSet[];
  activeConfigSetId: string;
}

export type CreateMode = 'blank' | 'clone';

export type PendingConfigSetAction = { type: 'switch'; targetSetId: string };

export const PROFILE_KEYS: ProviderProfileKey[] = ['openai', 'anthropic'];

export interface ApiConfigState {
  presets: ProviderPresets;
  profiles: Record<ProviderProfileKey, UIProviderProfile>;
  activeProfileKey: ProviderProfileKey;
  configSets: ApiConfigSet[];
  activeConfigSetId: string;
  pendingConfigSetAction: PendingConfigSetAction | null;
  enableThinking: boolean;
  savedDraftSignature: string;
  discoveredModels: Partial<Record<ProviderProfileKey, ProviderModelInfo[]>>;
  isLoadingConfig: boolean;
  isSaving: boolean;
  isTesting: boolean;
  isRefreshingModels: boolean;
  isDiscoveringLocalOllama: boolean;
  isMutatingConfigSet: boolean;
  isDiagnosing: boolean;
  errorText: string;
  errorKey: string | null;
  errorValues: Record<string, string | number> | undefined;
  successText: string;
  successKey: string | null;
  successValues: Record<string, string | number> | undefined;
  lastSaveCompletedAt: number;
  testResult: ApiTestResult | null;
  diagnosticResult: DiagnosticResult | null;
}

export type ApiConfigAction =
  | {
      type: 'APPLY_LOADED_STATE';
      payload: {
        presets: ProviderPresets;
        profiles: Record<ProviderProfileKey, UIProviderProfile>;
        activeProfileKey: ProviderProfileKey;
        enableThinking: boolean;
        configSets: ApiConfigSet[];
        activeConfigSetId: string;
        savedDraftSignature: string;
      };
    }
  | { type: 'SET_ACTIVE_PROFILE_KEY'; payload: ProviderProfileKey }
  | { type: 'SET_ENABLE_THINKING'; payload: boolean }
  | { type: 'PATCH_PROFILE'; profileKey: ProviderProfileKey; patch: Partial<UIProviderProfile> }
  | {
      type: 'UPDATE_PROFILE_FN';
      profileKey: ProviderProfileKey;
      updater: (prev: UIProviderProfile) => UIProviderProfile;
    }
  | {
      type: 'SET_DISCOVERED_MODELS';
      profileKey: ProviderProfileKey;
      models: ProviderModelInfo[];
    }
  | { type: 'CLEAR_DISCOVERED_MODELS'; profileKey: ProviderProfileKey }
  | { type: 'DELETE_DISCOVERED_MODELS'; profileKey: ProviderProfileKey }
  | { type: 'SET_CONFIG_SETS'; payload: ApiConfigSet[] }
  | { type: 'SET_ACTIVE_CONFIG_SET_ID'; payload: string }
  | { type: 'SET_PENDING_CONFIG_SET_ACTION'; payload: PendingConfigSetAction | null }
  | { type: 'SET_IS_LOADING_CONFIG'; payload: boolean }
  | { type: 'SET_IS_SAVING'; payload: boolean }
  | { type: 'SET_IS_TESTING'; payload: boolean }
  | { type: 'SET_IS_REFRESHING_MODELS'; payload: boolean }
  | { type: 'SET_IS_DISCOVERING_LOCAL_OLLAMA'; payload: boolean }
  | { type: 'SET_IS_MUTATING_CONFIG_SET'; payload: boolean }
  | { type: 'SET_IS_DIAGNOSING'; payload: boolean }
  | { type: 'CLEAR_ERROR' }
  | { type: 'SET_ERROR_KEY'; key: string; values?: Record<string, string | number> }
  | { type: 'SET_ERROR_TEXT'; text: string }
  | { type: 'CLEAR_SUCCESS' }
  | { type: 'SET_SUCCESS_KEY'; key: string; values?: Record<string, string | number> }
  | { type: 'SET_SUCCESS_TEXT'; text: string }
  | { type: 'SET_LAST_SAVE_COMPLETED_AT'; payload: number }
  | { type: 'SET_TEST_RESULT'; payload: ApiTestResult | null }
  | { type: 'SET_DIAGNOSTIC_RESULT'; payload: DiagnosticResult | null }
  | { type: 'SET_SAVED_DRAFT_SIGNATURE'; payload: string };
