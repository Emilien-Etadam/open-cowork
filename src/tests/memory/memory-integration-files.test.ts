import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

function readProjectFile(relativePath: string): string {
  return readFileSync(path.resolve(process.cwd(), relativePath), 'utf8');
}

describe('memory integration wiring', () => {
  it('registers the memory extension in the main process and exposes IPC handlers', () => {
    const mainIndex = readProjectFile('src/main/index.ts');
    const ipcSource = readProjectFile('src/main/ipc/ipc-schedule-memory.ts');
    expect(mainIndex).toContain('new MemoryExtension(mainAppState.memoryService)');
    expect(ipcSource).toContain("ipcMain.handle('memory.getOverview'");
    expect(ipcSource).toContain("'memory.search'");
    expect(ipcSource).toContain("'memory.listFiles'");
    expect(ipcSource).toContain("'memory.inspectSession'");
    expect(ipcSource).toContain("ipcMain.handle('memory.setEnabled'");
  });

  it('injects runtime plugin skill paths and extension hooks into the agent runner', () => {
    const piSetup = readProjectFile('src/main/agent/agent-runner-pi-setup.ts');
    const skillPaths = readProjectFile('src/main/agent/agent-runner-skills-paths.ts');
    const memoryExtension = readProjectFile('src/main/memory/memory-extension.ts');
    expect(piSetup).toContain('resolveSkillPaths(session.id)');
    expect(skillPaths).toContain("path.join(plugin.runtimePath, 'skills')");
    expect(piSetup).toContain('ctx.extensionManager.beforeSessionRun');
    expect(piSetup).toContain('skillsSignature');
    expect(memoryExtension).not.toContain('customTools: this.memoryService.getTools()');
  });

  it('adds a dedicated Memory settings tab and preload bridge', () => {
    const settingsPanel = readProjectFile('src/renderer/components/SettingsPanel.tsx');
    const preload = readProjectFile('src/preload/index.ts');
    const memorySettings = readProjectFile('src/renderer/components/settings/SettingsMemory.tsx');

    expect(settingsPanel).toContain("id: 'memory'");
    expect(settingsPanel).toContain('<SettingsMemory />');
    expect(preload).toContain('memory: {');
    expect(preload).toContain("ipcRenderer.invoke('memory.search'");
    expect(preload).toContain("ipcRenderer.invoke('memory.listFiles')");
    expect(memorySettings).toContain('window.electronAPI.memory.search');
    expect(memorySettings).toContain('window.electronAPI.memory.readFile');
    expect(memorySettings).toContain('window.electronAPI.memory.inspectSession');
    expect(memorySettings).toContain('window.electronAPI.memory.rebuildWorkspace');
    expect(memorySettings).toContain('evalEnabled: source.evalEnabled');
    expect(memorySettings).toContain('promptIterationRounds');
  });

  it('defaults new sessions to the global memory toggle', () => {
    const sessionLifecycle = readProjectFile(
      'src/main/session/session-manager-session-lifecycle.ts'
    );
    const sessionQueue = readProjectFile('src/main/session/session-manager-queue.ts');
    expect(sessionLifecycle).toContain("configStore.get('memoryEnabled') !== false");
    expect(sessionLifecycle).toContain('memoryEnabled?: boolean');
    expect(sessionQueue).toContain('afterSessionRun');
  });

  it('removes unused SQLite memory tables from schema initialization', () => {
    const databaseSource = readProjectFile('src/main/db/database.ts');
    expect(databaseSource).not.toContain('memory_core_entries');
    expect(databaseSource).not.toContain('memory_experience_sessions');
    expect(databaseSource).not.toContain('memory_experience_chunks');
    expect(databaseSource).not.toContain('memory_session_state');
  });
});
