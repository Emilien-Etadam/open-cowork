import type { SharedCustomProtocolType, SharedProviderType } from './api-model-presets';

export type CommonProviderSetupId = 'ollama' | 'vllm' | 'generic-openai' | 'generic-anthropic';

export interface CommonProviderSetup {
  id: CommonProviderSetupId;
  nameKey: string;
  noteKey: string;
  applyProvider: SharedProviderType;
  recommendedProtocol: SharedCustomProtocolType;
  recommendedBaseUrl: string;
  exampleModel: string;
  protocolLabel?: string;
  preferProviderTab?: SharedProviderType;
  matcher?: {
    hosts?: string[];
    hostContains?: string[];
    ports?: string[];
    pathPrefixes?: string[];
    pathIncludes?: string[];
  };
}

export type ProviderGuidanceHintCode =
  | 'empty_probe_response'
  | 'probe_response_mismatch'
  | 'prefer_provider_tab'
  | 'protocol_mismatch';

export type ProviderGuidanceErrorHintKind =
  | 'emptyProbeGeneric'
  | 'emptyProbeDetected'
  | 'emptyProbePreferProvider'
  | 'probeMismatchGeneric'
  | 'probeMismatchDetected';

export const COMMON_PROVIDER_SETUPS: CommonProviderSetup[] = [
  {
    id: 'ollama',
    nameKey: 'api.guidance.setups.ollama.name',
    noteKey: 'api.guidance.setups.ollama.note',
    applyProvider: 'openai',
    recommendedProtocol: 'openai',
    recommendedBaseUrl: 'http://localhost:11434/v1',
    exampleModel: 'qwen3.5:0.8b',
    protocolLabel: 'Ollama',
    preferProviderTab: 'openai',
    matcher: {
      hosts: ['localhost', '127.0.0.1', '0.0.0.0', '[::1]'],
      ports: ['11434'],
      pathPrefixes: ['', '/', '/v1'],
    },
  },
  {
    id: 'vllm',
    nameKey: 'api.guidance.setups.vllm.name',
    noteKey: 'api.guidance.setups.vllm.note',
    applyProvider: 'openai',
    recommendedProtocol: 'openai',
    recommendedBaseUrl: 'http://localhost:8000/v1',
    exampleModel: 'meta-llama/Llama-3.2-3B-Instruct',
    protocolLabel: 'vLLM',
    preferProviderTab: 'openai',
    matcher: {
      hosts: ['localhost', '127.0.0.1', '0.0.0.0', '[::1]'],
      ports: ['8000'],
      pathPrefixes: ['', '/', '/v1'],
    },
  },
  {
    id: 'generic-openai',
    nameKey: 'api.guidance.setups.genericOpenAI.name',
    noteKey: 'api.guidance.setups.genericOpenAI.note',
    applyProvider: 'openai',
    recommendedProtocol: 'openai',
    recommendedBaseUrl: 'http://localhost:8080/v1',
    exampleModel: 'your-model-id',
    preferProviderTab: 'openai',
  },
  {
    id: 'generic-anthropic',
    nameKey: 'api.guidance.setups.genericAnthropic.name',
    noteKey: 'api.guidance.setups.genericAnthropic.note',
    applyProvider: 'anthropic',
    recommendedProtocol: 'anthropic',
    recommendedBaseUrl: 'http://localhost:8080',
    exampleModel: 'claude-sonnet-4-6',
    preferProviderTab: 'anthropic',
  },
];

function normalizeBaseUrl(baseUrl: string | undefined): URL | null {
  const value = baseUrl?.trim();
  if (!value) {
    return null;
  }
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

export function isParsableBaseUrl(baseUrl: string | undefined): boolean {
  return normalizeBaseUrl(baseUrl) !== null;
}

function matchesHost(hostname: string, candidates: string[] | undefined): boolean {
  if (!candidates?.length) {
    return true;
  }
  const host = hostname.toLowerCase();
  return candidates.some((candidate) => host === candidate || host.endsWith(`.${candidate}`));
}

function matchesHostContains(hostname: string, candidates: string[] | undefined): boolean {
  if (!candidates?.length) {
    return true;
  }
  const host = hostname.toLowerCase();
  return candidates.some((candidate) => host.includes(candidate.toLowerCase()));
}

function matchesPath(pathname: string, setup: CommonProviderSetup): boolean {
  const normalizedPath = pathname.replace(/\/+$/, '') || '/';
  const { pathPrefixes, pathIncludes } = setup.matcher || {};

  const prefixOk =
    !pathPrefixes?.length ||
    pathPrefixes.some((prefix) => {
      const value = prefix || '/';
      return normalizedPath === value || normalizedPath.startsWith(`${value}/`);
    });
  if (!prefixOk) {
    return false;
  }

  const includesOk =
    !pathIncludes?.length || pathIncludes.some((fragment) => normalizedPath.includes(fragment));
  return includesOk;
}

function matchesPort(portname: string, candidates: string[] | undefined): boolean {
  if (!candidates?.length) {
    return true;
  }
  const value = portname || '';
  return candidates.includes(value);
}

export function detectCommonProviderSetup(baseUrl: string | undefined): CommonProviderSetup | null {
  const parsed = normalizeBaseUrl(baseUrl);
  if (!parsed) {
    return null;
  }

  const hostname = parsed.hostname.toLowerCase();
  const pathname = parsed.pathname;

  for (const setup of COMMON_PROVIDER_SETUPS) {
    if (!setup.matcher) {
      continue;
    }
    if (!matchesHost(hostname, setup.matcher.hosts)) {
      continue;
    }
    if (!matchesHostContains(hostname, setup.matcher.hostContains)) {
      continue;
    }
    if (!matchesPort(parsed.port, setup.matcher.ports)) {
      continue;
    }
    if (!matchesPath(pathname, setup)) {
      continue;
    }
    return setup;
  }

  return null;
}

export function orderCommonProviderSetups(
  activeId?: CommonProviderSetupId | null
): CommonProviderSetup[] {
  if (!activeId) {
    return COMMON_PROVIDER_SETUPS;
  }

  return [...COMMON_PROVIDER_SETUPS].sort((left, right) => {
    if (left.id === activeId) return -1;
    if (right.id === activeId) return 1;
    return 0;
  });
}

export function getFallbackOpenAISetup(): CommonProviderSetup {
  return COMMON_PROVIDER_SETUPS.find((setup) => setup.id === 'generic-openai')!;
}

function detectProviderGuidanceHintCode(
  details: string | undefined
): ProviderGuidanceHintCode | null {
  const value = details?.trim().toLowerCase();
  if (!value) {
    return null;
  }
  if (value === 'empty_probe_response') {
    return 'empty_probe_response';
  }
  if (value.startsWith('probe_response_mismatch:')) {
    return 'probe_response_mismatch';
  }
  return null;
}

export function resolveProviderGuidanceErrorHint(
  details: string | undefined,
  setup?: CommonProviderSetup | null
): ProviderGuidanceErrorHintKind | null {
  const hintCode = detectProviderGuidanceHintCode(details);
  if (!hintCode) {
    return null;
  }

  if (hintCode === 'empty_probe_response') {
    if (setup?.preferProviderTab) {
      return 'emptyProbePreferProvider';
    }
    return setup ? 'emptyProbeDetected' : 'emptyProbeGeneric';
  }

  return setup ? 'probeMismatchDetected' : 'probeMismatchGeneric';
}
