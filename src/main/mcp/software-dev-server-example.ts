/**
 * Software Development MCP Server
 *
 * Entry point kept for esbuild bundling via scripts/bundle-mcp.js.
 * The implementation now lives under ./software-dev/.
 */

import { writeMCPLog } from './mcp-logger.js';

writeMCPLog('=== Module Loading Started ===', 'Bootstrap');

import { main } from './software-dev/mcp-server.js';

writeMCPLog('Imported Software Development MCP modules', 'Bootstrap');
writeMCPLog('=== Script Loaded ===', 'Bootstrap');
writeMCPLog('Module loaded, about to call main()', 'Bootstrap');

main().catch((error) => {
  const errorMsg = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : 'No stack trace';
  writeMCPLog(`Fatal error in main(): ${errorMsg}`, 'Fatal Error');
  writeMCPLog(`Stack trace: ${stack}`, 'Fatal Error');
  process.exit(1);
});
