import { v4 as uuidv4 } from 'uuid';
import type { Message, Session } from '../../renderer/types';
import { mt } from '../i18n';
import { log, logCtx, logWarn } from '../utils/logger';
import { buildTerminalErrorMessage } from './agent-runner-message-end';
import { LoopGuard, type LoopGuardDecision } from './agent-runner-loop-guard';
import { safeStringify } from './agent-runner-mcp-bridge';
import type { PreparedPiSessionRun } from './agent-runner-pi-setup';
import type { AgentRunnerRunContext } from './agent-runner-run-context';
import {
  createOllamaColdStartTimer,
  handleCompactionEndEvent,
  handleCompactionStartEvent,
  handleLoopGuardDecision as handleLoopGuardDecisionEvent,
  handleMessageEndEvent,
  handleMessageUpdateEvent,
  handleStreamSubscriptionError,
  handleToolExecutionEndEvent,
  handleToolExecutionStartEvent,
  logStreamEvent,
  markFirstStreamEvent as markFirstStreamEventEvent,
  emitTerminalError as emitTerminalErrorEvent,
  type EmitTerminalErrorOptions,
  type StreamEventState,
} from './agent-runner-stream-events';
import { ThinkTagStreamParser } from './think-tag-parser';
import {
  estimateTokensFromText,
  formatContextOverflowError,
  getLastInputTokenCount,
  shouldBlockForContextOverflow,
} from './context-budget';

export interface StreamHandlingResult {
  abortedByTimeout: boolean;
  abortedByLoopGuard: boolean;
  abortedByStreamError: boolean;
  terminalErrorText?: string;
  contextOverflowHandled: boolean;
}

interface RunPromptWithStreamHandlingOptions {
  ctx: AgentRunnerRunContext;
  session: Session;
  prompt: string;
  existingMessages: Message[];
  thinkingStepId: string;
  controller: AbortController;
  sanitizeOutputPaths(content: string): string;
  piSetup: PreparedPiSessionRun;
}

