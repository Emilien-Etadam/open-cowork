#!/usr/bin/env node

/**
 * Copy lightweight built-in skills into resources/skills-core for packaging.
 * Heavy skills (docx, pptx) are downloaded on demand in packaged apps.
 */

const fs = require('node:fs');
const path = require('node:path');

const PROJECT_ROOT = path.join(__dirname, '..');
const SOURCE_ROOT = path.join(PROJECT_ROOT, '.claude', 'skills');
const OUTPUT_ROOT = path.join(PROJECT_ROOT, 'resources', 'skills-core');

const LIGHT_SKILLS = ['pdf', 'xlsx', 'skill-creator'];

function copyDirectorySync(source, target) {
  fs.mkdirSync(target, { recursive: true });
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

function main() {
  if (!fs.existsSync(SOURCE_ROOT)) {
    console.error(`[prepare:skills-core] Missing source directory: ${SOURCE_ROOT}`);
    process.exitCode = 1;
    return;
  }

  if (fs.existsSync(OUTPUT_ROOT)) {
    fs.rmSync(OUTPUT_ROOT, { recursive: true, force: true });
  }
  fs.mkdirSync(OUTPUT_ROOT, { recursive: true });

  for (const skillName of LIGHT_SKILLS) {
    const sourcePath = path.join(SOURCE_ROOT, skillName);
    const targetPath = path.join(OUTPUT_ROOT, skillName);
    if (!fs.existsSync(path.join(sourcePath, 'SKILL.md'))) {
      console.error(`[prepare:skills-core] Missing SKILL.md for ${skillName}`);
      process.exitCode = 1;
      return;
    }
    copyDirectorySync(sourcePath, targetPath);
    console.log(`[prepare:skills-core] ✓ ${skillName}`);
  }

  console.log(`[prepare:skills-core] Ready: ${OUTPUT_ROOT}`);
}

main();
