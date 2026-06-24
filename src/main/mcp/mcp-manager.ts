/**
 * @module main/mcp/mcp-manager
 *
 * Model Context Protocol (MCP) server manager (1321 lines).
 *
 * Responsibilities:
 * - MCP server config CRUD (add, update, delete, list)
 * - Server lifecycle: start, stop, restart with health checks
 * - Transport handling: stdio (child process), SSE (HTTP stream), and Streamable HTTP
 * - Tool/resource/prompt discovery from connected servers
 *
 * Dependencies: config-store (via mcp-config-store)
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { app, BrowserWindow, shell } from 'electron';

import path from 'path';
import { OpenCoworkMcpOAuthProvider } from './mcp-oauth';
import { log, logError, logWarn, logCtx, logCtxError, logTiming } from '../utils/logger';
import { getDefaultShell } from '../utils/shell-resolver';
import { ensureChromeReady } from './mcp-chrome-debug';
import { connectServerInternal as connectServerInternalImpl } from './mcp-connection';
import {
  findPreferredWindowsNpxPath,
  getTrustedWindowsNpxDirectories,
  mergeShellEnvForMcp,
  normalizeWindowsPathForComparison,
} from './mcp-env';
import { createUniqueMcpToolName, sanitizeMcpToolSegment } from './mcp-tool-naming';
import type { MCPServerConfig, MCPTool, MCPTransport, RefreshToolsResult } from './mcp-types';

export type { MCPServerConfig, MCPTool, RefreshToolsResult } from './mcp-types';
export { formatMcpToolName } from './mcp-tool-naming';
export { findPreferredWindowsNpxPath, mergeShellEnvForMcp } from './mcp-env';

const MCP_LIST_TOOLS_TIMEOUT_MS = 5 * 60 * 1000;
const MCP_TOOL_CALL_TIMEOUT_MS = 5 * 60 * 1000;

async function raceWithTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timeoutId!);
  }
}

/**
 * MCP Manager - Manages connections to MCP servers and exposes their tools
 */
export class MCPManager {
  private clients: Map<string, Client> = new Map();
  private transports: Map<string, MCPTransport> = new Map();
  private tools: Map<string, MCPTool> = new Map(); // toolName -> MCPTool
  private serverConfigs: Map<string, MCPServerConfig> = new Map();
  private oauthProviders: Map<string, { provider: OpenCoworkMcpOAuthProvider; serverUrl: string }> =
    new Map();
  private npxPath: string | null = null; // Cached npx path
  // Fingerprint of last initialized config to skip redundant re-init
  private lastConfigFingerprint: string | null = null;
  // Cached base environment (shell env + PATH). Resolved once, reused for all MCP server spawns.
  private cachedBaseEnv: Record<string, string> | null = null;
  private initializingServers = false;
  // Pending config queued while initialization is in progress
  private pendingInitConfigs: MCPServerConfig[] | null = null;
  // Guards against concurrent reconnect/update operations on the same server
  private reconnectingServers: Set<string> = new Set();
  // Tracks per-server connection status for UI display
  private connectionStatus = new Map<string, 'connecting' | 'connected' | 'failed'>();

  /**
   * Get bundled Node.js path
   * Returns the path to the bundled node/npx binaries
   */
  private getBundledNodePath(): { node: string; npx: string } | null {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const path = require('path');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require('fs');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const os = require('os');

    const platform = os.platform();
    const arch = os.arch();

    // In production, resources are in app.asar.unpacked or extraResources
    let resourcesPath: string;

    if (!app.isPackaged) {
      // Development: use downloaded node in resources/node
      // __dirname is dist-electron/main, so go up to project root
      log('[MCPManager] Development mode, using downloaded node in resources/node');
      const projectRoot = path.join(__dirname, '..', '..');
      resourcesPath = path.join(projectRoot, 'resources', 'node', `${platform}-${arch}`);
    } else {
      // Production: use bundled node in extraResources
      log('[MCPManager] Production mode, using bundled node in extraResources');
      resourcesPath = path.join(process.resourcesPath, 'node');
    }

    log(`[MCPManager] Looking for bundled Node.js at: ${resourcesPath}`);

    if (!fs.existsSync(resourcesPath)) {
      logWarn(`[MCPManager] Bundled Node.js not found at: ${resourcesPath}`);
      return null;
    }

    // Determine binary paths based on platform
    const binDir = platform === 'win32' ? resourcesPath : path.join(resourcesPath, 'bin');
    const nodeExe = platform === 'win32' ? 'node.exe' : 'node';
    const npxExe = platform === 'win32' ? 'npx.cmd' : 'npx';

    const nodePath = path.join(binDir, nodeExe);
    const npxPath = path.join(binDir, npxExe);

    // Verify files exist
    if (fs.existsSync(nodePath) && fs.existsSync(npxPath)) {
      log(`[MCPManager] Found bundled Node.js: ${nodePath}`);
      log(`[MCPManager] Found bundled npx: ${npxPath}`);
      return { node: nodePath, npx: npxPath };
    } else {
      logWarn(
        `[MCPManager] Bundled binaries incomplete - node: ${fs.existsSync(nodePath)}, npx: ${fs.existsSync(npxPath)}`
      );
      return null;
    }
  }

