/**
 * @module main/config/config-schema
 *
 * Application configuration types, constants, defaults, and schema helpers.
 */
import { mt, DEFAULT_BACKEND_LANGUAGE } from '../i18n';

export type ProviderType = 'openrouter' | 'anthropic' | 'custom' | 'openai' | 'gemini' | 'ollama';
export type CustomProtocolType = 'anthropic' | 'openai' | 'gemini';
export type AppTheme = 'dark' | 'light' | 'system';
export type ThemePreset = 'default' | 'vscode';
export type ProviderProfileKey =
  | 'openrouter'
  | 'anthropic'
  | 'openai'
  | 'gemini'
  | 'ollama'
  | 'custom:anthropic'
  | 'custom:openai'
  | 'custom:gemini';
export type ConfigSetId = string;
export type CreateSetMode = 'blank' | 'clone';

export interface CreateConfigSetPayload {
  name: string;
  mode?: CreateSetMode;
  fromSetId?: string;
}

export interface ProviderProfile {
  apiKey: string;
  baseUrl?: string;
  model: string;
  contextWindow?: number;
  maxTokens?: number;
}

export interface ApiConfigSet {
  id: ConfigSetId;
  name: string;
  isSystem?: boolean;
  provider: ProviderType;
  customProtocol: CustomProtocolType;
  activeProfileKey: ProviderProfileKey;
  profiles: Partial<Record<ProviderProfileKey, ProviderProfile>>;
  enableThinking: boolean;
  updatedAt: string;
}

export interface AppConfig {
  provider: ProviderType;
  apiKey: string;
  baseUrl?: string;
  customProtocol?: CustomProtocolType;
  model: string;
  contextWindow?: number;
  maxTokens?: number;
  activeProfileKey: ProviderProfileKey;
  profiles: Partial<Record<ProviderProfileKey, ProviderProfile>>;
  activeConfigSetId: ConfigSetId;
  configSets: ApiConfigSet[];
  claudeCodePath?: string;
  defaultWorkdir?: string;
  globalSkillsPath?: string;
  enableDevLogs: boolean;
  theme: AppTheme;
  themePreset: ThemePreset;
  uiLanguage?: string;
  sandboxEnabled: boolean;
  memoryEnabled: boolean;
  memoryRuntime: MemoryRuntimeConfig;
  enableThinking: boolean;
  isConfigured: boolean;
}

export interface MemoryModelRuntimeConfig {
  inheritFromActive: boolean;
  provider?: ProviderType;
  customProtocol?: CustomProtocolType;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  timeoutMs: number;
}

export interface MemoryRuntimeConfig {
  llm: MemoryModelRuntimeConfig;
  embedding: MemoryModelRuntimeConfig;
  useEmbedding: boolean;
  maxNavSteps: number;
  ingestionConcurrency: number;
  storageRoot?: string;
  evalEnabled?: boolean;
  evalWorkspaces?: string[];
  evalMaxRounds?: number;
  evalArtifactsRoot?: string;
  promptIterationRounds?: number;
}

export const DEFAULT_CONFIG_SET_ID = 'default';
export const MAX_CONFIG_SET_COUNT = 20;
export const LOCAL_ANTHROPIC_PLACEHOLDER_KEY = 'sk-ant-local-proxy';

export const DIRECT_READ_KEYS = new Set<keyof AppConfig>([
  'provider',
  'apiKey',
  'baseUrl',
  'customProtocol',
  'activeProfileKey',
  'activeConfigSetId',
  'claudeCodePath',
  'defaultWorkdir',
  'globalSkillsPath',
  'enableDevLogs',
  'theme',
  'themePreset',
  'sandboxEnabled',
  'memoryEnabled',
  'enableThinking',
  'isConfigured',
]);

export const PROFILE_KEYS: ProviderProfileKey[] = [
  'openrouter',
  'anthropic',
  'openai',
  'gemini',
  'ollama',
  'custom:anthropic',
  'custom:openai',
  'custom:gemini',
];

const VALID_THEMES: AppTheme[] = ['dark', 'light', 'system'];
const VALID_THEME_PRESETS: ThemePreset[] = ['default', 'vscode'];

export const defaultProfiles: Record<ProviderProfileKey, ProviderProfile> = {
  openrouter: {
    apiKey: '',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'anthropic/claude-sonnet-4-6',
  },
  anthropic: {
    apiKey: '',
    baseUrl: 'https://api.anthropic.com',
    model: 'claude-sonnet-4-6',
  },
  openai: {
    apiKey: '',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-5.4',
  },
  ollama: {
    apiKey: '',
    baseUrl: 'http://localhost:11434/v1',
    model: '',
  },
  gemini: {
    apiKey: '',
    baseUrl: 'https://generativelanguage.googleapis.com',
    model: 'gemini-2.5-flash',
  },
  'custom:anthropic': {
    apiKey: '',
    baseUrl: 'https://open.bigmodel.cn/api/anthropic',
    model: 'glm-5',
  },
  'custom:openai': {
    apiKey: '',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-5.4',
  },
  'custom:gemini': {
    apiKey: '',
    baseUrl: 'https://generativelanguage.googleapis.com',
    model: 'gemini-2.5-flash',
  },
};

