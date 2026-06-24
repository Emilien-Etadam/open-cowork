import { BrowserWindow } from 'electron';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';

import { log, logCtx, logCtxError, logError, logTiming, logWarn } from '../utils/logger.js';
import { createUniqueMcpToolName, sanitizeMcpToolSegment } from './mcp-tool-naming.js';
import type { MCPServerConfig, MCPTool, RefreshToolsResult } from './mcp-types.js';

const MCP_LIST_TOOLS_TIMEOUT_MS = 5 * 60 * 1000;
const MCP_TOOL_CALL_TIMEOUT_MS = 5 * 60 * 1000;

export interface MCPToolRegistryContext {
  clients: Map<string, Client>;
  serverConfigs: Map<string, MCPServerConfig>;
  reconnectingServers: Set<string>;
  connectionStatus: Map<string, 'connecting' | 'connected' | 'failed'>;
  getToolMap(): Map<string, MCPTool>;
  setToolMap(tools: Map<string, MCPTool>): void;
  disconnectServer(serverId: string): Promise<void>;
  connectServer(config: MCPServerConfig): Promise<void>;
}

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

export async function refreshTools(ctx: MCPToolRegistryContext): Promise<void> {
  log('[MCPManager] Refreshing tools from all servers');

  const toolResults: RefreshToolsResult[] = await Promise.all(
    Array.from(ctx.clients.entries()).map(async ([serverId, client]) => {
      const config = ctx.serverConfigs.get(serverId);
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

        const sortedTools = [...listToolsResult.tools].sort((left, right) => {
          const leftName = left.name || '';
          const rightName = right.name || '';
          if (leftName < rightName) return -1;
          if (leftName > rightName) return 1;
          return 0;
        });

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
      const win = BrowserWindow.getAllWindows().find((window) => !window.isDestroyed());
      if (win) {
        win.webContents.send('server-event', {
          type: 'mcp:tools-refresh-error',
          payload: { serverId: result.serverId, error: errMsg },
        });
      }
    } catch {
      // Best-effort notification; logging already happened above
    }

    const config = ctx.serverConfigs.get(result.serverId);
    if (config && config.name.toLowerCase().includes('chrome')) {
      log('[MCPManager] Chrome server may need reconnection. Trying to refresh...');
    }
  }

  ctx.setToolMap(newTools);
  log(`[MCPManager] Total tools available: ${newTools.size}`);
}

export function getTools(ctx: Pick<MCPToolRegistryContext, 'getToolMap'>): MCPTool[] {
  return Array.from(ctx.getToolMap().values());
}

export function getTool(
  ctx: Pick<MCPToolRegistryContext, 'getToolMap'>,
  toolName: string
): MCPTool | undefined {
  return ctx.getToolMap().get(toolName);
}

export async function callTool(
  ctx: MCPToolRegistryContext,
  toolName: string,
  args: Record<string, unknown>
): Promise<unknown> {
  const tool = ctx.getToolMap().get(toolName);
  if (!tool) {
    throw new Error(`MCP tool not found: ${toolName}`);
  }

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
    const currentTool = ctx.getToolMap().get(toolName) ?? tool;

    try {
      const client = ctx.clients.get(currentTool.serverId);
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
        const reconnected = await reconnectServer(ctx, currentTool.serverId);
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
        const reconnected = await reconnectServer(ctx, currentTool.serverId);
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
        if (deadline - Date.now() <= 0) {
          break;
        }
        log('[MCPManager] Tool call timeout detected, retrying within shared deadline...');
        const delay = Math.min(2000 * Math.pow(1.5, attempt), 10000);
        const remainingAfterDelay = deadline - Date.now();
        if (remainingAfterDelay <= 0) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, Math.min(delay, remainingAfterDelay)));
        continue;
      }

      break;
    }
  }

  throw lastError;
}

export async function reconnectServer(
  ctx: MCPToolRegistryContext,
  serverId: string
): Promise<boolean> {
  if (ctx.reconnectingServers.has(serverId)) {
    logWarn(`[MCPManager] Skipping reconnectServer for ${serverId}: reconnect already in progress`);
    return false;
  }

  const config = ctx.serverConfigs.get(serverId);
  if (!config || !config.enabled) {
    logWarn(`[MCPManager] Cannot reconnect server ${serverId}: config missing or disabled`);
    return false;
  }

  ctx.reconnectingServers.add(serverId);
  ctx.connectionStatus.set(serverId, 'connecting');

  try {
    await ctx.disconnectServer(serverId);
    await ctx.connectServer(config);
    await refreshTools(ctx);
    log(`[MCPManager] Reconnected server ${config.name} (${serverId})`);
    return true;
  } catch (error) {
    logError(`[MCPManager] Failed to reconnect server ${serverId}:`, error);
    return false;
  } finally {
    ctx.reconnectingServers.delete(serverId);
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
  return Boolean(errorMessage) && isReconnectableErrorText(errorMessage);
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
