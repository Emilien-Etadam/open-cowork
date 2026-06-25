/**
 * @module main/ipc/register-main-ipc
 */
import { registerClientShellIpc } from './ipc-client-shell';
import { registerConfigMcpIpc } from './ipc-config-mcp';
import { registerSkillsPluginsWindowIpc } from './ipc-skills-plugins-window';
import { registerSandboxLogsIpc } from './ipc-sandbox-logs';
import { registerRemoteScheduleMemoryIpc } from './ipc-remote-schedule-memory';
import { registerMarketplaceIpc } from './ipc-marketplace';
import { registerAutoUpdateIpc } from './ipc-auto-update';

export function registerMainIpc(): void {
  registerClientShellIpc();
  registerConfigMcpIpc();
  registerSkillsPluginsWindowIpc();
  registerMarketplaceIpc();
  registerAutoUpdateIpc();
  registerSandboxLogsIpc();
  registerRemoteScheduleMemoryIpc();
}
