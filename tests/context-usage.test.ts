import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { computeContextUsage } from '../src/renderer/utils/context-usage';

describe('context usage', () => {
  it('shows usage when only the context window is known', () => {
    expect(computeContextUsage([], 128000, 4096)).toEqual({
      inputTokens: 0,
      reservedOutput: 4096,
      used: 4096,
      total: 128000,
      percentage: 3.2,
      remaining: 123904,
    });
  });

  it('uses the latest assistant input token count', () => {
    const usage = computeContextUsage(
      [
        {
          id: '1',
          sessionId: 's1',
          role: 'assistant',
          content: [{ type: 'text', text: 'hello' }],
          timestamp: 1,
          tokenUsage: { input: 12000, output: 200 },
        },
      ],
      128000,
      4096
    );

    expect(usage?.inputTokens).toBe(12000);
    expect(usage?.used).toBe(16096);
  });
});

describe('ChatView IPC wiring', () => {
  it('does not replace the shared preload listener with a plugin-only handler', () => {
    const chatView = readFileSync(
      path.resolve(process.cwd(), 'src/renderer/components/ChatView.tsx'),
      'utf8'
    );

    expect(chatView).toContain('pluginCommandsRevision');
    expect(chatView).not.toContain('window.electronAPI.on((event)');
    expect(chatView).toContain('ChatContextUsageBar');
  });
});
