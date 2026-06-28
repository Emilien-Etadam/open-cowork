import { useCallback, useMemo } from 'react';
import type { TFunction } from 'i18next';
import { getModelInputGuidance } from '../../../shared/api-model-presets';
import {
  detectCommonProviderSetup,
  getFallbackOpenAISetup,
  isParsableBaseUrl,
  orderCommonProviderSetups,
  resolveProviderGuidanceErrorHint,
  type CommonProviderSetup,
} from '../../../shared/api-provider-guidance';
import { isLoopbackBaseUrl } from '../../../shared/network/loopback';
import type { ProviderPresets, ProviderType } from '../../types';
import { buildApiConfigDraftSignature } from './api-config-builders';
import {
  canDiscoverProviderModels,
  isLocalOpenAiMode,
  modelPresetForProfile,
  profileKeyToProvider,
} from './api-config-profile-utils';
import type { ApiConfigState } from './api-config-types';

interface UseApiConfigDerivedStateParams {
  activeConfigSetId: string;
  activeProfileKey: ApiConfigState['activeProfileKey'];
  configSets: ApiConfigState['configSets'];
  discoveredModels: ApiConfigState['discoveredModels'];
  enableThinking: boolean;
  error: string;
  pendingConfigSetAction: ApiConfigState['pendingConfigSetAction'];
  presets: ProviderPresets;
  profiles: ApiConfigState['profiles'];
  savedDraftSignature: string;
  t: TFunction;
  testDetails?: string;
}

function providerTabLabel(provider: ProviderType, presets: ProviderPresets): string {
  return presets[provider]?.name || provider;
}

