import { v4 as uuidv4 } from 'uuid';
import type { ContentBlock, Message, Session } from '../../renderer/types';
import {
  buildCompactionHandoffPrompt,
  buildCompactionSessionTitle,
} from '../../shared/compaction-handoff';
import { log, logError } from '../utils/logger';
import type { SessionManagerFacadeSupportDeps } from './session-manager-facade-support';

export async function compactSession(
  deps: SessionManagerFacadeSupportDeps,
  stopSession: (sessionId: string) => void,
  sessionId: string,
  customInstructions?: string
): Promise<{ success: boolean; errorKey?: string; error?: string }> {
  log('[SessionManager] Manual compaction requested for session:', sessionId);
  const session = deps.loadSession(sessionId);
  if (!session) {
    throw new Error(`Session not found: ${sessionId}`);
  }
  if (deps.activeSessions.has(sessionId)) {
    stopSession(sessionId);
  }

  const agentRunner = deps.getAgentRunner();
  if (!agentRunner.compactSession) {
    return { success: false, errorKey: 'errCompactFailed' };
  }

  try {
    const result = await agentRunner.compactSession(session, customInstructions);
    const compactionMessage: Message = {
      id: uuidv4(),
      sessionId,
      role: 'system',
      content: [
        {
          type: 'compaction_summary',
          summary: result.summary,
          tokensBefore: result.tokensBefore,
          customInstructions,
        },
      ],
      timestamp: Date.now(),
    };
    deps.saveMessage(compactionMessage);
    deps.sendToRenderer({
      type: 'stream.message',
      payload: { sessionId, message: compactionMessage },
    });
    return { success: true };
  } catch (error) {
    const errorKey =
      error instanceof Error && error.message.startsWith('errCompact') ? error.message : undefined;
    logError('[SessionManager] Manual compaction failed:', error);
    return {
      success: false,
      errorKey,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function handoffSession(
  deps: SessionManagerFacadeSupportDeps,
  stopSession: (sessionId: string) => void,
  sessionId: string,
  customInstructions?: string
): Promise<{
  success: boolean;
  newSession?: Session;
  initialContent?: ContentBlock[];
  errorKey?: string;
  error?: string;
}> {
  log('[SessionManager] Handoff to new session requested for:', sessionId);
  const session = deps.loadSession(sessionId);
  if (!session) {
    throw new Error(`Session not found: ${sessionId}`);
  }
  if (deps.activeSessions.has(sessionId)) {
    stopSession(sessionId);
  }

  const messages = deps.getMessages(sessionId);
  if (!messages.some((message) => message.role === 'user' || message.role === 'assistant')) {
    return { success: false, errorKey: 'errHandoffNothingToSummarize' };
  }

  const agentRunner = deps.getAgentRunner();
  if (!agentRunner.summarizeForHandoff) {
    return { success: false, errorKey: 'errHandoffFailed' };
  }

  try {
    const result = await agentRunner.summarizeForHandoff(session, messages, customInstructions);
    const handoffPrompt = buildCompactionHandoffPrompt({
      summary: result.summary,
      sourceTitle: session.title,
      tokensBefore: result.tokensBefore,
      customInstructions,
    });
    const initialContent: ContentBlock[] = [
      {
        type: 'compaction_summary',
        summary: result.summary,
        tokensBefore: result.tokensBefore,
        customInstructions,
        sourceTitle: session.title,
      },
      { type: 'text', text: handoffPrompt },
    ];
    const newSession = await deps.startSession(
      buildCompactionSessionTitle(session.title),
      handoffPrompt,
      session.cwd,
      session.allowedTools,
      initialContent,
      session.memoryEnabled
    );
    return { success: true, newSession, initialContent };
  } catch (error) {
    const errorKey =
      error instanceof Error && error.message.startsWith('errHandoff')
        ? error.message
        : 'errHandoffFailed';
    logError('[SessionManager] Handoff failed:', error);
    return {
      success: false,
      errorKey,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
