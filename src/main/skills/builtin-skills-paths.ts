/**
 * @module main/skills/builtin-skills-paths
 *
 * Centralized resolution for built-in skill directories (light bundled + on-demand heavy).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { app } from 'electron';
import { log, logWarn } from '../utils/logger';

// No proprietary heavy skills are bundled or downloaded. Kept as an empty list
// so the on-demand skill machinery stays type-safe but inert.
export const HEAVY_SKILLS = [] as const;

export type HeavySkillName = (typeof HEAVY_SKILLS)[number];

function physicalDirExists(dirPath: string): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const originalFs = require('original-fs') as typeof import('fs');
    return originalFs.existsSync(dirPath) && originalFs.statSync(dirPath).isDirectory();
  } catch {
    return false;
  }
}

export function getLegacyBundledSkillsRoot(): string | null {
  if (!app.isPackaged) {
    return null;
  }
  const legacyRoot = path.join(process.resourcesPath, 'skills');
  const hasHeavySkill = HEAVY_SKILLS.some((name) =>
    fs.existsSync(path.join(legacyRoot, name, 'SKILL.md'))
  );
  return hasHeavySkill ? legacyRoot : null;
}

export function getOnDemandSkillsRoot(): string {
  return path.join(app.getPath('userData'), 'runtimes', 'skills', app.getVersion());
}

export function isHeavySkill(skillName: string): skillName is HeavySkillName {
  return (HEAVY_SKILLS as readonly string[]).includes(skillName);
}

function isHeavySkillBundled(skillsRoot: string): boolean {
  return HEAVY_SKILLS.some((name) => fs.existsSync(path.join(skillsRoot, name, 'SKILL.md')));
}

/**
 * Lightweight skills shipped in the installer (pdf, xlsx, skill-creator).
 */
export function getBundledLightSkillsPath(): string {
  if (!app.isPackaged) {
    const devPath = path.join(app.getAppPath(), '.claude', 'skills');
    if (fs.existsSync(devPath)) {
      log('[BuiltinSkills] Found dev skills at:', devPath);
      return devPath;
    }
  }

  const appPath = app.getAppPath();
  const unpackedPath = appPath.replace(/\.asar$/, '.asar.unpacked');

  const candidates = [
    path.join(process.resourcesPath || '', 'skills'),
    path.join(app.getPath('userData'), 'resources', 'skills-core'),
    ...(physicalDirExists(path.join(unpackedPath, '.claude', 'skills'))
      ? [path.join(unpackedPath, '.claude', 'skills')]
      : []),
    path.join(appPath, '.claude', 'skills'),
  ];

  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;
    if (isHeavySkillBundled(candidate)) {
      continue;
    }
    log('[BuiltinSkills] Found light bundled skills at:', candidate);
    return candidate;
  }

  logWarn('[BuiltinSkills] No light bundled skills directory found');
  return '';
}

/**
 * All roots that may contain built-in skill folders.
 */
export function listBuiltinSkillRoots(): string[] {
  const roots = new Set<string>();
  const light = getBundledLightSkillsPath();
  if (light) roots.add(light);

  const onDemand = getOnDemandSkillsRoot();
  if (fs.existsSync(onDemand)) roots.add(onDemand);

  const legacy = getLegacyBundledSkillsRoot();
  if (legacy) roots.add(legacy);

  return [...roots];
}

/**
 * Primary built-in skills path (backward compatible — light bundle only).
 */
export function getBuiltinSkillsPath(): string {
  return getBundledLightSkillsPath();
}

export function resolveBuiltinSkillPath(skillName: string): string | null {
  for (const root of listBuiltinSkillRoots()) {
    const candidate = path.join(root, skillName);
    if (fs.existsSync(path.join(candidate, 'SKILL.md'))) {
      return candidate;
    }
  }
  return null;
}

export function listBuiltinSkillNames(): string[] {
  const names = new Set<string>();
  for (const root of listBuiltinSkillRoots()) {
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (fs.existsSync(path.join(root, entry.name, 'SKILL.md'))) {
        names.add(entry.name);
      }
    }
  }
  return [...names].sort();
}

export function isBuiltinHeavySkill(skillName: string): boolean {
  return isHeavySkill(skillName);
}
