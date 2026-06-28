import { API_PROVIDER_PRESETS } from '../../shared/api-model-presets';
import type { ProviderPresets } from '../types';

export { getModelInputGuidance } from '../../shared/api-model-presets';
export {
  buildApiConfigBootstrap,
  buildApiConfigDraftSignature,
  buildApiConfigSets,
  buildApiConfigSnapshot,
} from './api-config/api-config-builders';
export {
  canDiscoverProviderModels,
  isLocalOpenAiMode,
  profileKeyFromProvider,
  profileKeyToProvider,
} from './api-config/api-config-profile-utils';
export { useApiConfigState } from './api-config/use-api-config-state-hook';

export const FALLBACK_PROVIDER_PRESETS: ProviderPresets = API_PROVIDER_PRESETS;
