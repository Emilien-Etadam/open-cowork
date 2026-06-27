import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { app } from 'electron';
import Store, { type Options as StoreOptions } from 'electron-store';

type Logger = (...args: unknown[]) => void;

interface EncryptedStoreRotationOptions<T extends Record<string, unknown>> {
  stableKey: string;
  legacyKeys: string[];
  storeOptions: StoreOptions<T> & { projectName?: string };
  logPrefix: string;
  log?: Logger;
  warn?: Logger;
  /** When set, unreadable-recovery backups may restore a wiped store on startup. */
  recoverIfReset?: (current: T, recovered: T) => boolean;
}

interface KeyMaterialOptions {
  moduleDirname: string;
  stableSeed: string;
  legacySeed: string;
  salt: string;
}

function uniqueValues(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function buildLegacyDirCandidates(moduleDirname: string): string[] {
  const candidates = [moduleDirname, path.resolve(process.cwd(), 'dist-electron', 'main')];

  if (process.resourcesPath) {
    candidates.push(path.join(process.resourcesPath, 'app.asar', 'dist-electron', 'main'));
  }

  return uniqueValues(candidates);
}

/** Secure scrypt parameters for new key derivation. */
const SCRYPT_MAXMEM_HEADROOM = 1024 * 1024;

function createScryptOptions(N: number, r: number, p: number): crypto.ScryptOptions {
  return {
    N,
    r,
    p,
    maxmem: 128 * N * r + SCRYPT_MAXMEM_HEADROOM,
  };
}

export const SECURE_SCRYPT_OPTIONS: crypto.ScryptOptions = createScryptOptions(65536, 8, 1);

/** Legacy scrypt parameters — Node.js defaults used by earlier releases. */
export const LEGACY_SCRYPT_OPTIONS: crypto.ScryptOptions = createScryptOptions(16384, 8, 1);

function deriveKeyBuffer(
  seed: string,
  salt: string,
  options: crypto.ScryptOptions = SECURE_SCRYPT_OPTIONS
): Buffer {
  return crypto.scryptSync(seed, salt, 32, options);
}

function deriveKeyHex(seed: string, salt: string, options?: crypto.ScryptOptions): string {
  return deriveKeyBuffer(seed, salt, options).toString('hex');
}

function isLikelyKeyMismatch(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /\bUnexpected token\b|\bvalid JSON\b|\bbad decrypt\b|\bdecrypt\b|\bJSON\b/i.test(message);
}

function buildBackupPath(storePath: string, reason: string = 'pre-key-rotation'): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `${storePath}.${reason}-${timestamp}.bak`;
}

function resolveStoreName<T extends Record<string, unknown>>(
  storeOptions: StoreOptions<T>
): string {
  return typeof storeOptions.name === 'string' && storeOptions.name.trim()
    ? storeOptions.name.trim()
    : 'config';
}

function resolveStorePath<T extends Record<string, unknown>>(
  storeOptions: StoreOptions<T> & { projectName?: string }
): string | null {
  const name = resolveStoreName(storeOptions);

  const explicitCwd = (storeOptions as { cwd?: string }).cwd;
  if (typeof explicitCwd === 'string' && explicitCwd.trim()) {
    return path.join(path.resolve(explicitCwd), `${name}.json`);
  }

  try {
    if (app && typeof app.getPath === 'function') {
      const userDataPath = app.getPath('userData');
      if (userDataPath?.trim()) {
        return path.join(userDataPath, `${name}.json`);
      }
    }
  } catch {
    // Fall back to letting electron-store resolve the path itself.
  }

  return null;
}

function moveUnreadableStoreToBackup(storePath: string): string {
  const backupPath = buildBackupPath(storePath, 'unreadable-recovery');

  try {
    fs.renameSync(storePath, backupPath);
    return backupPath;
  } catch {
    fs.copyFileSync(storePath, backupPath);
    fs.unlinkSync(storePath);
    return backupPath;
  }
}

