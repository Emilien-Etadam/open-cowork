/**
 * @module main/ipc/ipc-config-mcp
 */
import { ipcMain } from 'electron';
import {
  configStore,
  getPiAiModelPresets,
  type AppConfig,
  type CreateConfigSetPayload,
} from '../config/config-store';
import { runConfigApiTest } from '../config/config-test-routing';
import { isLoopbackBaseUrl } from '../../shared/network/loopback';
import { listOllamaModels } from '../config/ollama-api';
import { mcpConfigStore } from '../mcp/mcp-config-store';
import type { MCPServerConfig } from '../mcp/mcp-manager';
import type {
  ApiTestInput,
  ApiTestResult,
  DiagnosticInput,
  ProviderModelInfo,
  WebSearchTestInput,
  WebSearchTestResult,
} from '../../renderer/types';
import { runWebSearchConfigTest } from '../config/web-search-test';
import { log, logError } from '../utils/logger';
import { mainAppState } from '../main-app-state';
import { sendToRenderer } from '../main-renderer-bridge';

const buildAgentRuntimeSignature = (config: AppConfig): string =>
  JSON.stringify({
    provider: config.provider,
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    customProtocol: config.customProtocol,
    model: config.model,
    enableThinking: config.enableThinking,
    memoryEnabled: config.memoryEnabled,
    memoryRuntime: config.memoryRuntime,
  });

const syncConfigAfterMutation = async (previousConfig: AppConfig) => {
  configStore.set('isConfigured', configStore.hasAnyUsableCredentials());

  configStore.applyToEnv();

  const updatedConfig = configStore.getAll();
  const shouldReloadRunner =
    buildAgentRuntimeSignature(previousConfig) !== buildAgentRuntimeSignature(updatedConfig);
  const shouldReloadSandbox = previousConfig.sandboxEnabled !== updatedConfig.sandboxEnabled;

  if (mainAppState.sessionManager) {
    if (shouldReloadRunner) {
      mainAppState.sessionManager.reloadConfig();
    }
    if (shouldReloadSandbox) {
      await mainAppState.sessionManager
        .reloadSandbox()
        .catch((err) => logError('[Config] Sandbox reload failed:', err));
    }
    if (shouldReloadRunner || shouldReloadSandbox) {
      log(
        '[Config] Session manager config synced:',
        JSON.stringify({ runnerReloaded: shouldReloadRunner, sandboxReloaded: shouldReloadSandbox })
      );
    }
  }

  const isConfigured = configStore.isConfigured();
  sendToRenderer({
    type: 'config.status',
    payload: {
      isConfigured,
      config: updatedConfig,
    },
  });
  log('[Config] Notified renderer of config update, isConfigured:', isConfigured);
  return updatedConfig;
};