export function useApiConfigDerivedState({
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
  testDetails,
}: UseApiConfigDerivedStateParams) {
  const providerMeta = useMemo(() => profileKeyToProvider(activeProfileKey), [activeProfileKey]);
  const provider = providerMeta.provider;
  const customProtocol = providerMeta.customProtocol;
  const currentProfile = profiles[activeProfileKey];
  const currentPreset = useMemo(
    () => modelPresetForProfile(activeProfileKey, presets),
    [activeProfileKey, presets]
  );
  const { apiKey, baseUrl, model, customModel, useCustomModel, contextWindow, maxTokens } =
    currentProfile;
  const allowEmptyApiKey =
    (provider === 'openai' && isLoopbackBaseUrl(baseUrl)) ||
    (provider === 'anthropic' && isLoopbackBaseUrl(baseUrl));
  const requiresApiKey = !allowEmptyApiKey;
  const localOpenAiMode = isLocalOpenAiMode(provider, baseUrl);
  const supportsModelDiscovery = canDiscoverProviderModels(
    provider,
    baseUrl,
    apiKey,
    requiresApiKey,
    currentPreset.baseUrl
  );
  const discovered = discoveredModels[activeProfileKey];
  const hasDiscoveredModels = Array.isArray(discovered) && discovered.length > 0;
  const modelOptions = hasDiscoveredModels
    ? discovered
    : localOpenAiMode
      ? []
      : currentPreset.models;
  const modelInputGuidance = getModelInputGuidance(provider);
  const currentConfigSet = useMemo(
    () => configSets.find((set) => set.id === activeConfigSetId) || null,
    [activeConfigSetId, configSets]
  );
  const pendingConfigSet = useMemo(
    () =>
      pendingConfigSetAction?.type === 'switch'
        ? configSets.find((set) => set.id === pendingConfigSetAction.targetSetId) || null
        : null,
    [configSets, pendingConfigSetAction]
  );
  const shouldShowLocalModelToggle =
    supportsModelDiscovery && (useCustomModel || Boolean(error) || modelOptions.length === 0);
  const detectedProviderSetup = useMemo(
    () => (provider === 'openai' ? detectCommonProviderSetup(baseUrl) : null),
    [baseUrl, provider]
  );
  const fallbackOpenAISetup = useMemo(() => getFallbackOpenAISetup(), []);
  const effectiveProviderSetup = useMemo(() => {
    if (detectedProviderSetup) return detectedProviderSetup;
    if (provider === 'openai' && baseUrl.trim() && isParsableBaseUrl(baseUrl)) {
      return fallbackOpenAISetup;
    }
    return null;
  }, [baseUrl, detectedProviderSetup, fallbackOpenAISetup, provider]);
  const setupDisplayProtocol = useCallback(
    (setup: CommonProviderSetup) =>
      setup.protocolLabel ||
      (setup.recommendedProtocol === 'openai'
        ? t('api.guidance.protocolLabels.openai')
        : t('api.guidance.protocolLabels.anthropic')),
    [t]
  );
  const protocolGuidanceTone = useMemo<'info' | 'warning' | undefined>(() => {
    if (provider !== 'openai' || !detectedProviderSetup) return undefined;
    return detectedProviderSetup.preferProviderTab ? 'warning' : 'info';
  }, [detectedProviderSetup, provider]);
  const protocolGuidanceText = useMemo(() => {
    if (provider !== 'openai' || !detectedProviderSetup) return '';
    const service = t(detectedProviderSetup.nameKey);
    if (detectedProviderSetup.preferProviderTab) {
      return t('api.guidance.preferProviderTab', {
        service,
        provider: providerTabLabel(detectedProviderSetup.preferProviderTab, presets),
      });
    }
    return t('api.guidance.protocolLooksGood', {
      service,
      recommendedProtocol: setupDisplayProtocol(detectedProviderSetup),
    });
  }, [detectedProviderSetup, presets, provider, setupDisplayProtocol, t]);
  const baseUrlGuidanceText = useMemo(() => {
    if (provider !== 'openai' || !effectiveProviderSetup) return '';
    if (!detectedProviderSetup && effectiveProviderSetup.id === fallbackOpenAISetup.id) {
      return t('api.guidance.genericBaseUrlHint', {
        recommendedProtocol: setupDisplayProtocol(effectiveProviderSetup),
        baseUrl: effectiveProviderSetup.recommendedBaseUrl,
        model: effectiveProviderSetup.exampleModel,
      });
    }
    return t('api.guidance.baseUrlHint', {
      service: t(effectiveProviderSetup.nameKey),
      recommendedProtocol: setupDisplayProtocol(effectiveProviderSetup),
      baseUrl: effectiveProviderSetup.recommendedBaseUrl,
      model: effectiveProviderSetup.exampleModel,
    });
  }, [
    detectedProviderSetup,
    effectiveProviderSetup,
    fallbackOpenAISetup.id,
    provider,
    setupDisplayProtocol,
    t,
  ]);
  const commonProviderSetups = useMemo(
    () =>
      provider === 'openai'
        ? orderCommonProviderSetups(detectedProviderSetup?.id).map((setup) => ({
            id: setup.id,
            name: t(setup.nameKey),
            protocolLabel: setupDisplayProtocol(setup),
            baseUrl: setup.recommendedBaseUrl,
            exampleModel: setup.exampleModel,
            notes: t(setup.noteKey),
            isDetected: setup.id === detectedProviderSetup?.id,
          }))
        : [],
    [detectedProviderSetup?.id, provider, setupDisplayProtocol, t]
  );
  const friendlyTestDetails = useMemo(() => {
    const hintKind = resolveProviderGuidanceErrorHint(testDetails, detectedProviderSetup);
    if (!hintKind) return '';
    if (hintKind === 'emptyProbePreferProvider' && detectedProviderSetup?.preferProviderTab) {
      return t('api.guidance.errorHints.emptyProbePreferProvider', {
        service: t(detectedProviderSetup.nameKey),
        provider: providerTabLabel(detectedProviderSetup.preferProviderTab, presets),
      });
    }
    if (hintKind === 'emptyProbeDetected' && effectiveProviderSetup) {
      return t('api.guidance.errorHints.emptyProbeDetected', {
        service: t(effectiveProviderSetup.nameKey),
        recommendedProtocol: setupDisplayProtocol(effectiveProviderSetup),
      });
    }
    if (hintKind === 'emptyProbeGeneric') return t('api.guidance.errorHints.emptyProbeGeneric');
    if (hintKind === 'probeMismatchDetected' && effectiveProviderSetup) {
      return t('api.guidance.errorHints.probeMismatchDetected', {
        service: t(effectiveProviderSetup.nameKey),
        recommendedProtocol: setupDisplayProtocol(effectiveProviderSetup),
      });
    }
    return hintKind === 'probeMismatchGeneric'
      ? t('api.guidance.errorHints.probeMismatchGeneric')
      : '';
  }, [
    detectedProviderSetup,
    effectiveProviderSetup,
    presets,
    setupDisplayProtocol,
    t,
    testDetails,
  ]);

  const currentDraftSignature = useMemo(
    () => buildApiConfigDraftSignature(activeProfileKey, profiles, enableThinking),
    [activeProfileKey, enableThinking, profiles]
  );

  return {
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
    isLocalOpenAiMode: localOpenAiMode,
    supportsModelDiscovery,
    shouldShowLocalModelToggle,
    detectedProviderSetup,
    protocolGuidanceTone,
    protocolGuidanceText,
    baseUrlGuidanceText,
    commonProviderSetups,
    friendlyTestDetails,
    requiresApiKey: !allowEmptyApiKey,
    currentDraftSignature,
    hasUnsavedChanges: savedDraftSignature !== '' && currentDraftSignature !== savedDraftSignature,
  };
}
