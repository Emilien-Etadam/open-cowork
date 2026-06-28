/**
 * @module main/runtime/skills-bundle-runtime
 *
 * On-demand download for heavy built-in skills (docx, pptx OOXML bundles).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { app } from 'electron';
import { log, logError } from '../utils/logger';
import {
  HEAVY_SKILLS,
  getLegacyBundledSkillsRoot,
  getOnDemandSkillsRoot,
  isHeavySkill,
} from '../skills/builtin-skills-paths';

export { HEAVY_SKILLS, getOnDemandSkillsRoot, isHeavySkill } from '../skills/builtin-skills-paths';

interface SkillsBundleRuntimeLib {
  HEAVY_SKILLS: string[];
  isSkillComplete: (skillRoot: string, skillName: string) => boolean;
  ensureSkillBundle: (options: {
    skillName: string;
    outputRoot: string;
    appVersion: string;
    devSourceRoot?: string | null;
    legacyBundledRoot?: string | null;
  }) => Promise<string>;
}

const ensurePromises = new Map<string, Promise<string>>();

async function loadSkillsBundleRuntimeLib(): Promise<SkillsBundleRuntimeLib> {
  const libPath = path.join(app.getAppPath(), 'scripts', 'lib', 'skills-bundle-runtime.mjs');
  return (await import(pathToFileURL(libPath).href)) as SkillsBundleRuntimeLib;
}

function getDevSkillsRoot(): string {
  return path.join(app.getAppPath(), '.claude', 'skills');
}

export function isHeavySkillReady(skillName: string): boolean {
  if (!isHeavySkill(skillName)) {
    return true;
  }
  const root = getOnDemandSkillsRoot();
  return fs.existsSync(path.join(root, skillName, 'SKILL.md'));
}

export function clearSkillsBundleCache(): void {
  ensurePromises.clear();
}

export async function ensureHeavySkill(skillName: string): Promise<string> {
  if (!isHeavySkill(skillName)) {
    throw new Error(`Not a heavy on-demand skill: ${skillName}`);
  }

  const existing = path.join(getOnDemandSkillsRoot(), skillName);
  if (fs.existsSync(path.join(existing, 'SKILL.md'))) {
    return existing;
  }

  const pending = ensurePromises.get(skillName);
  if (pending) {
    return pending;
  }

  const promise = (async () => {
    const lib = await loadSkillsBundleRuntimeLib();
    const outputRoot = getOnDemandSkillsRoot();
    fs.mkdirSync(outputRoot, { recursive: true });

    log(`[SkillsBundle] Ensuring heavy skill: ${skillName}`);
    const skillPath = await lib.ensureSkillBundle({
      skillName,
      outputRoot,
      appVersion: app.getVersion(),
      devSourceRoot: !app.isPackaged ? getDevSkillsRoot() : null,
      legacyBundledRoot: getLegacyBundledSkillsRoot(),
    });
    log(`[SkillsBundle] Ready: ${skillPath}`);
    return skillPath;
  })().catch((error) => {
    ensurePromises.delete(skillName);
    const message = error instanceof Error ? error.message : String(error);
    logError(`[SkillsBundle] Failed to ensure ${skillName}:`, message);
    throw error;
  });

  ensurePromises.set(skillName, promise);
  return promise;
}

export async function ensureHeavySkills(skillNames: string[] = [...HEAVY_SKILLS]): Promise<void> {
  const targets = skillNames.filter(isHeavySkill);
  await Promise.all(targets.map((skillName) => ensureHeavySkill(skillName)));
}

export function getHeavySkillsStatus(): {
  ready: boolean;
  pending: string[];
  version: string;
} {
  const pending = HEAVY_SKILLS.filter((name) => !isHeavySkillReady(name));
  return {
    ready: pending.length === 0,
    pending: [...pending],
    version: app.getVersion(),
  };
}

export function getSkillsBundleRuntimeLibPath(): string {
  return path.join(app.getAppPath(), 'scripts', 'lib', 'skills-bundle-runtime.mjs');
}