  /**
   * Get npx path from bundled Node.js
   * Throws an error if bundled Node.js is not found
   */
  private async checkNpxInPath(): Promise<void> {
    const bundledNode = this.getBundledNodePath();
    if (!bundledNode) {
      const errorMessage =
        'Bundled Node.js not found. Please reinstall the application.\n' +
        '未找到内置的 Node.js。请重新安装应用。\n\n' +
        'The application requires bundled Node.js to run MCP servers.\n' +
        '应用需要内置的 Node.js 来运行 MCP 服务器。';

      logError('[MCPManager] Bundled Node.js not found');
      throw new Error(errorMessage);
    }

    this.npxPath = bundledNode.npx;
    log(`[MCPManager] Using bundled npx: ${this.npxPath}`);
  }

  private async resolvePreferredNpxPath(pathEnv: string | undefined): Promise<string> {
    const bundledNpxPath = this.getBundledNodePath()?.npx ?? null;

    if (process.platform === 'win32') {
      const preferredNpxPath = findPreferredWindowsNpxPath(
        pathEnv,
        bundledNpxPath,
        undefined,
        getTrustedWindowsNpxDirectories(process.env)
      );
      if (!preferredNpxPath) {
        throw new Error(
          'npx is not available. Install Node.js so Open Cowork can use your system npx.cmd, or reinstall the app to restore the bundled runtime.'
        );
      }

      this.npxPath = preferredNpxPath;
      if (
        bundledNpxPath &&
        normalizeWindowsPathForComparison(preferredNpxPath) !==
          normalizeWindowsPathForComparison(bundledNpxPath)
      ) {
        log(`[MCPManager] Using system npx on Windows: ${this.npxPath}`);
      } else {
        log(`[MCPManager] Using bundled npx: ${this.npxPath}`);
      }

      return preferredNpxPath;
    }

    await this.checkNpxInPath();
    if (!this.npxPath) {
      throw new Error('Bundled npx is unavailable.');
    }
    return this.npxPath;
  }

  /**
   * Get enhanced environment with proper PATH for packaged app
   * This is critical for packaged apps where process.env is very limited
   */
  private async getEnhancedEnv(configEnv: Record<string, string>): Promise<Record<string, string>> {
    if (!this.cachedBaseEnv) {
      this.cachedBaseEnv = await this.resolveBaseEnv();
    }
    return { ...this.cachedBaseEnv, ...configEnv };
  }

