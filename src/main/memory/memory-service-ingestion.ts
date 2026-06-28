import * as fs from 'node:fs';
import type { AppConfig } from '../config/config-store';
import type { DatabaseInstance, SessionRow } from '../db/database';
import { log, logError } from '../utils/logger';
import type { CoreMemoryExtractor } from './core-memory-extractor';
import type { CoreMemoryStore } from './core-memory-store';
import type { ExperienceMemoryExtractor } from './experience-memory-extractor';
import type { ExperienceMemoryStore } from './experience-memory-store';
import type { MemoryIngestionQueue } from './memory-ingestion-queue';
import type { MemorySessionStateStore } from './memory-state-store';
import type { ChunkMemoryItem, MemoryIngestionInput, MemoryTranscriptTurn } from './memory-types';
import { getMemoryInjectionPolicy, sanitizeMemoryContent } from './memory-sanitizer';
import {
  extractKeywords,
  isoNow,
  messagesToTranscript,
  normalizeWorkspaceKey,
  safeRemoveFile,
} from './memory-utils';

interface MemoryPathsLike {
  coreFilePath: string;
  experienceFilePath: string;
  stateFilePath: string;
  artifactsDir: string;
}

interface ExtractionBundle {
  sessionRow: SessionRow;
  session: MemoryIngestionInput['session'];
  sourceWorkspace: string | null;
  sessionDate: string;
  fullMessages: MemoryIngestionInput['messages'];
  fullTurns: MemoryTranscriptTurn[];
  extracted: Awaited<ReturnType<ExperienceMemoryExtractor['extractSession']>>;
}

interface MemoryIngestionHost {
  coreExtractor: CoreMemoryExtractor;
  deletedSessionIds: Set<string>;
  db: DatabaseInstance;
  embedText: (text: string) => Promise<number[]>;
  experienceExtractor: ExperienceMemoryExtractor;
  extractRawText: (turns: MemoryTranscriptTurn[], sourceTurns: number[]) => string;
  getAppConfig: () => AppConfig;
  getCoreStore: () => CoreMemoryStore;
  getExperienceStore: () => ExperienceMemoryStore;
  getMessagesForSession: (sessionId: string) => MemoryIngestionInput['messages'];
  getOverview: (cwd?: string) => { sourceWorkspaceCount: number };
  getPaths: () => MemoryPathsLike;
  getStateStore: () => MemorySessionStateStore;
  queue: MemoryIngestionQueue;
  resetStores: () => void;
  resolveSessionDate: (
    session: MemoryIngestionInput['session'],
    messages: MemoryIngestionInput['messages']
  ) => string;
  resolveWorkspaceLabel: (sourceWorkspace: string | null) => string | undefined;
  sessionRowToSession: (row: SessionRow) => MemoryIngestionInput['session'];
}

export function enqueueIngestion(
  host: MemoryIngestionHost,
  input: MemoryIngestionInput
): Promise<void> {
  if (!input.session.memoryEnabled) {
    return Promise.resolve();
  }
  return host.queue.enqueue(input.session.id, async () => {
    await ingest(host, input);
  });
}

export async function rebuildWorkspace(
  host: MemoryIngestionHost,
  cwd: string
): Promise<{ success: boolean; workspaceKey: string }> {
  const workspaceKey = normalizeWorkspaceKey(cwd);
  if (!workspaceKey) {
    throw new Error('Workspace path is required');
  }

  clearWorkspace(host, cwd);
  const sessionRows = host.db.sessions
    .getAll()
    .filter(
      (session) =>
        normalizeWorkspaceKey(session.cwd) === workspaceKey && session.memory_enabled === 1
    )
    .sort((a, b) => a.created_at - b.created_at);
  await batchRebuild(host, sessionRows);
  return { success: true, workspaceKey };
}

export async function rebuildAll(
  host: MemoryIngestionHost
): Promise<{ success: boolean; workspaceCount: number; sessionCount: number }> {
  const paths = host.getPaths();
  safeRemoveFile(paths.coreFilePath);
  safeRemoveFile(paths.experienceFilePath);
  safeRemoveFile(paths.stateFilePath);
  fs.rmSync(paths.artifactsDir, { recursive: true, force: true });
  host.resetStores();

  const sessionRows = host.db.sessions
    .getAll()
    .filter((session) => session.memory_enabled === 1)
    .sort((a, b) => a.created_at - b.created_at);
  await batchRebuild(host, sessionRows);
  const overview = host.getOverview();
  return {
    success: true,
    workspaceCount: overview.sourceWorkspaceCount,
    sessionCount: sessionRows.length,
  };
}

export function clearWorkspace(
  host: MemoryIngestionHost,
  cwd: string
): { success: boolean; workspaceKey: string } {
  const workspaceKey = normalizeWorkspaceKey(cwd);
  if (!workspaceKey) {
    throw new Error('Workspace path is required');
  }

  const store = host.getExperienceStore();
  store.removeBySourceWorkspace(workspaceKey);
  store.save();
  host.getStateStore().deleteBySourceWorkspace(workspaceKey);
  return { success: true, workspaceKey };
}

