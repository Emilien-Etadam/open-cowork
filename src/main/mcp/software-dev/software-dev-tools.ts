import { ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

import type { Server } from '@modelcontextprotocol/sdk/server/index.js';

export function registerSoftwareDevToolList(server: Server): void {
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
}
