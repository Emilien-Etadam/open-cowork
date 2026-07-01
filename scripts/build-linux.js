#!/usr/bin/env node

const { spawnSync } = require('node:child_process');
const path = require('node:path');

const PROJECT_ROOT = path.join(__dirname, '..');

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: PROJECT_ROOT,
    stdio: 'inherit',
    shell: false,
    ...options,
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

if (process.platform !== 'linux') {
  console.error('[build-linux] This script must run on Linux.');
  process.exit(1);
}

run('npm', ['run', 'build:mcp']);
run('npx', ['tsc']);
run('npx', ['vite', 'build']);
run('npm', ['run', 'generate:icons']);
run('node', ['scripts/pre-build-check.js']);
run('npx', ['electron-builder', '--linux', 'AppImage', '--publish', 'never']);