function listUnreadableRecoveryBackups(storePath: string): string[] {
  const dir = path.dirname(storePath);
  const baseName = path.basename(storePath);
  const prefix = `${baseName}.unreadable-recovery-`;

  try {
    return fs
      .readdirSync(dir)
      .filter((file) => file.startsWith(prefix) && file.endsWith('.bak'))
      .map((file) => path.join(dir, file))
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  } catch {
    return [];
  }
}

function tryReadPlainTextStoreSnapshot<T extends Record<string, unknown>>(
  storePath: string,
  defaults: T
): T | null {
  try {
    const dir = path.dirname(storePath);
    const name = path.basename(storePath, '.json');
    const plainStore = new Store<T>({
      name,
      cwd: dir,
      defaults,
    });
    if (plainStore.path !== storePath) {
      return null;
    }
    return plainStore.store as T;
  } catch {
    return null;
  }
}

function readEncryptedStoreSnapshot<T extends Record<string, unknown>>(
  storePath: string,
  encryptionKey: string,
  storeOptions: StoreOptions<T>
): T | null {
  const dir = path.dirname(storePath);
  const storeName = resolveStoreName(storeOptions);
  const tempName = `${storeName}.recovery-read`;
  const tempPath = path.join(dir, `${tempName}.json`);

  try {
    fs.copyFileSync(storePath, tempPath);
    const store = new Store<T>({
      ...(storeOptions as StoreOptions<T>),
      cwd: dir,
      name: tempName,
      encryptionKey,
    });
    return store.store as T;
  } catch (error) {
    if (!isLikelyKeyMismatch(error)) {
      throw error;
    }
    return null;
  } finally {
    try {
      if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);
      }
    } catch {
      // Best-effort cleanup.
    }
  }
}

function writeEncryptedStoreSnapshot<T extends Record<string, unknown>>(
  snapshot: T,
  stableKey: string,
  storeOptions: StoreOptions<T> & { projectName?: string }
): Store<T> {
  const storeName = resolveStoreName(storeOptions);
  const storePath = resolveStorePath(storeOptions);
  const migratingName = `${storeName}.migrating`;

  const migratingStore = new Store<T>({
    ...(storeOptions as StoreOptions<T>),
    name: migratingName,
    encryptionKey: stableKey,
  });
  migratingStore.store = snapshot;

  if (storePath) {
    fs.renameSync(migratingStore.path, storePath);
  }

  return new Store<T>({
    ...(storeOptions as StoreOptions<T>),
    encryptionKey: stableKey,
  });
}

function migrateLegacyEncryptedStore<T extends Record<string, unknown>>(
  snapshot: T,
  storePath: string,
  stableKey: string,
  storeOptions: StoreOptions<T> & { projectName?: string },
  logPrefix: string,
  log?: Logger
): Store<T> {
  let backupPath: string | null = null;
  if (fs.existsSync(storePath)) {
    backupPath = buildBackupPath(storePath);
    try {
      fs.renameSync(storePath, backupPath);
    } catch {
      fs.copyFileSync(storePath, backupPath);
      fs.unlinkSync(storePath);
    }
  }

  const stableStore = writeEncryptedStoreSnapshot(snapshot, stableKey, storeOptions);

  log?.(`${logPrefix} Migrating encrypted store to a stable key`, {
    storePath,
    backupPath,
  });

  return stableStore;
}

export function getLegacyDerivedKeyHexes(options: KeyMaterialOptions): string[] {
  return buildLegacyDirCandidates(options.moduleDirname).map((dir) =>
    deriveKeyHex(
      `${os.hostname()}:${dir}:${options.legacySeed}`,
      options.salt,
      LEGACY_SCRYPT_OPTIONS
    )
  );
}

export function getStableDerivedKeyBuffer(options: KeyMaterialOptions): Buffer {
  return deriveKeyBuffer(options.stableSeed, options.salt, SECURE_SCRYPT_OPTIONS);
}

export function getLegacyDerivedKeyBuffers(options: KeyMaterialOptions): Buffer[] {
  return buildLegacyDirCandidates(options.moduleDirname).map((dir) =>
    deriveKeyBuffer(
      `${os.hostname()}:${dir}:${options.legacySeed}`,
      options.salt,
      LEGACY_SCRYPT_OPTIONS
    )
  );
}

