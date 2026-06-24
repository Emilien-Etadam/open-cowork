import type { Client } from '@modelcontextprotocol/sdk/client/index.js';

import { log, logError, logWarn } from '../utils/logger.js';
import type { OpenCoworkMcpOAuthProvider } from './mcp-oauth.js';
import type { MCPServerConfig, MCPTool, MCPTransport } from './mcp-types.js';

export interface MCPServerStatus {
  id: string;
  name: string;
  connected: boolean;
  status: 'connecting' | 'connected' | 'failed' | 'disabled';
  toolCount: number;
}

export interface MCPServerLifecycleContext {
  clients: Map<string, Client>;
  transports: Map<string, MCPTransport>;
  serverConfigs: Map<string, MCPServerConfig>;
  oauthProviders: Map<string, { provider: OpenCoworkMcpOAuthProvider; serverUrl: string }>;
  connectionStatus: Map<string, 'connecting' | 'connected' | 'failed'>;
  reconnectingServers: Set<string>;
  getToolMap(): Map<string, MCPTool>;
  getLastConfigFingerprint(): string | null;
  setLastConfigFingerprint(fingerprint: string | null): void;
  getInitializingServers(): boolean;
  setInitializingServers(value: boolean): void;
  getPendingInitConfigs(): MCPServerConfig[] | null;
  setPendingInitConfigs(configs: MCPServerConfig[] | null): void;
  connectServer(config: MCPServerConfig): Promise<void>;
  refreshTools(): Promise<void>;
}

export async function initializeServers(
  ctx: MCPServerLifecycleContext,
  configs: MCPServerConfig[]
): Promise<void> {
  if (ctx.getInitializingServers()) {
    ctx.setPendingInitConfigs(configs);
    return;
  }

  ctx.setInitializingServers(true);
  try {
    const fingerprint = JSON.stringify(
      configs.map((config) => ({
        id: config.id,
        enabled: config.enabled,
        command: config.command,
        args: config.args,
        url: config.url,
        env: config.env,
        headers: config.headers,
      }))
    );

    if (fingerprint === ctx.getLastConfigFingerprint()) {
      log('[MCPManager] Config unchanged, skipping re-initialization');
      return;
    }
    ctx.setLastConfigFingerprint(fingerprint);

    log('[MCPManager] Initializing', configs.length, 'MCP servers');

    await disconnectAll(ctx);

    ctx.serverConfigs.clear();
    for (const config of configs) {
      ctx.serverConfigs.set(config.id, config);
    }

    const enabledConfigs = configs.filter((config) => config.enabled);
    await Promise.allSettled(
      enabledConfigs.map(async (config) => {
        try {
          await ctx.connectServer(config);
        } catch (error) {
          logError(`[MCPManager] Failed to connect to server ${config.name}:`, error);
        }
      })
    );

    await ctx.refreshTools();
  } finally {
    ctx.setInitializingServers(false);

    const pendingInitConfigs = ctx.getPendingInitConfigs();
    if (pendingInitConfigs !== null) {
      ctx.setPendingInitConfigs(null);
      await initializeServers(ctx, pendingInitConfigs);
    }
  }
}

export async function updateServer(
  ctx: MCPServerLifecycleContext,
  config: MCPServerConfig
): Promise<void> {
  if (ctx.getInitializingServers()) {
    log('[MCPManager] Deferring update during initialization');
    return;
  }

  if (ctx.reconnectingServers.has(config.id)) {
    logWarn(`[MCPManager] Skipping updateServer for ${config.name}: reconnect already in progress`);
    return;
  }

  log(`[MCPManager] Updating server: ${config.name} (enabled: ${config.enabled})`);
  ctx.setLastConfigFingerprint(null);
  ctx.serverConfigs.set(config.id, config);

  const isConnected = ctx.clients.has(config.id);

  if (config.enabled && !isConnected) {
    try {
      await ctx.connectServer(config);
      await ctx.refreshTools();
    } catch (error) {
      logError(`[MCPManager] Failed to connect to server ${config.name}:`, error);
      throw error;
    }
    return;
  }

  if (!config.enabled && isConnected) {
    await disconnectServer(ctx, config.id);
    await ctx.refreshTools();
    return;
  }

  if (config.enabled && isConnected) {
    await disconnectServer(ctx, config.id);
    try {
      await ctx.connectServer(config);
      await ctx.refreshTools();
    } catch (error) {
      logError(`[MCPManager] Failed to reconnect server ${config.name}:`, error);
      throw error;
    }
  }
}

export async function removeServer(
  ctx: MCPServerLifecycleContext,
  serverId: string
): Promise<void> {
  log(`[MCPManager] Removing server: ${serverId}`);
  ctx.setLastConfigFingerprint(null);
  await disconnectServer(ctx, serverId);
  ctx.serverConfigs.delete(serverId);
  ctx.oauthProviders.delete(serverId);
  await ctx.refreshTools();
}

export async function disconnectServer(
  ctx: MCPServerLifecycleContext,
  serverId: string
): Promise<void> {
  const client = ctx.clients.get(serverId);
  const transport = ctx.transports.get(serverId);

  if (client) {
    try {
      await client.close();
    } catch (error) {
      logError(`[MCPManager] Error closing client for ${serverId}:`, error);
    }
    ctx.clients.delete(serverId);
  }

  if (transport) {
    try {
      await transport.close();
    } catch (error) {
      logError(`[MCPManager] Error closing transport for ${serverId}:`, error);
    }
    ctx.transports.delete(serverId);
  }

  const toolMap = ctx.getToolMap();
  const toolsToRemove: string[] = [];
  for (const [toolName, tool] of toolMap.entries()) {
    if (tool.serverId === serverId) {
      toolsToRemove.push(toolName);
    }
  }
  for (const toolName of toolsToRemove) {
    toolMap.delete(toolName);
  }

  ctx.connectionStatus.delete(serverId);
  log(`[MCPManager] Disconnected from server ${serverId}`);
}

export async function disconnectAll(ctx: MCPServerLifecycleContext): Promise<void> {
  const serverIds = Array.from(ctx.clients.keys());
  for (const serverId of serverIds) {
    await disconnectServer(ctx, serverId);
  }
}

export function getServerStatus(ctx: MCPServerLifecycleContext): MCPServerStatus[] {
  const status: MCPServerStatus[] = [];
  const tools = Array.from(ctx.getToolMap().values());

  for (const [serverId, config] of ctx.serverConfigs.entries()) {
    const connected = ctx.clients.has(serverId);
    const toolCount = tools.filter((tool) => tool.serverId === serverId).length;

    let serverStatus: MCPServerStatus['status'];
    const trackedStatus = ctx.connectionStatus.get(serverId);
    if (!config.enabled) {
      serverStatus = 'disabled';
    } else if (trackedStatus) {
      serverStatus = trackedStatus;
    } else if (connected) {
      serverStatus = 'connected';
    } else {
      serverStatus = 'connecting';
    }

    status.push({
      id: serverId,
      name: config.name,
      connected,
      status: serverStatus,
      toolCount,
    });
  }

  return status;
}

export async function shutdown(ctx: MCPServerLifecycleContext): Promise<void> {
  await disconnectAll(ctx);
}
