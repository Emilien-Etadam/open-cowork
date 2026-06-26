/**
 * @module main/config/config-store
 *
 * Persistent application configuration facade.
 *
 * Responsibilities:
 * - electron-store backed config persistence (API keys, model presets, settings)
 * - Config set management: create, rename, delete, switch between config profiles
 * - Delegates normalization to config-normalizer and provider runtime to config-provider-runtime
 *
 * Dependencies: electron-store, auth-utils, config-schema, config-normalizer, config-provider-runtime
 */
import Store, { type Options as StoreOptions } from 'electron-store';
import { log, logWarn } from '../utils/logger';
import {
  createEncryptedStoreWithKeyRotation,
  getLegacyDerivedKeyHexes,
} from '../utils/store-encryption';
import {
  getMachineEncryptionKey,
  LEGACY_STATIC_ENCRYPTION_KEYS,
} from '../utils/machine-encryption-key';
import { runConfigMigrations } from './config-migrations';
import { setBackendLanguage } from '../i18n';
import {
  buildBlankConfigSet,
  buildUniqueConfigSetName,
  cloneConfigSet,
  cloneProfiles,
  composeProjectedConfig,
  generateConfigSetId,
  normalizeConfig,
  normalizeConfigSets,
  normalizeProfile,
} from './config-normalizer';
import {
  applyConfigToEnv,
  hasAnyUsableCredentials,
  hasUsableCredentials,
  hasUsableCredentialsForActiveSet,
} from './config-provider-runtime';
import {
  defaultConfig,
  defaultProtocolForProvider,
  DIRECT_READ_KEYS,
  isAppTheme,
  isCustomProtocol,
  isProfileKey,
  isProviderType,
  isThemePreset,
  MAX_CONFIG_SET_COUNT,
  normalizeCustomProtocol,
  normalizeMemoryRuntimeConfig,
  normalizeWebSearchConfig,
  nowISO,
  PROFILE_KEYS,
  profileKeyFromProvider,
  profileKeyToProvider,
  shouldRecoverWipedConfig,
  toNonEmptyString,
  type ApiConfigSet,
  type AppConfig,
  type CreateConfigSetPayload,
  type CreateSetMode,
  type CustomProtocolType,
} from './config-schema';

export * from './config-schema';
export { getPiAiModelPresets, PROVIDER_PRESETS } from './config-provider-runtime';

export class ConfigStore {
  private store: Store<AppConfig>;

  constructor() {
    const storeOptions: StoreOptions<AppConfig> & { projectName?: string } = {
      name: 'config',
      projectName: 'open-cowork',
      defaults: defaultConfig,
    };

    type AppConfigRecord = AppConfig & Record<string, unknown>;
    this.store = createEncryptedStoreWithKeyRotation<AppConfigRecord>({
      stableKey: getMachineEncryptionKey(),
      legacyKeys: [
        ...LEGACY_STATIC_ENCRYPTION_KEYS,
        'open-cowork-config-v1',
        ...getLegacyDerivedKeyHexes({
          moduleDirname: __dirname,
          stableSeed: 'open-cowork-config-stable-v1',
          legacySeed: 'open-cowork-config-v1',
          salt: 'open-cowork-config-salt',
        }),
      ],
      storeOptions: storeOptions as StoreOptions<AppConfigRecord> & { projectName?: string },
      logPrefix: '[ConfigStore]',
      log,
      warn: logWarn,
      recoverIfReset: (current, recovered) =>
        shouldRecoverWipedConfig(current as AppConfig, recovered as AppConfig),
    }) as unknown as Store<AppConfig>;
    runConfigMigrations(this.store);
    this.ensureNormalized();
    setBackendLanguage((this.store.store as AppConfig).uiLanguage);
  }

  private ensureNormalized(): void {
    const normalized = this.normalizeConfig(this.store.store as Partial<AppConfig>);
    this.store.set(normalized);
  }

  private normalizeConfig(rawConfig: Partial<AppConfig> | undefined): AppConfig {
    return normalizeConfig(rawConfig);
  }

