import { describe, expect, it, vi } from 'vitest';
import type { ApiConfigSet } from '../src/renderer/types';
import { getConfigSetDisplayName } from '../src/renderer/utils/config-set-display';

function makeT(translations: Record<string, string>) {
  return vi.fn((key: string) => translations[key] ?? key);
}

describe('getConfigSetDisplayName', () => {
  it('localizes the system default set instead of showing stored legacy names', () => {
    const set: ApiConfigSet = {
      id: 'default',
      name: '默认方案',
      isSystem: true,
      provider: 'openai',
      customProtocol: 'openai',
      activeProfileKey: 'openai',
      profiles: {},
      enableThinking: false,
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    const t = makeT({
      'api.defaultConfigSetName': 'Par défaut',
      'api.defaultSetTag': 'Par défaut',
    });

    expect(getConfigSetDisplayName(set, t)).toBe('Par défaut');
  });

  it('shows both label and tag when they differ', () => {
    const set: ApiConfigSet = {
      id: 'default',
      name: 'Default',
      isSystem: true,
      provider: 'openai',
      customProtocol: 'openai',
      activeProfileKey: 'openai',
      profiles: {},
      enableThinking: false,
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    const t = makeT({
      'api.defaultConfigSetName': '默认方案',
      'api.defaultSetTag': '默认',
    });

    expect(getConfigSetDisplayName(set, t)).toBe('默认方案 (默认)');
  });

  it('keeps custom config set names unchanged', () => {
    const set: ApiConfigSet = {
      id: 'work',
      name: 'Work OpenAI',
      isSystem: false,
      provider: 'openai',
      customProtocol: 'openai',
      activeProfileKey: 'openai',
      profiles: {},
      enableThinking: false,
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    const t = makeT({});

    expect(getConfigSetDisplayName(set, t)).toBe('Work OpenAI');
  });
});
