import { describe, expect, it } from 'vitest';
import {
  COMMON_PROVIDER_SETUPS,
  detectCommonProviderSetup,
  getFallbackOpenAISetup,
  isParsableBaseUrl,
  orderCommonProviderSetups,
  resolveProviderGuidanceErrorHint,
} from '../src/shared/api-provider-guidance';

describe('provider guidance helpers', () => {
  it('detects Ollama on the local default port and prefers the openai tab', () => {
    const setup = detectCommonProviderSetup('http://localhost:11434/v1');
    expect(setup?.id).toBe('ollama');
    expect(setup?.preferProviderTab).toBe('openai');
    expect(detectCommonProviderSetup('http://localhost:3000/v1')).toBeNull();
  });

  it('detects vLLM on the local default port', () => {
    const setup = detectCommonProviderSetup('http://localhost:8000/v1');
    expect(setup?.id).toBe('vllm');
    expect(setup?.preferProviderTab).toBe('openai');
  });

  it('keeps unknown hosts unmatched and exposes the generic OpenAI fallback separately', () => {
    expect(detectCommonProviderSetup('https://relay.example.internal/v1')).toBeNull();
    expect(getFallbackOpenAISetup().id).toBe('generic-openai');
    expect(isParsableBaseUrl('https://relay.example.internal/v1')).toBe(true);
    expect(isParsableBaseUrl('relay-example')).toBe(false);
  });

  it('moves the detected setup to the top of the common setup list', () => {
    const ordered = orderCommonProviderSetups('vllm');
    expect(ordered[0]?.id).toBe('vllm');
    expect(ordered).toHaveLength(COMMON_PROVIDER_SETUPS.length);
  });

  it('maps probe failures to friendly hint kinds', () => {
    const ollama = detectCommonProviderSetup('http://localhost:11434/v1');
    expect(resolveProviderGuidanceErrorHint('empty_probe_response', ollama)).toBe(
      'emptyProbePreferProvider'
    );
    expect(resolveProviderGuidanceErrorHint('probe_response_mismatch:pong', ollama)).toBe(
      'probeMismatchDetected'
    );
    expect(resolveProviderGuidanceErrorHint('empty_probe_response', null)).toBe(
      'emptyProbeGeneric'
    );
  });
});
