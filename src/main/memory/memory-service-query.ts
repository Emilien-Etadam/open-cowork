import * as fs from 'node:fs';
import * as path from 'node:path';
import type { CoreMemoryStore } from './core-memory-store';
import type { ExperienceMemoryStore } from './experience-memory-store';
import type { MemoryRetriever } from './memory-retriever';
import type { MemorySessionStateStore } from './memory-state-store';
import type {
  MemoryDebugFileContent,
  MemoryDebugFileInfo,
  MemoryInspectSessionResult,
  MemoryOverview,
  MemoryReadResult,
  MemorySearchParams,
  MemorySearchResult,
  MemoryToolDefinition,
} from './memory-types';
import {
  getFileSizeBytes,
  getFileTimestampMs,
  isSubPath,
  loadJsonFile,
  normalizeWorkspaceKey,
} from './memory-utils';

interface MemoryPathsLike {
  storageRoot: string;
  coreFilePath: string;
  experienceFilePath: string;
  stateFilePath: string;
  artifactsDir: string;
}

interface MemoryQueryHost {
  assertSafeMemoryPaths: (storageRoot: string, artifactsDir: string) => void;
  getCoreStore: () => CoreMemoryStore;
  getExperienceStore: () => ExperienceMemoryStore;
  getPaths: () => MemoryPathsLike;
  getStateStore: () => MemorySessionStateStore;
  isEnabled: () => boolean;
  retriever: MemoryRetriever;
  tools: MemoryToolDefinition[];
}

export function getTools(host: MemoryQueryHost): MemoryToolDefinition[] {
  return host.tools;
}

export function searchMemory(
  host: MemoryQueryHost,
  params: MemorySearchParams
): MemorySearchResult[] {
  return host.retriever.search(params);
}

export function readMemory(host: MemoryQueryHost, id: string): MemoryReadResult | null {
  return host.retriever.read(id);
}

export function getOverview(host: MemoryQueryHost, cwd?: string): MemoryOverview {
  const paths = host.getPaths();
  const coreEntries = host.getCoreStore().getEntries();
  const experienceStore = host.getExperienceStore();
  const stateRecords = host.getStateStore().getAll();
  const currentWorkspace = normalizeWorkspaceKey(cwd);
  const topSourceWorkspaces = experienceStore.getStatsBySourceWorkspace();

  return {
    enabled: host.isEnabled(),
    storageRoot: paths.storageRoot,
    coreFilePath: paths.coreFilePath,
    experienceFilePath: paths.experienceFilePath,
    stateFilePath: paths.stateFilePath,
    coreCount: coreEntries.length,
    experienceSessionCount: experienceStore.sessions.length,
    experienceChunkCount: experienceStore.chunks.length,
    sourceWorkspaceCount: topSourceWorkspaces.filter((item) => item.workspaceKey !== '(none)')
      .length,
    failedSessionCount: stateRecords.filter((record) => Boolean(record.lastError)).length,
    latestIngestionAt: stateRecords.reduce<number | null>((latest, record) => {
      if (!record.lastIngestedAt) {
        return latest;
      }
      return latest === null ? record.lastIngestedAt : Math.max(latest, record.lastIngestedAt);
    }, null),
    latestError:
      stateRecords.filter((record) => record.lastError).sort((a, b) => b.updatedAt - a.updatedAt)[0]
        ?.lastError || null,
    currentWorkspace: currentWorkspace
      ? {
          workspaceKey: currentWorkspace,
          experienceSessionCount: experienceStore.sessions.filter(
            (item) => item.sourceWorkspace === currentWorkspace
          ).length,
          experienceChunkCount: experienceStore.chunks.filter(
            (item) => item.sourceWorkspace === currentWorkspace
          ).length,
        }
      : undefined,
    topSourceWorkspaces,
  };
}

