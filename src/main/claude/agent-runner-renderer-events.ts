import type { Message, ServerEvent, TraceStep } from '../../renderer/types';
import { log } from '../utils/logger';

export interface AgentRunnerRendererOptions {
  sendToRenderer: (event: ServerEvent) => void;
  saveMessage?: (message: Message) => void;
}

export class AgentRunnerRenderer {
  constructor(
    private readonly sendToRenderer: (event: ServerEvent) => void,
    private readonly saveMessage?: (message: Message) => void
  ) {}

  dispatch(event: ServerEvent): void {
    this.sendToRenderer(event);
  }

  sendTraceStep(sessionId: string, step: TraceStep): void {
    log(`[Trace] ${step.type}: ${step.title}`);
    this.sendToRenderer({ type: 'trace.step', payload: { sessionId, step } });
  }

  sendTraceUpdate(sessionId: string, stepId: string, updates: Partial<TraceStep>): void {
    log(`[Trace] Update step ${stepId}:`, updates);
    this.sendToRenderer({ type: 'trace.update', payload: { sessionId, stepId, updates } });
  }

  sendSessionNotice(
    sessionId: string,
    message: string,
    noticeType: 'info' | 'warning' | 'error' | 'success' = 'info'
  ): void {
    this.sendToRenderer({
      type: 'session.notice',
      payload: { sessionId, message, noticeType },
    });
  }

  sendMessage(sessionId: string, message: Message): void {
    if (this.saveMessage) {
      this.saveMessage(message);
    }
    this.sendToRenderer({ type: 'stream.message', payload: { sessionId, message } });
  }

  sendPartial(sessionId: string, delta: string): void {
    this.sendToRenderer({ type: 'stream.partial', payload: { sessionId, delta } });
  }
}
