#!/usr/bin/env node

/**
 * Create tar.gz bundles for heavy on-demand skills (docx, pptx).
 * Uploaded to GitHub Releases alongside installers.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { HEAVY_SKILLS } from './lib/skills-bundle-runtime.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '..');
const SOURCE_ROOT = path.join(PROJECT_ROOT, '.claude', 'skills');
const OUTPUT_DIR = path.join(PROJECT_ROOT, 'release', 'skill-bundles');

function readAppVersion() {
  const pkg = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'package.json'), 'utf8'));
  return pkg.version;
}

function main() {
  const version = process.env.SKILL_BUNDLE_VERSION || readAppVersion();
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  for (const skillName of HEAVY_SKILLS) {
    const sourcePath = path.join(SOURCE_ROOT, skillName);
    if (!fs.existsSync(path.join(sourcePath, 'SKILL.md'))) {
      throw new Error(`Missing heavy skill source: ${sourcePath}`);
    }

    const archiveName = `lygodactylus-skill-${skillName}-v${version}.tar.gz`;
    const archivePath = path.join(OUTPUT_DIR, archiveName);
    if (fs.existsSync(archivePath)) {
      fs.unlinkSync(archivePath);
    }

    execSync(`tar -czf "${archivePath}" -C "${SOURCE_ROOT}" "${skillName}"`, {
      stdio: 'inherit',
    });
    console.log(`[prepare:skill-bundles] ✓ ${archiveName}`);
  }
}

main();