export async function runPromptWithStreamHandling({
  ctx,
  session,
  prompt,
  existingMessages,
  thinkingStepId,
  controller,
  sanitizeOutputPaths,
  piSetup,
}: RunPromptWithStreamHandlingOptions): Promise<StreamHandlingResult> {
  const thinkParser = new ThinkTagStreamParser();
  const promptStartedAt = Date.now();
  const streamEventCounts = new Map<string, number>();
  const loopGuard = new LoopGuard();
  const state: StreamEventState = {
    streamedText: '',
    hasEmittedError: false,
    receivedFirstStreamEvent: false,
  };

  let abortedByTimeout = false;
  let abortedByLoopGuard = false;
  let abortedByStreamError = false;
  const {
    piSession,
    provider,
    runtimeConfig,
    piModel,
    contextualPrompt,
    modelContextWindow,
    modelMaxTokens,
    thinkingLevel,
    promptPrefix,
    cachedSession,
    compactionEnabled,
  } = piSetup;

  let activityTimeoutId: ReturnType<typeof setTimeout> | undefined;
  const resetActivityTimeout = (): void => {
    if (activityTimeoutId) {
      clearTimeout(activityTimeoutId);
    }
    activityTimeoutId = setTimeout(
      () => {
        logWarn('[ClaudeAgentRunner] Prompt timed out (no activity for 5 min), aborting');
        abortedByTimeout = true;
        controller.abort();
      },
      5 * 60 * 1000
    );
  };

  const lastInputTokens = getLastInputTokenCount(existingMessages);
  const memoryPrefixTokens = estimateTokensFromText(promptPrefix || '');
  const newPromptTokens = estimateTokensFromText(prompt);
  const projectedInputTokens = cachedSession
    ? lastInputTokens + newPromptTokens + memoryPrefixTokens
    : estimateTokensFromText(contextualPrompt);
  const contextWouldOverflow = shouldBlockForContextOverflow(
    cachedSession ? lastInputTokens : 0,
    cachedSession ? newPromptTokens + memoryPrefixTokens : projectedInputTokens,
    modelMaxTokens,
    modelContextWindow
  );
  if (contextWouldOverflow && !compactionEnabled) {
    const errorText = formatContextOverflowError(
      modelContextWindow,
      projectedInputTokens,
      modelMaxTokens
    );
    ctx.renderer.sendMessage(session.id, {
      id: uuidv4(),
      sessionId: session.id,
      role: 'assistant',
      content: [{ type: 'text', text: buildTerminalErrorMessage(errorText) }],
      timestamp: Date.now(),
    });
    ctx.renderer.sendTraceUpdate(session.id, thinkingStepId, {
      status: 'error',
      title: 'Context full',
    });
    return {
      abortedByTimeout,
      abortedByLoopGuard,
      abortedByStreamError,
      terminalErrorText: state.terminalErrorText,
      contextOverflowHandled: true,
    };
  }
  if (contextWouldOverflow && compactionEnabled) {
    ctx.renderer.sendSessionNotice(session.id, mt('noticeCompactionStart'), 'info');
  }

  const eventDeps = {
    ctx,
    session,
    thinkingStepId,
    controller,
    sanitizeOutputPaths,
    piSetup,
    thinkParser,
    loopGuard,
    promptStartedAt,
    recordStreamEvent: (eventType: string) =>
      streamEventCounts.set(eventType, (streamEventCounts.get(eventType) ?? 0) + 1),
    getStreamEventSummary: () =>
      Object.fromEntries(
        Array.from(streamEventCounts.entries()).sort(([left], [right]) => left.localeCompare(right))
      ),
    markFirstStreamEvent: (eventType: string) =>
      markFirstStreamEventEvent(eventType, state, eventDeps, ollamaColdStartTimerId),
    emitTerminalError: (errorText: string, options: EmitTerminalErrorOptions = {}) =>
      emitTerminalErrorEvent(errorText, state, eventDeps, options),
    handleLoopGuardDecision: (decision: LoopGuardDecision, context: string) =>
      handleLoopGuardDecisionEvent(decision, context, eventDeps),
    onLoopGuardAbort: () => {
      state.hasEmittedError = true;
      abortedByLoopGuard = true;
    },
    onStreamErrorAbort: () => {
      abortedByStreamError = true;
    },
  };
  const ollamaColdStartTimerId = createOllamaColdStartTimer(state, eventDeps);

  const unsubscribe = piSession.subscribe((event) => {
    try {
      if (controller.signal.aborted) {
        return;
      }
      resetActivityTimeout();
      logStreamEvent(event, eventDeps);

      switch (event.type) {
        case 'message_update':
          handleMessageUpdateEvent(event, state, eventDeps);
          break;
        case 'message_end':
          handleMessageEndEvent(event, state, eventDeps);
          break;
        case 'tool_execution_start':
          handleToolExecutionStartEvent(event, eventDeps);
          break;
        case 'tool_execution_end':
          handleToolExecutionEndEvent(event, eventDeps);
          break;
        case 'agent_end':
          logCtx('[ClaudeAgentRunner] Agent finished');
          break;
        case 'compaction_start':
          handleCompactionStartEvent(event, state, eventDeps);
          break;
        case 'compaction_end':
          handleCompactionEndEvent(event, state, eventDeps);
          break;
      }
    } catch (subscribeError) {
      handleStreamSubscriptionError(subscribeError, state, eventDeps);
    }
  });

  try {
    resetActivityTimeout();
    if (provider === 'ollama') {
      log(
        '[ClaudeAgentRunner] Starting Ollama prompt',
        safeStringify({
          sessionId: session.id,
          modelId: piModel.id,
          modelProvider: piModel.provider,
          baseUrl: piModel.baseUrl || runtimeConfig.baseUrl || '',
          usedSyntheticModel: piSetup.usedSyntheticModel,
          hasExplicitApiKey: Boolean(runtimeConfig.apiKey?.trim()),
          thinkingLevel,
        })
      );
    }
    const promptResult = await piSession.prompt(contextualPrompt);
    log(
      '[ClaudeAgentRunner] prompt() returned:',
      JSON.stringify(promptResult ?? 'void').substring(0, 1000)
    );
  } catch (error) {
    if (!(error instanceof Error) || error.name !== 'AbortError') {
      throw error;
    }
  } finally {
    try {
      unsubscribe();
    } catch (error) {
      logWarn('[ClaudeAgentRunner] unsubscribe error:', error);
    }
    if (activityTimeoutId) {
      clearTimeout(activityTimeoutId);
    }
    if (ollamaColdStartTimerId) {
      clearTimeout(ollamaColdStartTimerId);
    }
  }

  return {
    abortedByTimeout,
    abortedByLoopGuard,
    abortedByStreamError,
    terminalErrorText: state.terminalErrorText,
    contextOverflowHandled: false,
  };
}