export function clearCoreMemory(host: MemoryIngestionHost): { success: boolean } {
  host.getCoreStore().clear();
  return { success: true };
}

export function deleteSession(host: MemoryIngestionHost, sessionId: string): Promise<void> {
  host.deletedSessionIds.add(sessionId);
  return host.queue.enqueue(sessionId, async () => {
    const store = host.getExperienceStore();
    if (store.getSession(sessionId)) {
      store.removeSession(sessionId);
      store.save();
    }
    host.getStateStore().delete(sessionId);
  });
}

export async function batchRebuild(
  host: MemoryIngestionHost,
  sessionRows: SessionRow[]
): Promise<void> {
  if (!sessionRows.length) {
    return;
  }
  const bundles = await extractExperienceBundles(host, sessionRows);
  const sortedBundles = [...bundles].sort((a, b) => a.session.createdAt - b.session.createdAt);
  for (const bundle of sortedBundles) {
    await ingestExtractedBundle(host, bundle);
  }
}

export async function ingest(
  host: MemoryIngestionHost,
  input: MemoryIngestionInput
): Promise<void> {
  const { session, messages } = input;
  if (!session.memoryEnabled || !messages.length) {
    return;
  }

  if (host.deletedSessionIds.has(session.id)) {
    host.getStateStore().delete(session.id);
    return;
  }

  const sourceWorkspace = normalizeWorkspaceKey(session.cwd);
  const stateStore = host.getStateStore();
  const previousState = stateStore.get(session.id);
  const lastProcessedMessageCount = previousState?.lastProcessedMessageCount || 0;
  if (messages.length <= lastProcessedMessageCount) {
    return;
  }

  const fullTurns = messagesToTranscript(messages);
  const deltaTurns = messagesToTranscript(messages.slice(lastProcessedMessageCount));
  const sessionDate = host.resolveSessionDate(session, messages);

  try {
    await updateCoreMemory(host, session.id, sessionDate, deltaTurns);
    if (host.deletedSessionIds.has(session.id)) {
      stateStore.delete(session.id);
      return;
    }

    if (fullTurns.length) {
      const extracted = await host.experienceExtractor.extractSession({
        sessionId: session.id,
        sessionDate,
        turns: fullTurns,
      });
      if (host.deletedSessionIds.has(session.id)) {
        stateStore.delete(session.id);
        return;
      }
      await storeExperienceSession(host, {
        sourceWorkspace,
        sessionId: session.id,
        sessionTitle: session.title,
        sessionDate,
        sessionCreatedAt: session.createdAt,
        fullTurns,
        extracted,
      });
    }

    stateStore.set({
      sessionId: session.id,
      sourceWorkspace,
      lastProcessedMessageCount: messages.length,
      lastIngestedAt: Date.now(),
      lastError: null,
      createdAt: previousState?.createdAt || Date.now(),
      updatedAt: Date.now(),
    });
    log('[MemoryService] Ingested memory for session:', session.id);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logError('[MemoryService] Failed to ingest memory:', error);
    stateStore.set({
      sessionId: session.id,
      sourceWorkspace,
      lastProcessedMessageCount,
      lastIngestedAt: previousState?.lastIngestedAt || null,
      lastError: message,
      createdAt: previousState?.createdAt || Date.now(),
      updatedAt: Date.now(),
    });
  }
}

export async function extractExperienceBundles(
  host: MemoryIngestionHost,
  sessionRows: SessionRow[]
): Promise<ExtractionBundle[]> {
  const concurrency = host.getAppConfig().memoryRuntime.ingestionConcurrency;
  const tasks = sessionRows.map((sessionRow) => async () => {
    const session = host.sessionRowToSession(sessionRow);
    const fullMessages = host.getMessagesForSession(sessionRow.id);
    const fullTurns = messagesToTranscript(fullMessages);
    const sessionDate = host.resolveSessionDate(session, fullMessages);
    const sourceWorkspace = normalizeWorkspaceKey(session.cwd);
    const extracted = fullTurns.length
      ? await host.experienceExtractor.extractSession({
          sessionId: session.id,
          sessionDate,
          turns: fullTurns,
        })
      : { sessionSummary: '', sessionKeywords: [], chunks: [] };
    return {
      sessionRow,
      session,
      sourceWorkspace,
      sessionDate,
      fullMessages,
      fullTurns,
      extracted,
    } satisfies ExtractionBundle;
  });

  const bundles: ExtractionBundle[] = [];
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, async () => {
    while (cursor < tasks.length) {
      const index = cursor;
      cursor += 1;
      bundles[index] = await tasks[index]();
    }
  });
  await Promise.all(workers);
  return bundles.filter(Boolean);
}

