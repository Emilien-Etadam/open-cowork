import type { AgentSession as PiAgentSession } from '@mariozechner/pi-coding-agent';
import { v4 as uuidv4 } from 'uuid';
import type { ContentBlock, Session } from '../../renderer/types';
import { mt } from '../i18n';
import { extractArtifactsFromText, buildArtifactTraceSteps } from '../utils/artifact-parser';
import { log, logCtx, logCtxError, logError, logWarn } from '../utils/logger';
import {
  buildTerminalErrorEmissionDetails,
  buildTerminalErrorMessage,
  resolveAssistantStreamErrorText,
  resolveMessageEndPayload,
  toUserFacingErrorText,
} from './agent-runner-message-end';
import {
  buildAbortUserMessage,
  buildHaltSteerMessage,
  buildWarnSteerMessage,
  type LoopGuard,
  type LoopGuardDecision,
  type ToolCallDescriptor,
} from './agent-runner-loop-guard';
import {
  normalizeTokenUsage,
  safeStringify,
  summarizeMessageForLog,
  toErrorText,
} from './agent-runner-mcp-bridge';
import type { PreparedPiSessionRun } from './agent-runner-pi-setup';
import type { AgentRunnerRunContext } from './agent-runner-run-context';
import type { ThinkTagStreamParser } from './think-tag-parser';
import { normalizeToolExecutionResultForUi } from './tool-result-utils';

type PiSessionEvent = Parameters<Parameters<PiAgentSession['subscribe']>[0]>[0];
type MessageUpdateEvent = Extract<PiSessionEvent, { type: 'message_update' }>;
type MessageEndEvent = Extract<PiSessionEvent, { type: 'message_end' }>;
type ToolExecutionStartEvent = Extract<PiSessionEvent, { type: 'tool_execution_start' }>;
type ToolExecutionEndEvent = Extract<PiSessionEvent, { type: 'tool_execution_end' }>;
type CompactionStartEvent = Extract<PiSessionEvent, { type: 'compaction_start' }>;
type CompactionEndEvent = Extract<PiSessionEvent, { type: 'compaction_end' }>;

export interface StreamEventState {
  streamedText: string;
  compactionStepId?: string;
  hasEmittedError: boolean;
  terminalErrorText?: string;
  receivedFirstStreamEvent: boolean;
  firstStreamEventAt?: number;
}

export interface EmitTerminalErrorOptions {
  abort?: boolean;
  includePartialText?: boolean;
}

