import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const useIpcPath = path.resolve(process.cwd(), 'src/renderer/hooks/useIPC.ts');
const useIpcContent = readFileSync(useIpcPath, 'utf8');

describe('useIPC handoff session bootstrap', () => {
  it('adds the initial handoff message and switches active session', () => {
    expect(useIpcContent).toContain('initialContent');
    expect(useIpcContent).toContain('addMessage(newSession.id, userMessage)');
    expect(useIpcContent).toContain('setActiveSession(newSession.id)');
    expect(useIpcContent).toContain('startExecutionClock(newSession.id, userMessage.timestamp)');
  });
});
