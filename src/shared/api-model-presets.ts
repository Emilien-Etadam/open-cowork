export type SharedProviderType = 'openai' | 'anthropic';

export type SharedCustomProtocolType = 'anthropic' | 'openai';

export const ALLOWED_PROVIDER_TYPES: SharedProviderType[] = ['openai', 'anthropic'];

export interface SharedProviderPreset {
  name: string;
  baseUrl: string;
  models: Array<{ id: string; name: string }>;
  keyPlaceholder: string;
  keyHint: string;
}

export interface SharedProviderPresets {
  openai: SharedProviderPreset;
  anthropic: SharedProviderPreset;
}

export interface ModelInputGuidance {
  placeholder: string;
  hint: string;
}

export const API_PROVIDER_PRESETS: SharedProviderPresets = {
  openai: {
    name: 'OpenAI-compatible',
    baseUrl: '',
    models: [],
    keyPlaceholder: 'sk-...',
    keyHint: '',
  },
  anthropic: {
    name: 'Anthropic-compatible',
    baseUrl: '',
    models: [],
    keyPlaceholder: 'sk-ant-...',
    keyHint: '',
  },
};

export const PI_AI_CURATED_PRESETS: Record<string, { piProvider: string; pick: string[] }> = {
  anthropic: {
    piProvider: 'anthropic',
    pick: ['claude-sonnet-4-6', 'claude-haiku-4-5'],
  },
  openai: {
    piProvider: 'openai',
    pick: ['gpt-5.4', 'gpt-5.4-mini', 'o4-mini'],
  },
};

export function defaultProtocolForSharedProvider(
  provider: SharedProviderType
): SharedCustomProtocolType {
  return provider === 'anthropic' ? 'anthropic' : 'openai';
}

export function getModelInputGuidance(provider: SharedProviderType): ModelInputGuidance {
  if (provider === 'openai') {
    return {
      placeholder: 'qwen3.5:0.8b, meta-llama/Llama-3.2-3B-Instruct',
      hint: 'Ollama, vLLM et autres serveurs locaux utilisent aussi ce mode. Indiquez l’ID exact du modèle.',
    };
  }

  return {
    placeholder: 'claude-sonnet-4-6',
    hint: 'Utilisez l’ID exact exposé par votre point de terminaison compatible Anthropic.',
  };
}