export const defaultConfigSet: ApiConfigSet = {
  id: DEFAULT_CONFIG_SET_ID,
  name: mt('configDefaultSetName'),
  isSystem: true,
  provider: 'openrouter',
  customProtocol: 'anthropic',
  activeProfileKey: 'openrouter',
  profiles: defaultProfiles,
  enableThinking: false,
  updatedAt: '1970-01-01T00:00:00.000Z',
};

export function getDefaultSandboxEnabled(): boolean {
  return process.platform === 'win32';
}

export function configHasStoredCredentials(config: Partial<AppConfig>): boolean {
  if (config.isConfigured) {
    return true;
  }
  const profiles = config.profiles || {};
  return Object.values(profiles).some(
    (profile) => typeof profile?.apiKey === 'string' && profile.apiKey.trim().length > 0
  );
}

export function shouldRecoverWipedConfig(current: AppConfig, recovered: AppConfig): boolean {
  if (!configHasStoredCredentials(recovered)) {
    return false;
  }
  return !configHasStoredCredentials(current);
}

export const defaultConfig: AppConfig = {
  provider: defaultConfigSet.provider,
  apiKey: defaultProfiles.openrouter.apiKey,
  baseUrl: defaultProfiles.openrouter.baseUrl,
  customProtocol: defaultConfigSet.customProtocol,
  model: defaultProfiles.openrouter.model,
  activeProfileKey: defaultConfigSet.activeProfileKey,
  profiles: defaultProfiles,
  activeConfigSetId: DEFAULT_CONFIG_SET_ID,
  configSets: [defaultConfigSet],
  claudeCodePath: '',
  defaultWorkdir: '',
  globalSkillsPath: '',
  enableDevLogs: false,
  theme: 'light',
  themePreset: 'default',
  uiLanguage: DEFAULT_BACKEND_LANGUAGE,
  sandboxEnabled: getDefaultSandboxEnabled(),
  memoryEnabled: true,
  memoryRuntime: {
    llm: {
      inheritFromActive: true,
      provider: undefined,
      customProtocol: undefined,
      apiKey: '',
      baseUrl: '',
      model: '',
      timeoutMs: 180000,
    },
    embedding: {
      inheritFromActive: true,
      provider: undefined,
      customProtocol: undefined,
      apiKey: '',
      baseUrl: '',
      model: 'text-embedding-3-small',
      timeoutMs: 180000,
    },
    useEmbedding: false,
    maxNavSteps: 2,
    ingestionConcurrency: 4,
    storageRoot: '',
    evalEnabled: false,
    evalWorkspaces: [],
    evalMaxRounds: 12,
    evalArtifactsRoot: '',
    promptIterationRounds: 2,
  },
  enableThinking: false,
  isConfigured: false,
};

export function isProviderType(value: unknown): value is ProviderType {
  return (
    value === 'openrouter' ||
    value === 'anthropic' ||
    value === 'custom' ||
    value === 'openai' ||
    value === 'gemini' ||
    value === 'ollama'
  );
}

export function isCustomProtocol(value: unknown): value is CustomProtocolType {
  return value === 'anthropic' || value === 'openai' || value === 'gemini';
}

export function isProfileKey(value: unknown): value is ProviderProfileKey {
  return typeof value === 'string' && PROFILE_KEYS.includes(value as ProviderProfileKey);
}

export function isAppTheme(value: unknown): value is AppTheme {
  return typeof value === 'string' && VALID_THEMES.includes(value as AppTheme);
}

export function isThemePreset(value: unknown): value is ThemePreset {
  return typeof value === 'string' && VALID_THEME_PRESETS.includes(value as ThemePreset);
}

function isMemoryModelRuntimeConfig(value: unknown): value is Partial<MemoryModelRuntimeConfig> {
  return typeof value === 'object' && value !== null;
}

function normalizeMemoryModelRuntimeConfig(
  raw: unknown,
  fallback: MemoryModelRuntimeConfig
): MemoryModelRuntimeConfig {
  const value = isMemoryModelRuntimeConfig(raw) ? raw : {};
  return {
    inheritFromActive: toBoolean(value.inheritFromActive, fallback.inheritFromActive),
    provider: isProviderType(value.provider) ? value.provider : fallback.provider,
    customProtocol: isCustomProtocol(value.customProtocol)
      ? value.customProtocol
      : fallback.customProtocol,
    apiKey: typeof value.apiKey === 'string' ? value.apiKey : fallback.apiKey,
    baseUrl: typeof value.baseUrl === 'string' ? value.baseUrl : fallback.baseUrl,
    model: typeof value.model === 'string' ? value.model : fallback.model,
    timeoutMs:
      typeof value.timeoutMs === 'number' && Number.isFinite(value.timeoutMs)
        ? Math.max(5000, Math.round(value.timeoutMs))
        : fallback.timeoutMs,
  };
}

