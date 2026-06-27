import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function registerStoreMocks(userDataPath: string): void {
  vi.doMock('electron', () => ({
    app: {
      getPath: (name: string) => {
        if (name !== 'userData') {
          throw new Error(`Unexpected path request: ${name}`);
        }
        return userDataPath;
      },
    },
  }));

  vi.doMock('electron-store', () => {
    class MockStore {
      public path: string;
      private internalStore: Record<string, unknown>;
      private readonly encryptionKey?: string;
      private readonly defaults: Record<string, unknown>;

      constructor(options: {
        name?: string;
        cwd?: string;
        defaults?: Record<string, unknown>;
        encryptionKey?: string;
      }) {
        const name = options.name || 'config';
        const baseDir = options.cwd ? path.resolve(options.cwd) : userDataPath;
        this.path = path.join(baseDir, `${name}.json`);
        this.defaults = { ...(options.defaults || {}) };
        this.encryptionKey = options.encryptionKey;

        if (fs.existsSync(this.path)) {
          const raw = fs.readFileSync(this.path, 'utf8');
          const parsed = JSON.parse(raw) as {
            key?: string;
            payload?: Record<string, unknown>;
          };

          if (parsed.key && parsed.key !== this.encryptionKey) {
            throw new SyntaxError('Unexpected token \'�\', "�..." is not valid JSON');
          }

          this.internalStore = {
            ...this.defaults,
            ...(parsed.payload || {}),
          };
          return;
        }

        this.internalStore = { ...this.defaults };
      }

      get store(): Record<string, unknown> {
        return this.internalStore;
      }

      set store(value: Record<string, unknown>) {
        this.internalStore = value;
        fs.writeFileSync(
          this.path,
          JSON.stringify({
            key: this.encryptionKey,
            payload: value,
          })
        );
      }
    }

    return {
      default: MockStore,
    };
  });
}

describe('createEncryptedStoreWithKeyRotation', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencowork-store-'));
    vi.resetModules();
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.resetModules();
    vi.doUnmock('electron');
    vi.doUnmock('electron-store');
  });

  it('backs up unreadable encrypted stores and recreates defaults', async () => {
    registerStoreMocks(tempDir);

    const storePath = path.join(tempDir, 'config.json');
    fs.writeFileSync(
      storePath,
      JSON.stringify({
        key: 'some-old-key',
        payload: {
          provider: 'openrouter',
          apiKey: 'legacy-secret',
        },
      })
    );

    const { createEncryptedStoreWithKeyRotation } =
      await import('../src/main/utils/store-encryption');
    const store = createEncryptedStoreWithKeyRotation<Record<string, unknown>>({
      stableKey: 'stable-key',
      legacyKeys: ['legacy-key-1', 'legacy-key-2'],
      storeOptions: {
        name: 'config',
        defaults: {
          provider: 'anthropic',
          apiKey: '',
        },
      },
      logPrefix: '[TestStore]',
    });

    expect(store.store).toEqual({
      provider: 'anthropic',
      apiKey: '',
    });

    const backups = fs
      .readdirSync(tempDir)
      .filter((file) => file.startsWith('config.json.unreadable-recovery-'));
    expect(backups).toHaveLength(1);
    expect(fs.existsSync(path.join(tempDir, backups[0]))).toBe(true);
    expect(fs.existsSync(storePath)).toBe(false);
  });

  it('migrates legacy encrypted stores to the stable key without wiping data', async () => {
    registerStoreMocks(tempDir);

    const storePath = path.join(tempDir, 'config.json');
    fs.writeFileSync(
      storePath,
      JSON.stringify({
        key: 'legacy-key',
        payload: {
          provider: 'openrouter',
          apiKey: 'legacy-secret',
          isConfigured: true,
        },
      })
    );

    const { createEncryptedStoreWithKeyRotation } =
      await import('../src/main/utils/store-encryption');
    const store = createEncryptedStoreWithKeyRotation<Record<string, unknown>>({
      stableKey: 'stable-key',
      legacyKeys: ['legacy-key'],
      storeOptions: {
        name: 'config',
        defaults: {
          provider: 'anthropic',
          apiKey: '',
          isConfigured: false,
        },
      },
      logPrefix: '[TestStore]',
    });

    expect(store.store).toEqual({
      provider: 'openrouter',
      apiKey: 'legacy-secret',
      isConfigured: true,
    });

    const onDisk = JSON.parse(fs.readFileSync(storePath, 'utf8')) as {
      key?: string;
      payload?: Record<string, unknown>;
    };
    expect(onDisk.key).toBe('stable-key');
    expect(onDisk.payload).toEqual({
      provider: 'openrouter',
      apiKey: 'legacy-secret',
      isConfigured: true,
    });

    const unreadableBackups = fs
      .readdirSync(tempDir)
      .filter((file) => file.startsWith('config.json.unreadable-recovery-'));
    expect(unreadableBackups).toHaveLength(0);
  });

  it('restores wiped stores from unreadable-recovery backups on startup', async () => {
    registerStoreMocks(tempDir);

    const storePath = path.join(tempDir, 'config.json');
    const backupPath = path.join(
      tempDir,
      'config.json.unreadable-recovery-2026-01-01T00-00-00-000Z.bak'
    );

    fs.writeFileSync(
      backupPath,
      JSON.stringify({
        key: 'legacy-key',
        payload: {
          provider: 'openrouter',
          apiKey: 'legacy-secret',
          isConfigured: true,
        },
      })
    );
    fs.writeFileSync(
      storePath,
      JSON.stringify({
        key: 'stable-key',
        payload: {
          provider: 'anthropic',
          apiKey: '',
          isConfigured: false,
        },
      })
    );

    const { createEncryptedStoreWithKeyRotation } =
      await import('../src/main/utils/store-encryption');
    const store = createEncryptedStoreWithKeyRotation<Record<string, unknown>>({
      stableKey: 'stable-key',
      legacyKeys: ['legacy-key'],
      storeOptions: {
        name: 'config',
        defaults: {
          provider: 'anthropic',
          apiKey: '',
          isConfigured: false,
        },
      },
      logPrefix: '[TestStore]',
      recoverIfReset: (current, recovered) =>
        current.isConfigured !== true && recovered.isConfigured === true,
    });

    expect(store.store).toEqual({
      provider: 'openrouter',
      apiKey: 'legacy-secret',
      isConfigured: true,
    });
  });

  it('sets maxmem high enough for secure scrypt derivation', async () => {
    registerStoreMocks(tempDir);

    const { SECURE_SCRYPT_OPTIONS } = await import('../src/main/utils/store-encryption');

    expect(() =>
      crypto.scryptSync('stable-seed', 'lygodactylus-salt', 32, SECURE_SCRYPT_OPTIONS)
    ).not.toThrow();
    expect(SECURE_SCRYPT_OPTIONS.maxmem).toBeGreaterThan(128 * 65536 * 8);
  });
});
