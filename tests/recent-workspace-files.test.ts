import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { listRecentWorkspaceFiles } from '../src/main/utils/recent-workspace-files';

/** Write a file and pin mtime/atime so tests do not depend on clock sleeps or FS timestamp granularity. */
async function writeFileWithMtime(
  filePath: string,
  content: string,
  mtimeMs: number
): Promise<void> {
  await fs.writeFile(filePath, content);
  const mtime = new Date(mtimeMs);
  await fs.utimes(filePath, mtime, mtime);
}

describe('listRecentWorkspaceFiles', () => {
  let rootDir: string;

  beforeEach(async () => {
    rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'open-cowork-recent-files-'));
  });

  afterEach(async () => {
    await fs.rm(rootDir, { recursive: true, force: true });
  });

  it('returns files created after the given timestamp', async () => {
    const sinceMs = Date.now();
    const filePath = path.join(rootDir, 'deck.pptx');
    await writeFileWithMtime(filePath, 'ppt', sinceMs + 1000);

    const files = await listRecentWorkspaceFiles(rootDir, sinceMs);

    expect(files.map((item) => path.basename(item.path))).toContain('deck.pptx');
  });

  it('ignores files inside excluded directories', async () => {
    const sinceMs = Date.now();
    await fs.mkdir(path.join(rootDir, 'node_modules'), { recursive: true });
    await writeFileWithMtime(
      path.join(rootDir, 'node_modules', 'ignored.txt'),
      'ignore',
      sinceMs + 1000
    );
    await writeFileWithMtime(path.join(rootDir, 'report.html'), 'ok', sinceMs + 1000);

    const files = await listRecentWorkspaceFiles(rootDir, sinceMs);

    expect(files.map((item) => path.basename(item.path))).toContain('report.html');
    expect(files.map((item) => path.basename(item.path))).not.toContain('ignored.txt');
  });

  it('ignores system metadata files like .DS_Store', async () => {
    const sinceMs = Date.now();
    await writeFileWithMtime(path.join(rootDir, '.DS_Store'), 'noise', sinceMs + 1000);
    await writeFileWithMtime(path.join(rootDir, 'slides.pptx'), 'ppt', sinceMs + 1000);

    const files = await listRecentWorkspaceFiles(rootDir, sinceMs);

    expect(files.map((item) => path.basename(item.path))).toContain('slides.pptx');
    expect(files.map((item) => path.basename(item.path))).not.toContain('.DS_Store');
  });

  it('ignores common temp, lock, and backup file patterns', async () => {
    const sinceMs = Date.now();
    const noiseFiles = [
      '._slides.pptx',
      '~$deck.pptx',
      '.~lock.deck.pptx#',
      'draft.md~',
      'report.tmp',
      'download.crdownload',
    ];

    for (const name of noiseFiles) {
      await writeFileWithMtime(path.join(rootDir, name), 'noise', sinceMs + 1000);
    }
    await writeFileWithMtime(path.join(rootDir, 'real-output.pdf'), 'pdf', sinceMs + 1000);

    const files = await listRecentWorkspaceFiles(rootDir, sinceMs);
    const names = files.map((item) => path.basename(item.path));

    expect(names).toContain('real-output.pdf');
    for (const name of noiseFiles) {
      expect(names).not.toContain(name);
    }
  });

  it('ignores cache directories like __pycache__', async () => {
    const sinceMs = Date.now();
    await fs.mkdir(path.join(rootDir, '__pycache__'), { recursive: true });
    await writeFileWithMtime(
      path.join(rootDir, '__pycache__', 'script.cpython-311.pyc'),
      'pyc',
      sinceMs + 1000
    );
    await writeFileWithMtime(path.join(rootDir, 'presentation.pptx'), 'ppt', sinceMs + 1000);

    const files = await listRecentWorkspaceFiles(rootDir, sinceMs);
    const names = files.map((item) => path.basename(item.path));

    expect(names).toContain('presentation.pptx');
    expect(names).not.toContain('script.cpython-311.pyc');
  });

  it('orders results by most recent change first', async () => {
    const sinceMs = Date.now() - 60_000;
    const older = path.join(rootDir, 'older.txt');
    const newer = path.join(rootDir, 'newer.txt');
    await writeFileWithMtime(older, '1', sinceMs + 1000);
    await writeFileWithMtime(newer, '2', sinceMs + 2000);

    const files = await listRecentWorkspaceFiles(rootDir, sinceMs);

    expect(files[0]?.path).toBe(newer);
    expect(files[1]?.path).toBe(older);
  });
});
