/**
 * @module main/mcp/mcp-manager
 *
 * MCP manager facade that delegates environment, lifecycle, and tool-registry
 * responsibilities to focused helper modules.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { app, shell } from 'electron';

import path from 'path';
import { ensureChromeReady } from './mcp-chrome-debug.js';
import {
  getBundledNodePaths as resolveBundledNodePaths,
  ensureNodeRuntime,
} from '../runtime/node-runtime.js';
import { ensureGuiRuntimeReady as ensureGuiRuntime } from '../runtime/gui-runtime.js';
import { connectServerInternal as connectServerInternalImpl } from './mcp-connection.js';
import {
  getEnhancedEnv,
  resolvePreferredNpxPath,
  type MCPManagerEnvContext,
} from './mcp-manager-env.js';
import { OpenCoworkMcpOAuthProvider } from './mcp-oauth.js';
import {
  disconnectAll,
  disconnectServer,
  getServerStatus,
  initializeServers,
  removeServer,
  shutdown,
  updateServer,
  type MCPServerLifecycleContext,
} from './mcp-server-lifecycle.js';
import { callTool } from './mcp-tool-call.js';
import {
  getTool,
  getTools,
  refreshTools,
  type MCPToolRegistryContext,
} from './mcp-tool-registry.js';
import type { MCPServerConfig, MCPTool, MCPTransport } from './mcp-types.js';
import { log, logError, logWarn } from '../utils/logger.js';

export type { MCPServerConfig, MCPTool, RefreshToolsResult } from './mcp-types.js';
export { findPreferredWindowsNpxPath, mergeShellEnvForMcp } from './mcp-env.js';
export { formatMcpToolName } from './mcp-tool-naming.js';

export class MCPManager {
  private clients: Map<string, Client> = new Map();
  private transports: Map<string, MCPTransport> = new Map();
  private tools: Map<string, MCPTool> = new Map();
  private serverConfigs: Map<string, MCPServerConfig> = new Map();
  private oauthProviders: Map<string, { provider: OpenCoworkMcpOAuthProvider; serverUrl: string }> =
    new Map();
  private npxPath: string | null = null;
  private lastConfigFingerprint: string | null = null;
  private cachedBaseEnv: Record<string, string> | null = null;
  private initializingServers = false;
  private pendingInitConfigs: MCPServerConfig[] | null = null;
  private reconnectingServers: Set<string> = new Set();
  private connectionStatus = new Map<string, 'connecting' | 'connected' | 'failed'>();

  private getEnvContext(): MCPManagerEnvContext {
    return {
      getBundledNodePath: () => this.getBundledNodePath(),
      getCachedBaseEnv: () => this.cachedBaseEnv,
      setCachedBaseEnv: (env) => {
        this.cachedBaseEnv = env;
      },
      getNpxPath: () => this.npxPath,
      setNpxPath: (npxPath) => {
        this.npxPath = npxPath;
      },
    };
  }

  private getLifecycleContext(): MCPServerLifecycleContext {
    return {
      clients: this.clients,
      transports: this.transports,
      serverConfigs: this.serverConfigs,
      oauthProviders: this.oauthProviders,
      connectionStatus: this.connectionStatus,
      reconnectingServers: this.reconnectingServers,
      getToolMap: () => this.tools,
      getLastConfigFingerprint: () => this.lastConfigFingerprint,
      setLastConfigFingerprint: (fingerprint) => {
        this.lastConfigFingerprint = fingerprint;
      },
      getInitializingServers: () => this.initializingServers,
      setInitializingServers: (value) => {
        this.initializingServers = value;
      },
      getPendingInitConfigs: () => this.pendingInitConfigs,
      setPendingInitConfigs: (configs) => {
        this.pendingInitConfigs = configs;
      },
      connectServer: (config) => this.connectServer(config),
      refreshTools: () => this.refreshTools(),
    };
  }

  private getToolRegistryContext(): MCPToolRegistryContext {
    return {
      clients: this.clients,
      serverConfigs: this.serverConfigs,
      reconnectingServers: this.reconnectingServers,
      connectionStatus: this.connectionStatus,
      getToolMap: () => this.tools,
      setToolMap: (tools) => {
        this.tools = tools;
      },
      disconnectServer: (serverId) => this.disconnectServer(serverId),
      connectServer: (config) => this.connectServer(config),
    };
  }

  private getBundledNodePath(): { node: string; npx: string } | null {
    return resolveBundledNodePaths();
  }

  async ensureNodeRuntimeReady(): Promise<void> {
    await ensureNodeRuntime();
  }

  async ensureGuiRuntimeReady(): Promise<void> {
    await ensureGuiRuntime();
  }

  private async resolvePreferredNpxPath(pathEnv: string | undefined): Promise<string> {
    return resolvePreferredNpxPath(this.getEnvContext(), pathEnv);
  }

  private async getEnhancedEnv(configEnv: Record<string, string>): Promise<Record<string, string>> {
    return getEnhancedEnv(this.getEnvContext(), configEnv);
  }

  async initializeServers(configs: MCPServerConfig[]): Promise<void> {
    await initializeServers(this.getLifecycleContext(), configs);
  }

  async updateServer(config: MCPServerConfig): Promise<void> {
    await updateServer(this.getLifecycleContext(), config);
  }

  async removeServer(serverId: string): Promise<void> {
    await removeServer(this.getLifecycleContext(), serverId);
  }

  private getMcpServerPath(filename: string): string {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require('fs');

    if (app.isPackaged) {
      const jsFilename = filename.replace(/\.ts$/, '.js');
      const mcpPath = path.join(process.resourcesPath || '', 'mcp', jsFilename);

      try {
        if (fs.existsSync(mcpPath)) {
          log(`[MCPManager] Found MCP server at: ${mcpPath}`);
          return mcpPath;
        }
        logError(`[MCPManager] File not found at: ${mcpPath}`);
      } catch (error) {
        logError(`[MCPManager] Error checking MCP server path: ${error}`);
      }
    }

    const projectRoot = path.join(__dirname, '..', '..');
    const jsFilename = filename.replace(/\.ts$/, '.js');
    const devBundledPath = path.join(projectRoot, 'dist-mcp', jsFilename);
    try {
      if (fs.existsSync(devBundledPath)) {
        log(`[MCPManager] Found bundled MCP server (dev) at: ${devBundledPath}`);
        return devBundledPath;
      }
    } catch (error) {
      logWarn(`[MCPManager] Error checking dev bundled MCP server path: ${error}`);
    }

    const sourcePath = path.join(projectRoot, 'src', 'main', 'mcp', filename);
    try {
      if (fs.existsSync(sourcePath)) {
        log(`[MCPManager] MCP Server path resolved (${filename}):`, sourcePath);
        return sourcePath;
      }
      logError('[MCPManager] File not found at:', sourcePath);
      logError('[MCPManager] __dirname:', __dirname);
      logError('[MCPManager] projectRoot:', projectRoot);
    } catch (error) {
      logError('[MCPManager] Error checking file:', error);
    }

    return sourcePath;
  }

  private getSoftwareDevServerPath(): string {
    return this.getMcpServerPath('software-dev-server-example.ts');
  }

  private getGuiOperateServerPath(): string {
    return this.getMcpServerPath('gui-operate-server.ts');
  }

  private async connectServer(config: MCPServerConfig): Promise<void> {
    log(`[MCPManager] Connecting to MCP server: ${config.name} (${config.type})`);
    this.connectionStatus.set(config.id, 'connecting');

    try {
      await this.connectServerInternal(config);
      this.connectionStatus.set(config.id, 'connected');
    } catch (error) {
      this.connectionStatus.set(config.id, 'failed');
      throw error;
    }
  }

  private async connectServerInternal(config: MCPServerConfig): Promise<void> {
    const { client, transport } = await connectServerInternalImpl(config, {
      getBundledNodePath: () => this.getBundledNodePath(),
      getSoftwareDevServerPath: () => this.getSoftwareDevServerPath(),
      getGuiOperateServerPath: () => this.getGuiOperateServerPath(),
      getEnhancedEnv: (configEnv) => this.getEnhancedEnv(configEnv),
      resolvePreferredNpxPath: (pathEnv) => this.resolvePreferredNpxPath(pathEnv),
      connectClientWithTimeout: (clientArg, transportArg, timeoutMs) =>
        this.connectClientWithTimeout(clientArg, transportArg, timeoutMs),
      getOrCreateStreamableHttpOAuthProvider: (serverConfig) =>
        this.getOrCreateStreamableHttpOAuthProvider(serverConfig),
      ensureChromeReady: (serverName, clientArg) => ensureChromeReady(serverName, clientArg),
    });

    this.clients.set(config.id, client);
    this.transports.set(config.id, transport);
  }

  private async connectClientWithTimeout(
    client: Client,
    transport: MCPTransport,
    timeoutMs: number
  ): Promise<void> {
    const connectPromise = client.connect(transport);
    let connectTimeoutId: ReturnType<typeof setTimeout>;
    const connectTimeoutPromise = new Promise<never>((_, reject) => {
      connectTimeoutId = setTimeout(
        () => reject(new Error(`MCP server connection timed out after ${timeoutMs / 1000}s`)),
        timeoutMs
      );
    });

    try {
      await Promise.race([connectPromise, connectTimeoutPromise]);
      clearTimeout(connectTimeoutId!);
    } catch (error) {
      clearTimeout(connectTimeoutId!);
      connectPromise.catch(() => {});
      throw error;
    }
  }

  private getOrCreateStreamableHttpOAuthProvider(
    config: MCPServerConfig
  ): OpenCoworkMcpOAuthProvider {
    if (!config.url) {
      throw new Error(`Streamable HTTP server ${config.name} requires a URL`);
    }

    const existing = this.oauthProviders.get(config.id);
    if (existing && existing.serverUrl === config.url) {
      return existing.provider;
    }

    const provider = new OpenCoworkMcpOAuthProvider({
      openExternal: async (url) => {
        await this.openMcpAuthorizationUrl(config.name, url);
      },
    });

    this.oauthProviders.set(config.id, {
      provider,
      serverUrl: config.url,
    });

    return provider;
  }

  private async openMcpAuthorizationUrl(serverName: string, url: string): Promise<void> {
    const parsedUrl = new URL(url);
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      throw new Error(
        `MCP OAuth authorization URL for ${serverName} uses unsupported protocol: ${parsedUrl.protocol}`
      );
    }

    log(`[MCPManager] Opening MCP OAuth authorization for ${serverName}: ${parsedUrl.origin}`);
    await shell.openExternal(parsedUrl.toString());
  }

  async disconnectServer(serverId: string): Promise<void> {
    await disconnectServer(this.getLifecycleContext(), serverId);
  }

  async disconnectAll(): Promise<void> {
    await disconnectAll(this.getLifecycleContext());
  }

  async refreshTools(): Promise<void> {
    await refreshTools(this.getToolRegistryContext());
  }

  getTools(): MCPTool[] {
    return getTools(this.getToolRegistryContext());
  }

  getTool(toolName: string): MCPTool | undefined {
    return getTool(this.getToolRegistryContext(), toolName);
  }

  async callTool(toolName: string, args: Record<string, unknown>): Promise<unknown> {
    return callTool(this.getToolRegistryContext(), toolName, args);
  }

  getServerStatus(): Array<{
    id: string;
    name: string;
    connected: boolean;
    status: 'connecting' | 'connected' | 'failed' | 'disabled';
    toolCount: number;
  }> {
    return getServerStatus(this.getLifecycleContext());
  }

  async shutdown(): Promise<void> {
    await shutdown(this.getLifecycleContext());
  }
}
