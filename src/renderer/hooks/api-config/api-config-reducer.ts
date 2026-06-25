import type { ProviderModelInfo, ProviderProfileKey } from '../../types';
import type { ApiConfigAction, ApiConfigState } from './api-config-types';
import { defaultProfileForKey } from './api-config-profile-utils';

// Inline helper: produces a partial discoveredModels update that clears a profile key.
// Used by dispatch callers instead of calling this as a free function.
function clearDiscoveredModelsForProfile(
  prev: Partial<Record<ProviderProfileKey, ProviderModelInfo[]>>,
  profileKey: ProviderProfileKey
): Partial<Record<ProviderProfileKey, ProviderModelInfo[]>> {
  return { ...prev, [profileKey]: [] };
}

export function apiConfigReducer(state: ApiConfigState, action: ApiConfigAction): ApiConfigState {
  switch (action.type) {
    case 'APPLY_LOADED_STATE':
      return {
        ...state,
        presets: action.payload.presets,
        profiles: action.payload.profiles,
        activeProfileKey: action.payload.activeProfileKey,
        enableThinking: action.payload.enableThinking,
        configSets: action.payload.configSets,
        activeConfigSetId: action.payload.activeConfigSetId,
        pendingConfigSetAction: null,
        savedDraftSignature: action.payload.savedDraftSignature,
      };

    case 'SET_ACTIVE_PROFILE_KEY':
      return { ...state, activeProfileKey: action.payload };

    case 'SET_ENABLE_THINKING':
      return { ...state, enableThinking: action.payload };

    case 'PATCH_PROFILE':
      return {
        ...state,
        profiles: {
          ...state.profiles,
          [action.profileKey]: {
            ...(state.profiles[action.profileKey] ||
              defaultProfileForKey(action.profileKey, state.presets)),
            ...action.patch,
          },
        },
      };

    case 'UPDATE_PROFILE_FN':
      return {
        ...state,
        profiles: {
          ...state.profiles,
          [action.profileKey]: action.updater(
            state.profiles[action.profileKey] ||
              defaultProfileForKey(action.profileKey, state.presets)
          ),
        },
      };

    case 'SET_DISCOVERED_MODELS':
      return {
        ...state,
        discoveredModels: { ...state.discoveredModels, [action.profileKey]: action.models },
      };

    case 'CLEAR_DISCOVERED_MODELS':
      return {
        ...state,
        discoveredModels: clearDiscoveredModelsForProfile(
          state.discoveredModels,
          action.profileKey
        ),
      };

    case 'DELETE_DISCOVERED_MODELS': {
      const next = { ...state.discoveredModels };
      delete next[action.profileKey];
      return { ...state, discoveredModels: next };
    }

    case 'SET_CONFIG_SETS':
      return { ...state, configSets: action.payload };

    case 'SET_ACTIVE_CONFIG_SET_ID':
      return { ...state, activeConfigSetId: action.payload };

    case 'SET_PENDING_CONFIG_SET_ACTION':
      return { ...state, pendingConfigSetAction: action.payload };

    case 'SET_IS_LOADING_CONFIG':
      return { ...state, isLoadingConfig: action.payload };

    case 'SET_IS_SAVING':
      return { ...state, isSaving: action.payload };

    case 'SET_IS_TESTING':
      return { ...state, isTesting: action.payload };

    case 'SET_IS_REFRESHING_MODELS':
      return { ...state, isRefreshingModels: action.payload };

    case 'SET_IS_DISCOVERING_LOCAL_OLLAMA':
      return { ...state, isDiscoveringLocalOllama: action.payload };

    case 'SET_IS_MUTATING_CONFIG_SET':
      return { ...state, isMutatingConfigSet: action.payload };

    case 'SET_IS_DIAGNOSING':
      return { ...state, isDiagnosing: action.payload };

    case 'CLEAR_ERROR':
      return { ...state, errorText: '', errorKey: null, errorValues: undefined };

    case 'SET_ERROR_KEY':
      return { ...state, errorText: '', errorKey: action.key, errorValues: action.values };

    case 'SET_ERROR_TEXT':
      return { ...state, errorKey: null, errorValues: undefined, errorText: action.text };

    case 'CLEAR_SUCCESS':
      return { ...state, successText: '', successKey: null, successValues: undefined };

    case 'SET_SUCCESS_KEY':
      return { ...state, successText: '', successKey: action.key, successValues: action.values };

    case 'SET_SUCCESS_TEXT':
      return { ...state, successKey: null, successValues: undefined, successText: action.text };

    case 'SET_LAST_SAVE_COMPLETED_AT':
      return { ...state, lastSaveCompletedAt: action.payload };

    case 'SET_TEST_RESULT':
      return { ...state, testResult: action.payload };

    case 'SET_DIAGNOSTIC_RESULT':
      return { ...state, diagnosticResult: action.payload };

    case 'SET_SAVED_DRAFT_SIGNATURE':
      return { ...state, savedDraftSignature: action.payload };

    default: {
      // Exhaustiveness check — TypeScript will error if a case is missing
      const _exhaustive: never = action;
      return _exhaustive;
    }
  }
}
