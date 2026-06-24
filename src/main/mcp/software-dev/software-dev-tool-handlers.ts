import * as fs from 'fs/promises';
import * as path from 'path';

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

export async function handleSoftwareDevToolCall(
  name: string,
  args: Record<string, unknown> | undefined
) {
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
}
