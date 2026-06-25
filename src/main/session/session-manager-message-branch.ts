import { v4 as uuidv4 } from 'uuid';
import type { Message, Session, TextContent } from '../../renderer/types';
import { log, logError } from '../utils/logger';
import type { SessionManagerFacadeSupportDeps } from './session-manager-facade-support';

type StopSession = (sessionId: string) => void;

function extractPromptText(message: Message): string {
  if (!Array.isArray(message.content)) {
    return String(message.content ?? '').trim();
  }

  return message.content
    .filter((block) => block.type === 'text')
    .map((block) => (block as TextContent).text)
    .join('\n')
    .trim();
}

function buildForkTitle(sourceTitle: string): string {
  const base = sourceTitle.trim() || 'New Session';
  const forkTitle = `Fork — ${base}`;
  return forkTitle.length > 50 ? `${forkTitle.slice(0, 47)}...` : forkTitle;
}

function cloneMessagesForSession(messages: Message[], targetSessionId: string): Message[] {
  return messages.map((message) => ({
    ...message,
    id: uuidv4(),
    sessionId: targetSessionId,
    localStatus: undefined,
  }));
}

function findUserMessageIndex(messages: Message[], messageId: string): number {
  return messages.findIndex((message) => message.id === messageId && message.role === 'user');
}

export async function forkSessionFromMessage(
  deps: SessionManagerFacadeSupportDeps,
  stopSession: StopSession,
  createSession: (
    title: string,
    cwd?: string,
    allowedTools?: string[],
    memoryEnabled?: boolean
  ) => Session,
  sessionId: string,
  messageId: string
): Promise<{
  success: boolean;
  newSession?: Session;
  messages?: Message[];
  errorKey?: string;
  error?: string;
}> {
  log('[SessionManager] Fork from message requested:', sessionId, messageId);
  const session = deps.loadSession(sessionId);
  if (!session) {
    return { success: false, errorKey: 'errForkSessionNotFound' };
  }

  if (deps.activeSessions.has(sessionId)) {
    stopSession(sessionId);
  }

  const messages = deps.getMessages(sessionId);
  const messageIndex = findUserMessageIndex(messages, messageId);
  if (messageIndex < 0) {
    return { success: false, errorKey: 'errForkMessageNotFound' };
  }

  try {
    const newSession = createSession(
      buildForkTitle(session.title),
      session.cwd,
      session.allowedTools,
      session.memoryEnabled
    );
    newSession.model = session.model;

    const forkMessages = cloneMessagesForSession(
      messages.slice(0, messageIndex + 1),
      newSession.id
    );

    deps.store.saveSession(newSession);
    for (const message of forkMessages) {
      deps.saveMessage(message);
    }

    deps.sendToRenderer({
      type: 'session.update',
      payload: { sessionId: newSession.id, updates: newSession },
    });

    return { success: true, newSession, messages: forkMessages };
  } catch (error) {
    logError('[SessionManager] Fork from message failed:', error);
    return {
      success: false,
      errorKey: 'errForkFailed',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function rewindSessionForEdit(
  deps: SessionManagerFacadeSupportDeps,
  stopSession: StopSession,
  sessionId: string,
  messageId: string
): Promise<{
  success: boolean;
  promptText?: string;
  messages?: Message[];
  errorKey?: string;
  error?: string;
}> {
  log('[SessionManager] Rewind for edit requested:', sessionId, messageId);
  const session = deps.loadSession(sessionId);
  if (!session) {
    return { success: false, errorKey: 'errRewindSessionNotFound' };
  }

  if (deps.activeSessions.has(sessionId)) {
    stopSession(sessionId);
  }

  const messages = deps.getMessages(sessionId);
  const messageIndex = findUserMessageIndex(messages, messageId);
  if (messageIndex < 0) {
    return { success: false, errorKey: 'errRewindMessageNotFound' };
  }

  const targetMessage = messages[messageIndex];
  const promptText = extractPromptText(targetMessage);
  const keptMessages = messages.slice(0, messageIndex);

  try {
    deps.db.messages.deleteFromTimestamp(sessionId, targetMessage.timestamp);
    deps.db.traceSteps.deleteFromTimestamp(sessionId, targetMessage.timestamp);
    deps.store.replaceMessages(sessionId, keptMessages);
    deps.getAgentRunner().clearSdkSession?.(sessionId);

    const now = Date.now();
    deps.db.sessions.update(sessionId, {
      claude_session_id: null,
      openai_thread_id: null,
      updated_at: now,
    });
    deps.sendToRenderer({
      type: 'session.update',
      payload: {
        sessionId,
        updates: { claudeSessionId: undefined, openaiThreadId: undefined, updatedAt: now },
      },
    });

    return { success: true, promptText, messages: keptMessages };
  } catch (error) {
    logError('[SessionManager] Rewind for edit failed:', error);
    return {
      success: false,
      errorKey: 'errRewindFailed',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