  private saveConfig(config: AppConfig): void {
    const normalized = this.normalizeConfig(config);
    this.store.set(normalized);
    setBackendLanguage(normalized.uiLanguage);
  }

  getAll(): AppConfig {
    return this.normalizeConfig(this.store.store as Partial<AppConfig>);
  }

  get<K extends keyof AppConfig>(key: K): AppConfig[K] {
    if (DIRECT_READ_KEYS.has(key)) {
      const rawValue = this.store.get(key as string) as AppConfig[K] | undefined;
      if (rawValue !== undefined) {
        if (key === 'provider' && !isProviderType(rawValue)) {
          return defaultConfig[key];
        }
        if (key === 'customProtocol' && !isCustomProtocol(rawValue)) {
          return defaultConfig[key];
        }
        if (key === 'activeProfileKey' && !isProfileKey(rawValue)) {
          return defaultConfig[key];
        }
        if (key === 'theme' && !isAppTheme(rawValue)) {
          return defaultConfig[key];
        }
        if (key === 'themePreset' && !isThemePreset(rawValue)) {
          return defaultConfig[key];
        }
        if (
          (key === 'enableDevLogs' ||
            key === 'sandboxEnabled' ||
            key === 'memoryEnabled' ||
            key === 'enableThinking' ||
            key === 'isConfigured') &&
          typeof rawValue !== 'boolean'
        ) {
          return defaultConfig[key];
        }
        return rawValue;
      }
      return defaultConfig[key];
    }
    return this.getAll()[key];
  }

  set<K extends keyof AppConfig>(key: K, value: AppConfig[K]): void {
    this.update({ [key]: value } as Partial<AppConfig>);
  }

  createSet(payload: CreateConfigSetPayload): AppConfig {
    const current = this.getAll();
    if (current.configSets.length >= MAX_CONFIG_SET_COUNT) {
      throw new Error(`Config set limit reached: max ${MAX_CONFIG_SET_COUNT}`);
    }

    const id = generateConfigSetId(current.configSets);
    const name = buildUniqueConfigSetName(payload.name, current.configSets);
    const mode: CreateSetMode = payload.mode === 'blank' ? 'blank' : 'clone';
    let newSet: ApiConfigSet;

    if (mode === 'blank') {
      const activeSet =
        current.configSets.find((set) => set.id === current.activeConfigSetId) ||
        current.configSets[0];
      const seedProvider = activeSet?.provider || current.provider;
      const seedProtocol: CustomProtocolType = normalizeCustomProtocol(
        activeSet?.customProtocol,
        defaultProtocolForProvider(seedProvider)
      );
      newSet = buildBlankConfigSet({
        id,
        name,
        provider: seedProvider,
        customProtocol: seedProtocol,
      });
    } else {
      const source =
        current.configSets.find((set) => set.id === payload.fromSetId) ||
        current.configSets.find((set) => set.id === current.activeConfigSetId) ||
        current.configSets[0];

      if (!source) {
        throw new Error('Config set clone source not found');
      }

      const cloned = cloneConfigSet(source);
      newSet = {
        ...cloned,
        id,
        name,
        isSystem: false,
        updatedAt: nowISO(),
      };
    }

    this.saveConfig({
      ...composeProjectedConfig(current, [...current.configSets, newSet], id),
    } as AppConfig);

    return this.getAll();
  }

  renameSet(payload: { id: string; name: string }): AppConfig {
    const current = this.getAll();
    const target = current.configSets.find((set) => set.id === payload.id);
    if (!target) {
      throw new Error('Config set not found');
    }

    const nextName = buildUniqueConfigSetName(payload.name, current.configSets, payload.id);
    const nextSets = current.configSets.map((set) => {
      if (set.id !== payload.id) {
        return cloneConfigSet(set);
      }
      return {
        ...cloneConfigSet(set),
        name: nextName,
        updatedAt: nowISO(),
      };
    });

    this.saveConfig(composeProjectedConfig(current, nextSets, current.activeConfigSetId));

    return this.getAll();
  }

