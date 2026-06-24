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
import type { CustomProtocolType, ProviderPresets, ProviderType } from '../../types';
import { buildApiConfigDraftSignature } from './api-config-builders';
import {
  isCustomAnthropicLoopbackGateway,
  isCustomGeminiLoopbackGateway,
  isCustomOpenAiLoopbackGateway,
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

function protocolLabel(protocol: CustomProtocolType, t: TFunction): string {
  if (protocol === 'openai') return t('api.guidance.protocolLabels.openai');
  if (protocol === 'gemini') return t('api.guidance.protocolLabels.gemini');
  return t('api.guidance.protocolLabels.anthropic');
}

function providerTabLabel(provider: ProviderType, presets: ProviderPresets, t: TFunction): string {
  return provider === 'custom' ? t('api.custom') : presets[provider]?.name || provider;
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
  const modelOptions =
    provider === 'ollama' ? discoveredModels[activeProfileKey] || [] : currentPreset.models;
  const modelInputGuidance = getModelInputGuidance(provider, customProtocol);
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

  const { apiKey, baseUrl, model, customModel, useCustomModel, contextWindow, maxTokens } =
    currentProfile;
  const shouldShowOllamaManualModelToggle =
    provider !== 'ollama' || useCustomModel || Boolean(error) || modelOptions.length === 0;
  const detectedProviderSetup = useMemo(
    () => (provider === 'custom' ? detectCommonProviderSetup(baseUrl) : null),
    [baseUrl, provider]
  );
  const fallbackOpenAISetup = useMemo(() => getFallbackOpenAISetup(), []);
  const effectiveProviderSetup = useMemo(() => {
    if (detectedProviderSetup) return detectedProviderSetup;
    if (
      provider === 'custom' &&
      customProtocol === 'openai' &&
      baseUrl.trim() &&
      isParsableBaseUrl(baseUrl)
    ) {
      return fallbackOpenAISetup;
    }
    return null;
  }, [baseUrl, customProtocol, detectedProviderSetup, fallbackOpenAISetup, provider]);
  const setupDisplayProtocol = useCallback(
    (setup: CommonProviderSetup) =>
      setup.protocolLabel || protocolLabel(setup.recommendedProtocol, t),
    [t]
  );
  const protocolGuidanceTone = useMemo<'info' | 'warning' | undefined>(() => {
    if (provider !== 'custom' || !detectedProviderSetup) return undefined;
    return detectedProviderSetup.preferProviderTab
      ? 'warning'
      : customProtocol === detectedProviderSetup.recommendedProtocol
        ? 'info'
        : 'warning';
  }, [customProtocol, detectedProviderSetup, provider]);
  const protocolGuidanceText = useMemo(() => {
    if (provider !== 'custom' || !detectedProviderSetup) return '';
    const service = t(detectedProviderSetup.nameKey);
    if (detectedProviderSetup.preferProviderTab) {
      return t('api.guidance.preferProviderTab', {
        service,
        provider: providerTabLabel(detectedProviderSetup.preferProviderTab, presets, t),
      });
    }
    return customProtocol !== detectedProviderSetup.recommendedProtocol
      ? t('api.guidance.protocolMismatch', {
          service,
          recommendedProtocol: setupDisplayProtocol(detectedProviderSetup),
        })
      : t('api.guidance.protocolLooksGood', {
          service,
          recommendedProtocol: setupDisplayProtocol(detectedProviderSetup),
        });
  }, [customProtocol, detectedProviderSetup, presets, provider, setupDisplayProtocol, t]);
  const baseUrlGuidanceText = useMemo(() => {
    if (provider !== 'custom' || !effectiveProviderSetup) return '';
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
      provider === 'custom'
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
        provider: providerTabLabel(detectedProviderSetup.preferProviderTab, presets, t),
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

  const allowEmptyApiKey =
    provider === 'ollama' ||
    (provider === 'custom' &&
      ((customProtocol === 'anthropic' && isCustomAnthropicLoopbackGateway(baseUrl)) ||
        (customProtocol === 'openai' && isCustomOpenAiLoopbackGateway(baseUrl)) ||
        (customProtocol === 'gemini' && isCustomGeminiLoopbackGateway(baseUrl))));
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
    shouldShowOllamaManualModelToggle,
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
