import type { AgentSession as PiAgentSession } from '@earendil-works/pi-coding-agent';
import { v4 as uuidv4 } from 'uuid';
import type { Session } from '../../renderer/types';
import { log, logError, logWarn } from '../utils/logger';
import { toUserFacingErrorText } from './agent-runner-message-end';
import {
  buildAbortUserMessage,
  buildHaltSteerMessage,
  buildWarnSteerMessage,
  type LoopGuard,
  type LoopGuardDecision,
} from './agent-runner-loop-guard';
import { safeStringify, summarizeMessageForLog, toErrorText } from './agent-runner-mcp-bridge';
import type { PreparedPiSessionRun } from './agent-runner-pi-setup';
import type { AgentRunnerRunContext } from './agent-runner-run-context';
import type { EmitTerminalErrorOptions } from './agent-runner-stream-message-events';
import type { ThinkTagStreamParser } from './think-tag-parser';

type PiSessionEvent = Parameters<Parameters<PiAgentSession['subscribe']>[0]>[0];

export interface StreamEventState {
  streamedText: string;
  compactionStepId?: string;
  hasEmittedError: boolean;
  terminalErrorText?: string;
  receivedFirstStreamEvent: boolean;
  firstStreamEventAt?: number;
}

export interface StreamEventDeps {
  ctx: AgentRunnerRunContext;
  session: Session;
  thinkingStepId: string;
  controller: AbortController;
  sanitizeOutputPaths(content: string): string;
  piSetup: PreparedPiSessionRun;
  thinkParser: ThinkTagStreamParser;
  loopGuard: LoopGuard;
  promptStartedAt: number;
  recordStreamEvent(eventType: string): void;
  getStreamEventSummary(): Record<string, number>;
  markFirstStreamEvent(eventType: string): void;
  emitTerminalError(errorText: string, options?: EmitTerminalErrorOptions): void;
  handleLoopGuardDecision(decision: LoopGuardDecision, context: string): void;
  onLoopGuardAbort(): void;
  onStreamErrorAbort(): void;
}

export function handleLoopGuardDecision(
  decision: LoopGuardDecision,
  context: string,
  deps: StreamEventDeps
): void {
  if (decision.action === 'none' || deps.controller.signal.aborted) {
    return;
  }
  logWarn(`[LoopGuard] ${context}: action=${decision.action} reason=${decision.reason}`);

  if (decision.action === 'hash_abort' || decision.action === 'freq_abort') {
    deps.ctx.renderer.sendMessage(deps.session.id, {
      id: uuidv4(),
      sessionId: deps.session.id,
      role: 'assistant',
      content: [{ type: 'text', text: buildAbortUserMessage(decision) }],
      timestamp: Date.now(),
    });
    deps.ctx.renderer.sendTraceUpdate(deps.session.id, deps.thinkingStepId, {
      status: 'error',
      title: 'Stopped: tool-call loop detected',
    });
    deps.onLoopGuardAbort();
    try {
      deps.controller.abort();
    } catch (abortError) {
      logWarn('[LoopGuard] abort error:', abortError);
    }
    return;
  }

  const steerText =
    decision.action === 'hash_halt' || decision.action === 'freq_halt'
      ? buildHaltSteerMessage(decision)
      : buildWarnSteerMessage(decision);
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sessionAny = deps.piSetup.piSession as any;
    if (typeof sessionAny.sendUserMessage !== 'function') {
      logWarn('[LoopGuard] piSession.sendUserMessage is not available; skipping steer');
      return;
    }
    Promise.resolve(sessionAny.sendUserMessage(steerText, { deliverAs: 'steer' })).catch(
      (error: unknown) => logWarn('[LoopGuard] sendUserMessage(steer) failed:', error)
    );
  } catch (error) {
    logWarn('[LoopGuard] sendUserMessage(steer) threw:', error);
  }
}

export function logStreamEvent(event: PiSessionEvent, deps: StreamEventDeps): void {
  if (event.type === 'message_update') {
    const updateType = event.assistantMessageEvent.type;
    deps.recordStreamEvent(updateType);
    if (updateType !== 'text_delta' && updateType !== 'thinking_delta') {
      log(`[ClaudeAgentRunner] Event: ${event.type} → ${updateType}`);
    }
    return;
  }

  if (event.type === 'message_start') {
    log(
      '[ClaudeAgentRunner] Event: message_start',
      safeStringify(summarizeMessageForLog(event.message), 2)
    );
    return;
  }

  if (event.type === 'message_end') {
    log(
      '[ClaudeAgentRunner] Event: message_end',
      safeStringify(
        {
          message: summarizeMessageForLog(event.message),
          messageUpdateCounts: deps.getStreamEventSummary(),
        },
        2
      )
    );
    return;
  }

  log(`[ClaudeAgentRunner] Event: ${event.type}`);
}

export function handleStreamSubscriptionError(
  error: unknown,
  state: StreamEventState,
  deps: StreamEventDeps
): void {
  logError('[ClaudeAgentRunner] Error in subscribe callback:', error);
  if (state.compactionStepId) {
    deps.ctx.renderer.sendTraceUpdate(deps.session.id, state.compactionStepId, {
      status: 'error',
      title: 'Error during context compaction',
    });
    state.compactionStepId = undefined;
  }
  if (state.hasEmittedError) {
    return;
  }

  state.hasEmittedError = true;
  deps.ctx.renderer.sendMessage(deps.session.id, {
    id: uuidv4(),
    sessionId: deps.session.id,
    role: 'assistant',
    content: [{ type: 'text', text: `**Error**: ${toUserFacingErrorText(toErrorText(error))}` }],
    timestamp: Date.now(),
  });
}

export {
  createOllamaColdStartTimer,
  emitTerminalError,
  handleMessageEndEvent,
  handleMessageUpdateEvent,
  markFirstStreamEvent,
  type EmitTerminalErrorOptions,
} from './agent-runner-stream-message-events';
export {
  handleCompactionEndEvent,
  handleCompactionStartEvent,
  handleToolExecutionEndEvent,
  handleToolExecutionStartEvent,
} from './agent-runner-stream-tool-events';
