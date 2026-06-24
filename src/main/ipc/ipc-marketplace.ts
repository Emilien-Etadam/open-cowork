/**
 * @module main/ipc/ipc-marketplace
 */
import { ipcMain } from 'electron';
import { logError } from '../utils/logger';
import { mainAppState } from '../main-app-state';
import { mcpConfigStore } from '../mcp/mcp-config-store';

async function syncMcpAfterMarketplaceChange(serverId?: string): Promise<void> {
  if (!mainAppState.sessionManager || !serverId) {
    return;
  }
  const mcpManager = mainAppState.sessionManager.getMCPManager();
  const config = mcpConfigStore.getServer(serverId);
  if (!config) {
    return;
  }
  try {
    await mcpManager.updateServer(config);
    mainAppState.sessionManager.invalidateMcpServersCache();
  } catch (error) {
    logError('[Marketplace] Failed to sync MCP server:', error);
    throw error;
  }
}

export function registerMarketplaceIpc(): void {
  ipcMain.handle('marketplace.list', async (_event, forceRefresh = false) => {
    if (!mainAppState.marketplaceService) {
      throw new Error('MarketplaceService not initialized');
    }
    return mainAppState.marketplaceService.list(forceRefresh === true);
  });

  ipcMain.handle(
    'marketplace.install',
    async (_event, catalogId: string, envValues?: Record<string, string>) => {
      if (!mainAppState.marketplaceService) {
        throw new Error('MarketplaceService not initialized');
      }
      const result = await mainAppState.marketplaceService.install(catalogId, envValues);
      if (result.type === 'mcp' && result.installedRef) {
        await syncMcpAfterMarketplaceChange(result.installedRef);
      }
      if (result.type === 'skill' || result.type === 'plugin') {
        mainAppState.sessionManager?.invalidateSkillsSetup();
      }
      return result;
    }
  );

  ipcMain.handle('marketplace.uninstall', async (_event, catalogId: string) => {
    if (!mainAppState.marketplaceService) {
      throw new Error('MarketplaceService not initialized');
    }
    const record = mainAppState.marketplaceService
      ? await mainAppState.marketplaceService
          .list()
          .then((entries) => entries.find((entry) => entry.id === catalogId))
      : undefined;
    const result = await mainAppState.marketplaceService.uninstall(catalogId);
    if (record?.type === 'mcp' && record.installedRef) {
      const mcpManager = mainAppState.sessionManager?.getMCPManager();
      if (mcpManager) {
        await mcpManager.removeServer(record.installedRef);
        mainAppState.sessionManager?.invalidateMcpServersCache();
      }
    }
    if (record?.type === 'skill' || record?.type === 'plugin') {
      mainAppState.sessionManager?.invalidateSkillsSetup();
    }
    return result;
  });

  ipcMain.handle('marketplace.setEnabled', async (_event, catalogId: string, enabled: boolean) => {
    if (!mainAppState.marketplaceService) {
      throw new Error('MarketplaceService not initialized');
    }
    const entry = await mainAppState.marketplaceService
      .list()
      .then((entries) => entries.find((item) => item.id === catalogId));
    const result = await mainAppState.marketplaceService.setEnabled(catalogId, enabled);
    if (entry?.type === 'mcp' && entry.installedRef) {
      await syncMcpAfterMarketplaceChange(entry.installedRef);
    }
    if (entry?.type === 'skill' || entry?.type === 'plugin') {
      mainAppState.sessionManager?.invalidateSkillsSetup();
    }
    return result;
  });
}
