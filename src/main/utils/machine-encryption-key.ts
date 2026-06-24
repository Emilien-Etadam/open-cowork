import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { app } from 'electron';
import { log, logWarn } from './logger';

const KEY_FILE_NAME = 'machine-encryption.key';
const FALLBACK_SALT = 'open-cowork-machine-key-v2';

let cachedKey: string | null = null;

type SafeStorageApi = {
  isEncryptionAvailable: () => boolean;
  encryptString: (plainText: string) => Buffer;
  decryptString: (encrypted: Buffer) => string;
};

function readSafeStorage(): SafeStorageApi | undefined {
  try {
    // Lazy require keeps vitest partial electron mocks working in unit tests.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const electron = require('electron') as { safeStorage?: Partial<SafeStorageApi> };
    const storage = electron.safeStorage;
    if (
      storage &&
      typeof storage.isEncryptionAvailable === 'function' &&
      typeof storage.encryptString === 'function' &&
      typeof storage.decryptString === 'function'
    ) {
      return storage as SafeStorageApi;
    }
  } catch {
    // Ignore partial electron mocks in unit tests.
  }
  return undefined;
}

function getKeyFilePath(): string {
  return path.join(app.getPath('userData'), KEY_FILE_NAME);
}

function deriveFallbackKey(): string {
  const seed = `${os.hostname()}:${app.getPath('userData')}:${FALLBACK_SALT}`;
  return crypto.scryptSync(seed, FALLBACK_SALT, 32).toString('hex');
}

/**
 * Returns a machine-bound encryption key for electron-store.
 *
 * Prefer Electron safeStorage (Windows Credential Manager / macOS Keychain).
 * Fall back to a userData-derived scrypt key when OS encryption is unavailable.
 */
export function getMachineEncryptionKey(): string {
  if (cachedKey) {
    return cachedKey;
  }

  const keyPath = getKeyFilePath();
  const safeStorage = readSafeStorage();
  const encryptionAvailable = Boolean(safeStorage?.isEncryptionAvailable());

  if (safeStorage && encryptionAvailable) {
    try {
      if (fs.existsSync(keyPath)) {
        const encrypted = fs.readFileSync(keyPath);
        cachedKey = safeStorage.decryptString(encrypted);
        return cachedKey;
      }

      const generated = crypto.randomBytes(32).toString('hex');
      fs.writeFileSync(keyPath, safeStorage.encryptString(generated));
      try {
        fs.chmodSync(keyPath, 0o600);
      } catch {
        // chmod is best-effort on Windows.
      }
      cachedKey = generated;
      log('[MachineEncryptionKey] Generated new OS-protected encryption key');
      return cachedKey;
    } catch (error) {
      logWarn('[MachineEncryptionKey] safeStorage key load failed, using fallback:', error);
    }
  } else {
    logWarn('[MachineEncryptionKey] OS encryption unavailable, using fallback derived key');
  }

  cachedKey = deriveFallbackKey();
  return cachedKey;
}

/** Legacy static keys kept for encrypted store rotation. */
export const LEGACY_STATIC_ENCRYPTION_KEYS = [
  'open-cowork-config-stable-v1',
  'open-cowork-remote-stable-v1',
] as const;