  deleteSet(payload: { id: string }): AppConfig {
    const current = this.getAll();
    const target = current.configSets.find((set) => set.id === payload.id);
    if (!target) {
      throw new Error('Config set not found');
    }
    if (target.isSystem) {
      throw new Error('System config set cannot be deleted');
    }
    if (current.configSets.length <= 1) {
      throw new Error('At least one config set must be kept');
    }

    const nextSets = current.configSets
      .filter((set) => set.id !== payload.id)
      .map((set) => cloneConfigSet(set));

    const fallbackActive = nextSets.find((set) => set.isSystem)?.id || nextSets[0]?.id;
    const nextActiveConfigSetId =
      current.activeConfigSetId === payload.id ? fallbackActive : current.activeConfigSetId;

    this.saveConfig(composeProjectedConfig(current, nextSets, nextActiveConfigSetId));

    return this.getAll();
  }

  switchSet(payload: { id: string }): AppConfig {
    const current = this.getAll();
    if (!current.configSets.some((set) => set.id === payload.id)) {
      throw new Error('Config set not found');
    }

    this.saveConfig(composeProjectedConfig(current, current.configSets, payload.id));

    return this.getAll();
  }

  update(updates: Partial<AppConfig>): void {
    const current = this.getAll();
    let nextConfigSets = current.configSets.map((set) => cloneConfigSet(set));

    if (Array.isArray(updates.configSets) && updates.configSets.length > 0) {
      const normalizedSets = normalizeConfigSets(updates.configSets, {
        provider: current.provider,
        customProtocol: normalizeCustomProtocol(
          current.customProtocol,
          defaultProtocolForProvider(current.provider)
        ),
        activeProfileKey: current.activeProfileKey,
        profiles: cloneProfiles(current.profiles),
        enableThinking: current.enableThinking,
      });
      nextConfigSets = normalizedSets;
    }

    const requestedActiveConfigSetId =
      toNonEmptyString(updates.activeConfigSetId) || current.activeConfigSetId;
    const activeConfigSetId = nextConfigSets.some((set) => set.id === requestedActiveConfigSetId)
      ? requestedActiveConfigSetId
      : nextConfigSets[0].id;

    const targetIndex = nextConfigSets.findIndex((set) => set.id === activeConfigSetId);
    const targetSet =
      targetIndex >= 0
        ? cloneConfigSet(nextConfigSets[targetIndex])
        : cloneConfigSet(nextConfigSets[0]);

    const nextProfiles = cloneProfiles(targetSet.profiles);
    let nextActiveProfileKey = targetSet.activeProfileKey;
    let nextProvider = targetSet.provider;
    let nextCustomProtocol: CustomProtocolType = normalizeCustomProtocol(
      targetSet.customProtocol,
      defaultProtocolForProvider(targetSet.provider)
    );

    const mutatesActiveSet =
      updates.profiles !== undefined ||
      updates.activeProfileKey !== undefined ||
      updates.provider !== undefined ||
      updates.customProtocol !== undefined ||
      updates.apiKey !== undefined ||
      updates.baseUrl !== undefined ||
      updates.model !== undefined ||
      updates.enableThinking !== undefined;

    if (mutatesActiveSet) {
      if (updates.profiles) {
        for (const key of PROFILE_KEYS) {
          if (updates.profiles[key]) {
            nextProfiles[key] = normalizeProfile(key, updates.profiles[key]);
          }
        }
      }

      if (isProfileKey(updates.activeProfileKey)) {
        nextActiveProfileKey = updates.activeProfileKey;
        const fromProfile = profileKeyToProvider(nextActiveProfileKey);
        nextProvider = fromProfile.provider;
        nextCustomProtocol = fromProfile.customProtocol;
      }

      if (updates.provider || updates.customProtocol) {
        const requestedProvider = isProviderType(updates.provider)
          ? updates.provider
          : nextProvider;
        const requestedProtocol = isCustomProtocol(updates.customProtocol)
          ? updates.customProtocol
          : defaultProtocolForProvider(requestedProvider);
        nextActiveProfileKey = profileKeyFromProvider(requestedProvider, requestedProtocol);
        const fromProfile = profileKeyToProvider(nextActiveProfileKey);
        nextProvider = fromProfile.provider;
        nextCustomProtocol = fromProfile.customProtocol;
      }

      const nextActiveProfile = {
        ...nextProfiles[nextActiveProfileKey],
      };
      if (updates.apiKey !== undefined) {
        nextActiveProfile.apiKey = updates.apiKey;
      }
      if (updates.baseUrl !== undefined) {
        const baseUrl = updates.baseUrl?.trim();
        nextActiveProfile.baseUrl = baseUrl ?? '';
      }
      if (updates.model !== undefined) {
        const model = updates.model?.trim();
        nextActiveProfile.model = model ?? '';
      }
      nextProfiles[nextActiveProfileKey] = normalizeProfile(
        nextActiveProfileKey,
        nextActiveProfile
      );

      const updatedSet: ApiConfigSet = {
        ...targetSet,
        provider: nextProvider,
        customProtocol: nextCustomProtocol,
        activeProfileKey: nextActiveProfileKey,
        profiles: nextProfiles,
        enableThinking:
          updates.enableThinking !== undefined ? updates.enableThinking : targetSet.enableThinking,
        updatedAt: nowISO(),
      };

      if (targetIndex >= 0) {
        nextConfigSets[targetIndex] = updatedSet;
      }
    }

    const projectedConfig = composeProjectedConfig(current, nextConfigSets, activeConfigSetId);
    this.saveConfig({
      ...projectedConfig,
      claudeCodePath:
        updates.claudeCodePath !== undefined ? updates.claudeCodePath : current.claudeCodePath,
      defaultWorkdir:
        updates.defaultWorkdir !== undefined ? updates.defaultWorkdir : current.defaultWorkdir,
      globalSkillsPath:
        updates.globalSkillsPath !== undefined
          ? updates.globalSkillsPath
          : current.globalSkillsPath,
      enableDevLogs:
        updates.enableDevLogs !== undefined ? updates.enableDevLogs : current.enableDevLogs,
      theme: updates.theme !== undefined ? updates.theme : current.theme,
      themePreset: updates.themePreset !== undefined ? updates.themePreset : current.themePreset,
      uiLanguage: updates.uiLanguage !== undefined ? updates.uiLanguage : current.uiLanguage,
      sandboxEnabled:
        updates.sandboxEnabled !== undefined ? updates.sandboxEnabled : current.sandboxEnabled,
      memoryEnabled:
        updates.memoryEnabled !== undefined ? updates.memoryEnabled : current.memoryEnabled,
      memoryRuntime:
        updates.memoryRuntime !== undefined
          ? normalizeMemoryRuntimeConfig(updates.memoryRuntime)
          : current.memoryRuntime,
      webSearch:
        updates.webSearch !== undefined
          ? normalizeWebSearchConfig(updates.webSearch)
          : current.webSearch,
      isConfigured:
        updates.isConfigured !== undefined ? updates.isConfigured : current.isConfigured,
    });
  }

  isConfigured(): boolean {
    return hasAnyUsableCredentials(this.getAll());
  }

  hasUsableCredentials(config: AppConfig = this.getAll()): boolean {
    return hasUsableCredentials(config);
  }

  hasUsableCredentialsForActiveSet(config: AppConfig = this.getAll()): boolean {
    return hasUsableCredentialsForActiveSet(config);
  }

  hasAnyUsableCredentials(config: AppConfig = this.getAll()): boolean {
    return hasAnyUsableCredentials(config);
  }

  applyToEnv(): void {
    applyConfigToEnv(this.getAll());
  }

  reset(): void {
    this.store.clear();
    this.ensureNormalized();
  }

  getPath(): string {
    return this.store.path;
  }
}

export const configStore = new ConfigStore();