export async function updateCoreMemory(
  host: MemoryIngestionHost,
  sessionId: string,
  sessionDate: string,
  turns: MemoryTranscriptTurn[]
): Promise<void> {
  if (!turns.length) {
    return;
  }

  const coreStore = host.getCoreStore();
  const actions = await host.coreExtractor.extract({
    sessionId,
    sessionDate,
    turns,
    existingCorePromptBlock: coreStore.toPromptBlock(),
  });
  if (actions.length) {
    const injectionPolicy = getMemoryInjectionPolicy(host.getAppConfig().memoryRuntime);
    const sanitizedActions = actions.map((action) => ({
      ...action,
      value:
        typeof action.value === 'string'
          ? sanitizeMemoryContent(action.value, injectionPolicy)
          : action.value,
    }));
    coreStore.applyActions(sanitizedActions);
  }
}

export async function storeExperienceSession(
  host: MemoryIngestionHost,
  input: {
    sourceWorkspace: string | null;
    sessionId: string;
    sessionTitle?: string;
    sessionDate: string;
    sessionCreatedAt: number;
    fullTurns: MemoryTranscriptTurn[];
    extracted: Awaited<ReturnType<ExperienceMemoryExtractor['extractSession']>>;
  }
): Promise<void> {
  const store = host.getExperienceStore();
  const existing = store.getSession(input.sessionId);
  const ingestedAt = isoNow();
  const sourceWorkspaceLabel = host.resolveWorkspaceLabel(input.sourceWorkspace);
  const injectionPolicy = getMemoryInjectionPolicy(host.getAppConfig().memoryRuntime);
  const sanitize = (text: string) => sanitizeMemoryContent(text, injectionPolicy);

  const chunkInputs: Array<Omit<ChunkMemoryItem, 'id'>> = [];
  for (const chunk of input.extracted.chunks) {
    const rawText = sanitize(host.extractRawText(input.fullTurns, chunk.sourceTurns));
    const summary = sanitize(chunk.summary);
    const details = sanitize(chunk.details);
    const searchableText = [summary, details, ...chunk.keywords].join(' ').trim();
    chunkInputs.push({
      sessionId: input.sessionId,
      sourceWorkspace: input.sourceWorkspace,
      sourceWorkspaceLabel,
      sourceSessionId: input.sessionId,
      sourceSessionTitle: input.sessionTitle,
      sourceSessionDate: input.sessionDate,
      summary,
      details,
      keywords: chunk.keywords.length ? chunk.keywords : extractKeywords(searchableText),
      sourceTurns: chunk.sourceTurns,
      rawText,
      sessionDate: input.sessionDate,
      createdAt: existing?.createdAt || new Date(input.sessionCreatedAt).toISOString(),
      ingestedAt,
      embedding: await host.embedText(searchableText),
    });
  }

  const sessionSearchable = [input.extracted.sessionSummary, ...input.extracted.sessionKeywords]
    .join(' ')
    .trim();
  const sessionSummary = sanitize(input.extracted.sessionSummary);
  store.replaceSession(
    input.sessionId,
    {
      sessionId: input.sessionId,
      sourceWorkspace: input.sourceWorkspace,
      sourceWorkspaceLabel,
      sourceSessionId: input.sessionId,
      sourceSessionTitle: input.sessionTitle,
      sourceSessionDate: input.sessionDate,
      summary: sessionSummary,
      keywords: input.extracted.sessionKeywords.length
        ? input.extracted.sessionKeywords
        : extractKeywords(sessionSearchable),
      chunkIds: [],
      rawSession: input.fullTurns.map((turn) => ({
        ...turn,
        content: sanitize(turn.content),
      })),
      sessionDate: input.sessionDate,
      createdAt: existing?.createdAt || new Date(input.sessionCreatedAt).toISOString(),
      ingestedAt,
      embedding: await host.embedText(sessionSearchable),
    },
    chunkInputs
  );
  store.save();
}

async function ingestExtractedBundle(
  host: MemoryIngestionHost,
  bundle: ExtractionBundle
): Promise<void> {
  await updateCoreMemory(host, bundle.session.id, bundle.sessionDate, bundle.fullTurns);
  if (bundle.fullTurns.length) {
    await storeExperienceSession(host, {
      sourceWorkspace: bundle.sourceWorkspace,
      sessionId: bundle.session.id,
      sessionTitle: bundle.session.title,
      sessionDate: bundle.sessionDate,
      sessionCreatedAt: bundle.session.createdAt,
      fullTurns: bundle.fullTurns,
      extracted: bundle.extracted,
    });
  }
  host.getStateStore().set({
    sessionId: bundle.session.id,
    sourceWorkspace: bundle.sourceWorkspace,
    lastProcessedMessageCount: bundle.fullMessages.length,
    lastIngestedAt: Date.now(),
    lastError: null,
    createdAt: bundle.session.createdAt,
    updatedAt: Date.now(),
  });
}
