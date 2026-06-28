import { describe, expect, it } from 'vitest';
import { resolveAgentCliPath } from '../../main/config/agent-cli-path';

describe('resolveAgentCliPath', () => {
  it('prefers agentCliPath over legacy claudeCodePath', () => {
    expect(
      resolveAgentCliPath({
        agentCliPath: '/usr/bin/agent',
        claudeCodePath: '/usr/bin/claude',
      })
    ).toBe('/usr/bin/agent');
  });

  it('falls back to claudeCodePath when agentCliPath is empty', () => {
    expect(
      resolveAgentCliPath({
        agentCliPath: '',
        claudeCodePath: '/usr/bin/claude',
      })
    ).toBe('/usr/bin/claude');
  });
});