interface StreamEventDeps {
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

export function createOllamaColdStartTimer(
  state: StreamEventState,
  deps: StreamEventDeps
): ReturnType<typeof setTimeout> | undefined {
  if (deps.piSetup.provider !== 'ollama') {
    return undefined;
  }

  return setTimeout(() => {
    if (!state.receivedFirstStreamEvent && !deps.controller.signal.aborted) {
      deps.ctx.renderer.sendTraceUpdate(deps.session.id, deps.thinkingStepId, {
        title: 'Waiting for model to load into memory...',
      });
    }
  }, 10000);
}

export function markFirstStreamEvent(
  eventType: string,
  state: StreamEventState,
  deps: StreamEventDeps,
  ollamaColdStartTimerId?: ReturnType<typeof setTimeout>
): void {
  if (state.receivedFirstStreamEvent) {
    return;
  }

  state.receivedFirstStreamEvent = true;
  state.firstStreamEventAt = Date.now();
  if (ollamaColdStartTimerId) {
    clearTimeout(ollamaColdStartTimerId);
  }
  deps.ctx.renderer.sendTraceUpdate(deps.session.id, deps.thinkingStepId, {
    title: 'Processing request...',
  });

  if (deps.piSetup.provider === 'ollama') {
    log(
      '[ClaudeAgentRunner] Ollama first stream event received',
      safeStringify({
        sessionId: deps.session.id,
        eventType,
        modelId: deps.piSetup.piModel.id,
        modelProvider: deps.piSetup.piModel.provider,
        baseUrl: deps.piSetup.piModel.baseUrl || deps.piSetup.runtimeConfig.baseUrl || '',
        latencyMs: state.firstStreamEventAt - deps.promptStartedAt,
      })
    );
  }
}

export function emitTerminalError(
  errorText: string,
  state: StreamEventState,
  deps: StreamEventDeps,
  options: EmitTerminalErrorOptions = {}
): void {
  state.terminalErrorText = errorText;
  const flushed = options.includePartialText
    ? deps.thinkParser.flush()
    : { thinking: '', text: '' };
  const emission = buildTerminalErrorEmissionDetails({
    errorText,
    streamedText: state.streamedText,
    flushedThinking: flushed.thinking,
    flushedText: flushed.text,
  });

  if (emission.thinkingDelta) {
    deps.ctx.renderer.dispatch({
      type: 'stream.thinking',
      payload: { sessionId: deps.session.id, delta: emission.thinkingDelta },
    });
  }
  if (emission.textDelta) {
    deps.ctx.renderer.sendPartial(deps.session.id, emission.textDelta);
  }

  state.streamedText = '';
  deps.ctx.renderer.dispatch({
    type: 'stream.partial',
    payload: { sessionId: deps.session.id, delta: '' },
  });
  if (!state.hasEmittedError) {
    state.hasEmittedError = true;
    deps.ctx.renderer.sendMessage(deps.session.id, {
      id: uuidv4(),
      sessionId: deps.session.id,
      role: 'assistant',
      content: [
        {
          type: 'text',
          text: buildTerminalErrorMessage(
            errorText,
            emission.partialText ? deps.sanitizeOutputPaths(emission.partialText) : ''
          ),
        },
      ],
      timestamp: Date.now(),
    });
  }
  deps.ctx.renderer.sendTraceUpdate(deps.session.id, deps.thinkingStepId, {
    status: 'error',
    title: 'Request failed',
  });

  if (options.abort && !deps.controller.signal.aborted) {
    deps.onStreamErrorAbort();
    try {
      deps.controller.abort();
    } catch (abortError) {
      logWarn('[ClaudeAgentRunner] stream-error abort failed:', abortError);
    }
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

export function handleMessageUpdateEvent(
  event: MessageUpdateEvent,
  state: StreamEventState,
  deps: StreamEventDeps
): void {
  if (deps.controller.signal.aborted) {
    return;
  }

  const assistantMessageEvent = event.assistantMessageEvent;
  if (assistantMessageEvent.type === 'text_delta') {
    deps.markFirstStreamEvent(assistantMessageEvent.type);
    const parsed = deps.thinkParser.push(assistantMessageEvent.delta);
    if (parsed.thinking) {
      deps.ctx.renderer.dispatch({
        type: 'stream.thinking',
        payload: { sessionId: deps.session.id, delta: parsed.thinking },
      });
    }
    if (parsed.text) {
      state.streamedText += parsed.text;
      deps.ctx.renderer.sendPartial(deps.session.id, parsed.text);
    }
    return;
  }

  if (assistantMessageEvent.type === 'thinking_delta') {
    deps.markFirstStreamEvent(assistantMessageEvent.type);
    deps.ctx.renderer.dispatch({
      type: 'stream.thinking',
      payload: { sessionId: deps.session.id, delta: assistantMessageEvent.delta },
    });
    return;
  }

  if (assistantMessageEvent.type === 'toolcall_start') {
    deps.markFirstStreamEvent(assistantMessageEvent.type);
    const partial = assistantMessageEvent.partial;
    const toolContent = partial?.content?.[assistantMessageEvent.contentIndex];
    const toolName = toolContent?.type === 'toolCall' ? toolContent.name : 'unknown';
    const toolCallId = toolContent?.type === 'toolCall' ? toolContent.id : uuidv4();
    deps.ctx.renderer.sendTraceStep(deps.session.id, {
      id: toolCallId,
      type: 'tool_call',
      status: 'running',
      title: deps.ctx.getToolDisplayName(toolName),
      toolName,
      toolInput:
        toolContent?.type === 'toolCall'
          ? (toolContent.arguments as Record<string, unknown>) || {}
          : undefined,
      timestamp: Date.now(),
    });
    return;
  }

  if (assistantMessageEvent.type === 'done') {
    log('[ClaudeAgentRunner] message_update done event (handled in message_end)');
    return;
  }

  if (assistantMessageEvent.type === 'error') {
    deps.markFirstStreamEvent(assistantMessageEvent.type);
    const errorDetail = JSON.stringify(assistantMessageEvent.error?.content || 'no content');
    logCtxError(
      '[ClaudeAgentRunner] pi-ai stream error:',
      assistantMessageEvent.reason,
      errorDetail
    );
    deps.emitTerminalError(resolveAssistantStreamErrorText(assistantMessageEvent), {
      abort: true,
      includePartialText: true,
    });
  }
}

export function handleMessageEndEvent(
  event: MessageEndEvent,
  state: StreamEventState,
  deps: StreamEventDeps
): void {
  if (deps.controller.signal.aborted) {
    return;
  }

  const flushed = deps.thinkParser.flush();
  if (flushed.thinking) {
    deps.ctx.renderer.dispatch({
      type: 'stream.thinking',
      payload: { sessionId: deps.session.id, delta: flushed.thinking },
    });
  }
  if (flushed.text) {
    state.streamedText += flushed.text;
    deps.ctx.renderer.sendPartial(deps.session.id, flushed.text);
  }

  const message = event.message;
  if (process.env.COWORK_LOG_SDK_MESSAGES_FULL === '1') {
    log('[ClaudeAgentRunner] message_end raw message:', safeStringify(message, 2));
  }

  const resolvedPayload = resolveMessageEndPayload({
    message: message as Parameters<typeof resolveMessageEndPayload>[0]['message'],
    streamedText: state.streamedText,
  });
  state.streamedText = resolvedPayload.nextStreamedText;

  if (deps.piSetup.provider === 'ollama') {
    log(
      '[ClaudeAgentRunner] Ollama message_end diagnostics',
      safeStringify({
        sessionId: deps.session.id,
        modelId: deps.piSetup.piModel.id,
        modelProvider: deps.piSetup.piModel.provider,
        usedSyntheticModel: deps.piSetup.usedSyntheticModel,
        receivedFirstStreamEvent: state.receivedFirstStreamEvent,
        firstStreamLatencyMs: state.firstStreamEventAt
          ? state.firstStreamEventAt - deps.promptStartedAt
          : null,
        stopReason: (message as { stopReason?: unknown }).stopReason ?? null,
        contentBlocks: Array.isArray((message as { content?: unknown[] }).content)
          ? ((message as { content?: unknown[] }).content?.length ?? 0)
          : 0,
        emittedError: Boolean(resolvedPayload.errorText),
      })
    );
  }

  if (resolvedPayload.errorText) {
    deps.emitTerminalError(resolvedPayload.errorText, { includePartialText: true });
    return;
  }
  if (!resolvedPayload.shouldEmitMessage) {
    return;
  }

  const contentBlocks: ContentBlock[] = [];
  for (const block of resolvedPayload.effectiveContent) {
    if (block.type === 'text') {
      const { cleanText, artifacts } = extractArtifactsFromText(block.text);
      if (cleanText) {
        contentBlocks.push({ type: 'text', text: deps.sanitizeOutputPaths(cleanText) });
      }
      for (const step of buildArtifactTraceSteps(artifacts)) {
        deps.ctx.renderer.sendTraceStep(deps.session.id, step);
      }
      continue;
    }

    if (block.type === 'toolCall') {
      contentBlocks.push({
        type: 'tool_use',
        id: block.id,
        name: block.name,
        displayName: deps.ctx.getToolDisplayName(block.name),
        input: block.arguments,
      });
      continue;
    }

    if (block.type === 'thinking') {
      contentBlocks.push({ type: 'thinking', thinking: block.thinking });
      continue;
    }

    const unknownBlock = block as { type?: string; text?: string };
    log(`[ClaudeAgentRunner] Unknown content block type: ${unknownBlock.type}`);
    const text = unknownBlock.text || JSON.stringify(block);
    if (text) {
      contentBlocks.push({ type: 'text', text });
    }
  }

  deps.ctx.renderer.dispatch({
    type: 'stream.partial',
    payload: { sessionId: deps.session.id, delta: '' },
  });

  const toolUseDescriptors: ToolCallDescriptor[] = [];
  for (const block of resolvedPayload.effectiveContent) {
    if (block.type === 'toolCall') {
      toolUseDescriptors.push({
        name: block.name || '',
        input: (block.arguments as Record<string, unknown>) || undefined,
      });
    }
  }
  if (toolUseDescriptors.length > 0) {
    deps.handleLoopGuardDecision(
      deps.loopGuard.recordAssistantMessage(toolUseDescriptors),
      'message_end'
    );
    if (deps.controller.signal.aborted) {
      return;
    }
  }

  if (contentBlocks.length === 0) {
    return;
  }

  const messageWithUsage = message as { usage?: unknown };
  const tokenUsage = normalizeTokenUsage(messageWithUsage.usage);
  if (messageWithUsage.usage) {
    log(
      '[ClaudeAgentRunner] normalized usage:',
      safeStringify({ raw: messageWithUsage.usage, normalized: tokenUsage }, 2)
    );
  }

  deps.ctx.renderer.sendMessage(deps.session.id, {
    id: uuidv4(),
    sessionId: deps.session.id,
    role: 'assistant',
    content: contentBlocks,
    timestamp: Date.now(),
    api: deps.piSetup.piModel.api,
    provider: deps.piSetup.piModel.provider,
    model: deps.piSetup.piModel.id,
    tokenUsage,
  });
}

export function handleToolExecutionStartEvent(
  event: ToolExecutionStartEvent,
  deps: StreamEventDeps
): void {
  logCtx(`[ClaudeAgentRunner] Tool execution start: ${event.toolName}`);
  deps.handleLoopGuardDecision(
    deps.loopGuard.recordToolInvocation(event.toolName),
    'tool_execution_start'
  );
}

export function handleToolExecutionEndEvent(
  event: ToolExecutionEndEvent,
  deps: StreamEventDeps
): void {
  if (deps.controller.signal.aborted) {
    return;
  }

  const normalizedToolResult = normalizeToolExecutionResultForUi(event.result);
  const outputText = normalizedToolResult.content;
  const toolDisplayName = deps.ctx.getToolDisplayName(event.toolName);
  deps.ctx.renderer.sendTraceUpdate(deps.session.id, event.toolCallId, {
    status: event.isError ? 'error' : 'completed',
    title: toolDisplayName,
    toolName: event.toolName,
    toolOutput: deps.sanitizeOutputPaths(outputText).slice(0, 800),
  });

  deps.ctx.renderer.sendMessage(deps.session.id, {
    id: uuidv4(),
    sessionId: deps.session.id,
    role: 'assistant',
    content: [
      {
        type: 'tool_result',
        toolUseId: event.toolCallId,
        content: deps.sanitizeOutputPaths(outputText),
        isError: event.isError,
        ...(normalizedToolResult.images.length > 0 ? { images: normalizedToolResult.images } : {}),
      },
    ],
    timestamp: Date.now(),
  });
}

export function handleCompactionStartEvent(
  event: CompactionStartEvent,
  state: StreamEventState,
  deps: StreamEventDeps
): void {
  log('[ClaudeAgentRunner] Auto-compaction started, reason:', event.reason);
  deps.ctx.renderer.sendSessionNotice(deps.session.id, mt('noticeCompactionStart'), 'info');
  state.compactionStepId = `compaction-${Date.now()}`;
  deps.ctx.renderer.sendTraceStep(deps.session.id, {
    id: state.compactionStepId,
    type: 'thinking',
    status: 'running',
    title: `Compacting context (${event.reason})...`,
    timestamp: Date.now(),
  });
}

export function handleCompactionEndEvent(
  event: CompactionEndEvent,
  state: StreamEventState,
  deps: StreamEventDeps
): void {
  const status = event.aborted || event.errorMessage ? 'error' : 'completed';
  const title = event.aborted
    ? 'Context compaction aborted'
    : event.errorMessage
      ? `Context compaction failed: ${event.errorMessage}`
      : 'Context compaction completed';
  log('[ClaudeAgentRunner] Auto-compaction ended:', title, 'willRetry:', event.willRetry);

  if (state.compactionStepId) {
    deps.ctx.renderer.sendTraceUpdate(deps.session.id, state.compactionStepId, { status, title });
    state.compactionStepId = undefined;
  } else {
    deps.ctx.renderer.sendTraceStep(deps.session.id, {
      id: `compaction-end-${Date.now()}`,
      type: 'thinking',
      status,
      title,
      timestamp: Date.now(),
    });
  }

  if (event.aborted) {
    deps.ctx.renderer.sendSessionNotice(
      deps.session.id,
      mt('noticeCompactionFailed', { error: title }),
      'warning'
    );
  } else if (event.errorMessage) {
    deps.ctx.renderer.sendSessionNotice(
      deps.session.id,
      mt('noticeCompactionFailed', { error: event.errorMessage }),
      'warning'
    );
  } else {
    deps.ctx.renderer.sendSessionNotice(
      deps.session.id,
      mt('noticeCompactionCompleted'),
      'success'
    );
  }
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
