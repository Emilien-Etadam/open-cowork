import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

describe('scheduled task session title wiring', () => {
  it('routes schedule title generation through SessionManager flow', () => {
    const titlePath = path.resolve(process.cwd(), 'src/main/main-scheduled-task-title.ts');
    const ipcPath = path.resolve(process.cwd(), 'src/main/ipc/ipc-schedule-memory.ts');
    const titleContent = readFileSync(titlePath, 'utf8');
    const ipcContent = readFileSync(ipcPath, 'utf8');

    expect(titleContent).toContain('export async function resolveScheduledTaskTitle(');
    expect(titleContent).toContain('mainAppState.sessionManager.generateScheduledTaskTitle');
    expect(ipcContent).toContain("ipcMain.handle('schedule.create', async");
    expect(ipcContent).toContain("'schedule.update'");
  });
});
