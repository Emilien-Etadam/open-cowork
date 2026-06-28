import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { app } from 'electron';

import path from 'path';
import { connectWithOAuthRetry, type OpenCoworkMcpOAuthProvider } from './mcp-oauth';
import { log, logError, logWarn } from '../utils/logger';
import { getBundledPythonPaths } from '../runtime/python-runtime.js';
import { getBundledCliclickPath } from '../runtime/gui-tools-runtime.js';
import type { MCPServerConfig, MCPTransport } from './mcp-types';

export interface ConnectServerInternalDeps {
  getBundledNodePath(): { node: string; npx: string } | null;
  getSoftwareDevServerPath(): string;
  getGuiOperateServerPath(): string;
  getEnhancedEnv(configEnv: Record<string, string>): Promise<Record<string, string>>;
  resolvePreferredNpxPath(pathEnv: string | undefined): Promise<string>;
  connectClientWithTimeout(
    client: Client,
    transport: MCPTransport,
    timeoutMs: number
  ): Promise<void>;
  getOrCreateStreamableHttpOAuthProvider(config: MCPServerConfig): OpenCoworkMcpOAuthProvider;
  ensureChromeReady(serverName: string, client: Client): Promise<void>;
}

/**
 * Internal connect logic extracted from MCPManager so status tracking can stay in the class.
 */
