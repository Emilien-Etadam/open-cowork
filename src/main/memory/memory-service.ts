import type { AppConfig } from '../config/config-store';
import { configStore } from '../config/config-store';
import type { DatabaseInstance } from '../db/database';
import { CoreMemoryExtractor } from './core-memory-extractor';
import { ExperienceMemoryExtractor } from './experience-memory-extractor';
import {
  extractRawText,
  getMessagesForSession,
  resolveSessionDate,
  resolveWorkspaceLabel,
  sessionRowToSession,
} from './memory-service-helpers';
import { MemoryIngestionQueue } from './memory-ingestion-queue';
import type { MemoryLLMClientLike } from './memory-llm-client';
import { MemoryLLMClient } from './memory-llm-client';
import { MemoryNavigator } from './memory-navigator';
import { DEFAULT_MEMORY_PROMPTS, type MemoryPromptSet } from './memory-prompts';
import { MemoryRetriever } from './memory-retriever';
import { MemoryServiceStorage, assertSafeMemoryPaths } from './memory-service-storage';
import { buildPromptPrefix, embedText } from './memory-service-context';
import {
  clearCoreMemory,
  clearWorkspace,
  deleteSession,
  enqueueIngestion,
  rebuildAll,
  rebuildWorkspace,
} from './memory-service-ingestion';
import {
  getOverview,
  getTools,
  inspectSession,
  listFiles,
  readFile,
  readMemory,
  searchMemory,
} from './memory-service-query';
import type {
  MemoryDebugFileContent,
  MemoryDebugFileInfo,
  MemoryIngestionInput,
  MemoryInspectSessionResult,
  MemoryOverview,
  MemoryReadResult,
  MemorySearchParams,
  MemorySearchResult,
  MemoryToolDefinition,
} from './memory-types';
import { createMemoryTools } from './memory-tools';

export class MemoryService {
  private readonly queue = new MemoryIngestionQueue();
  private readonly deletedSessionIds = new Set<string>();
  private readonly llmClient: MemoryLLMClientLike;
  private readonly coreExtractor: CoreMemoryExtractor;
  private readonly experienceExtractor: ExperienceMemoryExtractor;
  private readonly navigator: MemoryNavigator;
  private readonly retriever: MemoryRetriever;
  private readonly tools: MemoryToolDefinition[];
  private readonly storage = new MemoryServiceStorage(() => this.getAppConfig());
  private readonly queryHost: Parameters<typeof getTools>[0];
  private readonly contextHost: Parameters<typeof buildPromptPrefix>[0];
  private readonly ingestionHost: Parameters<typeof enqueueIngestion>[0];

