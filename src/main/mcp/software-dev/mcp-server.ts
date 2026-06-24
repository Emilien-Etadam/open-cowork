import * as fs from 'fs/promises';
import * as path from 'path';

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

import { writeMCPLog } from '../mcp-logger.js';
import { getDockerContainerLogs, saveDockerDiagnostics, stopGUIApplication } from './docker-gui.js';
import { WORKSPACE_DIR, readFile } from './file-ops.js';
import {
  callVisionAPI,
  clearCurrentGUIApp,
  executeGUIInteraction,
  executeGUIInteractionWithVision,
  focusApplicationWindow,
  getCurrentGUIApp,
  setCurrentGUIApp,
  startGUIApplication,
  takeScreenshot,
} from './gui-runtime.js';
import {
  createRequirement,
  getRequirementCount,
  listRequirements,
  updateRequirement,
  validateRequirement,
} from './requirements.js';

// Initialize the MCP server
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

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'create_requirement',
        description:
          'Create a new requirement for tracking. Requirements can be linked to code files and tests.',
        inputSchema: {
          type: 'object',
          properties: {
            description: {
              type: 'string',
              description: 'Detailed description of the requirement',
            },
            files: {
              type: 'array',
              items: { type: 'string' },
              description: 'List of files related to this requirement',
            },
          },
          required: ['description'],
        },
      },
      {
        name: 'update_requirement',
        description:
          'Update an existing requirement based on test results, user feedback, or new findings',
        inputSchema: {
          type: 'object',
          properties: {
            requirement_id: {
              type: 'string',
              description: 'The ID of the requirement to update',
            },
            updated_description: {
              type: 'string',
              description: 'The updated requirement description',
            },
            reason: {
              type: 'string',
              description: 'Reason for the requirement update',
            },
            status: {
              type: 'string',
              enum: ['pending', 'in-progress', 'completed', 'failed'],
              description: 'Updated status of the requirement',
            },
          },
          required: ['requirement_id', 'updated_description', 'reason'],
        },
      },
      {
        name: 'validate_requirement',
        description:
          'Validate whether a requirement has been completed by checking if all required files exist',
        inputSchema: {
          type: 'object',
          properties: {
            requirement_id: {
              type: 'string',
              description: 'The ID of the requirement to validate',
            },
          },
          required: ['requirement_id'],
        },
      },
      {
        name: 'list_requirements',
        description: 'List all tracked requirements with their current status',
        inputSchema: {
          type: 'object',
          properties: {
            status_filter: {
              type: 'string',
              enum: ['pending', 'in-progress', 'completed', 'failed', 'all'],
              description: 'Filter requirements by status (default: all)',
            },
          },
        },
      },
      {
        name: 'read_code_file',
        description: 'Read the content of a code file in the workspace',
        inputSchema: {
          type: 'object',
          properties: {
            file_path: {
              type: 'string',
              description: 'Path to the file to read (relative to workspace)',
            },
          },
          required: ['file_path'],
        },
      },
      {
        name: 'start_gui_application',
        description:
          'Start a GUI application for testing. Supports Python (tkinter, PyQt, etc.), Electron, web apps, and more. Can run in Docker for isolation.',
        inputSchema: {
          type: 'object',
          properties: {
            app_file_path: {
              type: 'string',
              description: 'Path to the application file to run (e.g., app.py, index.html)',
            },
            app_type: {
              type: 'string',
              enum: ['python', 'electron', 'web', 'java', 'other'],
              description: 'Type of application',
            },
            start_command: {
              type: 'string',
              description:
                'REQUIRED: The command to START/LAUNCH the GUI application. This command will be executed to bring up the application window. Examples: "python app.py" to run a Python GUI app, "npm start" to launch an Electron app, "java -jar myapp.jar" for Java apps, "python test_gomoku.py" to run a test script that launches the app. This is the actual command that starts your application process.',
            },
            wait_for_ready: {
              type: 'number',
              description: 'Seconds to wait for app to be ready (default: 3)',
            },
            use_docker: {
              type: 'boolean',
              description:
                'Run in isolated Docker environment (default: false). Prevents interference with user work.',
            },
            enable_vnc: {
              type: 'boolean',
              description:
                'Enable VNC server for viewing tests (default: true, only for Docker mode)',
            },
            vnc_port: {
              type: 'number',
              description: 'VNC port to expose (default: 5901, only for Docker mode)',
            },
          },
          required: ['app_file_path', 'app_type', 'start_command'],
        },
      },
      {
        name: 'gui_interact',
        description:
          'Interact with GUI using direct coordinates (cliclick on macOS, xdotool on Linux). For element-based interaction, use gui_interact_vision instead.',
        inputSchema: {
          type: 'object',
          properties: {
            action: {
              type: 'string',
              enum: [
                'click',
                'double_click',
                'right_click',
                'move',
                'type',
                'key',
                'drag',
                'screenshot',
                'wait',
              ],
              description: 'Action to perform. Use coordinates (x, y) for click/move actions.',
            },
            x: {
              type: 'number',
              description: 'X coordinate for click/move actions',
            },
            y: {
              type: 'number',
              description: 'Y coordinate for click/move actions',
            },
            value: {
              type: 'string',
              description:
                'Value for the action (text to type, key name, or drag coordinates "x1,y1,x2,y2")',
            },
            timeout: {
              type: 'number',
              description: 'Timeout in milliseconds (default: 5000)',
            },
          },
          required: ['action'],
        },
      },
      {
        name: 'gui_assert',
        description:
          'Assert GUI state using vision-based verification. Ask questions about what should be visible on screen.',
        inputSchema: {
          type: 'object',
          properties: {
            question: {
              type: 'string',
              description:
                'Question about expected GUI state (e.g., "Is the OK button visible?", "Does the text say Hello World?")',
            },
            expected_answer: {
              type: 'string',
              description: 'Expected answer (e.g., "yes", "true", "Hello World")',
            },
          },
          required: ['question'],
        },
      },
      {
        name: 'stop_gui_application',
        description: 'Stop the running GUI application and cleanup resources.',
        inputSchema: {
          type: 'object',
          properties: {
            force: {
              type: 'boolean',
              description: 'Force kill the application (default: false)',
            },
          },
        },
      },
      {
        name: 'get_docker_logs',
        description:
          'Get and save comprehensive Docker container logs and diagnostics to .docker-logs directory. Useful for debugging black screen or other issues.',
        inputSchema: {
          type: 'object',
          properties: {
            save_to_file: {
              type: 'boolean',
              description: 'Save logs to file in .docker-logs directory (default: true)',
            },
          },
        },
      },
      {
        name: 'gui_interact_vision',
        description:
          'Interact with GUI elements using AI vision to locate elements (cliclick on macOS, xdotool on Linux). Works with ANY GUI app. Describe the element in natural language.',
        inputSchema: {
          type: 'object',
          properties: {
            action: {
              type: 'string',
              enum: ['click', 'double_click', 'right_click', 'type', 'hover'],
              description: 'Action to perform on the GUI element',
            },
            element_description: {
              type: 'string',
              description:
                'Natural language description of the element to interact with (e.g., "the red Start button", "the text input field at the top", "the OK button in the dialog")',
            },
            value: {
              type: 'string',
              description: 'Value to type (only for type action)',
            },
            timeout: {
              type: 'number',
              description: 'Timeout in milliseconds (default: 5000)',
            },
          },
          required: ['action', 'element_description'],
        },
      },
      {
        name: 'gui_verify_vision',
        description:
          'Verify GUI state using AI vision. Ask questions about what is visible on screen and get intelligent answers.',
        inputSchema: {
          type: 'object',
          properties: {
            question: {
              type: 'string',
              description:
                'Question about the GUI state (e.g., "Is the game board visible?", "What is the current player shown?", "Are there any error messages?")',
            },
          },
          required: ['question'],
        },
      },
    ],
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'create_requirement': {
        const { description, files } = args as { description: string; files?: string[] };
        const requirement = createRequirement(description, files || []);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  success: true,
                  message: 'Requirement created',
                  requirement_id: requirement.id,
                  requirement,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case 'update_requirement': {
        const { requirement_id, updated_description, reason, status } = args as {
          requirement_id: string;
          updated_description: string;
          reason: string;
          status?: 'pending' | 'in-progress' | 'completed' | 'failed';
        };

        const requirement = updateRequirement(requirement_id, updated_description, reason, status);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  success: true,
                  message: 'Requirement updated',
                  requirement_id,
                  requirement,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case 'validate_requirement': {
        const { requirement_id } = args as { requirement_id: string };
        const { requirement, validated, missingFiles } = await validateRequirement(requirement_id);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  success: true,
                  requirement_id,
                  validated,
                  status: requirement.status,
                  missing_files: missingFiles,
                  requirement,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case 'list_requirements': {
        const { status_filter } = args as {
          status_filter?: 'pending' | 'in-progress' | 'completed' | 'failed' | 'all';
        };
        const filteredReqs = listRequirements(status_filter);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  success: true,
                  total: getRequirementCount(),
                  filtered: filteredReqs.length,
                  status_filter: status_filter || 'all',
                  requirements: filteredReqs,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case 'read_code_file': {
        const { file_path } = args as { file_path: string };
        const content = await readFile(file_path);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  success: true,
                  file_path,
                  content,
                  size: content.length,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case 'start_gui_application': {
        const {
          app_file_path,
          app_type,
          start_command,
          wait_for_ready,
          use_docker,
          enable_vnc,
          vnc_port,
        } = args as {
          app_file_path: string;
          app_type: string;
          start_command?: string;
          wait_for_ready?: number;
          use_docker?: boolean;
          enable_vnc?: boolean;
          vnc_port?: number;
        };

        const existingApp = getCurrentGUIApp();
        if (existingApp) {
          await stopGUIApplication(existingApp, true);
          clearCurrentGUIApp();
        }

        const instance = await startGUIApplication(
          app_file_path,
          app_type,
          start_command,
          wait_for_ready || 3,
          use_docker !== false,
          enable_vnc !== false,
          vnc_port || 5901
        );

        setCurrentGUIApp(instance);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  success: true,
                  message: 'GUI application started',
                  app_file_path,
                  app_type,
                  pid: instance.pid,
                  url: instance.url,
                  start_time: instance.startTime,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case 'gui_interact': {
        const { action, x, y, value, timeout } = args as {
          action: string;
          x?: number;
          y?: number;
          value?: string;
          timeout?: number;
        };

        if (!getCurrentGUIApp()) {
          throw new Error('No GUI application is running. Use start_gui_application first.');
        }

        writeMCPLog(`[GUI] Performing action: ${action} at (${x}, ${y})`);

        try {
          const result = await executeGUIInteraction(action, x, y, value, timeout || 5000);

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(result, null, 2),
              },
            ],
          };
        } catch (error: unknown) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    success: false,
                    tool: 'gui_interact',
                    error: error instanceof Error ? error.message : String(error),
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }
      }

      case 'gui_assert': {
        const { question, expected_answer } = args as {
          question: string;
          expected_answer?: string;
        };
        const currentGUIApp = getCurrentGUIApp();

        if (!currentGUIApp) {
          throw new Error('No GUI application is running. Use start_gui_application first.');
        }

        writeMCPLog(`[GUI] Asserting: ${question}`);

        try {
          const screenshotPath = path.join(WORKSPACE_DIR, 'gui_screenshot.png');

          if (!currentGUIApp.isDocker) {
            await focusApplicationWindow();
            await new Promise((resolve) => setTimeout(resolve, 1000));
          }
          await takeScreenshot(screenshotPath);

          const imageBuffer = await fs.readFile(screenshotPath);
          const base64Image = imageBuffer.toString('base64');

          const prompt = `Analyze this GUI screenshot and answer the following question:

${question}

Provide a clear yes/no answer or the specific information requested.`;
          const answer = await callVisionAPI(base64Image, prompt, 1024);

          let passed = true;
          if (expected_answer) {
            const normalizedAnswer = answer.toLowerCase().trim();
            const normalizedExpected = expected_answer.toLowerCase().trim();
            passed =
              normalizedAnswer.includes(normalizedExpected) ||
              normalizedAnswer === normalizedExpected;
          }

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    success: true,
                    question,
                    answer,
                    expected_answer,
                    passed,
                    screenshot_path: screenshotPath,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        } catch (error: unknown) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    success: false,
                    tool: 'gui_assert',
                    error: error instanceof Error ? error.message : String(error),
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }
      }

      case 'stop_gui_application': {
        const { force } = args as { force?: boolean };
        const currentGUIApp = getCurrentGUIApp();

        if (!currentGUIApp) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    success: true,
                    message: 'No GUI application is running',
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        await stopGUIApplication(currentGUIApp, force || false);
        clearCurrentGUIApp();

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  success: true,
                  message: 'GUI application stopped',
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case 'get_docker_logs': {
        const { save_to_file } = args as { save_to_file?: boolean };
        const currentGUIApp = getCurrentGUIApp();

        if (!currentGUIApp || !currentGUIApp.isDocker || !currentGUIApp.containerId) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    success: false,
                    message:
                      'No Docker container is running. Use start_gui_application with use_docker=true first.',
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        try {
          let logFile: string | undefined;

          if (save_to_file !== false) {
            logFile = await saveDockerDiagnostics(currentGUIApp.containerId, WORKSPACE_DIR);
          }

          const logs = await getDockerContainerLogs(currentGUIApp.containerId);

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    success: true,
                    message: 'Docker logs retrieved',
                    container_id: currentGUIApp.containerId,
                    log_file: logFile,
                    logs_preview:
                      logs.substring(0, 2000) +
                      (logs.length > 2000 ? '\n... (truncated, see log_file for full logs)' : ''),
                    full_logs_length: logs.length,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        } catch (error: unknown) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    success: false,
                    message: 'Failed to get Docker logs',
                    error: error instanceof Error ? error.message : String(error),
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }
      }

      case 'gui_interact_vision': {
        const { action, element_description, value, timeout } = args as {
          action: string;
          element_description: string;
          value?: string;
          timeout?: number;
        };

        if (!getCurrentGUIApp()) {
          throw new Error('No GUI application is running. Use start_gui_application first.');
        }

        writeMCPLog(`[Vision] Performing ${action} on "${element_description}"`);

        try {
          const result = await executeGUIInteractionWithVision(
            action,
            element_description,
            value,
            timeout || 5000
          );

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(result, null, 2),
              },
            ],
          };
        } catch (error: unknown) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    success: false,
                    tool: 'gui_interact_vision',
                    error: error instanceof Error ? error.message : String(error),
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }
      }

      case 'gui_verify_vision': {
        const { question } = args as { question: string };
        const currentGUIApp = getCurrentGUIApp();

        if (!currentGUIApp) {
          throw new Error('No GUI application is running. Use start_gui_application first.');
        }

        writeMCPLog(`[Vision] Verifying: ${question}`);

        try {
          if (!currentGUIApp.isDocker) {
            writeMCPLog('[Vision] Bringing window to front for verification...');
            await focusApplicationWindow();
            writeMCPLog('[Vision] Waiting 1 second for window to come to front...');
            await new Promise((resolve) => setTimeout(resolve, 1000));
          }

          writeMCPLog('[Vision] Taking screenshot for verification...');
          const screenshotPath = path.join(WORKSPACE_DIR, 'gui_screenshot.png');
          await takeScreenshot(screenshotPath);

          const imageBuffer = await fs.readFile(screenshotPath);
          const base64Image = imageBuffer.toString('base64');

          const prompt = `Analyze this GUI screenshot and answer the following question:

${question}

Provide a detailed answer based on what you can see in the image.`;
          const answer = await callVisionAPI(base64Image, prompt, 2048);

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    success: true,
                    question,
                    answer,
                    screenshot_path: screenshotPath,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        } catch (error: unknown) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    success: false,
                    tool: 'gui_verify_vision',
                    error: error instanceof Error ? error.message : String(error),
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
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

// Start the server
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
