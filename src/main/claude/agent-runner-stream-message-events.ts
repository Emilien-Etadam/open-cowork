import type { AgentSession as PiAgentSession } from '@earendil-works/pi-coding-agent';
import { v4 as uuidv4 } from 'uuid';
import type { ContentBlock } from '../../renderer/types';
import { extractArtifactsFromText, buildArtifactTraceSteps } from '../utils/artifact-parser';
import { log, logCtxError, logWarn } from '../utils/logger';
import {
  buildTerminalErrorEmissionDetails,
  buildTerminalErrorMessage,
  resolveAssistantStreamErrorText,
  resolveMessageEndPayload,
} from './agent-runner-message-end';
import type { ToolCallDescriptor } from './agent-runner-loop-guard';
import { normalizeTokenUsage, safeStringify } from './agent-runner-mcp-bridge';
import type { StreamEventDeps, StreamEventState } from './agent-runner-stream-events';

type PiSessionEvent = Parameters<Parameters<PiAgentSession['subscribe']>[0]>[0];
type MessageUpdateEvent = Extract<PiSessionEvent, { type: 'message_update' }>;
type MessageEndEvent = Extract<PiSessionEvent, { type: 'message_end' }>;

export interface EmitTerminalErrorOptions {
  abort?: boolean;
  includePartialText?: boolean;
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
