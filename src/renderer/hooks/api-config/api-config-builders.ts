import type {
  ApiConfigSet,
  AppConfig,
  CustomProtocolType,
  ProviderProfile,
  ProviderPresets,
  ProviderProfileKey,
  ProviderType,
} from '../../types';
import type { CommonProviderSetup } from '../../../shared/api-provider-guidance';
import {
  PROFILE_KEYS,
  type ApiConfigBootstrap,
  type ApiConfigState,
  type ConfigStateSnapshot,
  type UIProviderProfile,
} from './api-config-types';
import {
  isCustomProtocol,
  isProfileKey,
  isProviderType,
  modelPresetForProfile,
  normalizeProfile,
  profileKeyFromProvider,
  profileKeyToProvider,
} from './api-config-profile-utils';

const DEFAULT_CONFIG_SET_ID = 'default';
const DEFAULT_CONFIG_SET_NAME = 'Default';

function resolveProvider(config: AppConfig | null | undefined): ProviderType {
  return isProviderType(config?.provider) ? config.provider : 'openai';
}

function resolveCustomProtocol(
  config: AppConfig | null | undefined,
  provider: ProviderType
): CustomProtocolType {
  if (isCustomProtocol(config?.customProtocol)) {
    return config.customProtocol;
  }
  return provider === 'anthropic' ? 'anthropic' : 'openai';
}

export function buildApiConfigSnapshot(
  config: AppConfig | null | undefined,
  presets: ProviderPresets
): ConfigStateSnapshot {
  const provider = resolveProvider(config);
  const customProtocol = resolveCustomProtocol(config, provider);
  const derivedProfileKey = profileKeyFromProvider(provider, customProtocol);
  const activeProfileKey = isProfileKey(config?.activeProfileKey)
    ? config.activeProfileKey
    : derivedProfileKey;

  const profiles = {} as Record<ProviderProfileKey, UIProviderProfile>;
  for (const key of PROFILE_KEYS) {
    profiles[key] = normalizeProfile(key, config?.profiles?.[key], presets);
  }

  const hasProfilesFromConfig = Boolean(
    config?.profiles && Object.keys(config.profiles).length > 0
  );
  if (!hasProfilesFromConfig) {
    profiles[activeProfileKey] = normalizeProfile(
      activeProfileKey,
      {
        apiKey: config?.apiKey || '',
        baseUrl: config?.baseUrl,
        model: config?.model,
      },
      presets
    );
  }

  return {
    activeProfileKey,
    profiles,
    enableThinking: Boolean(config?.enableThinking),
  };
}

export function toPersistedProfiles(
  profiles: Record<ProviderProfileKey, UIProviderProfile>
): Partial<Record<ProviderProfileKey, ProviderProfile>> {
  const persisted: Partial<Record<ProviderProfileKey, ProviderProfile>> = {};
  for (const key of PROFILE_KEYS) {
    const profile = profiles[key];
    const finalModel = profile.useCustomModel
      ? profile.customModel.trim() || profile.model
      : profile.model;
    persisted[key] = {
      apiKey: profile.apiKey,
      baseUrl: profile.baseUrl.trim() || undefined,
      model: finalModel,
      contextWindow: profile.contextWindow ? Number(profile.contextWindow) : undefined,
      maxTokens: profile.maxTokens ? Number(profile.maxTokens) : undefined,
    };
  }
  return persisted;
}

export function buildApiConfigDraftSignature(
  activeProfileKey: ProviderProfileKey,
  profiles: Record<ProviderProfileKey, UIProviderProfile>,
  enableThinking: boolean
): string {
  const persisted = toPersistedProfiles(profiles);
  return JSON.stringify({
    activeProfileKey,
    enableThinking,
    profiles: PROFILE_KEYS.map((key) => ({
      key,
      apiKey: persisted[key]?.apiKey || '',
      baseUrl: persisted[key]?.baseUrl || '',
      model: persisted[key]?.model || '',
    })),
  });
}

