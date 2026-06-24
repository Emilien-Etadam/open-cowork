import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import type Store from 'electron-store';
import type { AppConfig } from './config-store';

interface ConfigMigrationState {
  win32SandboxDefault?: boolean;
}

function getMigrationFilePath(): string {
  return path.join(app.getPath('userData'), 'config-migrations.json');
}

function readMigrationState(): ConfigMigrationState {
  const filePath = getMigrationFilePath();
  if (!fs.existsSync(filePath)) {
    return {};
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as ConfigMigrationState;
  } catch {
    return {};
  }
}

function writeMigrationState(state: ConfigMigrationState): void {
  const filePath = getMigrationFilePath();
  fs.writeFileSync(filePath, JSON.stringify(state, null, 2));
}

/**
 * One-time migrations for persisted app config.
 */
export function runConfigMigrations(_store: Store<AppConfig>): void {
  if (process.platform !== 'win32') {
    return;
  }

  const state = readMigrationState();
  if (state.win32SandboxDefault) {
    return;
  }

  // Record migration without overriding an explicit user choice (sandboxEnabled=false).
  writeMigrationState({ ...state, win32SandboxDefault: true });
}
