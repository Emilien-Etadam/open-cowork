import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';

import { writeMCPLog } from '../mcp-logger.js';
import { WORKSPACE_DIR } from './file-ops.js';
import { handleSoftwareDevToolCall } from './software-dev-tool-handlers.js';
import { registerSoftwareDevToolList } from './software-dev-tools.js';

const server = new Server(
  {
    name: 'software-development-server',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

registerSoftwareDevToolList(server);

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    return await handleSoftwareDevToolCall(name, args as Record<string, unknown> | undefined);
  } catch (error) {
    writeMCPLog(
      `[SoftwareDev] Error in ${name}: ${error instanceof Error ? error.message : String(error)}`,
      'Error'
    );
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: false,
              tool: name,
              error: error instanceof Error ? error.message : String(error),
            },
            null,
            2
          ),
        },
      ],
      isError: true,
    };
  }
});

export async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);

  writeMCPLog('='.repeat(60));
  writeMCPLog('Software Development MCP Server v1.0.0');
  writeMCPLog('='.repeat(60));
  writeMCPLog(`Workspace: ${WORKSPACE_DIR}`);
  writeMCPLog(`Claude Code: ${process.env.CLAUDE_CODE_PATH || 'claude-code (from PATH)'}`);
  writeMCPLog('');
  writeMCPLog('Available Tools:');
  writeMCPLog('  Code Development:');
  writeMCPLog('    - read_code_file: Read file contents');
  writeMCPLog('  GUI Testing:');
  writeMCPLog('    - start_gui_application: Launch GUI app for testing');
  writeMCPLog('    - gui_interact: Direct coordinate-based interaction (cliclick/xdotool)');
  writeMCPLog('    - gui_interact_vision: AI vision-based GUI interaction');
  writeMCPLog('    - gui_verify_vision: AI vision-based GUI verification');
  writeMCPLog('    - gui_assert: Vision-based GUI state assertions');
  writeMCPLog('    - stop_gui_application: Stop running GUI app');
  writeMCPLog('  Requirements:');
  writeMCPLog('    - create_requirement: Track new requirements');
  writeMCPLog('    - update_requirement: Update requirement status');
  writeMCPLog('    - validate_requirement: Validate requirement completion');
  writeMCPLog('    - list_requirements: List all tracked requirements');
  writeMCPLog('='.repeat(60));
  writeMCPLog('Server ready and listening on stdio');
  writeMCPLog('='.repeat(60));
}
