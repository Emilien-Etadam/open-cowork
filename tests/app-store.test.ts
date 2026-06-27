import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function registerStoreMocks(userDataPath: string, machineKey: string): void {
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

  vi.doMock('../src/main/utils/machine-encryption-key', () => ({
    getMachineEncryptionKey: () => machineKey,
    LEGACY_STATIC_ENCRYPTION_KEYS: [],
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
          const parsed = JSON.parse(raw) as
            | Record<string, unknown>
            | { key?: string; payload?: Record<string, unknown> };

          if (this.encryptionKey) {
            const encrypted =
              parsed &&
              typeof parsed === 'object' &&
              'key' in parsed &&
              'payload' in parsed &&
              typeof parsed.payload === 'object';

            if (!encrypted) {
              throw new SyntaxError("Unexpected token '�', \"�...\" is not valid JSON");
            }

            if (parsed.key !== this.encryptionKey) {
              throw new SyntaxError("Unexpected token '�', \"�...\" is not valid JSON");
            }

            this.internalStore = {
              ...this.defaults,
              ...(parsed.payload || {}),
            };
            return;
          }

          this.internalStore = {
            ...this.defaults,
            ...(parsed as Record<string, unknown>),
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
        if (this.encryptionKey) {
          fs.writeFileSync(
            this.path,
            JSON.stringify({
              key: this.encryptionKey,
              payload: value,
            })
          );
          return;
        }
        fs.writeFileSync(this.path, JSON.stringify(value));
      }

      get(key: string, defaultValue?: unknown): unknown {
        return this.internalStore[key] ?? defaultValue;
      }

      set(key: string, value: unknown): void {
        this.internalStore[key] = value;
        this.store = this.internalStore;
      }
    }

    return {
      default: MockStore,
    };
  });
}

describe('createAppEncryptedStore', () => {
  let tempDir: string;
  let machineKey: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'app-store-test-'));
    machineKey = crypto.randomBytes(32).toString('hex');
    vi.resetModules();
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('migrates a legacy plain-text store without data loss', async () => {
    const storePath = path.join(tempDir, 'mcp-config.json');
    fs.writeFileSync(
      storePath,
      JSON.stringify({
        servers: [{ id: 'notion-1', name: 'Notion', type: 'stdio', enabled: true }],
      })
    );

    registerStoreMocks(tempDir, machineKey);
    const { createAppEncryptedStore } = await import('../src/main/utils/app-store');

    const store = createAppEncryptedStore<{ servers: Array<Record<string, unknown>> }>({
      name: 'mcp-config',
      defaults: { servers: [] },
      logPrefix: '[TestMCPConfigStore]',
    });

    expect(store.get('servers')).toHaveLength(1);
    expect(store.get('servers')?.[0]).toMatchObject({ id: 'notion-1' });

    const raw = JSON.parse(fs.readFileSync(store.path, 'utf8')) as {
      key?: string;
      payload?: { servers: unknown[] };
    };
    expect(raw.key).toBe(machineKey);
    expect(raw.payload?.servers).toHaveLength(1);
  });

  it('creates a new encrypted store when no file exists', async () => {
    registerStoreMocks(tempDir, machineKey);
    const { createAppEncryptedStore } = await import('../src/main/utils/app-store');

    const store = createAppEncryptedStore<{ token: string }>({
      name: 'chat-lan-config',
      defaults: { token: 'generated-token' },
      logPrefix: '[TestChatLanConfigStore]',
    });

    expect(store.get('token')).toBe('generated-token');
    store.set('token', 'generated-token');
    expect(fs.existsSync(store.path)).toBe(true);
  });
});
