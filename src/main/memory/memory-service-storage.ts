import * as fs from 'node:fs';
import * as path from 'node:path';
import { app } from 'electron';
import type { AppConfig } from '../config/config-store';
import { CoreMemoryStore } from './core-memory-store';
import { ExperienceMemoryStore } from './experience-memory-store';
import { MemorySessionStateStore } from './memory-state-store';
import { isSubPath } from './memory-utils';

export interface MemoryPaths {
  storageRoot: string;
  coreFilePath: string;
  experienceFilePath: string;
  stateFilePath: string;
  artifactsDir: string;
}

function isFilesystemRootPath(filePath: string): boolean {
  const resolvedPath = path.resolve(filePath);
  return resolvedPath === path.parse(resolvedPath).root;
}

function resolveMaterializedPath(filePath: string): string {
  const resolvedPath = path.resolve(filePath);
  if (fs.existsSync(resolvedPath)) {
    return fs.realpathSync(resolvedPath);
  }

  const { root } = path.parse(resolvedPath);
  const segments = path.relative(root, resolvedPath).split(path.sep).filter(Boolean);
  let existingPath = root;
  let firstMissingIndex = 0;
  for (; firstMissingIndex < segments.length; firstMissingIndex += 1) {
    const candidate = path.join(existingPath, segments[firstMissingIndex]);
    if (!fs.existsSync(candidate)) {
      break;
    }
    existingPath = candidate;
  }

  const realExistingPath = fs.realpathSync(existingPath);
  const missingRemainder = segments.slice(firstMissingIndex).join(path.sep);
  return missingRemainder ? path.join(realExistingPath, missingRemainder) : realExistingPath;
}

export function assertSafeMemoryPaths(storageRoot: string, artifactsDir: string): void {
  const resolvedStorageRoot = path.resolve(storageRoot);
  const resolvedArtifactsDir = path.resolve(artifactsDir);
  if (isFilesystemRootPath(resolvedStorageRoot)) {
    throw new Error('Memory storageRoot must not be a filesystem root');
  }
  if (isFilesystemRootPath(resolvedArtifactsDir)) {
    throw new Error('Memory evalArtifactsRoot must not be a filesystem root');
  }
  if (!isSubPath(resolvedArtifactsDir, resolvedStorageRoot)) {
    throw new Error('evalArtifactsRoot must stay inside storageRoot');
  }

  const materializedStorageRoot = resolveMaterializedPath(resolvedStorageRoot);
  const materializedArtifactsDir = resolveMaterializedPath(resolvedArtifactsDir);
  if (isFilesystemRootPath(materializedStorageRoot)) {
    throw new Error('Memory storageRoot must not be a filesystem root');
  }
  if (isFilesystemRootPath(materializedArtifactsDir)) {
    throw new Error('Memory evalArtifactsRoot must not be a filesystem root');
  }
  if (!isSubPath(materializedArtifactsDir, materializedStorageRoot)) {
    throw new Error('evalArtifactsRoot must stay inside storageRoot');
  }
}

export class MemoryServiceStorage {
  private currentPathsKey: string | null = null;
  private coreStore: CoreMemoryStore | null = null;
  private stateStore: MemorySessionStateStore | null = null;
  private experienceStore: ExperienceMemoryStore | null = null;

  constructor(private readonly getAppConfig: () => AppConfig) {}

  getPaths(): MemoryPaths {
    const configuredRoot = this.getAppConfig().memoryRuntime.storageRoot?.trim();
    const configuredArtifactsRoot = this.getAppConfig().memoryRuntime.evalArtifactsRoot?.trim();
    const storageRoot = path.resolve(
      configuredRoot || path.join(app.getPath('userData'), 'memory')
    );
    const safeArtifactsDir = path.join(storageRoot, 'eval-artifacts');
    const artifactsDir = path.resolve(configuredArtifactsRoot || safeArtifactsDir);
    assertSafeMemoryPaths(storageRoot, artifactsDir);
    return {
      storageRoot,
      coreFilePath: path.join(storageRoot, 'core_memory.json'),
      experienceFilePath: path.join(storageRoot, 'experience_memory.json'),
      stateFilePath: path.join(storageRoot, 'session_state.json'),
      artifactsDir,
    };
  }

  reset(): void {
    this.currentPathsKey = null;
    this.coreStore = null;
    this.stateStore = null;
    this.experienceStore = null;
  }

  getCoreStore(): CoreMemoryStore {
    this.ensureStores();
    return this.coreStore!;
  }

  getStateStore(): MemorySessionStateStore {
    this.ensureStores();
    return this.stateStore!;
  }

  getExperienceStore(): ExperienceMemoryStore {
    this.ensureStores();
    return this.experienceStore!;
  }

  private ensureStores(): void {
    const paths = this.getPaths();
    const pathsKey = `${paths.storageRoot}::${paths.artifactsDir}`;
    if (
      this.currentPathsKey === pathsKey &&
      this.coreStore &&
      this.stateStore &&
      this.experienceStore
    ) {
      return;
    }
    fs.mkdirSync(paths.storageRoot, { recursive: true });
    fs.mkdirSync(paths.artifactsDir, { recursive: true });
    assertSafeMemoryPaths(paths.storageRoot, paths.artifactsDir);
    this.currentPathsKey = pathsKey;
    this.coreStore = new CoreMemoryStore(paths.coreFilePath);
    this.stateStore = new MemorySessionStateStore(paths.stateFilePath);
    this.experienceStore = new ExperienceMemoryStore(paths.experienceFilePath);
  }
}