export async function connectServerInternal(
  config: MCPServerConfig,
  deps: ConnectServerInternalDeps
): Promise<{ client: Client; transport: MCPTransport }> {
  let transport: MCPTransport;
  let commandForLogging = '';
  let argsForLogging: string[] = [];
  const connectTimeoutMs = 30000;

  const client = new Client(
    {
      name: 'lygodactylus',
      version: '0.1.0',
    },
    {
      capabilities: {},
    }
  );

  if (config.type === 'stdio') {
    if (!config.command) {
      throw new Error(`STDIO server ${config.name} requires a command`);
    }

    let command = config.command;
    let args = config.args || [];

    const isBuiltinServer =
      config.name === 'GUI_Operate' ||
      config.name === 'GUI Operate' ||
      config.name === 'Software_Development' ||
      config.name === 'Software Development';
    const isOldConfig =
      (command === 'npx' || command.endsWith('/npx')) &&
      args.includes('-y') &&
      args.includes('tsx');

    if (isBuiltinServer && isOldConfig && app.isPackaged) {
      log(`[MCPManager] Auto-migrating ${config.name} from npx/tsx to node (production mode)`);

      const bundledNode = deps.getBundledNodePath();
      if (bundledNode) {
        command = bundledNode.node;
        args = args.filter((arg) => arg !== '-y' && arg !== 'tsx');
        log(`[MCPManager] Updated command: ${command} ${args.join(' ')}`);
      }
    }

    args = args.map((arg) => {
      if (arg === '{SOFTWARE_DEV_SERVER_PATH}') {
        return deps.getSoftwareDevServerPath();
      }
      if (arg === '{GUI_OPERATE_SERVER_PATH}') {
        return deps.getGuiOperateServerPath();
      }
      return arg;
    });

    if (!app.isPackaged && isBuiltinServer) {
      const cmdBase = path.basename(command).toLowerCase();
      const isNodeCmd = cmdBase === 'node' || cmdBase === 'node.exe';
      const tsScript = args.find((a) => typeof a === 'string' && a.endsWith('.ts'));
      if (isNodeCmd && tsScript) {
        throw new Error(
          `[MCPManager] Development config is trying to run a TypeScript MCP server with node:\n` +
            `  ${command} ${args.join(' ')}\n\n` +
            `Fix:\n` +
            `- Run: npm run build:mcp (or restart npm run dev, which should run it)\n` +
            `- Or change this server command to: npx -y tsx <server.ts>\n`
        );
      }
    }

    const env = await deps.getEnhancedEnv(config.env || {});

    if (command === 'npx' || command.endsWith('/npx')) {
      command = await deps.resolvePreferredNpxPath(env.PATH);
    }

    if (process.platform === 'win32') {
      const cmdBase = path.basename(command).toLowerCase();
      const winSuffixMap: Record<string, string> = {
        npx: '.cmd',
        npm: '.cmd',
        yarn: '.cmd',
        pnpm: '.cmd',
        tsx: '.cmd',
        'ts-node': '.cmd',
        node: '.exe',
      };
      if (winSuffixMap[cmdBase] && command === cmdBase) {
        command = command + winSuffixMap[cmdBase];
        log(`[MCPManager] Windows: resolved bare command '${cmdBase}' to '${command}'`);
      }
    }

    commandForLogging = command;
    argsForLogging = args;

    log('[MCPManager] Server auth env summary', {
      server: config.name,
      OPENAI_API_KEY: env.OPENAI_API_KEY?.trim() ? 'set' : 'unset',
      OPENAI_BASE_URL: env.OPENAI_BASE_URL || '(unset)',
      OPENAI_MODEL: env.OPENAI_MODEL || '(unset)',
      OPENAI_ACCOUNT_ID: env.OPENAI_ACCOUNT_ID?.trim() ? 'set' : 'unset',
      ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY?.trim() ? 'set' : 'unset',
      ANTHROPIC_AUTH_TOKEN: env.ANTHROPIC_AUTH_TOKEN?.trim() ? 'set' : 'unset',
    });

    if (app.isPackaged && isBuiltinServer) {
      const unpackedNodeModules = path.join(
        process.resourcesPath || '',
        'app.asar.unpacked',
        'node_modules'
      );
      const asarNodeModules = path.join(process.resourcesPath || '', 'app.asar', 'node_modules');

      env.NODE_PATH = [unpackedNodeModules, asarNodeModules].join(path.delimiter);
      log(`[MCPManager] Set NODE_PATH for MCP server: ${env.NODE_PATH}`);

      env.OPEN_COWORK_RESOURCES_PATH = process.resourcesPath || '';

      const pythonPaths = getBundledPythonPaths();
      if (pythonPaths) {
        env.OPEN_COWORK_PYTHON_PATH = pythonPaths.python;
        env.OPEN_COWORK_PYTHON_HOME = pythonPaths.pythonRoot;
      }

      const cliclickPath = getBundledCliclickPath();
      if (cliclickPath) {
        env.OPEN_COWORK_CLICLICK_PATH = cliclickPath;
      }
    }

    log(`[MCPManager] Creating STDIO transport: ${command} ${args.join(' ')}`);
    log(`[MCPManager] Environment variables: ${Object.keys(env).length} vars`);
    log(`[MCPManager] PATH: ${env.PATH?.substring(0, 200)}...`);
    log(`[MCPManager] HOME: ${env.HOME}`);
    log(`[MCPManager] NODE_PATH: ${env.NODE_PATH || '(not set)'}`);

    const isNpxCommand =
      path.basename(command).toLowerCase() === 'npx' ||
      path.basename(command).toLowerCase() === 'npx.cmd';
    if (isNpxCommand) {
      try {
        const { exec } = await import('child_process');
        const { promisify } = await import('util');
        const execAsync = promisify(exec);

        const quotedCmd = command.includes(' ') ? `"${command}"` : command;
        log(`[MCPManager] Testing npx execution: ${quotedCmd} --version`);
        const testResult = await execAsync(`${quotedCmd} --version`, {
          timeout: 5000,
          env,
        });
        log(`[MCPManager] npx test successful: ${testResult.stdout.trim()}`);
      } catch (testError: unknown) {
        const errorMsg = testError instanceof Error ? testError.message : String(testError);
        logError(`[MCPManager] npx test failed: ${errorMsg}`);
        if (
          testError instanceof Error &&
          (testError as NodeJS.ErrnoException & { stderr?: string }).stderr
        ) {
          logError(
            `[MCPManager] npx test stderr: ${(testError as NodeJS.ErrnoException & { stderr?: string }).stderr}`
          );
        }
        logError(
          `[MCPManager] npx pre-check failed. The connection attempt will proceed but may fail.`
        );
      }
    }

    transport = new StdioClientTransport({
      command,
      args,
      env,
      cwd: config.cwd || undefined,
    });

    log(`[MCPManager] STDIO transport created successfully`);
  } else if (config.type === 'sse') {
    if (!config.url) {
      throw new Error(`SSE server ${config.name} requires a URL`);
    }

    let sseUrl: URL;
    try {
      sseUrl = new URL(config.url);
    } catch {
      throw new Error(`SSE server ${config.name} has a malformed URL: "${config.url}"`);
    }

    transport = new SSEClientTransport(sseUrl, { requestInit: { headers: config.headers } });
  } else if (config.type === 'streamable-http') {
    if (!config.url) {
      throw new Error(`Streamable HTTP server ${config.name} requires a URL`);
    }

    log(`[MCPManager] Creating Streamable HTTP transport: ${config.url}`);

    let httpUrl: URL;
    try {
      httpUrl = new URL(config.url);
    } catch {
      throw new Error(`Streamable HTTP server ${config.name} has a malformed URL: "${config.url}"`);
    }

    const requestInit: RequestInit = {};
    if (config.headers && Object.keys(config.headers).length > 0) {
      requestInit.headers = config.headers;
    }

    const authProvider = deps.getOrCreateStreamableHttpOAuthProvider(config);
    transport = await connectWithOAuthRetry<StreamableHTTPClientTransport>({
      connect: async (streamableTransport: StreamableHTTPClientTransport) => {
        await deps.connectClientWithTimeout(client, streamableTransport, connectTimeoutMs);
      },
      createTransport: (provider) =>
        new StreamableHTTPClientTransport(httpUrl, { authProvider: provider, requestInit }),
      provider: authProvider,
    });
  } else {
    throw new Error(`Unsupported transport type: ${config.type}`);
  }

  log(`[MCPManager] MCP client created, attempting to connect...`);

  try {
    if (config.type !== 'streamable-http') {
      await deps.connectClientWithTimeout(client, transport, connectTimeoutMs);
    }
    log(`[MCPManager] Client.connect() completed successfully`);

    if (config.type === 'stdio') {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const transportAny = transport as any;
        if (transportAny._process) {
          const childProcess = transportAny._process;
          log(`[MCPManager] MCP server process spawned with PID: ${childProcess.pid}`);

          childProcess.unref();

          if (childProcess.stderr) {
            childProcess.stderr.on('data', (data: Buffer) => {
              try {
                const message = data.toString().trim();
                if (message) {
                  logError(`[MCPManager] MCP server stderr: ${message}`);
                }
              } catch (error) {
                logError('[MCPManager] Error processing MCP server stderr:', error);
              }
            });
          }

          childProcess.on('exit', (code: number, signal: string) => {
            if (code !== null && code !== 0) {
              logError(`[MCPManager] MCP server process exited with code ${code}`);
            } else if (signal) {
              logError(`[MCPManager] MCP server process killed with signal ${signal}`);
            } else {
              log(`[MCPManager] MCP server process exited normally`);
            }
          });

          childProcess.on('error', (error: Error) => {
            logError(`[MCPManager] MCP server process error: ${error.message}`);
            logError(`[MCPManager] Error stack: ${error.stack}`);
          });
        } else {
          logWarn(`[MCPManager] transport._process is not set after connect`);
        }
      } catch (e: unknown) {
        logWarn(
          `[MCPManager] Could not attach to MCP server process for logging: ${e instanceof Error ? e.message : String(e)}`
        );
      }
    }
  } catch (error: unknown) {
    logError(`[MCPManager] Client.connect() failed:`, error);
    const connErr = error as { code?: unknown; name?: unknown; message?: unknown };
    logError(
      `[MCPManager] Error details - code: ${connErr.code}, name: ${connErr.name}, message: ${connErr.message}`
    );

    if (config.type === 'stdio' && commandForLogging) {
      logError(`[MCPManager] STDIO transport may have failed to spawn process or communicate`);
      logError(`[MCPManager] Command was: ${commandForLogging} ${argsForLogging.join(' ')}`);
    }

    try {
      await transport.close();
    } catch {
      /* ignore close error */
    }
    throw error;
  }

  log(`[MCPManager] Connected to ${config.name}`);

  if (config.name.toLowerCase().includes('chrome')) {
    try {
      await deps.ensureChromeReady(config.name, client);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logWarn(
        `[MCPManager] Chrome readiness check failed for ${config.name}; MCP server connected but browser tools may be unavailable until Chrome debug port is ready: ${message}`
      );
    }
  }

  return { client, transport };
}
