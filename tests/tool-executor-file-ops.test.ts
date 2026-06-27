import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ToolExecutor } from '../src/main/tools/tool-executor';

describe('ToolExecutor file operations', () => {
  let workspaceDir: string;
  let executor: ToolExecutor;

  const mockPathResolver = {
    getMounts: () => [{ real: workspaceDir, virtual: '/mnt/workspace' }],
    resolve: (_sessionId: string, virtualPath: string) => {
      if (virtualPath.startsWith('/mnt/workspace')) {
        return virtualPath.replace('/mnt/workspace', workspaceDir);
      }
      return null;
    },
  };

  beforeEach(() => {
    workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tool-executor-workspace-'));
    executor = new ToolExecutor(mockPathResolver as never);
  });

  afterEach(() => {
    fs.rmSync(workspaceDir, { recursive: true, force: true });
  });

  it('writes and reads a file inside the workspace', async () => {
    await executor.writeFile('s1', 'notes/hello.txt', 'bonjour');
    await expect(executor.readFile('s1', 'notes/hello.txt')).resolves.toBe('bonjour');
  });

  it('lists directory entries with sizes', async () => {
    fs.mkdirSync(path.join(workspaceDir, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(workspaceDir, 'docs', 'readme.md'), 'hello');
    const listing = await executor.listDirectory('s1', 'docs');
    expect(listing).toContain('[FILE] readme.md');
    expect(listing).toMatch(/KB|B\)/);
  });

  it('rejects reads outside the mounted workspace', async () => {
    await expect(executor.readFile('s1', '/etc/passwd')).rejects.toThrow(/Failed to read file/);
  });
});
