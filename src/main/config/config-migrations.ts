import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import type Store from 'electron-store';
import type { AppConfig } from './config-schema';
import { log } from '../utils/logger';

interface ConfigMigrationState {
  win32SandboxDefault?: boolean;
  darwinSandboxDefault?: boolean;
  agentCliPath?: boolean;
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
export function runConfigMigrations(store: Store<AppConfig>): void {
  const state = readMigrationState();
  let nextState = { ...state };

  if (process.platform === 'win32' && !state.win32SandboxDefault) {
    nextState = { ...nextState, win32SandboxDefault: true };
  }

  if (process.platform === 'darwin' && !state.darwinSandboxDefault) {
    nextState = { ...nextState, darwinSandboxDefault: true };
  }

  if (!state.agentCliPath) {
    const current = store.store;
    if (!current.agentCliPath?.trim() && current.claudeCodePath?.trim()) {
      store.set('agentCliPath', current.claudeCodePath);
      log('[ConfigMigration] Copied claudeCodePath → agentCliPath');
    }
    nextState = { ...nextState, agentCliPath: true };
  }

  if (
    nextState.win32SandboxDefault !== state.win32SandboxDefault ||
    nextState.darwinSandboxDefault !== state.darwinSandboxDefault ||
    nextState.agentCliPath !== state.agentCliPath
  ) {
    writeMigrationState(nextState);
  }
}
