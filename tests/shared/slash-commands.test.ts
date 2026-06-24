import { describe, expect, it } from 'vitest';

import {
  isCompactSlashCommand,
  isHandoffSlashCommand,
  parseSlashCommand,
} from '../../src/shared/slash-commands';

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

  it('detects bare /handoff', () => {
    expect(parseSlashCommand('/handoff')).toEqual({ kind: 'handoff', instructions: undefined });
  });

  it('detects /handoff with custom instructions', () => {
    expect(parseSlashCommand('/handoff focus on tests')).toEqual({
      kind: 'handoff',
      instructions: 'focus on tests',
    });
  });

  it('is case-insensitive', () => {
    expect(parseSlashCommand('/COMPACT keep tool calls')).toEqual({
      kind: 'compact',
      instructions: 'keep tool calls',
    });
    expect(parseSlashCommand('/HANDOFF keep decisions')).toEqual({
      kind: 'handoff',
      instructions: 'keep decisions',
    });
  });

  it('returns message for normal text', () => {
    expect(parseSlashCommand('hello /compact world')).toEqual({ kind: 'message' });
    expect(parseSlashCommand('please compact this')).toEqual({ kind: 'message' });
    expect(parseSlashCommand('hello /handoff world')).toEqual({ kind: 'message' });
  });

  it('exposes compact predicate', () => {
    expect(isCompactSlashCommand('/compact')).toBe(true);
    expect(isCompactSlashCommand('not a command')).toBe(false);
  });

  it('exposes handoff predicate', () => {
    expect(isHandoffSlashCommand('/handoff')).toBe(true);
    expect(isHandoffSlashCommand('not a command')).toBe(false);
  });
});
