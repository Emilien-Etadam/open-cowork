/**
 * Shared Node.js runtime download/extract utilities.
 * Used by scripts/download-node.js (dev/build) and the packaged app (on-demand).
 */
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

export const NODE_VERSION = 'v22.22.0';

export const PLATFORMS = {
  darwin: {
    arm64: `node-${NODE_VERSION}-darwin-arm64`,
    x64: `node-${NODE_VERSION}-darwin-x64`,
  },
  win32: {
    x64: `node-${NODE_VERSION}-win-x64`,
  },
  linux: {
    x64: `node-${NODE_VERSION}-linux-x64`,
  },
};

const BASE_URL = 'https://nodejs.org/dist';
const WINDOWS_UNLINK_RETRY_COUNT = 8;
const WINDOWS_UNLINK_RETRY_DELAY_MS = 500;

/**
 * Fix npx in bundled Node: replace broken bin/npx with a wrapper using bundled node.
 */
export function applyNpxFix(extractDir) {
  const npxBinPath = path.join(extractDir, 'bin', 'npx');
  const realNpxCli = path.join(extractDir, 'lib', 'node_modules', 'npm', 'bin', 'npx-cli.js');

  if (!fs.existsSync(realNpxCli)) {
    return;
  }

  const current = fs.existsSync(npxBinPath) ? fs.readFileSync(npxBinPath, 'utf8') : '';
  if (current.includes('npx-wrapper-fix')) {
    return;
  }

  const isSymlink = fs.existsSync(npxBinPath) && fs.lstatSync(npxBinPath).isSymbolicLink();
  if (isSymlink) {
    fs.unlinkSync(npxBinPath);
  }

  const isWindows = extractDir.includes('win32') || extractDir.includes('win-x');
  if (isWindows) {
    const cmdPath = `${npxBinPath}.cmd`;
    const cmd = `@echo off\r\nrem npx-wrapper-fix\r\n"%~dp0node.exe" "%~dp0..\\lib\\node_modules\\npm\\bin\\npx-cli.js" %*\r\n`;
    fs.writeFileSync(cmdPath, cmd);
  } else {
    const wrapper = `#!/bin/sh
# npx-wrapper-fix
DIR="$(cd "$(dirname "$0")" && pwd)"
exec "$DIR/node" "$DIR/../lib/node_modules/npm/bin/npx-cli.js" "$@"
`;
    fs.writeFileSync(npxBinPath, wrapper);
    fs.chmodSync(npxBinPath, 0o755);
  }
}

export function resolveRuntimeBinaries(runtimeRoot) {
  const platform = process.platform;
  const binDir = platform === 'win32' ? runtimeRoot : path.join(runtimeRoot, 'bin');
  const nodePath = path.join(binDir, platform === 'win32' ? 'node.exe' : 'node');
  const npxPath = path.join(binDir, platform === 'win32' ? 'npx.cmd' : 'npx');
  if (fs.existsSync(nodePath) && fs.existsSync(npxPath)) {
    return { node: nodePath, npx: npxPath };
  }
  return null;
}

export function isRuntimeComplete(runtimeRoot) {
  return resolveRuntimeBinaries(runtimeRoot) !== null;
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function removeFileWithRetries(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  for (let attempt = 1; attempt <= WINDOWS_UNLINK_RETRY_COUNT; attempt += 1) {
    try {
      fs.unlinkSync(filePath);
      return;
    } catch (error) {
      const isRetryableWindowsError =
        process.platform === 'win32' &&
        (error.code === 'EPERM' || error.code === 'EBUSY' || error.code === 'ENOTEMPTY');
      if (!isRetryableWindowsError || attempt === WINDOWS_UNLINK_RETRY_COUNT) {
        throw error;
      }
      sleepSync(WINDOWS_UNLINK_RETRY_DELAY_MS);
    }
  }
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https
      .get(url, (response) => {
        if (response.statusCode === 302 || response.statusCode === 301) {
          file.close();
          download(response.headers.location, dest).then(resolve).catch(reject);
          return;
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
      })
      .on('error', (err) => {
        fs.unlink(dest, () => {});
        reject(err);
      });
  });
}

