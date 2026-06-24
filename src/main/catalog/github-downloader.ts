import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { log } from '../utils/logger';

const execFileAsync = promisify(execFile);

export async function downloadGithubSubdir(
  repo: string,
  subdir: string,
  ref: string
): Promise<string> {
  const [owner, name] = repo.split('/');
  if (!owner || !name) {
    throw new Error(`Invalid GitHub repo: ${repo}`);
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'opencowork-plugin-'));
  const archivePath = path.join(tempRoot, 'archive.tar.gz');
  const extractDir = path.join(tempRoot, 'extracted');
  fs.mkdirSync(extractDir, { recursive: true });

  const archiveUrl = `https://codeload.github.com/${owner}/${name}/tar.gz/${encodeURIComponent(ref)}`;
  const response = await fetch(archiveUrl);
  if (!response.ok) {
    throw new Error(`Failed to download GitHub archive (${response.status})`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(archivePath, buffer);

  await execFileAsync('tar', ['-xzf', archivePath, '-C', extractDir], {
    maxBuffer: 20 * 1024 * 1024,
  });

  const extractedRoots = fs.readdirSync(extractDir);
  if (extractedRoots.length === 0) {
    throw new Error('GitHub archive was empty');
  }

  const repoRoot = path.join(extractDir, extractedRoots[0]);
  const pluginPath = path.join(repoRoot, subdir);
  if (!fs.existsSync(pluginPath) || !fs.statSync(pluginPath).isDirectory()) {
    throw new Error(`Plugin subdirectory not found: ${subdir}`);
  }

  const targetDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencowork-plugin-copy-'));
  await copyDirectory(pluginPath, targetDir);
  log('[GithubDownloader] Prepared plugin directory:', targetDir);
  return targetDir;
}

async function copyDirectory(source: string, target: string): Promise<void> {
  fs.mkdirSync(target, { recursive: true });
  const entries = fs.readdirSync(source, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = path.join(source, entry.name);
    const targetPath = path.join(target, entry.name);
    if (entry.isDirectory()) {
      await copyDirectory(sourcePath, targetPath);
    } else if (entry.isFile()) {
      fs.copyFileSync(sourcePath, targetPath);
    }
  }
}