export function listFiles(host: MemoryQueryHost): MemoryDebugFileInfo[] {
  const paths = host.getPaths();
  const experienceStore = host.getExperienceStore();
  return [
    {
      kind: 'core',
      label: 'core_memory.json',
      filePath: paths.coreFilePath,
      exists: fs.existsSync(paths.coreFilePath),
      sizeBytes: getFileSizeBytes(paths.coreFilePath),
      updatedAt: getFileTimestampMs(paths.coreFilePath),
    },
    {
      kind: 'experience',
      label: 'experience_memory.json',
      filePath: paths.experienceFilePath,
      exists: fs.existsSync(paths.experienceFilePath),
      sizeBytes: getFileSizeBytes(paths.experienceFilePath),
      updatedAt: getFileTimestampMs(paths.experienceFilePath),
      sessionCount: experienceStore.sessions.length,
      chunkCount: experienceStore.chunks.length,
    },
    {
      kind: 'state',
      label: 'session_state.json',
      filePath: paths.stateFilePath,
      exists: fs.existsSync(paths.stateFilePath),
      sizeBytes: getFileSizeBytes(paths.stateFilePath),
      updatedAt: getFileTimestampMs(paths.stateFilePath),
    },
    {
      kind: 'artifacts',
      label: 'eval-artifacts/',
      filePath: paths.artifactsDir,
      exists: fs.existsSync(paths.artifactsDir),
      sizeBytes: getFileSizeBytes(paths.artifactsDir),
      updatedAt: getFileTimestampMs(paths.artifactsDir),
    },
  ];
}

export function readFile(host: MemoryQueryHost, filePath: string): MemoryDebugFileContent {
  const normalizedPath = resolveReadablePath(host, filePath);
  const stat = fs.statSync(normalizedPath);
  if (stat.isDirectory()) {
    const parsed = fs
      .readdirSync(normalizedPath)
      .sort()
      .map((name) => {
        const fullPath = path.join(normalizedPath, name);
        const child = fs.statSync(fullPath);
        return {
          name,
          path: fullPath,
          isDirectory: child.isDirectory(),
          sizeBytes: child.size,
          updatedAt: child.mtimeMs,
        };
      });
    return {
      kind: 'artifacts',
      filePath: normalizedPath,
      text: JSON.stringify(parsed, null, 2),
      parsed,
      sizeBytes: stat.size,
      updatedAt: stat.mtimeMs,
    };
  }

  const raw = fs.readFileSync(normalizedPath, 'utf8');
  return {
    kind: resolveFileKind(host, normalizedPath),
    filePath: normalizedPath,
    text: raw,
    parsed: raw.trim() ? loadJsonFile(normalizedPath, null) : null,
    sizeBytes: getFileSizeBytes(normalizedPath),
    updatedAt: getFileTimestampMs(normalizedPath),
  };
}

export function inspectSession(
  host: MemoryQueryHost,
  sessionId: string,
  sourceWorkspace?: string
): MemoryInspectSessionResult | null {
  const store = host.getExperienceStore();
  const session = store.getSession(sessionId);
  if (!session) {
    return null;
  }
  if (sourceWorkspace) {
    const normalized = normalizeWorkspaceKey(sourceWorkspace);
    if (session.sourceWorkspace !== normalized) {
      return null;
    }
  }
  return {
    sourceWorkspace: session.sourceWorkspace,
    filePath: store.getPath(),
    session,
    chunks: store.getChunksBySession(sessionId),
  };
}

function resolveFileKind(host: MemoryQueryHost, filePath: string): MemoryDebugFileInfo['kind'] {
  const paths = host.getPaths();
  if (filePath === paths.coreFilePath) return 'core';
  if (filePath === paths.experienceFilePath) return 'experience';
  if (filePath === paths.stateFilePath) return 'state';
  return 'artifacts';
}

function resolveReadablePath(host: MemoryQueryHost, filePath: string): string {
  const paths = host.getPaths();
  host.assertSafeMemoryPaths(paths.storageRoot, paths.artifactsDir);
  const requestedPath = path.resolve(filePath);
  if (!fs.existsSync(requestedPath)) {
    throw new Error('Requested file does not exist');
  }

  const normalizedPath = fs.realpathSync(requestedPath);
  const allowedFiles = new Set(
    [paths.coreFilePath, paths.experienceFilePath, paths.stateFilePath]
      .filter((candidate) => fs.existsSync(candidate))
      .map((candidate) => fs.realpathSync(candidate))
  );
  const artifactsRoot = fs.existsSync(paths.artifactsDir)
    ? fs.realpathSync(paths.artifactsDir)
    : path.resolve(paths.artifactsDir);

  if (!allowedFiles.has(normalizedPath) && !isSubPath(normalizedPath, artifactsRoot)) {
    throw new Error('Requested file is outside allowed memory files');
  }
  return normalizedPath;
}
