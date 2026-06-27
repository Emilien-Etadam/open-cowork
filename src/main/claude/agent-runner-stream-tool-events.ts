import type { AgentSession as PiAgentSession } from '@earendil-works/pi-coding-agent';
import { v4 as uuidv4 } from 'uuid';
import { mt } from '../i18n';
import { log, logCtx } from '../utils/logger';
import type { StreamEventDeps, StreamEventState } from './agent-runner-stream-events';
import { normalizeToolExecutionResultForUi } from './tool-result-utils';

type PiSessionEvent = Parameters<Parameters<PiAgentSession['subscribe']>[0]>[0];
type ToolExecutionStartEvent = Extract<PiSessionEvent, { type: 'tool_execution_start' }>;
type ToolExecutionEndEvent = Extract<PiSessionEvent, { type: 'tool_execution_end' }>;
type CompactionStartEvent = Extract<PiSessionEvent, { type: 'compaction_start' }>;
type CompactionEndEvent = Extract<PiSessionEvent, { type: 'compaction_end' }>;

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
