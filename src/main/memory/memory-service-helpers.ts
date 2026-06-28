import * as path from 'node:path';
import type { MessageRow, SessionRow } from '../db/database';
import type { MemoryIngestionInput, MemoryTranscriptTurn } from './memory-types';
import { formatTimestamp } from './memory-utils';

export function extractRawText(turns: MemoryTranscriptTurn[], sourceTurns: number[]): string {
  return [...sourceTurns]
    .sort((a, b) => a - b)
    .map((turnNumber) => turns[turnNumber - 1])
    .filter((turn): turn is MemoryTranscriptTurn => Boolean(turn))
    .map((turn) => `${turn.role}: ${turn.content}`)
    .join('\n');
}

export function resolveSessionDate(
  session: MemoryIngestionInput['session'],
  messages: MemoryIngestionInput['messages']
): string {
  const timestamp =
    messages[messages.length - 1]?.timestamp || session.updatedAt || session.createdAt;
  return formatTimestamp(timestamp);
}

export function resolveWorkspaceLabel(sourceWorkspace: string | null): string | undefined {
  if (!sourceWorkspace) {
    return undefined;
  }
  const basename = path.basename(sourceWorkspace);
  return basename || sourceWorkspace;
}

export function sessionRowToSession(row: SessionRow): MemoryIngestionInput['session'] {
  return {
    id: row.id,
    title: row.title,
    status: row.status as MemoryIngestionInput['session']['status'],
    cwd: row.cwd || undefined,
    mountedPaths: [],
    allowedTools: [],
    memoryEnabled: row.memory_enabled === 1,
    model: row.model || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    claudeSessionId: row.agent_session_id || row.claude_session_id || undefined,
    openaiThreadId: row.openai_thread_id || undefined,
  };
}

export function getMessagesForSession(
  messages: { getBySessionId: (sessionId: string) => MessageRow[] },
  sessionId: string
): MemoryIngestionInput['messages'] {
  return messages.getBySessionId(sessionId).map((row) => ({
    id: row.id,
    sessionId: row.session_id,
    role: row.role as MemoryIngestionInput['messages'][number]['role'],
    content: safeParseContent(row.content),
    timestamp: row.timestamp,
    executionTimeMs: row.execution_time_ms || undefined,
  }));
}

function safeParseContent(raw: string) {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed : [{ type: 'text', text: String(parsed) }];
  } catch {
    return [{ type: 'text', text: raw }];
  }
}
