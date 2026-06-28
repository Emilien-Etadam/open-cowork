import { describe, expect, it } from 'vitest';
import { computeMemoryRankScore } from '../../main/memory/memory-ranker';

describe('memory-ranker', () => {
  it('boosts same-workspace matches', () => {
    const sameWorkspace = computeMemoryRankScore({
      query: 'gateway token',
      text: 'gateway token rotation policy',
      currentWorkspace: '/workspace/project-a',
      sourceWorkspace: '/workspace/project-a',
      ingestedAt: new Date().toISOString(),
    });
    const otherWorkspace = computeMemoryRankScore({
      query: 'gateway token',
      text: 'gateway token rotation policy',
      currentWorkspace: '/workspace/project-a',
      sourceWorkspace: '/workspace/project-b',
      ingestedAt: new Date().toISOString(),
    });
    expect(sameWorkspace.score).toBeGreaterThan(otherWorkspace.score);
  });
});
