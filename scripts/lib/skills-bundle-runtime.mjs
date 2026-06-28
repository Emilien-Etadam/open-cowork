/**
 * Shared heavy skill bundle download/extract utilities.
 * Used by scripts/prepare-skill-bundles.mjs and the packaged app (on-demand).
 */
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

export const HEAVY_SKILLS = ['docx', 'pptx'];
export const LIGHT_SKILLS = ['pdf', 'xlsx', 'skill-creator'];

const GITHUB_OWNER = process.env.LYGODACTYLUS_GITHUB_OWNER || 'Emilien-Etadam';
const GITHUB_REPO = process.env.LYGODACTYLUS_GITHUB_REPO || 'lygodactylus';

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

export function isSkillComplete(skillRoot, skillName) {
  return exists(path.join(skillRoot, skillName, 'SKILL.md'));
}

export function resolveSkillBundleUrl(skillName, appVersion) {
  return `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/download/v${appVersion}/lygodactylus-skill-${skillName}-v${appVersion}.tar.gz`;
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
          reject(new Error(`Download failed (${response.statusCode}): ${url}`));
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

function extractArchive(archivePath, outputRoot) {
  ensureDir(outputRoot);
  execSync(`tar -xzf "${archivePath}" -C "${outputRoot}"`, { stdio: 'inherit' });
}

function copyDirectorySync(source, target) {
  ensureDir(target);
  for (const entry of fs.readdirSync(source)) {
    const sourcePath = path.join(source, entry);
    const targetPath = path.join(target, entry);
    const stat = fs.statSync(sourcePath);
    if (stat.isDirectory()) {
      copyDirectorySync(sourcePath, targetPath);
    } else {
      fs.copyFileSync(sourcePath, targetPath);
    }
  }
}

function tryCopyFromCandidates(skillName, outputRoot, candidates) {
  for (const candidateRoot of candidates) {
    if (!candidateRoot) continue;
    const sourcePath = path.join(candidateRoot, skillName);
    if (!isSkillComplete(candidateRoot, skillName)) continue;
    const targetPath = path.join(outputRoot, skillName);
    if (exists(targetPath)) {
      fs.rmSync(targetPath, { recursive: true, force: true });
    }
    copyDirectorySync(sourcePath, targetPath);
    return targetPath;
  }
  return null;
}

/**
 * Ensure a heavy skill is present under outputRoot/{skillName}.
 */
export async function ensureSkillBundle({
  skillName,
  outputRoot,
  appVersion,
  devSourceRoot = null,
  legacyBundledRoot = null,
}) {
  if (!HEAVY_SKILLS.includes(skillName)) {
    throw new Error(`Not a heavy on-demand skill: ${skillName}`);
  }

  if (isSkillComplete(outputRoot, skillName)) {
    return path.join(outputRoot, skillName);
  }

  ensureDir(outputRoot);

  const copied = tryCopyFromCandidates(skillName, outputRoot, [
    devSourceRoot,
    legacyBundledRoot,
  ]);
  if (copied) {
    return copied;
  }

  const archivePath = path.join(outputRoot, `.downloads`, `lygodactylus-skill-${skillName}-v${appVersion}.tar.gz`);
  const url = resolveSkillBundleUrl(skillName, appVersion);

  try {
    await download(url, archivePath);
    extractArchive(archivePath, outputRoot);
    if (exists(archivePath)) {
      fs.unlinkSync(archivePath);
    }
  } catch (error) {
    if (exists(archivePath)) {
      try {
        fs.unlinkSync(archivePath);
      } catch {
        // ignore
      }
    }
    throw error;
  }

  if (!isSkillComplete(outputRoot, skillName)) {
    throw new Error(`Skill bundle extraction completed but ${skillName}/SKILL.md is missing`);
  }

  return path.join(outputRoot, skillName);
}