  /**
   * Resolve the base environment (shell env + PATH).
   * Heavy operation — called once, then cached by getEnhancedEnv.
   */
  private async resolveBaseEnv(): Promise<Record<string, string>> {
    const { execFile } = await import('child_process');
    const { promisify } = await import('util');
    const execFileAsync = promisify(execFile);
    const os = await import('os');
    const path = await import('path');

    const platform = os.platform();
    const homeDir = os.homedir();

    // Start with current process env
    let env = { ...process.env } as Record<string, string>;

    // For macOS/Linux, try to get full environment from user's shell
    // This is essential for packaged apps where process.env is minimal
    if (platform === 'darwin' || platform === 'linux') {
      try {
        const shell = getDefaultShell();
        const shellName = path.basename(shell);

        log(`[MCPManager] Getting full environment from ${shellName}...`);

        // Use login shell to get full environment including PATH
        // execFile avoids shell injection — args passed as array, not interpolated string
        const { stdout } = await execFileAsync(shell, ['-l', '-c', 'env'], {
          timeout: 5000,
          env: { HOME: homeDir },
        });

        // Parse environment variables
        const lines = stdout.split(/\r?\n/);
        const shellEnv: Record<string, string> = {};

        for (const line of lines) {
          const equalIndex = line.indexOf('=');
          if (equalIndex > 0) {
            const key = line.substring(0, equalIndex);
            const value = line.substring(equalIndex + 1);
            shellEnv[key] = value;
          }
        }

        // Merge shell environment safely: enrich missing runtime vars but never override
        // config-sensitive keys that were already set by app runtime.
        env = mergeShellEnvForMcp(env, shellEnv);

        // Special handling for PATH: merge both shell PATH and process PATH
        // This ensures we have both user tools (from shell) and system paths (from process)
        if (shellEnv.PATH && process.env.PATH) {
          // For Unix systems (darwin/linux), path delimiter is ':'
          const pathDelimiter = ':';

          const shellPaths = shellEnv.PATH.split(pathDelimiter).filter((p) => p.trim());
          const processPaths = process.env.PATH.split(pathDelimiter).filter((p) => p.trim());

          // Combine and deduplicate paths (shell paths first for priority)
          const allPaths = [...shellPaths];
          for (const p of processPaths) {
            if (!allPaths.includes(p)) {
              allPaths.push(p);
            }
          }

          env.PATH = allPaths.join(pathDelimiter);
          log(
            `[MCPManager] Merged PATH: ${shellPaths.length} paths from shell + ${processPaths.length - (allPaths.length - shellPaths.length)} unique paths from process = ${allPaths.length} total`
          );
        } else if (shellEnv.PATH) {
          env.PATH = shellEnv.PATH;
          log(`[MCPManager] Using shell PATH only`);
        }

        log(
          `[MCPManager] Enhanced environment with ${Object.keys(shellEnv).length} variables from shell`
        );
      } catch (error: unknown) {
        logWarn(
          `[MCPManager] Could not get environment from shell: ${error instanceof Error ? error.message : String(error)}`
        );
        logWarn(`[MCPManager] Using limited process.env, MCP servers may fail`);
      }
    } else if (platform === 'win32') {
      // Windows: try PowerShell to get user PATH
      // Use full path to avoid relying on PATH in Electron packaged environment
      const psExe = path.join(
        process.env.SystemRoot || 'C:\\Windows',
        'System32',
        'WindowsPowerShell',
        'v1.0',
        'powershell.exe'
      );
      try {
        const { stdout } = await execFileAsync(
          psExe,
          [
            '-NoProfile',
            '-Command',
            "[Environment]::GetEnvironmentVariable('Path', 'User') + ';' + [Environment]::GetEnvironmentVariable('Path', 'Machine')",
          ],
          { timeout: 5000 }
        );
        if (stdout.trim()) {
          const pathDelimiter = ';';
          const winPaths = stdout
            .trim()
            .split(pathDelimiter)
            .filter((p) => p.trim());
          const currentPaths = (env.PATH || '').split(pathDelimiter).filter((p) => p.trim());
          const allPaths = [...winPaths];
          for (const p of currentPaths) {
            if (!allPaths.some((ep) => ep.toLowerCase() === p.toLowerCase())) {
              allPaths.push(p);
            }
          }
          env.PATH = allPaths.join(pathDelimiter);
          log(
            `[MCPManager] Enhanced Windows PATH: ${winPaths.length} user/machine paths + ${allPaths.length - winPaths.length} unique process paths = ${allPaths.length} total`
          );
        }
      } catch (error: unknown) {
        logWarn(
          `[MCPManager] Could not get Windows PATH from PowerShell: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    // Add bundled Node.js bin directory to PATH (highest priority)
    // This ensures npx can find the bundled node executable
    const bundledNode = this.getBundledNodePath();
    if (bundledNode && env.PATH) {
      const nodeBinDir = path.dirname(bundledNode.node);
      const pathDelimiter = platform === 'win32' ? ';' : ':';

      // Prepend bundled node bin directory to PATH
      const pathParts = env.PATH.split(pathDelimiter).filter((p) => p.trim());

      // Remove bundled path if it already exists (to avoid duplicates)
      const filteredPaths = pathParts.filter((p) => p !== nodeBinDir);

      // Add bundled path at the beginning
      env.PATH = [nodeBinDir, ...filteredPaths].join(pathDelimiter);
      log(`[MCPManager] Prepended bundled Node.js bin to PATH: ${nodeBinDir}`);
    }

    log(`[MCPManager] Final PATH: ${env.PATH?.substring(0, 150)}...`);

    return env;
  }

  /**
   * Initialize MCP servers from configuration
   */
  async initializeServers(configs: MCPServerConfig[]): Promise<void> {
    if (this.initializingServers) {
      // Store the latest config so we can replay it once the current init finishes
      this.pendingInitConfigs = configs;
      return;
    }
    this.initializingServers = true;
    try {
      const fingerprint = JSON.stringify(
        configs.map((c) => ({
          id: c.id,
          enabled: c.enabled,
          command: c.command,
          args: c.args,
          url: c.url,
          env: c.env,
          headers: c.headers,
        }))
      );
      if (fingerprint === this.lastConfigFingerprint) {
        log('[MCPManager] Config unchanged, skipping re-initialization');
        return;
      }
      this.lastConfigFingerprint = fingerprint;

      log('[MCPManager] Initializing', configs.length, 'MCP servers');

      // Close existing connections
      await this.disconnectAll();

      // Store configurations
      this.serverConfigs.clear();
      for (const config of configs) {
        this.serverConfigs.set(config.id, config);
      }

      // Connect to enabled servers in parallel
      const enabledConfigs = configs.filter((c) => c.enabled);
      await Promise.allSettled(
        enabledConfigs.map(async (config) => {
          try {
            await this.connectServer(config);
          } catch (error) {
            logError(`[MCPManager] Failed to connect to server ${config.name}:`, error);
          }
        })
      );

      // Refresh tools from all connected servers
      await this.refreshTools();
    } finally {
      this.initializingServers = false;
      // Replay any config that arrived while we were initializing
      if (this.pendingInitConfigs !== null) {
        const pending = this.pendingInitConfigs;
        this.pendingInitConfigs = null;
        await this.initializeServers(pending);
      }
    }
  }

  /**
   * Update a single server configuration and reconnect if needed
   * This is more efficient than reinitializing all servers
   */
  async updateServer(config: MCPServerConfig): Promise<void> {
    // Defer if initialization is in progress to avoid races
    if (this.initializingServers) {
      log('[MCPManager] Deferring update during initialization');
      return;
    }
    // Prevent concurrent update while a reconnect is already in progress for this server
    if (this.reconnectingServers.has(config.id)) {
      logWarn(
        `[MCPManager] Skipping updateServer for ${config.name}: reconnect already in progress`
      );
      return;
    }
    log(`[MCPManager] Updating server: ${config.name} (enabled: ${config.enabled})`);
    this.lastConfigFingerprint = null;

    // Store the updated config
    this.serverConfigs.set(config.id, config);

    // Check if server is currently connected
    const isConnected = this.clients.has(config.id);

    if (config.enabled && !isConnected) {
      // Need to connect
      try {
        await this.connectServer(config);
        await this.refreshTools();
      } catch (error) {
        logError(`[MCPManager] Failed to connect to server ${config.name}:`, error);
        throw error;
      }
    } else if (!config.enabled && isConnected) {
      // Need to disconnect
      await this.disconnectServer(config.id);
      await this.refreshTools();
    } else if (config.enabled && isConnected) {
      // Config changed, reconnect
      await this.disconnectServer(config.id);
      try {
        await this.connectServer(config);
        await this.refreshTools();
      } catch (error) {
        logError(`[MCPManager] Failed to reconnect server ${config.name}:`, error);
        throw error;
      }
    }
    // If disabled and not connected, nothing to do
  }

  /**
   * Remove a server from tracking (call after deleting from config store)
   */
  async removeServer(serverId: string): Promise<void> {
    log(`[MCPManager] Removing server: ${serverId}`);
    this.lastConfigFingerprint = null;
    await this.disconnectServer(serverId);
    this.serverConfigs.delete(serverId);
    this.oauthProviders.delete(serverId);
    await this.refreshTools();
  }

  /**
   * Get the path to a MCP server file in the mcp directory
   */
  private getMcpServerPath(filename: string): string {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require('fs');

    // In development: __dirname points to dist-electron/main
    // In production: appPath points to the app.asar or unpacked app
    if (app.isPackaged) {
      // Production: use compiled JavaScript files from extraResources/mcp
      // Convert .ts extension to .js
      const jsFilename = filename.replace(/\.ts$/, '.js');
      const mcpPath = path.join(process.resourcesPath || '', 'mcp', jsFilename);

      // Check if compiled JS file exists in resources
      try {
        if (fs.existsSync(mcpPath)) {
          log(`[MCPManager] Found MCP server at: ${mcpPath}`);
          return mcpPath;
        } else {
          logError(`[MCPManager] File not found at: ${mcpPath}`);
        }
      } catch (error) {
        logError(`[MCPManager] Error checking MCP server path: ${error}`);
      }
    }

    // Development: __dirname is dist-electron/main
    // Need to go up 2 levels to get to project root (dist-electron/main -> dist-electron -> project root)
    const projectRoot = path.join(__dirname, '..', '..');

    // Prefer bundled JS from dist-mcp in development.
    // This avoids running TypeScript directly with `node` (which will fail without a TS loader).
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

    // Fallback to source TypeScript (requires running via tsx/ts-node if using command 'node')
    const sourcePath = path.join(projectRoot, 'src', 'main', 'mcp', filename);

    // Verify file exists and log for debugging
    try {
      if (fs.existsSync(sourcePath)) {
        log(`[MCPManager] MCP Server path resolved (${filename}):`, sourcePath);
        return sourcePath;
      } else {
        logError(`[MCPManager] File not found at:`, sourcePath);
        logError('[MCPManager] __dirname:', __dirname);
        logError('[MCPManager] projectRoot:', projectRoot);
      }
    } catch (error) {
      logError('[MCPManager] Error checking file:', error);
    }

    return sourcePath;
  }

  /**
   * Get the path to the Software Development MCP server file
   */
  private getSoftwareDevServerPath(): string {
    return this.getMcpServerPath('software-dev-server-example.ts');
  }

  /**
   * Get the path to the GUI Operate MCP server file
   */
  private getGuiOperateServerPath(): string {
    return this.getMcpServerPath('gui-operate-server.ts');
  }

  /**
   * Connect to a single MCP server
   */
  private async connectServer(config: MCPServerConfig): Promise<void> {
    log(`[MCPManager] Connecting to MCP server: ${config.name} (${config.type})`);

    // Mark status as connecting at the very start, before any transport creation
    this.connectionStatus.set(config.id, 'connecting');

    try {
      await this.connectServerInternal(config);
      this.connectionStatus.set(config.id, 'connected');
    } catch (error) {
      this.connectionStatus.set(config.id, 'failed');
      throw error;
    }
  }

  /**
   * Internal connect logic — separated so connectServer can guarantee
   * connectionStatus is always set to 'connected' or 'failed'.
   */
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
      // Prevent UnhandledPromiseRejection from the orphaned connectPromise
      // when timeout wins the race and transport is closed beneath it.
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

  /**
   * Disconnect from a specific server
   */
  async disconnectServer(serverId: string): Promise<void> {
    const client = this.clients.get(serverId);
    const transport = this.transports.get(serverId);

    if (client) {
      try {
        await client.close();
      } catch (error) {
        logError(`[MCPManager] Error closing client for ${serverId}:`, error);
      }
      this.clients.delete(serverId);
    }

    if (transport) {
      try {
        await transport.close();
      } catch (error) {
        logError(`[MCPManager] Error closing transport for ${serverId}:`, error);
      }
      this.transports.delete(serverId);
    }

    // Remove tools from this server
    const toolsToRemove: string[] = [];
    for (const [toolName, tool] of this.tools.entries()) {
      if (tool.serverId === serverId) {
        toolsToRemove.push(toolName);
      }
    }
    for (const toolName of toolsToRemove) {
      this.tools.delete(toolName);
    }

    this.connectionStatus.delete(serverId);

    log(`[MCPManager] Disconnected from server ${serverId}`);
  }

  /**
   * Disconnect from all servers
   */
  async disconnectAll(): Promise<void> {
    const serverIds = Array.from(this.clients.keys());
    for (const serverId of serverIds) {
      await this.disconnectServer(serverId);
    }
  }

  /**
   * Refresh tools from all connected servers with timeout protection
   */
  async refreshTools(): Promise<void> {
    log('[MCPManager] Refreshing tools from all servers');

    const toolResults: RefreshToolsResult[] = await Promise.all(
      Array.from(this.clients.entries()).map(async ([serverId, client]) => {
        const config = this.serverConfigs.get(serverId);
        if (!config) {
          return { kind: 'success', serverId, tools: [] as MCPTool[] };
        }

        const timeoutMs = MCP_LIST_TOOLS_TIMEOUT_MS;
        log(`[MCPManager] Fetching tools from ${config.name} (timeout: ${timeoutMs}ms)...`);

        try {
          const listToolsResult = await raceWithTimeout(
            client.listTools(),
            timeoutMs,
            `listTools timeout after ${timeoutMs}ms`
          );

          log(`[MCPManager] Raw tools from ${config.name}:`, listToolsResult);

          // Sort alphabetically so dedup suffix assignment is deterministic
          // across reconnects (otherwise session history can reference a name
          // that later changes if the server returns tools in a new order).
          const sortedTools = [...listToolsResult.tools].sort((left, right) => {
            const leftName = left.name || '';
            const rightName = right.name || '';
            if (leftName < rightName) return -1;
            if (leftName > rightName) return 1;
            return 0;
          });

          // OpenAI-compatible providers reject tool names that contain
          // punctuation like dots or colons, so we expose a sanitized
          // model-facing name while preserving the original MCP tool name
          // for the actual call.
          const serverKey = sanitizeMcpToolSegment(config.name, 'server');
          const usedToolNames = new Set<string>();
          const tools = sortedTools.map((tool) => {
            const originalToolName =
              typeof tool.name === 'string' && tool.name.trim().length > 0 ? tool.name : 'tool';
            const sanitizedToolName = sanitizeMcpToolSegment(originalToolName, 'tool');
            const prefixedName = createUniqueMcpToolName(
              `mcp__${serverKey}__${sanitizedToolName}`,
              usedToolNames
            );
            return {
              name: prefixedName,
              originalName: originalToolName,
              description: tool.description || '',
              inputSchema: {
                type: 'object',
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                properties: (tool.inputSchema as any)?.properties || {},
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                required: (tool.inputSchema as any)?.required,
              },
              serverId,
              serverName: config.name,
            } satisfies MCPTool;
          });

          log(`[MCPManager] ✓ Loaded ${tools.length} tools from ${config.name}`);
          return { kind: 'success' as const, serverId, tools };
        } catch (error) {
          return { kind: 'error' as const, serverId, error };
        }
      })
    );

    const newTools = new Map<string, MCPTool>();
    for (const result of toolResults) {
      if (result.kind === 'success') {
        for (const tool of result.tools) {
          newTools.set(tool.name, tool);
        }
        continue;
      }

      const error = result.error;
      const errMsg = error instanceof Error ? error.message : String(error);
      logError(`[MCPManager] ❌ Error listing tools from ${result.serverId}:`, errMsg);

      try {
        const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed());
        if (win) {
          win.webContents.send('server-event', {
            type: 'mcp:tools-refresh-error',
            payload: { serverId: result.serverId, error: errMsg },
          });
        }
      } catch (_notifyErr) {
        // Best-effort notification; logging already happened above
      }

      const config = this.serverConfigs.get(result.serverId);
      if (config && config.name.toLowerCase().includes('chrome')) {
        log(`[MCPManager] Chrome server may need reconnection. Trying to refresh...`);
      }
    }

    this.tools = newTools; // atomic swap

    log(`[MCPManager] Total tools available: ${this.tools.size}`);
  }

  /**
   * Get all available MCP tools
   */
  getTools(): MCPTool[] {
    return Array.from(this.tools.values());
  }

  /**
   * Get tool by name
   */
  getTool(toolName: string): MCPTool | undefined {
    return this.tools.get(toolName);
  }

  /**
   * Call an MCP tool with timeout and retry
   */
  async callTool(toolName: string, args: Record<string, unknown>): Promise<unknown> {
    const tool = this.tools.get(toolName);
    if (!tool) {
      throw new Error(`MCP tool not found: ${toolName}`);
    }

    // Prefer the original MCP tool name when present so sanitized model-facing
    // names can still map back to the true server tool.
    let actualToolName = tool.originalName || toolName;
    if (!tool.originalName && toolName.startsWith('mcp__')) {
      const remainder = toolName.slice('mcp__'.length);
      const separatorIndex = remainder.indexOf('__');
      if (separatorIndex !== -1) {
        actualToolName = remainder.slice(separatorIndex + 2);
      }
    }

    logCtx(`[MCPManager] Calling tool ${actualToolName} on server ${tool.serverName}`);

    const callStartTime = Date.now();
    const maxRetries = 2;
    let lastError: unknown;
    let compatHotReloadTried = false;
    const deadline = Date.now() + MCP_TOOL_CALL_TIMEOUT_MS;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      // Re-lookup tool on every iteration: after reconnect the registry is refreshed
      const currentTool = this.tools.get(toolName) ?? tool;
      try {
        const client = this.clients.get(currentTool.serverId);
        if (!client) {
          throw new Error(`MCP server not connected: ${currentTool.serverId}`);
        }

        const remainingMs = deadline - Date.now();
        if (remainingMs <= 0) {
          throw new Error(`Tool call timeout after ${MCP_TOOL_CALL_TIMEOUT_MS}ms`);
        }

        const callPromise = client.callTool({
          name: actualToolName,
          arguments: args,
        });
        const result = await raceWithTimeout(
          callPromise,
          remainingMs,
          `Tool call timeout after ${MCP_TOOL_CALL_TIMEOUT_MS}ms`
        );

        const toolErrorMessage = extractStructuredToolErrorMessage(result);
        if (shouldReconnectOnStructuredToolError(toolErrorMessage)) {
          // 某些 MCP 服务会把连接错误包在结构化结果里而非直接抛异常，这里转为异常以复用统一重连逻辑。
          throw new Error(toolErrorMessage);
        }
        if (
          !compatHotReloadTried &&
          shouldHotReloadGuiVisionServer(currentTool.serverName, actualToolName, toolErrorMessage)
        ) {
          compatHotReloadTried = true;
          logWarn(
            `[MCPManager] Detected GUI vision compatibility error (${toolErrorMessage}). Reconnecting server ${currentTool.serverName} and retrying once.`
          );
          const reconnected = await this.reconnectServer(currentTool.serverId);
          if (reconnected) {
            continue;
          }
        }

        logTiming(`MCP tool ${actualToolName}`, callStartTime);
        return result;
      } catch (error: unknown) {
        lastError = error;
        const errorMsg = error instanceof Error ? error.message : String(error);
        logCtxError(
          `[MCPManager] Error calling tool ${toolName} (attempt ${attempt + 1}/${maxRetries + 1}):`,
          errorMsg
        );

        if (attempt >= maxRetries) {
          break;
        }

        const lowerErrorMsg = errorMsg.toLowerCase();
        const shouldReconnect =
          lowerErrorMsg.includes('mcp server not connected') ||
          lowerErrorMsg.includes('not connected') ||
          lowerErrorMsg.includes('connection closed');

        if (shouldReconnect) {
          log(
            `[MCPManager] Reconnectable MCP error detected for ${currentTool.serverName}; attempting reconnect...`
          );
          const reconnected = await this.reconnectServer(currentTool.serverId);
          if (reconnected) {
            continue;
          }
          logWarn(
            `[MCPManager] Reconnect attempt failed for ${currentTool.serverName}, will retry after backoff`
          );
          const delay = Math.min(2000 * Math.pow(1.5, attempt), 10000);
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }

        if (errorMsg.includes('timeout')) {
          if (attempt >= maxRetries || deadline - Date.now() <= 0) {
            break;
          }
          log(`[MCPManager] Tool call timeout detected, retrying within shared deadline...`);
          const delay = Math.min(2000 * Math.pow(1.5, attempt), 10000);
          const remainingAfterDelay = deadline - Date.now();
          if (remainingAfterDelay <= 0) {
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, Math.min(delay, remainingAfterDelay)));
          continue;
        }

        // For non-retryable errors, exit retry loop immediately
        break;
      }
    }

    throw lastError;
  }

  private async reconnectServer(serverId: string): Promise<boolean> {
    // Prevent concurrent reconnect operations for the same server
    if (this.reconnectingServers.has(serverId)) {
      logWarn(
        `[MCPManager] Skipping reconnectServer for ${serverId}: reconnect already in progress`
      );
      return false;
    }
    const config = this.serverConfigs.get(serverId);
    if (!config || !config.enabled) {
      logWarn(`[MCPManager] Cannot reconnect server ${serverId}: config missing or disabled`);
      return false;
    }

    this.reconnectingServers.add(serverId);
    // Pre-set 'connecting' before disconnect to avoid status flickering to 'disabled'
    this.connectionStatus.set(serverId, 'connecting');
    try {
      await this.disconnectServer(serverId);
      await this.connectServer(config);
      await this.refreshTools();
      log(`[MCPManager] Reconnected server ${config.name} (${serverId})`);
      return true;
    } catch (error) {
      logError(`[MCPManager] Failed to reconnect server ${serverId}:`, error);
      return false;
    } finally {
      this.reconnectingServers.delete(serverId);
    }
  }

  /**
   * Get server status
   */
  getServerStatus(): Array<{
    id: string;
    name: string;
    connected: boolean;
    status: 'connecting' | 'connected' | 'failed' | 'disabled';
    toolCount: number;
  }> {
    const status: Array<{
      id: string;
      name: string;
      connected: boolean;
      status: 'connecting' | 'connected' | 'failed' | 'disabled';
      toolCount: number;
    }> = [];

    for (const [serverId, config] of this.serverConfigs.entries()) {
      const connected = this.clients.has(serverId);
      const toolCount = Array.from(this.tools.values()).filter(
        (tool) => tool.serverId === serverId
      ).length;

      // Derive status: use connectionStatus map if available, otherwise infer from enabled/connected
      let serverStatus: 'connecting' | 'connected' | 'failed' | 'disabled';
      const trackedStatus = this.connectionStatus.get(serverId);
      if (!config.enabled) {
        serverStatus = 'disabled';
      } else if (trackedStatus) {
        serverStatus = trackedStatus;
      } else if (connected) {
        serverStatus = 'connected';
      } else {
        // Enabled server with no tracked status and no client — likely transient
        // (e.g. during reconnect after disconnectServer deleted the entry).
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

  /**
   * Cleanup on shutdown
   */
  async shutdown(): Promise<void> {
    await this.disconnectAll();
  }
}

function extractStructuredToolErrorMessage(result: unknown): string {
  if (!result || typeof result !== 'object') {
    return '';
  }

  const topLevelIsError = (result as { isError?: unknown }).isError === true;
  const resultObj = result as { content?: unknown };
  const content = Array.isArray(resultObj.content) ? resultObj.content : [];
  for (const item of content) {
    if (!item || typeof item !== 'object') continue;
    if ((item as { type?: string }).type !== 'text') continue;
    const text = (item as { text?: unknown }).text;
    if (typeof text !== 'string') continue;

    const trimmed = text.trim();
    if (!trimmed) continue;

    if (trimmed.startsWith('{')) {
      try {
        const parsed = JSON.parse(trimmed) as { error?: unknown; message?: unknown };
        if (parsed.error === true && typeof parsed.message === 'string' && parsed.message.trim()) {
          return parsed.message.trim();
        }
      } catch {
        // Ignore malformed JSON payloads
      }
    }

    if (topLevelIsError && isReconnectableErrorText(trimmed)) {
      return trimmed;
    }
  }

  return '';
}

function isReconnectableErrorText(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  return (
    normalized === 'not connected' ||
    normalized.includes('mcp server not connected') ||
    normalized.includes('connection closed')
  );
}

function shouldReconnectOnStructuredToolError(errorMessage: string): boolean {
  if (!errorMessage) {
    return false;
  }
  return isReconnectableErrorText(errorMessage);
}

function shouldHotReloadGuiVisionServer(
  serverName: string,
  actualToolName: string,
  errorMessage: string
): boolean {
  if (!errorMessage) {
    return false;
  }
  if (actualToolName !== 'gui_verify_vision') {
    return false;
  }
  if (!serverName.toLowerCase().includes('gui')) {
    return false;
  }

  return (
    errorMessage.includes('Unsupported parameter: max_output_tokens') ||
    errorMessage.includes('Instructions are required') ||
    errorMessage.includes('Stream must be set to true')
  );
}