export function createEncryptedStoreWithKeyRotation<T extends Record<string, unknown>>(
  options: EncryptedStoreRotationOptions<T>
): Store<T> {
  const stableKey = options.stableKey;
  const legacyKeys = uniqueValues(options.legacyKeys);

  try {
    const stableStore = new Store<T>({
      ...(options.storeOptions as StoreOptions<T>),
      encryptionKey: stableKey,
    });
    return attemptRecoveryFromUnreadableBackups(stableStore, options, stableKey, legacyKeys);
  } catch (error) {
    if (!isLikelyKeyMismatch(error)) {
      throw error;
    }

    const failedAttempts: string[] = [
      `stable key: ${error instanceof Error ? error.message : String(error)}`,
    ];

    const storePath = resolveStorePath(options.storeOptions);
    if (storePath && fs.existsSync(storePath)) {
      const plainSnapshot = tryReadPlainTextStoreSnapshot(
        storePath,
        options.storeOptions.defaults as T
      );
      if (plainSnapshot) {
        options.log?.(`${options.logPrefix} Migrating plain-text store to machine encryption`, {
          storePath,
        });
        return migrateLegacyEncryptedStore(
          plainSnapshot,
          storePath,
          stableKey,
          options.storeOptions,
          options.logPrefix,
          options.log
        );
      }
    }

    for (const legacyKey of legacyKeys) {
      try {
        const legacyStore = new Store<T>({
          ...(options.storeOptions as StoreOptions<T>),
          encryptionKey: legacyKey,
        });
        const snapshot = legacyStore.store as T;
        const legacyStorePath = legacyStore.path;

        // electron-store reads the existing file on construction. The legacy blob
        // must be moved aside before opening the stable-key store.
        return migrateLegacyEncryptedStore(
          snapshot,
          legacyStorePath,
          stableKey,
          options.storeOptions,
          options.logPrefix,
          options.log
        );
      } catch (legacyError) {
        if (!isLikelyKeyMismatch(legacyError)) {
          throw legacyError;
        }
        failedAttempts.push(
          `legacy key: ${legacyError instanceof Error ? legacyError.message : String(legacyError)}`
        );
      }
    }

    if (storePath && fs.existsSync(storePath)) {
      const backupPath = moveUnreadableStoreToBackup(storePath);
      options.warn?.(
        `${options.logPrefix} Backed up unreadable encrypted store and recreated defaults`,
        { storePath, backupPath }
      );

      return new Store<T>({
        ...(options.storeOptions as StoreOptions<T>),
        encryptionKey: stableKey,
      });
    }

    const aggregated = failedAttempts.join('; ');
    options.warn?.(
      `${options.logPrefix} Failed to read encrypted store with all keys: ${aggregated}`
    );
    throw new Error(`${options.logPrefix} All decryption keys failed: ${aggregated}`);
  }
}

function attemptRecoveryFromUnreadableBackups<T extends Record<string, unknown>>(
  stableStore: Store<T>,
  options: EncryptedStoreRotationOptions<T>,
  stableKey: string,
  legacyKeys: string[]
): Store<T> {
  if (!options.recoverIfReset) {
    return stableStore;
  }

  const storePath = resolveStorePath(options.storeOptions);
  if (!storePath) {
    return stableStore;
  }

  const currentSnapshot = stableStore.store as T;
  for (const backupPath of listUnreadableRecoveryBackups(storePath)) {
    for (const legacyKey of legacyKeys) {
      const recovered = readEncryptedStoreSnapshot(backupPath, legacyKey, options.storeOptions);
      if (!recovered || !options.recoverIfReset(currentSnapshot, recovered)) {
        continue;
      }

      options.warn?.(
        `${options.logPrefix} Restoring encrypted store from unreadable-recovery backup`,
        { backupPath }
      );
      return writeEncryptedStoreSnapshot(recovered, stableKey, options.storeOptions);
    }
  }

  return stableStore;
}