function cleanupExtractedRuntime(extractDir) {
  const CLEANUP_DIRS = ['include', 'share'];
  const CLEANUP_FILES = ['CHANGELOG.md', 'README.md'];
  const CLEANUP_NPM_DIRS = ['docs', 'man'];

  for (const dir of CLEANUP_DIRS) {
    const dirPath = path.join(extractDir, dir);
    if (fs.existsSync(dirPath)) {
      fs.rmSync(dirPath, { recursive: true, force: true });
    }
  }
  for (const file of CLEANUP_FILES) {
    const filePath = path.join(extractDir, file);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }
  const npmDir = path.join(extractDir, 'lib', 'node_modules', 'npm');
  if (fs.existsSync(npmDir)) {
    for (const sub of CLEANUP_NPM_DIRS) {
      const subPath = path.join(npmDir, sub);
      if (fs.existsSync(subPath)) {
        fs.rmSync(subPath, { recursive: true, force: true });
      }
    }
  }
}

function extractArchive({ archivePath, extractDir, platform, nodeName }) {
  fs.mkdirSync(extractDir, { recursive: true });

  if (platform === 'win32') {
    if (process.platform === 'win32') {
      execSync(
        `powershell -Command "Expand-Archive -Path '${archivePath}' -DestinationPath '${extractDir}' -Force"`,
        { stdio: 'inherit' }
      );
    } else {
      execSync(`unzip -q "${archivePath}" -d "${extractDir}"`, { stdio: 'inherit' });
    }
    const innerDir = path.join(extractDir, nodeName);
    if (fs.existsSync(innerDir)) {
      for (const file of fs.readdirSync(innerDir)) {
        fs.renameSync(path.join(innerDir, file), path.join(extractDir, file));
      }
      fs.rmdirSync(innerDir);
    }
  } else {
    execSync(`tar -xzf "${archivePath}" -C "${extractDir}" --strip-components=1`, {
      stdio: 'inherit',
    });
  }
}

/**
 * Download and extract Node.js for the current (or specified) platform/arch.
 */
export async function downloadAndExtract({
  outputDir,
  platform = process.platform,
  arch = process.arch,
  flatLayout = false,
}) {
  const nodeName = PLATFORMS[platform]?.[arch];
  if (!nodeName) {
    throw new Error(`Unsupported platform for Node runtime: ${platform}-${arch}`);
  }

  const ext = platform === 'win32' ? 'zip' : 'tar.gz';
  const archiveName = `${nodeName}.${ext}`;
  const url = `${BASE_URL}/${NODE_VERSION}/${archiveName}`;
  const archivePath = path.join(outputDir, archiveName);
  const extractDir = flatLayout ? outputDir : path.join(outputDir, `${platform}-${arch}`);
  const tempDir = `${extractDir}.tmp`;

  fs.mkdirSync(outputDir, { recursive: true });

  if (isRuntimeComplete(extractDir)) {
    applyNpxFix(extractDir);
    return extractDir;
  }

  if (fs.existsSync(tempDir)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  try {
    await download(url, archivePath);
    fs.mkdirSync(tempDir, { recursive: true });
    extractArchive({ archivePath, extractDir: tempDir, platform, nodeName });
    cleanupExtractedRuntime(tempDir);
    applyNpxFix(tempDir);

    if (fs.existsSync(extractDir)) {
      fs.rmSync(extractDir, { recursive: true, force: true });
    }
    fs.renameSync(tempDir, extractDir);
    removeFileWithRetries(archivePath);

    if (!isRuntimeComplete(extractDir)) {
      throw new Error('Node runtime extraction completed but binaries are missing');
    }

    return extractDir;
  } catch (error) {
    removeFileWithRetries(archivePath);
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    throw error;
  }
}
