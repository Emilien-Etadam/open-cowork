/**
 * Shared Python runtime download/extract utilities.
 * Used by scripts/prepare-python.js (dev/build) and the packaged app (on-demand).
 */
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

export const PYTHON_MINOR = process.env.OPEN_COWORK_PYTHON_MINOR || '3.10';
export const PYTHON_VERSION = process.env.OPEN_COWORK_PYTHON_VERSION || '3.10.19';
export const ABI = `cp${PYTHON_MINOR.replace('.', '')}`;
export const RUNTIME_VERSION_FILENAME = 'runtime-version.txt';

const GITHUB_REPO =
  process.env.OPEN_COWORK_PYTHON_STANDALONE_REPO || 'astral-sh/python-build-standalone';
const RELEASES_API = `https://api.github.com/repos/${GITHUB_REPO}/releases?per_page=30`;

export const BUNDLED_GUI_PACKAGES = ['pillow', 'pyobjc-framework-Quartz'];
const BUNDLED_RUNTIME_FINGERPRINT = BUNDLED_GUI_PACKAGES.join('|');

const DEFAULT_PYTHON_URLS =
  PYTHON_MINOR === '3.10'
    ? {
        'aarch64-apple-darwin':
          'https://github.com/astral-sh/python-build-standalone/releases/download/20260203/cpython-3.10.19+20260203-aarch64-apple-darwin-install_only.tar.gz',
        'x86_64-apple-darwin':
          'https://github.com/astral-sh/python-build-standalone/releases/download/20260203/cpython-3.10.19+20260203-x86_64-apple-darwin-install_only.tar.gz',
        'x86_64-unknown-linux-gnu':
          'https://github.com/astral-sh/python-build-standalone/releases/download/20260203/cpython-3.10.19+20260203-x86_64-unknown-linux-gnu-install_only.tar.gz',
      }
    : {};

export const TARGETS = {
  darwin: {
    arm64: {
      triple: 'aarch64-apple-darwin',
      platformTag: 'macosx_11_0_arm64',
      envUrlKey: 'OPEN_COWORK_PYTHON_STANDALONE_URL_DARWIN_ARM64',
    },
    x64: {
      triple: 'x86_64-apple-darwin',
      platformTag: 'macosx_11_0_x86_64',
      envUrlKey: 'OPEN_COWORK_PYTHON_STANDALONE_URL_DARWIN_X64',
    },
  },
  linux: {
    x64: {
      triple: 'x86_64-unknown-linux-gnu',
      platformTag: 'manylinux2014_x86_64',
      envUrlKey: 'OPEN_COWORK_PYTHON_STANDALONE_URL_LINUX_X64',
    },
  },
};

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

