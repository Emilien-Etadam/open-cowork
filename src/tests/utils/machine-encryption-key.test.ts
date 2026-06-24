import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('getMachineEncryptionKey', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencowork-machine-key-'));
    vi.resetModules();
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.resetModules();
    vi.doUnmock('electron');
  });

  it('uses safeStorage when OS encryption is available', async () => {
    const encryptString = vi.fn((value: string) => Buffer.from(`enc:${value}`));
    const decryptString = vi.fn((value: Buffer) => value.toString().replace(/^enc:/, ''));

    vi.doMock('electron', () => ({
      app: {
        getPath: (name: string) => {
          if (name === 'userData') return tempDir;
          throw new Error(`Unexpected path: ${name}`);
        },
      },
      safeStorage: {
        isEncryptionAvailable: () => true,
        encryptString,
        decryptString,
      },
    }));

    const { getMachineEncryptionKey } = await import('../../main/utils/machine-encryption-key');
    const first = getMachineEncryptionKey();
    const second = getMachineEncryptionKey();

    expect(first).toHaveLength(64);
    expect(second).toBe(first);
    expect(fs.existsSync(path.join(tempDir, 'machine-encryption.key'))).toBe(
      encryptString.mock.calls.length > 0
    );
  });
});
