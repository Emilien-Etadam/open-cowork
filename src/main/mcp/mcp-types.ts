import type { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import type { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

export interface MCPServerConfig {
  id: string;
  name: string;
  type: 'stdio' | 'sse' | 'streamable-http';
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  url?: string;
  headers?: Record<string, string>;
  enabled: boolean;
}

export interface MCPTool {
  name: string;
  originalName?: string;
  description: string;
  inputSchema: {
    type: string;
    properties: Record<string, unknown>;
    required?: string[];
  };
  serverId: string;
  serverName: string;
}

export type RefreshToolsResult =
  | { kind: 'success'; serverId: string; tools: MCPTool[] }
  | { kind: 'error'; serverId: string; error: unknown };

export type MCPTransport =
  | StdioClientTransport
  | SSEClientTransport
  | StreamableHTTPClientTransport;