export function normalizeMemoryRuntimeConfig(raw: unknown): MemoryRuntimeConfig {
  const value =
    typeof raw === 'object' && raw !== null ? (raw as Partial<MemoryRuntimeConfig>) : {};
  return {
    llm: normalizeMemoryModelRuntimeConfig(value.llm, defaultConfig.memoryRuntime.llm),
    embedding: normalizeMemoryModelRuntimeConfig(
      value.embedding,
      defaultConfig.memoryRuntime.embedding
    ),
    useEmbedding: toBoolean(value.useEmbedding, defaultConfig.memoryRuntime.useEmbedding),
    maxNavSteps:
      typeof value.maxNavSteps === 'number' && Number.isFinite(value.maxNavSteps)
        ? Math.max(0, Math.min(4, Math.round(value.maxNavSteps)))
        : defaultConfig.memoryRuntime.maxNavSteps,
    ingestionConcurrency:
      typeof value.ingestionConcurrency === 'number' && Number.isFinite(value.ingestionConcurrency)
        ? Math.max(1, Math.min(16, Math.round(value.ingestionConcurrency)))
        : defaultConfig.memoryRuntime.ingestionConcurrency,
    storageRoot:
      typeof value.storageRoot === 'string'
        ? value.storageRoot
        : defaultConfig.memoryRuntime.storageRoot,
    evalEnabled: toBoolean(value.evalEnabled, defaultConfig.memoryRuntime.evalEnabled ?? false),
    evalWorkspaces: Array.isArray(value.evalWorkspaces)
      ? value.evalWorkspaces.filter((item): item is string => typeof item === 'string')
      : defaultConfig.memoryRuntime.evalWorkspaces,
    evalMaxRounds:
      typeof value.evalMaxRounds === 'number' && Number.isFinite(value.evalMaxRounds)
        ? Math.max(1, Math.min(100, Math.round(value.evalMaxRounds)))
        : defaultConfig.memoryRuntime.evalMaxRounds,
    evalArtifactsRoot:
      typeof value.evalArtifactsRoot === 'string'
        ? value.evalArtifactsRoot
        : defaultConfig.memoryRuntime.evalArtifactsRoot,
    promptIterationRounds:
      typeof value.promptIterationRounds === 'number' &&
      Number.isFinite(value.promptIterationRounds)
        ? Math.max(0, Math.min(10, Math.round(value.promptIterationRounds)))
        : defaultConfig.memoryRuntime.promptIterationRounds,
  };
}

export function profileKeyFromProvider(
  provider: ProviderType,
  customProtocol: CustomProtocolType = 'anthropic'
): ProviderProfileKey {
  if (provider !== 'custom') {
    return provider;
  }
  if (customProtocol === 'openai') {
    return 'custom:openai';
  }
  if (customProtocol === 'gemini') {
    return 'custom:gemini';
  }
  return 'custom:anthropic';
}

export function profileKeyToProvider(profileKey: ProviderProfileKey): {
  provider: ProviderType;
  customProtocol: CustomProtocolType;
} {
  if (profileKey === 'custom:openai') {
    return { provider: 'custom', customProtocol: 'openai' };
  }
  if (profileKey === 'custom:gemini') {
    return { provider: 'custom', customProtocol: 'gemini' };
  }
  if (profileKey === 'custom:anthropic') {
    return { provider: 'custom', customProtocol: 'anthropic' };
  }
  if (profileKey === 'openai') {
    return { provider: 'openai', customProtocol: 'openai' };
  }
  if (profileKey === 'gemini') {
    return { provider: 'gemini', customProtocol: 'gemini' };
  }
  if (profileKey === 'ollama') {
    return { provider: 'ollama', customProtocol: 'openai' };
  }
  return { provider: profileKey, customProtocol: 'anthropic' };
}

export function toBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

export function toNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function nowISO(): string {
  return new Date().toISOString();
}

export function normalizeCustomProtocol(
  value: CustomProtocolType | undefined,
  fallback: CustomProtocolType = 'anthropic'
): CustomProtocolType {
  if (value === 'openai' || value === 'gemini' || value === 'anthropic') {
    return value;
  }
  return fallback;
}

export function defaultProtocolForProvider(provider: ProviderType): CustomProtocolType {
  if (provider === 'openai' || provider === 'ollama') {
    return 'openai';
  }
  if (provider === 'gemini') {
    return 'gemini';
  }
  return 'anthropic';
}
