#!/usr/bin/env node
/**
 * Align latest.yml installer filename with the actual .exe uploaded to GitHub Releases.
 * electron-builder can emit Open-Cowork-*.exe in YAML while the artifact is Open.Cowork-*.exe.
 */
import fs from 'node:fs';
import path from 'node:path';

const releaseDir = process.argv[2] ?? 'release';
const ymlPath = path.join(releaseDir, 'latest.yml');

if (!fs.existsSync(ymlPath)) {
  console.error(`Missing ${ymlPath}`);
  process.exit(1);
}

const installer = fs
  .readdirSync(releaseDir)
  .filter((name) => name.endsWith('.exe') && !name.toLowerCase().includes('blockmap'))
  .sort()
  .at(-1);

if (!installer) {
  console.error(`No installer .exe found in ${releaseDir}`);
  process.exit(1);
}

let yml = fs.readFileSync(ymlPath, 'utf8');
const pathLine = `path: ${installer}`;
const urlLine = `  - url: ${installer}`;

if (!/^path: /m.test(yml)) {
  console.error('latest.yml missing path: field');
  process.exit(1);
}

yml = yml.replace(/^path: .+$/m, pathLine);
yml = yml.replace(/^(\s+- url: ).+$/m, urlLine);

fs.writeFileSync(ymlPath, yml);
console.log(`Synced latest.yml → ${installer}`);
