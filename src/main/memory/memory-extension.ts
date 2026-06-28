import type {
  AgentRuntimeExtension,
  BeforeSessionRunResult,
} from '../extensions/agent-runtime-extension';
import { computeMemoryPrefixBudget } from '../agent/context-budget';
import { sendToRenderer } from '../main-renderer-bridge';
import type { MemoryService } from './memory-service';

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

    const context = await this.memoryService.buildPromptContext(session, prompt, {
      maxPrefixTokens,
    });

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