export function registerConfigMcpIpc(): void {
  ipcMain.handle('config.get', () => {
    try {
      return configStore.getAll();
    } catch (error) {
      logError('[Config] Error getting config:', error);
      return {};
    }
  });

  ipcMain.handle('config.getPresets', () => {
    try {
      return getPiAiModelPresets();
    } catch (error) {
      logError('[Config] Error getting presets:', error);
      return [];
    }
  });

  ipcMain.handle('config.save', async (_event, newConfig: Partial<AppConfig>) => {
    log('[Config] Saving config:', {
      ...newConfig,
      apiKey: newConfig.apiKey ? '***' : '',
      memoryRuntime: newConfig.memoryRuntime
        ? {
            ...newConfig.memoryRuntime,
            llm: newConfig.memoryRuntime.llm
              ? {
                  ...newConfig.memoryRuntime.llm,
                  apiKey: newConfig.memoryRuntime.llm.apiKey ? '***' : '',
                }
              : undefined,
            embedding: newConfig.memoryRuntime.embedding
              ? {
                  ...newConfig.memoryRuntime.embedding,
                  apiKey: newConfig.memoryRuntime.embedding.apiKey ? '***' : '',
                }
              : undefined,
          }
        : undefined,
    });

    const previousConfig = configStore.getAll();
    configStore.update(newConfig);
    const updatedConfig = await syncConfigAfterMutation(previousConfig);

    return { success: true, config: updatedConfig };
  });

  ipcMain.handle('config.createSet', async (_event, payload: CreateConfigSetPayload) => {
    log('[Config] Creating config set:', payload);
    const previousConfig = configStore.getAll();
    configStore.createSet(payload);
    const updatedConfig = await syncConfigAfterMutation(previousConfig);
    return { success: true, config: updatedConfig };
  });

  ipcMain.handle('config.renameSet', async (_event, payload: { id: string; name: string }) => {
    log('[Config] Renaming config set:', payload);
    const previousConfig = configStore.getAll();
    configStore.renameSet(payload);
    const updatedConfig = await syncConfigAfterMutation(previousConfig);
    return { success: true, config: updatedConfig };
  });

  ipcMain.handle('config.deleteSet', async (_event, payload: { id: string }) => {
    log('[Config] Deleting config set:', payload);
    const previousConfig = configStore.getAll();
    configStore.deleteSet(payload);
    const updatedConfig = await syncConfigAfterMutation(previousConfig);
    return { success: true, config: updatedConfig };
  });

  ipcMain.handle('config.switchSet', async (_event, payload: { id: string }) => {
    log('[Config] Switching config set:', payload);
    const previousConfig = configStore.getAll();
    configStore.switchSet(payload);
    const updatedConfig = await syncConfigAfterMutation(previousConfig);
    return { success: true, config: updatedConfig };
  });

  ipcMain.handle('config.isConfigured', () => {
    try {
      return configStore.isConfigured();
    } catch (error) {
      logError('[Config] Error checking configured status:', error);
      return false;
    }
  });

  ipcMain.handle('config.test', async (_event, payload: ApiTestInput): Promise<ApiTestResult> => {
    try {
      return await runConfigApiTest(payload, configStore.getAll());
    } catch (error) {
      logError('[Config] API test failed:', error);
      return {
        ok: false,
        errorType: 'unknown',
        details: error instanceof Error ? error.message : String(error),
      };
    }
  });

  ipcMain.handle(
    'config.testWebSearch',
    async (_event, payload: WebSearchTestInput): Promise<WebSearchTestResult> => {
      try {
        return await runWebSearchConfigTest(payload);
      } catch (error) {
        logError('[Config] Web search test failed:', error);
        return {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
  );

  ipcMain.handle(
    'config.listModels',
    async (
      _event,
      payload: { provider: AppConfig['provider']; apiKey: string; baseUrl?: string }
    ): Promise<ProviderModelInfo[]> => {
      if (payload.provider !== 'openai' || !isLoopbackBaseUrl(payload.baseUrl)) {
        return [];
      }
      return listOllamaModels(payload);
    }
  );

  ipcMain.handle('config.diagnose', async (_event, payload: DiagnosticInput) => {
    try {
      const { runDiagnostics } = await import('../config/api-diagnostics');
      return await runDiagnostics(payload);
    } catch (error) {
      logError('[Config] Error running diagnostics:', error);
      throw error;
    }
  });

  ipcMain.handle('config.discover-local', async (_event, payload?: { baseUrl?: string }) => {
    try {
      const { discoverLocalOllama } = await import('../config/api-diagnostics');
      return await discoverLocalOllama(payload);
    } catch (error) {
      logError('[Config] Error discovering local services:', error);
      return [];
    }
  });

  ipcMain.handle('mcp.getServers', () => {
    try {
      return mcpConfigStore.getServers();
    } catch (error) {
      logError('[MCP] Error getting servers:', error);
      return [];
    }
  });

  ipcMain.handle('mcp.getServer', (_event, serverId: string) => {
    try {
      return mcpConfigStore.getServer(serverId);
    } catch (error) {
      logError('[MCP] Error getting server:', error);
      return null;
    }
  });

  ipcMain.handle('mcp.saveServer', async (_event, config: MCPServerConfig) => {
    mcpConfigStore.saveServer(config);
    if (mainAppState.sessionManager) {
      const mcpManager = mainAppState.sessionManager.getMCPManager();
      try {
        await mcpManager.updateServer(config);
        mainAppState.sessionManager.invalidateMcpServersCache();
        log(`[MCP] Server ${config.name} updated successfully`);
      } catch (err) {
        logError('[MCP] Failed to update server:', err);
        if (config.enabled) {
          mcpConfigStore.saveServer({ ...config, enabled: false });
        }
        const errorMessage = err instanceof Error ? err.message : String(err);
        return { success: false, error: errorMessage };
      }
    }
    return { success: true };
  });

  ipcMain.handle('mcp.deleteServer', async (_event, serverId: string) => {
    mcpConfigStore.deleteServer(serverId);
    if (mainAppState.sessionManager) {
      const mcpManager = mainAppState.sessionManager.getMCPManager();
      try {
        await mcpManager.removeServer(serverId);
        mainAppState.sessionManager.invalidateMcpServersCache();
        log(`[MCP] Server ${serverId} removed successfully`);
      } catch (err) {
        logError('[MCP] Failed to remove server:', err);
      }
    }
    return { success: true };
  });

  ipcMain.handle('mcp.getTools', () => {
    try {
      if (!mainAppState.sessionManager) {
        return [];
      }
      const mcpManager = mainAppState.sessionManager.getMCPManager();
      return mcpManager.getTools();
    } catch (error) {
      logError('[MCP] Error getting tools:', error);
      return [];
    }
  });

  ipcMain.handle('mcp.getServerStatus', () => {
    try {
      if (!mainAppState.sessionManager) {
        return [];
      }
      const mcpManager = mainAppState.sessionManager.getMCPManager();
      return mcpManager.getServerStatus();
    } catch (error) {
      logError('[MCP] Error getting server status:', error);
      return [];
    }
  });

  ipcMain.handle('mcp.getPresets', () => {
    try {
      return mcpConfigStore.getPresets();
    } catch (error) {
      logError('[MCP] Error getting presets:', error);
      return {};
    }
  });
}
