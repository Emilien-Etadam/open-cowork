/**
 * @module main/ipc/ipc-skills-plugins-window
 */
import { ipcMain, shell } from 'electron';
import { configStore } from '../config/config-store';
import { logError } from '../utils/logger';
import { mainAppState } from '../main-app-state';
import { sendToRenderer } from '../main-renderer-bridge';
import { notifyPluginCommandsChanged } from './plugin-commands-notify';

export function registerSkillsPluginsWindowIpc(): void {
  ipcMain.handle('skills.getAll', async () => {
    try {
      if (!mainAppState.skillsManager) {
        throw new Error('Skills manager is still starting');
      }
      return await mainAppState.skillsManager.listSkills();
    } catch (error) {
      logError('[Skills] Error getting skills:', error);
      throw error;
    }
  });

  ipcMain.handle('skills.install', async (_event, skillPath: string) => {
    try {
      if (!mainAppState.skillsManager) {
        throw new Error('SkillsManager not initialized');
      }
      const skill = await mainAppState.skillsManager.installSkill(skillPath);
      mainAppState.sessionManager?.invalidateSkillsSetup();
      return { success: true, skill };
    } catch (error) {
      logError('[Skills] Error installing skill:', error);
      throw error;
    }
  });

  ipcMain.handle('skills.delete', async (_event, skillId: string) => {
    try {
      if (!mainAppState.skillsManager) {
        throw new Error('SkillsManager not initialized');
      }
      await mainAppState.skillsManager.uninstallSkill(skillId);
      mainAppState.sessionManager?.invalidateSkillsSetup();
      return { success: true };
    } catch (error) {
      logError('[Skills] Error deleting skill:', error);
      throw error;
    }
  });

  ipcMain.handle('skills.setEnabled', async (_event, skillId: string, enabled: boolean) => {
    try {
      if (!mainAppState.skillsManager) {
        throw new Error('SkillsManager not initialized');
      }
      mainAppState.skillsManager.setSkillEnabled(skillId, enabled);
      mainAppState.sessionManager?.invalidateSkillsSetup();
      return { success: true };
    } catch (error) {
      logError('[Skills] Error toggling skill:', error);
      throw error;
    }
  });

  ipcMain.handle('skills.validate', async (_event, skillPath: string) => {
    try {
      if (!mainAppState.skillsManager) {
        return { valid: false, errors: ['SkillsManager not initialized'] };
      }
      const result = await mainAppState.skillsManager.validateSkillFolder(skillPath);
      return result;
    } catch (error) {
      logError('[Skills] Error validating skill:', error);
      return { valid: false, errors: ['Validation failed'] };
    }
  });

  ipcMain.handle('skills.getStoragePath', async () => {
    try {
      if (!mainAppState.skillsManager) {
        return null;
      }
      return mainAppState.skillsManager.getGlobalSkillsPath();
    } catch (error) {
      logError('[Skills] Error getting storage path:', error);
      return null;
    }
  });

  ipcMain.handle('skills.setStoragePath', async (_event, targetPath: string, migrate = true) => {
    if (!mainAppState.skillsManager) {
      throw new Error('SkillsManager not initialized');
    }
    const result = await mainAppState.skillsManager.setGlobalSkillsPath(
      targetPath,
      migrate !== false
    );
    sendToRenderer({
      type: 'config.status',
      payload: {
        isConfigured: configStore.isConfigured(),
        config: configStore.getAll(),
      },
    });
    return { success: true, ...result };
  });

  ipcMain.handle('skills.openStoragePath', async () => {
    if (!mainAppState.skillsManager) {
      throw new Error('SkillsManager not initialized');
    }
    const storagePath = mainAppState.skillsManager.getGlobalSkillsPath();
    const openResult = await shell.openPath(storagePath);
    if (openResult) {
      return { success: false, path: storagePath, error: openResult };
    }
    return { success: true, path: storagePath };
  });

  ipcMain.handle('plugins.listInstalled', async () => {
    try {
      if (!mainAppState.pluginRuntimeService) {
        throw new Error('PluginRuntimeService not initialized');
      }
      return mainAppState.pluginRuntimeService.listInstalled();
    } catch (error) {
      logError('[Plugins] Error listing installed plugins:', error);
      throw error;
    }
  });

  ipcMain.handle('plugins.listCommands', async () => {
    try {
      if (!mainAppState.pluginRuntimeService) {
        throw new Error('PluginRuntimeService not initialized');
      }
      return mainAppState.pluginRuntimeService.listAvailableCommands();
    } catch (error) {
      logError('[Plugins] Error listing plugin commands:', error);
      throw error;
    }
  });

  ipcMain.handle('plugins.setEnabled', async (_event, pluginId: string, enabled: boolean) => {
    try {
      if (!mainAppState.pluginRuntimeService) {
        throw new Error('PluginRuntimeService not initialized');
      }
      const result = await mainAppState.pluginRuntimeService.setEnabled(pluginId, enabled);
      mainAppState.sessionManager?.invalidateSkillsSetup();
      notifyPluginCommandsChanged();
      return result;
    } catch (error) {
      logError('[Plugins] Error toggling plugin:', error);
      throw error;
    }
  });

  ipcMain.handle(
    'plugins.setComponentEnabled',
    async (
      _event,
      pluginId: string,
      component: 'skills' | 'commands' | 'agents' | 'hooks' | 'mcp',
      enabled: boolean
    ) => {
      try {
        if (!mainAppState.pluginRuntimeService) {
          throw new Error('PluginRuntimeService not initialized');
        }
        const result = await mainAppState.pluginRuntimeService.setComponentEnabled(
          pluginId,
          component,
          enabled
        );
        if (component === 'skills' || component === 'commands') {
          mainAppState.sessionManager?.invalidateSkillsSetup();
        }
        if (component === 'commands') {
          notifyPluginCommandsChanged();
        }
        return result;
      } catch (error) {
        logError('[Plugins] Error toggling plugin component:', error);
        throw error;
      }
    }
  );

  ipcMain.handle('plugins.uninstall', async (_event, pluginId: string) => {
    try {
      if (!mainAppState.pluginRuntimeService) {
        throw new Error('PluginRuntimeService not initialized');
      }
      const result = await mainAppState.pluginRuntimeService.uninstall(pluginId);
      mainAppState.sessionManager?.invalidateSkillsSetup();
      notifyPluginCommandsChanged();
      return result;
    } catch (error) {
      logError('[Plugins] Error uninstalling plugin:', error);
      throw error;
    }
  });

  ipcMain.on('window.minimize', () => {
    try {
      mainAppState.mainWindow?.minimize();
    } catch (error) {
      logError('[Window] Error minimizing:', error);
    }
  });

  ipcMain.on('window.maximize', () => {
    try {
      if (mainAppState.mainWindow?.isMaximized()) {
        mainAppState.mainWindow.unmaximize();
      } else {
        mainAppState.mainWindow?.maximize();
      }
    } catch (error) {
      logError('[Window] Error maximizing:', error);
    }
  });

  ipcMain.on('window.close', () => {
    try {
      mainAppState.mainWindow?.close();
    } catch (error) {
      logError('[Window] Error closing:', error);
    }
  });
}
