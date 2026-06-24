import type { CommonProviderSetup } from '../../../shared/api-provider-guidance';
import type {
  ApiConfigSet,
  ApiTestResult,
  CustomProtocolType,
  DiagnosticResult,
  ProviderModelInfo,
  ProviderPreset,
  ProviderPresets,
  ProviderType,
} from '../../types';
import type { PendingConfigSetAction } from './api-config-types';

export function buildApiConfigStateResult({
  activeConfigSetId,
  apiKey,
  applyCommonProviderSetup,
  baseUrl,
  baseUrlGuidanceText,
  commonProviderSetups,
  configSetLimit,
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
  provider,
  protocolGuidanceText,
  protocolGuidanceTone,
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
  setError,
  setMaxTokens,
  setModel,
  setSuccessMessage,
  shouldShowOllamaManualModelToggle,
  successMessage,
  testResult,
  toggleCustomModel,
  useCustomModel,
  changeProvider,
  changeProtocol,
  cancelPendingConfigSetAction,
  discoverLocalOllama,
}: {
  activeConfigSetId: string;
  apiKey: string;
  applyCommonProviderSetup: (setupId: string) => void;
  baseUrl: string;
  baseUrlGuidanceText: string;
  commonProviderSetups: Array<{
    id: string;
    name: string;
    protocolLabel: string;
    baseUrl: string;
    exampleModel: string;
    notes: string;
    isDetected: boolean;
  }>;
  configSetLimit: number;
  configSets: ApiConfigSet[];
  contextWindow: string;
  createConfigSet: (payload: { name: string; mode: 'blank' | 'clone' }) => Promise<boolean>;
  currentConfigSet: ApiConfigSet | null;
  currentPreset: ProviderPreset;
  customModel: string;
  customProtocol: CustomProtocolType;
  deleteConfigSet: (id: string) => Promise<boolean>;
  detectedProviderSetup: CommonProviderSetup | null;
  diagnosticResult: DiagnosticResult | null;
  discardAndContinuePendingConfigSetAction: () => Promise<void>;
  enableThinking: boolean;
  error: string;
  friendlyTestDetails: string;
  handleDeepDiagnose: () => Promise<void>;
  handleDiagnose: (verificationLevel?: 'fast' | 'deep') => Promise<void>;
  handleSave: (options?: { silentSuccess?: boolean }) => Promise<boolean>;
  handleTest: () => Promise<void>;
  hasUnsavedChanges: boolean;
  isDiagnosing: boolean;
  isDiscoveringLocalOllama: boolean;
  isLoadingConfig: boolean;
  isMutatingConfigSet: boolean;
  isRefreshingModels: boolean;
  isSaving: boolean;
  isTesting: boolean;
  lastSaveCompletedAt: number;
  maxTokens: string;
  model: string;
  modelInputGuidance: { hint: string; placeholder: string };
  modelOptions: ProviderModelInfo[];
  pendingConfigSet: ApiConfigSet | null;
  pendingConfigSetAction: PendingConfigSetAction | null;
  presets: ProviderPresets;
  provider: ProviderType;
  protocolGuidanceText: string;
  protocolGuidanceTone: 'info' | 'warning' | undefined;
  refreshModelOptions: () => Promise<unknown[]>;
  renameConfigSet: (id: string, name: string) => Promise<boolean>;
  requestConfigSetSwitch: (setId: string) => Promise<void>;
  requestCreateBlankConfigSet: () => Promise<void>;
  requiresApiKey: boolean;
  saveAndContinuePendingConfigSetAction: () => Promise<void>;
  setApiKey: (value: string) => void;
  setBaseUrl: (value: string) => void;
  setContextWindow: (value: string) => void;
  setCustomModel: (value: string) => void;
  setEnableThinking: (value: boolean) => void;
  setError: (text: string) => void;
  setMaxTokens: (value: string) => void;
  setModel: (value: string) => void;
  setSuccessMessage: (text: string) => void;
  shouldShowOllamaManualModelToggle: boolean;
  successMessage: string;
  testResult: ApiTestResult | null;
  toggleCustomModel: () => void;
  useCustomModel: boolean;
  changeProvider: (provider: ProviderType) => void;
  changeProtocol: (protocol: CustomProtocolType) => void;
  cancelPendingConfigSetAction: () => void;
  discoverLocalOllama: (options?: { silent?: boolean }) => Promise<unknown>;
}) {
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
    configSetLimit,
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
    setError,
    setSuccessMessage,
  };
}