  constructor(
    private readonly db: DatabaseInstance,
    options?: { llmClient?: MemoryLLMClientLike; prompts?: Partial<MemoryPromptSet> }
  ) {
    this.llmClient = options?.llmClient || new MemoryLLMClient();
    const promptSet: MemoryPromptSet = { ...DEFAULT_MEMORY_PROMPTS, ...options?.prompts };
    this.coreExtractor = new CoreMemoryExtractor(
      this.llmClient,
      promptSet.coreMemoryUpdateSystemPrompt
    );
    this.experienceExtractor = new ExperienceMemoryExtractor(
      this.llmClient,
      promptSet.sessionChunkExtractionPrompt
    );
    this.navigator = new MemoryNavigator(this.llmClient, promptSet.memoryNavigationPrompt);
    this.retriever = new MemoryRetriever({
      getCoreEntries: () => this.storage.getCoreStore().getEntries(),
      getCoreFilePath: () => this.storage.getPaths().coreFilePath,
      getExperienceStore: () => this.storage.getExperienceStore(),
      getExperienceFilePath: () => this.storage.getPaths().experienceFilePath,
      getSessionTitle: (sessionId) => this.db.sessions.get(sessionId)?.title || undefined,
    });
    this.tools = createMemoryTools(this);
    this.queryHost = {
      assertSafeMemoryPaths,
      getCoreStore: () => this.storage.getCoreStore(),
      getExperienceStore: () => this.storage.getExperienceStore(),
      getPaths: () => this.storage.getPaths(),
      getStateStore: () => this.storage.getStateStore(),
      isEnabled: () => this.isEnabled(),
      retriever: this.retriever,
      tools: this.tools,
    };
    this.contextHost = {
      getAppConfig: () => this.getAppConfig(),
      getCoreStore: () => this.storage.getCoreStore(),
      getExperienceStore: () => this.storage.getExperienceStore(),
      isEnabled: () => this.isEnabled(),
      llmClient: this.llmClient,
      navigator: this.navigator,
    };
    this.ingestionHost = {
      coreExtractor: this.coreExtractor,
      deletedSessionIds: this.deletedSessionIds,
      db: this.db,
      embedText: (text: string) => embedText(this.contextHost, text),
      experienceExtractor: this.experienceExtractor,
      extractRawText,
      getAppConfig: () => this.getAppConfig(),
      getCoreStore: () => this.storage.getCoreStore(),
      getExperienceStore: () => this.storage.getExperienceStore(),
      getMessagesForSession: (sessionId: string) =>
        getMessagesForSession(this.db.messages, sessionId),
      getOverview: (cwd?: string) => getOverview(this.queryHost, cwd),
      getPaths: () => this.storage.getPaths(),
      getStateStore: () => this.storage.getStateStore(),
      queue: this.queue,
      resetStores: () => this.storage.reset(),
      resolveSessionDate,
      resolveWorkspaceLabel,
      sessionRowToSession,
    };
  }

  isEnabled(): boolean {
    return configStore.get('memoryEnabled') !== false;
  }

  setEnabled(enabled: boolean): { success: boolean; enabled: boolean } {
    configStore.update({ memoryEnabled: enabled });
    return { success: true, enabled };
  }

  getTools(): MemoryToolDefinition[] {
    return getTools(this.queryHost);
  }

  search(params: MemorySearchParams): MemorySearchResult[] {
    return searchMemory(this.queryHost, params);
  }

  read(id: string): MemoryReadResult | null {
    return readMemory(this.queryHost, id);
  }

  getOverview(cwd?: string): MemoryOverview {
    return getOverview(this.queryHost, cwd);
  }

  listFiles(): MemoryDebugFileInfo[] {
    return listFiles(this.queryHost);
  }

  readFile(filePath: string): MemoryDebugFileContent {
    return readFile(this.queryHost, filePath);
  }

  inspectSession(sessionId: string, sourceWorkspace?: string): MemoryInspectSessionResult | null {
    return inspectSession(this.queryHost, sessionId, sourceWorkspace);
  }

  async buildPromptPrefix(
    session: { cwd?: string },
    prompt: string,
    options?: { maxPrefixTokens?: number }
  ): Promise<string> {
    return buildPromptPrefix(this.contextHost, session, prompt, options);
  }

  enqueueIngestion(input: MemoryIngestionInput): Promise<void> {
    return enqueueIngestion(this.ingestionHost, input);
  }

  async rebuildWorkspace(cwd: string): Promise<{ success: boolean; workspaceKey: string }> {
    return rebuildWorkspace(this.ingestionHost, cwd);
  }

  async rebuildAll(): Promise<{ success: boolean; workspaceCount: number; sessionCount: number }> {
    return rebuildAll(this.ingestionHost);
  }

  clearWorkspace(cwd: string): { success: boolean; workspaceKey: string } {
    return clearWorkspace(this.ingestionHost, cwd);
  }

  clearCoreMemory(): { success: boolean } {
    return clearCoreMemory(this.ingestionHost);
  }

  deleteSession(sessionId: string): Promise<void> {
    return deleteSession(this.ingestionHost, sessionId);
  }

  private getAppConfig(): AppConfig {
    return configStore.getAll();
  }
}