function download(url, dest) {
  return new Promise((resolve, reject) => {
    ensureDir(path.dirname(dest));
    const file = fs.createWriteStream(dest);

    const request = https.get(
      url,
      {
        headers: {
          'User-Agent': 'lygodactylus-runtime',
          Accept: '*/*',
        },
      },
      (response) => {
        if (response.statusCode === 301 || response.statusCode === 302) {
          const redirect = response.headers.location;
          file.close();
          if (exists(dest)) fs.unlinkSync(dest);
          return download(redirect, dest).then(resolve).catch(reject);
        }
        if (response.statusCode !== 200) {
          file.close();
          if (exists(dest)) fs.unlinkSync(dest);
          reject(new Error(`Download failed: ${response.statusCode} ${response.statusMessage}`));
          return;
        }
        response.pipe(file);
        file.on('finish', () => {
          file.close();
          resolve();
        });
      }
    );

    request.on('error', (err) => {
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

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    let data = '';
    const request = https.get(
      url,
      {
        headers: {
          'User-Agent': 'lygodactylus-runtime',
          Accept: 'application/vnd.github+json',
        },
      },
      (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          const redirect = res.headers.location;
          if (!redirect) {
            reject(new Error(`HTTP ${res.statusCode} redirect but no Location header for ${url}`));
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

function getStripComponentsForArchive(archivePath) {
  const isZst = archivePath.endsWith('.tar.zst');
  const listCmd = isZst ? `tar --zstd -tf "${archivePath}"` : `tar -tzf "${archivePath}"`;
  const list = execSync(listCmd, { encoding: 'utf8' }).split('\n');
  const python3Entry = list.find((p) => p.endsWith('/bin/python3'));
  if (!python3Entry) {
    throw new Error(`Could not locate bin/python3 in archive: ${archivePath}`);
  }
  const prefix = python3Entry.replace(/\/bin\/python3$/, '').replace(/\/$/, '');
  const parts = prefix.split('/').filter(Boolean);
  return parts.length;
}

function extractArchive(archivePath, destDir) {
  ensureDir(destDir);
  for (const entry of fs.readdirSync(destDir)) {
    fs.rmSync(path.join(destDir, entry), { recursive: true, force: true });
  }

  const isZst = archivePath.endsWith('.tar.zst');
  const strip = getStripComponentsForArchive(archivePath);
  const extractCmd = isZst
    ? `tar --zstd -xf "${archivePath}" -C "${destDir}" --strip-components=${strip}`
    : `tar -xzf "${archivePath}" -C "${destDir}" --strip-components=${strip}`;

  execSync(extractCmd, { stdio: 'inherit' });
}

function ensurePipAvailable(pythonBin) {
  try {
    execSync(`${JSON.stringify(pythonBin)} -m pip --version`, { stdio: 'ignore' });
  } catch {
    execSync(`${JSON.stringify(pythonBin)} -m ensurepip --upgrade`, { stdio: 'inherit' });
  }
}

export function resolveRuntimePaths(runtimeRoot) {
  const pythonPath = path.join(runtimeRoot, 'bin', 'python3');
  if (!exists(pythonPath)) {
    return null;
  }
  const sitePackages = path.join(runtimeRoot, 'site-packages');
  return {
    python: pythonPath,
    pythonRoot: runtimeRoot,
    sitePackages,
  };
}

export function isRuntimeComplete(runtimeRoot, { requireGuiPackages = false } = {}) {
  const paths = resolveRuntimePaths(runtimeRoot);
  if (!paths) {
    return false;
  }
  if (!requireGuiPackages) {
    return true;
  }
  const hasPillow = exists(path.join(paths.sitePackages, 'PIL'));
  const hasQuartz = exists(path.join(paths.sitePackages, 'Quartz'));
  return hasPillow && hasQuartz;
}

const SITE_PACKAGES_WHITELIST = new Set([
  'PIL',
  'Pillow',
  'Pillow.libs',
  'Quartz',
  'AppKit',
  'Foundation',
  'CoreFoundation',
  'objc',
  'PyObjCTools',
  'pyobjc_core',
  'pyobjc_framework_Cocoa',
  'pyobjc_framework_Quartz',
]);

function isWhitelistedSitePackage(name) {
  if (SITE_PACKAGES_WHITELIST.has(name)) return true;
  if (name.endsWith('.dist-info')) {
    const pkgName = name.replace(/-[\d].*$/, '');
    for (const w of SITE_PACKAGES_WHITELIST) {
      if (pkgName.toLowerCase() === w.toLowerCase()) return true;
      if (pkgName.toLowerCase().replace(/-/g, '_') === w.toLowerCase()) return true;
    }
  }
  return false;
}

export function cleanPythonRuntime(destDir, siteDir) {
  if (exists(siteDir)) {
    for (const entry of fs.readdirSync(siteDir)) {
      if (isWhitelistedSitePackage(entry)) continue;
      fs.rmSync(path.join(siteDir, entry), { recursive: true, force: true });
    }
  }

  try {
    execSync(`find "${destDir}" -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true`, {
      stdio: 'ignore',
    });
    execSync(`find "${destDir}" -name "*.pyc" -delete 2>/dev/null || true`, { stdio: 'ignore' });
  } catch {
    // ignore
  }

  const libDir = path.join(destDir, 'lib');
  const pythonLibDirs = exists(libDir)
    ? fs.readdirSync(libDir).filter((d) => d.startsWith('python'))
    : [];

  for (const pyDir of pythonLibDirs) {
    const stdlibDir = path.join(libDir, pyDir);
    for (const mod of ['test', 'idlelib', 'lib2to3', 'tkinter', 'pydoc_data', 'ensurepip']) {
      const modPath = path.join(stdlibDir, mod);
      if (exists(modPath)) {
        fs.rmSync(modPath, { recursive: true, force: true });
      }
    }
    try {
      for (const f of fs.readdirSync(stdlibDir).filter((name) => name.startsWith('turtle'))) {
        fs.rmSync(path.join(stdlibDir, f), { recursive: true, force: true });
      }
    } catch {
      // ignore
    }
  }

  if (exists(libDir)) {
    for (const d of fs.readdirSync(libDir).filter((name) => name.startsWith('tcl') || name.startsWith('tk'))) {
      fs.rmSync(path.join(libDir, d), { recursive: true, force: true });
    }
  }
}

export function installGuiPackages(siteDir, platformTag, pythonBin) {
  ensureDir(siteDir);
  const runtimeMarkerFile = path.join(path.resolve(siteDir, '..'), RUNTIME_VERSION_FILENAME);
  const runtimeMarker = exists(runtimeMarkerFile)
    ? fs.readFileSync(runtimeMarkerFile, 'utf-8').trim()
    : '';

  const hasPillow = exists(path.join(siteDir, 'PIL'));
  const hasQuartz = exists(path.join(siteDir, 'Quartz'));
  if (hasPillow && hasQuartz && runtimeMarker === BUNDLED_RUNTIME_FINGERPRINT) {
    return;
  }

  ensurePipAvailable(pythonBin);
  const cmd =
    `${JSON.stringify(pythonBin)} -m pip install --upgrade --no-input ` +
    `--target "${siteDir}" ` +
    `${BUNDLED_GUI_PACKAGES.map((pkg) => JSON.stringify(pkg)).join(' ')}`;

  execSync(cmd, { stdio: 'inherit' });
  fs.writeFileSync(runtimeMarkerFile, BUNDLED_RUNTIME_FINGERPRINT, 'utf-8');
}

export function installGuiPackagesCrossCompile(siteDir, platformTag, pipPython = process.env.OPEN_COWORK_PIP_PYTHON) {
  ensureDir(siteDir);
  const pythonRoot = path.resolve(siteDir, '..');
  const runtimeMarkerFile = path.join(pythonRoot, RUNTIME_VERSION_FILENAME);
  const runtimeMarker = exists(runtimeMarkerFile)
    ? fs.readFileSync(runtimeMarkerFile, 'utf-8').trim()
    : '';

  const hasPillow = exists(path.join(siteDir, 'PIL'));
  const hasQuartz = exists(path.join(siteDir, 'Quartz'));
  if (hasPillow && hasQuartz && runtimeMarker === BUNDLED_RUNTIME_FINGERPRINT) {
    return;
  }

  ensurePipAvailable(pipPython);
  const cmd =
    `${JSON.stringify(pipPython)} -m pip install --upgrade --no-input --only-binary=:all: ` +
    `--target "${siteDir}" ` +
    `--platform "${platformTag}" --python-version "${PYTHON_MINOR}" --implementation "cp" --abi "${ABI}" ` +
    `${BUNDLED_GUI_PACKAGES.map((pkg) => JSON.stringify(pkg)).join(' ')}`;

  execSync(cmd, { stdio: 'inherit' });
  fs.writeFileSync(runtimeMarkerFile, BUNDLED_RUNTIME_FINGERPRINT, 'utf-8');
}

async function findStandaloneAssetUrl(triple, envUrlKey) {
  const envUrl = process.env[envUrlKey];
  if (envUrl) {
    return envUrl;
  }

  const defaultUrl = DEFAULT_PYTHON_URLS[triple];
  if (defaultUrl) {
    return defaultUrl;
  }

  const releases = await fetchJson(RELEASES_API);
  if (!Array.isArray(releases)) {
    throw new Error(`Unexpected GitHub API response for ${RELEASES_API}`);
  }

  const wantedPrefix = `cpython-${PYTHON_MINOR}`;
  for (const rel of releases) {
    for (const asset of rel.assets || []) {
      const name = asset.name || '';
      const url = asset.browser_download_url || '';
      const ok =
        name.includes(wantedPrefix) &&
        name.includes(triple) &&
        name.includes('install_only') &&
        (name.endsWith('.tar.gz') || name.endsWith('.tar.zst')) &&
        url;
      if (ok) {
        return url;
      }
    }
  }

  throw new Error(
    `Could not find python-build-standalone asset for Python ${PYTHON_MINOR} (${triple}). ` +
      `Set ${envUrlKey} to override.`
  );
}

function resolveTarget(platform, arch) {
  const target = TARGETS[platform]?.[arch];
  if (!target) {
    throw new Error(`Unsupported platform for Python runtime: ${platform}-${arch}`);
  }
  return target;
}

/**
 * Download, extract, clean, and optionally install GUI packages for Python.
 */
export async function downloadAndPrepare({
  outputDir,
  platform = process.platform,
  arch = process.arch,
  flatLayout = false,
  installGuiDeps = platform === 'darwin',
  crossCompileGuiDeps = false,
}) {
  const target = resolveTarget(platform, arch);
  const extractDir = flatLayout ? outputDir : path.join(outputDir, `${platform}-${arch}`);
  const tempDir = `${extractDir}.tmp`;
  const siteDir = path.join(extractDir, 'site-packages');
  const requireGuiPackages = installGuiDeps && platform === 'darwin';

  if (isRuntimeComplete(extractDir, { requireGuiPackages })) {
    return extractDir;
  }

  if (exists(tempDir)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  ensureDir(outputDir);
  const url = await findStandaloneAssetUrl(target.triple, target.envUrlKey);
  const archiveName = path.basename(url);
  const archivePath = path.join(outputDir, archiveName);

  try {
    if (!exists(archivePath)) {
      await download(url, archivePath);
    }

    fs.mkdirSync(tempDir, { recursive: true });
    extractArchive(archivePath, tempDir);
    cleanPythonRuntime(tempDir, path.join(tempDir, 'site-packages'));

    if (installGuiDeps && platform === 'darwin') {
      if (crossCompileGuiDeps) {
        installGuiPackagesCrossCompile(path.join(tempDir, 'site-packages'), target.platformTag);
      } else {
        installGuiPackages(
          path.join(tempDir, 'site-packages'),
          target.platformTag,
          path.join(tempDir, 'bin', 'python3')
        );
      }
      cleanPythonRuntime(tempDir, path.join(tempDir, 'site-packages'));
    }

    if (exists(extractDir)) {
      fs.rmSync(extractDir, { recursive: true, force: true });
    }
    fs.renameSync(tempDir, extractDir);

    if (exists(archivePath)) {
      fs.unlinkSync(archivePath);
    }

    if (!isRuntimeComplete(extractDir, { requireGuiPackages })) {
      throw new Error('Python runtime extraction completed but binaries are missing');
    }

    return extractDir;
  } catch (error) {
    if (exists(archivePath)) {
      try {
        fs.unlinkSync(archivePath);
      } catch {
        // ignore
      }
    }
    if (exists(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    throw error;
  }
}
