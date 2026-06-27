import type { TraceStep } from '../types';
import type { useAppStore } from '../store';

type AppStoreState = ReturnType<typeof useAppStore.getState>;

export type TraceAction =
  | { kind: 'add'; sessionId: string; step: TraceStep }
  | { kind: 'update'; sessionId: string; stepId: string; updates: Partial<TraceStep> };

export interface IpcStreamBatching {
  bufferPartial: (sessionId: string, delta: string) => void;
  bufferThinking: (sessionId: string, delta: string) => void;
  bufferTrace: (action: TraceAction) => void;
  clearPartial: (sessionId: string) => void;
  clearThinking: (sessionId: string) => void;
  dispose: () => void;
}

/**
 * RAF-batched stream updates for high-frequency IPC events (partial text, thinking, traces).
 */
export function createIpcStreamBatching(getStore: () => AppStoreState): IpcStreamBatching {
  const pendingPartials: Record<string, string[]> = {};
  let partialRafId: number | null = null;

  const pendingThinking: Record<string, string[]> = {};
  let thinkingRafId: number | null = null;

  let pendingTraces: TraceAction[] = [];
  let traceRafId: number | null = null;

  const flushPartials = () => {
    partialRafId = null;
    const store = getStore();
    for (const sessionId in pendingPartials) {
      const chunks = pendingPartials[sessionId];
      if (chunks.length > 0) {
        store.setPartialMessage(sessionId, chunks.join(''));
        pendingPartials[sessionId] = [];
      }
    }
  };

  const flushThinking = () => {
    thinkingRafId = null;
    const store = getStore();
    for (const sessionId in pendingThinking) {
      const chunks = pendingThinking[sessionId];
      if (chunks.length > 0) {
        store.setPartialThinking(sessionId, chunks.join(''));
        pendingThinking[sessionId] = [];
      }
    }
  };

  const flushTraces = () => {
    traceRafId = null;
    const store = getStore();
    for (const action of pendingTraces) {
      if (action.kind === 'add') {
        store.addTraceStep(action.sessionId, action.step);
      } else {
        store.updateTraceStep(action.sessionId, action.stepId, action.updates);
      }
    }
    pendingTraces = [];
  };

  return {
    bufferPartial(sessionId: string, delta: string) {
      if (!pendingPartials[sessionId]) {
        pendingPartials[sessionId] = [];
      }
      pendingPartials[sessionId].push(delta);
      if (partialRafId === null) {
        partialRafId = requestAnimationFrame(flushPartials);
      }
    },
    bufferThinking(sessionId: string, delta: string) {
      if (!pendingThinking[sessionId]) {
        pendingThinking[sessionId] = [];
      }
      pendingThinking[sessionId].push(delta);
      if (thinkingRafId === null) {
        thinkingRafId = requestAnimationFrame(flushThinking);
      }
    },
    bufferTrace(action: TraceAction) {
      pendingTraces.push(action);
      if (traceRafId === null) {
        traceRafId = requestAnimationFrame(flushTraces);
      }
    },
    clearPartial(sessionId: string) {
      delete pendingPartials[sessionId];
    },
    clearThinking(sessionId: string) {
      delete pendingThinking[sessionId];
    },
    dispose() {
      if (partialRafId !== null) {
        cancelAnimationFrame(partialRafId);
        flushPartials();
      }
      if (thinkingRafId !== null) {
        cancelAnimationFrame(thinkingRafId);
        flushThinking();
      }
      if (traceRafId !== null) {
        cancelAnimationFrame(traceRafId);
        flushTraces();
      }
    },
  };
}
