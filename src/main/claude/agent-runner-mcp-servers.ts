import * as path from 'path';
import { mcpConfigStore } from '../mcp/mcp-config-store';
import { log, logError, logWarn } from '../utils/logger';
import { getBundledNodePaths } from './agent-runner-path-env';
import { safeStringify, toErrorText } from './agent-runner-mcp-bridge';
import type { AgentRunnerRunContext } from './agent-runner-run-context';

export function logMcpServersSummary(mcpServers: Record<string, unknown>): void {
  const summary = Object.entries(mcpServers).map(([name, serverConfig]) => {
    const typedServerConfig = serverConfig as {
      type?: string;
      command?: string;
      args?: unknown[];
      env?: Record<string, unknown>;
    };

    return {
      name,
      type: typedServerConfig.type ?? 'unknown',
      command: typedServerConfig.command ?? '',
      argsCount: Array.isArray(typedServerConfig.args) ? typedServerConfig.args.length : 0,
      envKeys: typedServerConfig.env ? Object.keys(typedServerConfig.env).length : 0,
    };
  });

  log('[ClaudeAgentRunner] Final mcpServers summary:', safeStringify(summary, 2));
  if (process.env.COWORK_LOG_SDK_MESSAGES_FULL === '1') {
    log('[ClaudeAgentRunner] Final mcpServers config:', safeStringify(mcpServers, 2));
  }
}

export function buildMcpServers(
  ctx: AgentRunnerRunContext,
  imageCapable: boolean
): Record<string, unknown> {
  const mcpServers: Record<string, unknown> = {};
  if (!ctx.mcpManager) {
    return mcpServers;
  }

  const serverStatuses = ctx.mcpManager.getServerStatus();
  const connectedServers = serverStatuses.filter((status) => status.connected);
  log('[ClaudeAgentRunner] MCP server statuses:', safeStringify(serverStatuses));
  log('[ClaudeAgentRunner] Connected MCP servers:', connectedServers.length);

  let allConfigs: ReturnType<typeof mcpConfigStore.getEnabledServers> = [];
  try {
    allConfigs = mcpConfigStore.getEnabledServers();
    log(
      '[ClaudeAgentRunner] Enabled MCP configs:',
      allConfigs.map((config) => config.name)
    );
  } catch (error) {
    logWarn(
      '[ClaudeAgentRunner] Failed to read enabled MCP configs; MCP tools will be unavailable this query',
      error
    );
  }

  const mcpFingerprint = JSON.stringify(allConfigs) + String(imageCapable);
  const cachedMcpServers = ctx.getMcpServersCache();
  if (cachedMcpServers?.fingerprint === mcpFingerprint) {
    Object.assign(mcpServers, cachedMcpServers.servers);
    log('[ClaudeAgentRunner] MCP servers config reused from cache');
    logMcpServersSummary(mcpServers);
    return mcpServers;
  }

  const bundledNodePaths = getBundledNodePaths();
  const bundledNpx = bundledNodePaths?.npx ?? null;

  for (const config of allConfigs) {
    try {
      const serverKey = config.name;
      if (config.type === 'stdio') {
        const command =
          config.command === 'npx' && bundledNpx
            ? bundledNpx
            : config.command === 'node' && bundledNodePaths
              ? bundledNodePaths.node
              : config.command;

        const serverEnv = { ...config.env };
        if (bundledNodePaths && (config.command === 'npx' || config.command === 'node')) {
          const nodeBinDir = path.dirname(bundledNodePaths.node);
          const currentPath = process.env.PATH || '';
          serverEnv.PATH = `${nodeBinDir}${path.delimiter}${currentPath}`;
          log(`[ClaudeAgentRunner]   Added bundled node bin to PATH: ${nodeBinDir}`);
        }

        if (!imageCapable) {
          serverEnv.OPEN_COWORK_DISABLE_IMAGE_TOOL_OUTPUT = '1';
        }

        let resolvedArgs = config.args || [];
        const hasPlaceholders = resolvedArgs.some(
          (arg) =>
            arg.includes('{SOFTWARE_DEV_SERVER_PATH}') || arg.includes('{GUI_OPERATE_SERVER_PATH}')
        );
        if (hasPlaceholders) {
          let presetKey: string | null = null;
          if (config.name === 'Software_Development' || config.name === 'Software Development') {
            presetKey = 'software-development';
          } else if (config.name === 'GUI_Operate' || config.name === 'GUI Operate') {
            presetKey = 'gui-operate';
          }

          if (presetKey) {
            const preset = mcpConfigStore.createFromPreset(presetKey, true);
            if (preset?.args) {
              resolvedArgs = preset.args;
            }
          }
        }

        mcpServers[serverKey] = {
          type: 'stdio',
          command,
          args: resolvedArgs,
          env: serverEnv,
        };
        log(`[ClaudeAgentRunner] Added STDIO MCP server: ${serverKey}`);
        log(`[ClaudeAgentRunner]   Command: ${command} ${resolvedArgs.join(' ')}`);
        log(`[ClaudeAgentRunner]   Tools will be named: mcp__${serverKey}__<toolName>`);
      } else if (config.type === 'sse') {
        mcpServers[serverKey] = {
          type: 'sse',
          url: config.url,
          headers: config.headers || {},
        };
        log(`[ClaudeAgentRunner] Added SSE MCP server: ${serverKey}`);
      }
    } catch (error) {
      logError('[ClaudeAgentRunner] Failed to prepare MCP server config, skipping server', {
        serverId: config.id,
        serverName: config.name,
        error: toErrorText(error),
      });
    }
  }

  ctx.setMcpServersCache({ fingerprint: mcpFingerprint, servers: { ...mcpServers } });
  logMcpServersSummary(mcpServers);
  return mcpServers;
}
