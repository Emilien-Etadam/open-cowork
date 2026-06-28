/**
 * Shared GUI tools (cliclick) runtime utilities for macOS.
 * Used by scripts/prepare-gui-tools.js (dev/build) and the packaged app (on-demand).
 */
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export const CLICLICK_VERSION = '5.1';

const HOMEBREW_FORMULA_API = 'https://formulae.brew.sh/api/formula/cliclick.json';

function exists(p) {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function tryExecFile(cmd, args) {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch {
    return null;
  }
}

function detectBinaryArch(filePath) {
  const out = tryExecFile('/usr/bin/file', ['-b', filePath]);
  if (!out) return null;

  const hasArm64 = out.includes('arm64');
  const hasX64 = out.includes('x86_64');
  const isUniversal = out.includes('universal') || (hasArm64 && hasX64);

  if (isUniversal) return 'universal';
  if (hasArm64) return 'arm64';
  if (hasX64) return 'x64';
  return null;
}

export function resolveCliclickPath(runtimeRoot) {
  const cliclickPath = path.join(runtimeRoot, 'bin', 'cliclick');
  if (exists(cliclickPath)) {
    return cliclickPath;
  }
  return null;
}

export function isRuntimeComplete(runtimeRoot) {
  return resolveCliclickPath(runtimeRoot) !== null;
}

export function findSystemCliclick(arch = process.arch === 'arm64' ? 'arm64' : 'x64') {
  const candidates = new Set(['/opt/homebrew/bin/cliclick', '/usr/local/bin/cliclick']);
  const whichPath = tryExecFile('/usr/bin/which', ['cliclick']);
  if (whichPath) candidates.add(whichPath);

  for (const src of candidates) {
    if (!exists(src)) continue;
    const binaryArch = detectBinaryArch(src);
    if (!binaryArch) continue;
    if (binaryArch === 'universal' || binaryArch === arch) {
      return src;
    }
  }
  return null;
}

function copyExecutable(src, dest) {
  ensureDir(path.dirname(dest));
  fs.copyFileSync(src, dest);
  fs.chmodSync(dest, 0o755);
}

export function copyCliclickFromSystem(runtimeRoot, arch = process.arch === 'arm64' ? 'arm64' : 'x64') {
  const src = findSystemCliclick(arch);
  if (!src) {
    return null;
  }
  const dest = path.join(runtimeRoot, 'bin', 'cliclick');
  copyExecutable(src, dest);
  return dest;
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    let data = '';
    const request = https.get(
      url,
      {
        headers: {
          'User-Agent': 'lygodactylus-runtime',
          Accept: 'application/json',
        },
      },
      (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          const redirect = res.headers.location;
          if (!redirect) {
            reject(new Error(`HTTP ${res.statusCode} redirect but no Location header`));
            return;
          }
          return fetchJson(redirect).then(resolve).catch(reject);
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} for ${url}`));
          return;
        }
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(e);
          }
        });
      }
    );
    request.on('error', reject);
  });
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    ensureDir(path.dirname(dest));
    const file = fs.createWriteStream(dest);
    https
      .get(
        url,
        {
          headers: {
            'User-Agent': 'lygodactylus-runtime',
            Accept: '*/*',
          },
        },
        (response) => {
          if (response.statusCode === 301 || response.statusCode === 302) {
            file.close();
            return download(response.headers.location, dest).then(resolve).catch(reject);
          }
          if (response.statusCode !== 200) {
            file.close();
            reject(new Error(`Failed to download: ${response.statusCode}`));
            return;
          }
          response.pipe(file);
          file.on('finish', () => {
            file.close();
            resolve();
          });
        }
      )
      .on('error', (err) => {
        try {
          file.close();
          if (exists(dest)) fs.unlinkSync(dest);
        } catch {
          // ignore
        }
        reject(err);
      });
  });
}

function resolveHomebrewBottleUrl(arch) {
  return fetchJson(HOMEBREW_FORMULA_API).then((formula) => {
    const files = formula?.bottles?.stable?.files;
    if (!files || typeof files !== 'object') {
      throw new Error('Homebrew formula API did not return bottle files for cliclick');
    }

    const preferredKeys =
      arch === 'arm64'
        ? ['arm64_sequoia', 'arm64_sonoma', 'arm64_ventura', 'arm64_tahoe', 'arm64_monterey']
        : ['sequoia', 'sonoma', 'ventura', 'tahoe', 'monterey', 'big_sur'];

    for (const key of preferredKeys) {
      const url = files[key]?.url;
      if (url) return url;
    }

    for (const value of Object.values(files)) {
      if (value?.url) return value.url;
    }

    throw new Error('No Homebrew bottle URL found for cliclick');
  });
}

async function downloadFromHomebrewBottle(runtimeRoot, arch) {
  const bottleUrl = await resolveHomebrewBottleUrl(arch);
  const tempDir = `${runtimeRoot}.bottle.tmp`;
  const archivePath = path.join(tempDir, path.basename(new URL(bottleUrl).pathname));

  if (exists(tempDir)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
  ensureDir(tempDir);

  try {
    await download(bottleUrl, archivePath);
    execFileSync('tar', ['-xzf', archivePath, '-C', tempDir], { stdio: 'inherit' });

    const extractedCandidates = [
      path.join(tempDir, 'cliclick', '5.1', 'bin', 'cliclick'),
      path.join(tempDir, 'cliclick', 'bin', 'cliclick'),
    ];

    let extracted = null;
    for (const candidate of extractedCandidates) {
      if (exists(candidate)) {
        extracted = candidate;
        break;
      }
    }

    if (!extracted) {
      const matches = tryExecFile('/usr/bin/find', [tempDir, '-name', 'cliclick', '-type', 'f']);
      if (matches) {
        extracted = matches.split('\n').find(Boolean) || null;
      }
    }

    if (!extracted) {
      throw new Error('Could not locate cliclick binary inside Homebrew bottle');
    }

    const dest = path.join(runtimeRoot, 'bin', 'cliclick');
    copyExecutable(extracted, dest);
    return dest;
  } finally {
    if (exists(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }
}

/**
 * Ensure cliclick is available under runtimeRoot/bin/cliclick.
 */
export async function ensureCliclick({
  runtimeRoot,
  arch = process.arch === 'arm64' ? 'arm64' : 'x64',
}) {
  if (isRuntimeComplete(runtimeRoot)) {
    return resolveCliclickPath(runtimeRoot);
  }

  const copied = copyCliclickFromSystem(runtimeRoot, arch);
  if (copied) {
    return copied;
  }

  return downloadFromHomebrewBottle(runtimeRoot, arch);
}
