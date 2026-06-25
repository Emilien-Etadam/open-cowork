import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

describe('MessageCard user actions', () => {
  it('exposes fork and edit prompt actions below copy', () => {
    const source = readFileSync(
      path.resolve(process.cwd(), 'src/renderer/components/MessageCard.tsx'),
      'utf8'
    );

    expect(source).toContain('onFork');
    expect(source).toContain('onEditPrompt');
    expect(source).toContain('forkFromMessage');
    expect(source).toContain('editPrompt');
    expect(source).toContain('GitBranch');
    expect(source).toContain('Pencil');
  });
});

describe('session message branch IPC', () => {
  it('registers fork and rewind client events', () => {
    const types = readFileSync(path.resolve(process.cwd(), 'src/renderer/types/index.ts'), 'utf8');
    const preload = readFileSync(path.resolve(process.cwd(), 'src/preload/index.ts'), 'utf8');

    expect(types).toContain('session.forkFromMessage');
    expect(types).toContain('session.rewindToMessage');
    expect(preload).toContain('session.forkFromMessage');
    expect(preload).toContain('session.rewindToMessage');
  });
});