export function buildApiConfigSets(
  config: AppConfig | null | undefined,
  presets: ProviderPresets
): ApiConfigSet[] {
  const now = new Date().toISOString();

  if (config?.configSets && config.configSets.length > 0) {
    return config.configSets.map((set, index) => {
      const provider = isProviderType(set.provider) ? set.provider : 'openai';
      const customProtocol = isCustomProtocol(set.customProtocol)
        ? set.customProtocol
        : provider === 'anthropic'
          ? 'anthropic'
          : 'openai';
      const fallbackActive = profileKeyFromProvider(provider, customProtocol);
      const activeProfileKey = isProfileKey(set.activeProfileKey)
        ? set.activeProfileKey
        : fallbackActive;

      const normalizedProfiles = {} as Record<ProviderProfileKey, ProviderProfile>;
      for (const key of PROFILE_KEYS) {
        const uiProfile = normalizeProfile(key, set.profiles?.[key], presets);
        normalizedProfiles[key] = {
          apiKey: uiProfile.apiKey,
          baseUrl: uiProfile.baseUrl,
          model: uiProfile.useCustomModel
            ? uiProfile.customModel.trim() || uiProfile.model
            : uiProfile.model,
        };
      }

      return {
        ...set,
        id: typeof set.id === 'string' && set.id.trim() ? set.id : `set-${index + 1}`,
        name:
          typeof set.name === 'string' && set.name.trim() ? set.name : `Configuration ${index + 1}`,
        provider,
        customProtocol,
        activeProfileKey,
        profiles: normalizedProfiles,
        enableThinking: Boolean(set.enableThinking),
        updatedAt: typeof set.updatedAt === 'string' && set.updatedAt.trim() ? set.updatedAt : now,
      };
    });
  }

  const snapshot = buildApiConfigSnapshot(config, presets);
  const activeMeta = profileKeyToProvider(snapshot.activeProfileKey);
  const fallbackId =
    typeof config?.activeConfigSetId === 'string' && config.activeConfigSetId.trim()
      ? config.activeConfigSetId
      : DEFAULT_CONFIG_SET_ID;

  return [
    {
      id: fallbackId,
      name: DEFAULT_CONFIG_SET_NAME,
      isSystem: true,
      provider: activeMeta.provider,
      customProtocol: activeMeta.customProtocol,
      activeProfileKey: snapshot.activeProfileKey,
      profiles: toPersistedProfiles(snapshot.profiles),
      enableThinking: snapshot.enableThinking,
      updatedAt: now,
    },
  ];
}

export function buildApiConfigBootstrap(
  config: AppConfig | null | undefined,
  presets: ProviderPresets
): ApiConfigBootstrap {
  const snapshot = buildApiConfigSnapshot(config, presets);
  const configSets = buildApiConfigSets(config, presets);
  const activeConfigSetId =
    typeof config?.activeConfigSetId === 'string' &&
    configSets.some((set) => set.id === config.activeConfigSetId)
      ? config.activeConfigSetId
      : configSets[0]?.id || DEFAULT_CONFIG_SET_ID;

  return {
    snapshot,
    configSets,
    activeConfigSetId,
  };
}

export function buildInitialApiConfigState(
  config: AppConfig | null | undefined,
  bootstrap: ApiConfigBootstrap,
  presets: ProviderPresets
): ApiConfigState {
  return {
    presets,
    profiles: bootstrap.snapshot.profiles,
    activeProfileKey: bootstrap.snapshot.activeProfileKey,
    configSets: bootstrap.configSets,
    activeConfigSetId: bootstrap.activeConfigSetId,
    pendingConfigSetAction: null,
    isMutatingConfigSet: false,
    enableThinking: Boolean(config?.enableThinking),
    discoveredModels: {},
    isLoadingConfig: true,
    savedDraftSignature: '',
    isSaving: false,
    isTesting: false,
    isRefreshingModels: false,
    isDiscoveringLocalOllama: false,
    errorText: '',
    errorKey: null,
    errorValues: undefined,
    successText: '',
    successKey: null,
    successValues: undefined,
    lastSaveCompletedAt: 0,
    testResult: null,
    diagnosticResult: null,
    isDiagnosing: false,
  };
}

export function buildLoadedApiConfigStatePayload(
  config: AppConfig | null | undefined,
  presets: ProviderPresets
): {
  presets: ProviderPresets;
  profiles: Record<ProviderProfileKey, UIProviderProfile>;
  activeProfileKey: ProviderProfileKey;
  enableThinking: boolean;
  configSets: ApiConfigSet[];
  activeConfigSetId: string;
  savedDraftSignature: string;
} {
  const bootstrap = buildApiConfigBootstrap(config, presets);

  return {
    presets,
    profiles: bootstrap.snapshot.profiles,
    activeProfileKey: bootstrap.snapshot.activeProfileKey,
    enableThinking: bootstrap.snapshot.enableThinking,
    configSets: bootstrap.configSets,
    activeConfigSetId: bootstrap.activeConfigSetId,
    savedDraftSignature: buildApiConfigDraftSignature(
      bootstrap.snapshot.activeProfileKey,
      bootstrap.snapshot.profiles,
      bootstrap.snapshot.enableThinking
    ),
  };
}

export function buildSetupModelState(
  setup: CommonProviderSetup,
  profileKey: ProviderProfileKey,
  presets: ProviderPresets
): Pick<UIProviderProfile, 'model' | 'customModel' | 'useCustomModel'> {
  const preset = modelPresetForProfile(profileKey, presets);
  const hasPresetModel = preset.models.some((item) => item.id === setup.exampleModel);
  return {
    model: hasPresetModel ? setup.exampleModel : preset.models[0]?.id || setup.exampleModel,
    customModel: hasPresetModel ? '' : setup.exampleModel,
    useCustomModel: !hasPresetModel,
  };
}
