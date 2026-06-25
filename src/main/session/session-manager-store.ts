import type { ContentBlock, Message, Session, TextContent, TraceStep } from '../../renderer/types';
import type { DatabaseInstance, SessionRow, TraceStepRow } from '../db/database';
import { log, logError } from '../utils/logger';

function parseJsonArray<T>(raw: string, fieldName: string): T[] {
  try {
    return JSON.parse(raw) as T[];
  } catch (error) {
    logError(`[SessionManager] Failed to parse ${fieldName}:`, error);
    return [];
  }
}

function mapSessionRow(row: SessionRow): Session {
  return {
    id: row.id,
    title: row.title,
    claudeSessionId: row.claude_session_id || undefined,
    openaiThreadId: row.openai_thread_id || undefined,
    status: row.status as Session['status'],
    cwd: row.cwd || undefined,
    mountedPaths: parseJsonArray(row.mounted_paths, 'mounted_paths'),
    allowedTools: parseJsonArray(row.allowed_tools, 'allowed_tools'),
    memoryEnabled: row.memory_enabled === 1,
    model: row.model || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function normalizeContent(raw: string): ContentBlock[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      return parsed as ContentBlock[];
    }
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'type' in parsed &&
      typeof (parsed as { type: unknown }).type === 'string'
    ) {
      return [parsed as ContentBlock];
    }
    if (typeof parsed === 'string') {
      return [{ type: 'text', text: parsed } as TextContent];
    }
    return [{ type: 'text', text: String(parsed) } as TextContent];
  } catch {
    return [{ type: 'text', text: raw } as TextContent];
  }
}

export class SessionManagerStore {
  private static readonly MAX_CACHE_SIZE = 100;

  private readonly messageCache = new Map<string, Message[]>();

  constructor(private readonly db: DatabaseInstance) {}

  saveSession(session: Session): void {
    this.db.sessions.create({
      id: session.id,
      title: session.title,
      claude_session_id: session.claudeSessionId || null,
      openai_thread_id: session.openaiThreadId || null,
      status: session.status,
      cwd: session.cwd || null,
      mounted_paths: JSON.stringify(session.mountedPaths),
      allowed_tools: JSON.stringify(session.allowedTools),
      memory_enabled: session.memoryEnabled ? 1 : 0,
      model: session.model || null,
      created_at: session.createdAt,
      updated_at: session.updatedAt,
    });
  }

  loadSession(sessionId: string): Session | null {
    const row = this.db.sessions.get(sessionId);
    return row ? mapSessionRow(row) : null;
  }

  listSessions(): Session[] {
    return this.db.sessions.getAll().map(mapSessionRow);
  }

  resetStaleRunningSessions(): number {
    const now = Date.now();
    const staleSessions = this.db.sessions
      .getAll()
      .filter((row) => row.status === 'running')
      .map((row) => row.id);

    for (const sessionId of staleSessions) {
      this.db.sessions.update(sessionId, { status: 'idle', updated_at: now });
    }

    if (staleSessions.length > 0) {
      log('[SessionManager] Reset stale running sessions on startup:', staleSessions.length);
    }

    return staleSessions.length;
  }

  saveMessage(message: Message): void {
    this.db.messages.create({
      id: message.id,
      session_id: message.sessionId,
      role: message.role,
      content: JSON.stringify(message.content),
      timestamp: message.timestamp,
      token_usage: message.tokenUsage ? JSON.stringify(message.tokenUsage) : null,
      execution_time_ms: message.executionTimeMs ?? null,
    });

    const cached = this.messageCache.get(message.sessionId);
    if (cached) {
      cached.push(message);
    } else {
      if (this.messageCache.size > SessionManagerStore.MAX_CACHE_SIZE) {
        const firstKey = this.messageCache.keys().next().value;
        if (firstKey) {
          this.messageCache.delete(firstKey);
        }
      }
      this.messageCache.set(message.sessionId, [message]);
    }

    log('[SessionManager] Message saved:', message.id, 'role:', message.role);
  }

  getMessages(sessionId: string): Message[] {
    const cached = this.messageCache.get(sessionId);
    if (cached) {
      return [...cached];
    }

    const messages = this.db.messages.getBySessionId(sessionId).map((row) => ({
      id: row.id,
      sessionId: row.session_id,
      role: row.role as Message['role'],
      content: normalizeContent(row.content),
      timestamp: row.timestamp,
      tokenUsage: row.token_usage ? JSON.parse(row.token_usage) : undefined,
      executionTimeMs: row.execution_time_ms ?? undefined,
    }));

    this.messageCache.set(sessionId, messages);
    return [...messages];
  }

  getTraceSteps(sessionId: string): TraceStep[] {
    const parseToolInput = (value: string | null): Record<string, unknown> | undefined => {
      if (!value) {
        return undefined;
      }
      try {
        return JSON.parse(value) as Record<string, unknown>;
      } catch {
        return undefined;
      }
    };

    return this.db.traceSteps.getBySessionId(sessionId).map((row) => ({
      id: row.id,
      type: row.type as TraceStep['type'],
      status: row.status as TraceStep['status'],
      title: row.title,
      content: row.content || undefined,
      toolName: row.tool_name || undefined,
      toolInput: parseToolInput(row.tool_input),
      toolOutput: row.tool_output || undefined,
      isError: row.is_error === 1 ? true : undefined,
      timestamp: row.timestamp,
      duration: row.duration ?? undefined,
    }));
  }

  saveTraceStep(sessionId: string, step: TraceStep): void {
    this.db.traceSteps.create({
      id: step.id,
      session_id: sessionId,
      type: step.type,
      status: step.status,
      title: step.title,
      content: step.content ?? null,
      tool_name: step.toolName ?? null,
      tool_input: step.toolInput ? JSON.stringify(step.toolInput) : null,
      tool_output: step.toolOutput ?? null,
      is_error: step.isError ? 1 : null,
      timestamp: step.timestamp,
      duration: step.duration ?? null,
    });
  }

  updateTraceStep(stepId: string, updates: Partial<TraceStep>): void {
    const rowUpdates: Partial<TraceStepRow> = {};
    if (updates.type !== undefined) rowUpdates.type = updates.type;
    if (updates.status !== undefined) rowUpdates.status = updates.status;
    if (updates.title !== undefined) rowUpdates.title = updates.title;
    if (updates.content !== undefined) rowUpdates.content = updates.content;
    if (updates.toolName !== undefined) rowUpdates.tool_name = updates.toolName;
    if (updates.toolInput !== undefined) {
      rowUpdates.tool_input = updates.toolInput ? JSON.stringify(updates.toolInput) : null;
    }
    if (updates.toolOutput !== undefined) rowUpdates.tool_output = updates.toolOutput;
    if (updates.isError !== undefined) rowUpdates.is_error = updates.isError ? 1 : 0;
    if (updates.timestamp !== undefined) rowUpdates.timestamp = updates.timestamp;
    if (updates.duration !== undefined) rowUpdates.duration = updates.duration;

    this.db.traceSteps.update(stepId, rowUpdates);
  }

  clearMessageCache(sessionId: string): void {
    this.messageCache.delete(sessionId);
  }
}
