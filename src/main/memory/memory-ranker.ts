import { cosineSimilarity, lexicalScore, normalizeWorkspaceKey } from './memory-utils';

export function memoryWorkspaceBoost(
  currentWorkspace: string | null,
  sourceWorkspace?: string | null
): number {
  if (!currentWorkspace) {
    return sourceWorkspace ? 0 : -0.03;
  }
  if (sourceWorkspace === currentWorkspace) {
    return 0.3;
  }
  if (!sourceWorkspace) {
    return -0.04;
  }
  return 0;
}

export function memoryRecencyBoost(ingestedAt: string, now = Date.now()): number {
  const timestamp = Date.parse(ingestedAt);
  if (!Number.isFinite(timestamp)) {
    return 0;
  }
  const ageDays = Math.max(0, (now - timestamp) / 86_400_000);
  if (ageDays <= 3) {
    return 0.08;
  }
  if (ageDays <= 14) {
    return 0.04;
  }
  if (ageDays <= 45) {
    return 0.02;
  }
  return 0;
}

export interface MemoryRankInput {
  query: string;
  text: string;
  queryEmbedding?: number[];
  recordEmbedding?: number[];
  currentWorkspace?: string | null;
  sourceWorkspace?: string | null;
  ingestedAt?: string;
}

export function computeMemoryRankScore(input: MemoryRankInput): {
  score: number;
  evidenceScore: number;
} {
  const lexical = lexicalScore(input.query, input.text);
  const embedding =
    input.queryEmbedding?.length && input.recordEmbedding?.length
      ? cosineSimilarity(input.queryEmbedding, input.recordEmbedding)
      : 0;
  const evidenceScore = lexical + embedding;
  const currentWorkspace = normalizeWorkspaceKey(input.currentWorkspace || null);
  const score =
    evidenceScore +
    memoryWorkspaceBoost(currentWorkspace, input.sourceWorkspace) +
    (input.ingestedAt ? memoryRecencyBoost(input.ingestedAt) : 0);
  return { score, evidenceScore };
}
