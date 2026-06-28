import type {
  AgentRuntimeExtension,
  BeforeSessionRunResult,
} from '../extensions/agent-runtime-extension';
import { computeMemoryPrefixBudget } from '../agent/context-budget';
import { sendToRenderer } from '../main-renderer-bridge';
import { logWarn } from '../utils/logger';
import { withAsyncTimeoutOrNull } from '../utils/async-timeout';
import type { MemoryService } from './memory-service';

const MEMORY_SESSION_SETUP_TIMEOUT_MS = 30_000;

export class MemoryExtension implements AgentRuntimeExtension {
  readonly name = 'memory';

  constructor(private readonly memoryService: MemoryService) {}

  async beforeSessionRun({
    session,
    prompt,
    contextBudget,
  }: Parameters<
    NonNullable<AgentRuntimeExtension['beforeSessionRun']>
  >[0]): Promise<BeforeSessionRunResult | void> {
    if (!this.memoryService.isEnabled() || !session.memoryEnabled) {
      sendToRenderer({
        type: 'session.memoryContext',
        payload: { sessionId: session.id, items: [] },
      });
      return;
    }

    const maxPrefixTokens = contextBudget
      ? computeMemoryPrefixBudget(
          contextBudget.contextWindow,
          contextBudget.currentInputTokens,
          contextBudget.maxTokens
        )
      : undefined;

    const context = await withAsyncTimeoutOrNull(
      'memory.buildPromptContext',
      MEMORY_SESSION_SETUP_TIMEOUT_MS,
      () =>
        this.memoryService.buildPromptContext(session, prompt, {
          maxPrefixTokens,
        })
    );

    if (!context) {
      logWarn(
        '[MemoryExtension] Memory context build timed out during session setup; continuing without memory injection'
      );
      sendToRenderer({
        type: 'session.memoryContext',
        payload: { sessionId: session.id, items: [] },
      });
      return;
    }

    if (this.memoryService.shouldShowInjectedMemoryInChat()) {
      sendToRenderer({
        type: 'session.memoryContext',
        payload: { sessionId: session.id, items: context.items },
      });
    }

    return {
      promptPrefix: context.prefix,
    };
  }

  async afterSessionRun({
    session,
    prompt,
    messages,
  }: Parameters<NonNullable<AgentRuntimeExtension['afterSessionRun']>>[0]): Promise<void> {
    if (!this.memoryService.isEnabled() || !session.memoryEnabled) {
      return;
    }
    await this.memoryService.enqueueIngestion({
      session,
      prompt,
      messages,
    });
  }

  async onSessionDeleted({
    sessionId,
  }: Parameters<NonNullable<AgentRuntimeExtension['onSessionDeleted']>>[0]): Promise<void> {
    await this.memoryService.deleteSession(sessionId);
  }
}
