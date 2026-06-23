import { describe, expect, it } from 'vitest';

import { isCompactSlashCommand, parseSlashCommand } from '../../src/shared/slash-commands';

describe('parseSlashCommand', () => {
  it('detects bare /compact', () => {
    expect(parseSlashCommand('/compact')).toEqual({ kind: 'compact', instructions: undefined });
  });

  it('detects /compact with custom instructions', () => {
    expect(parseSlashCommand('/compact focus on API changes')).toEqual({
      kind: 'compact',
      instructions: 'focus on API changes',
    });
  });

  it('is case-insensitive', () => {
    expect(parseSlashCommand('/COMPACT keep tool calls')).toEqual({
      kind: 'compact',
      instructions: 'keep tool calls',
    });
  });

  it('returns message for normal text', () => {
    expect(parseSlashCommand('hello /compact world')).toEqual({ kind: 'message' });
    expect(parseSlashCommand('please compact this')).toEqual({ kind: 'message' });
  });

  it('exposes compact predicate', () => {
    expect(isCompactSlashCommand('/compact')).toBe(true);
    expect(isCompactSlashCommand('not a command')).toBe(false);
  });
});
