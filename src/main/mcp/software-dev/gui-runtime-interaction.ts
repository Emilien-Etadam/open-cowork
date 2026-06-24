import * as path from 'path';

import { writeMCPLog } from '../mcp-logger.js';
import { WORKSPACE_DIR, executeCommand } from './file-ops.js';
import { executeCliclick } from './gui-runtime-cliclick.js';
import { focusApplicationWindow } from './gui-runtime-focus.js';
import { takeScreenshot } from './gui-runtime-screenshot.js';
import { analyzeScreenshotWithVision } from './gui-runtime-vision-analyze.js';
import { currentGUIApp } from './gui-runtime-state.js';

export async function executeGUIInteractionWithVision(
  action: string,
  elementDescription: string,
  value?: string,
  _timeout: number = 5000
): Promise<Record<string, unknown>> {
  if (!currentGUIApp) {
    throw new Error('No GUI application is running');
  }

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const platform = require('os').platform();
  const screenshotPath = path.join(WORKSPACE_DIR, 'gui_screenshot.png');

  try {
    // Step 0: Bring window to front before taking screenshot (skip for Docker)
    if (!currentGUIApp.isDocker) {
      writeMCPLog('[Vision] Step 0: Bringing window to front...');
      await focusApplicationWindow();
      writeMCPLog('[Vision] Waiting 1 second for window to come to front...');
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    // Step 1: Take screenshot
    writeMCPLog('[Vision] Step 1: Taking screenshot...');
    await takeScreenshot(screenshotPath);
    writeMCPLog(`[Vision] Screenshot saved to ${screenshotPath}`);

    // Step 2: Analyze with vision model to find element
    const coords = await analyzeScreenshotWithVision(screenshotPath, elementDescription);

    if (coords.confidence < 50) {
      return {
        success: false,
        message: `Element "${elementDescription}" not found with sufficient confidence (${coords.confidence}%)`,
        suggestion: 'Try a more specific description or check if the element is visible',
      };
    }

    // Step 3: Perform action - use Docker xdotool if in Docker mode, otherwise use local tools
    if (currentGUIApp.isDocker && currentGUIApp.containerId) {
      // Docker mode: use xdotool inside container
      writeMCPLog('[Vision] Using xdotool inside Docker container...');
      switch (action) {
        case 'click':
          await executeCommand(
            `docker exec ${currentGUIApp.containerId} bash -c "DISPLAY=:99 xdotool mousemove ${coords.x} ${coords.y} click 1"`,
            WORKSPACE_DIR
          );
          await new Promise((resolve) => setTimeout(resolve, 500));
          return {
            success: true,
            action: 'click',
            element: elementDescription,
            coordinates: { x: coords.x, y: coords.y },
            confidence: coords.confidence,
            mode: 'docker',
          };
        case 'double_click':
          await executeCommand(
            `docker exec ${currentGUIApp.containerId} bash -c "DISPLAY=:99 xdotool mousemove ${coords.x} ${coords.y} click --repeat 2 1"`,
            WORKSPACE_DIR
          );
          await new Promise((resolve) => setTimeout(resolve, 500));
          return {
            success: true,
            action: 'double_click',
            element: elementDescription,
            coordinates: { x: coords.x, y: coords.y },
            confidence: coords.confidence,
            mode: 'docker',
          };
        case 'right_click':
          await executeCommand(
            `docker exec ${currentGUIApp.containerId} bash -c "DISPLAY=:99 xdotool mousemove ${coords.x} ${coords.y} click 3"`,
            WORKSPACE_DIR
          );
          await new Promise((resolve) => setTimeout(resolve, 500));
          return {
            success: true,
            action: 'right_click',
            element: elementDescription,
            coordinates: { x: coords.x, y: coords.y },
            confidence: coords.confidence,
            mode: 'docker',
          };
        case 'type':
          if (!value) {
            throw new Error('Value is required for type action');
          }
          await executeCommand(
            `docker exec ${currentGUIApp.containerId} bash -c "DISPLAY=:99 xdotool mousemove ${coords.x} ${coords.y} click 1"`,
            WORKSPACE_DIR
          );
          await new Promise((resolve) => setTimeout(resolve, 200));
          await executeCommand(
            `docker exec ${currentGUIApp.containerId} bash -c "DISPLAY=:99 xdotool type '${value.replace(/'/g, "'\\''")}'"`,
            WORKSPACE_DIR
          );
          await new Promise((resolve) => setTimeout(resolve, 500));
          return {
            success: true,
            action: 'type',
            element: elementDescription,
            value,
            coordinates: { x: coords.x, y: coords.y },
            confidence: coords.confidence,
            mode: 'docker',
          };
        case 'hover':
          await executeCommand(
            `docker exec ${currentGUIApp.containerId} bash -c "DISPLAY=:99 xdotool mousemove ${coords.x} ${coords.y}"`,
            WORKSPACE_DIR
          );
          await new Promise((resolve) => setTimeout(resolve, 500));
          return {
            success: true,
            action: 'hover',
            element: elementDescription,
            coordinates: { x: coords.x, y: coords.y },
            confidence: coords.confidence,
            mode: 'docker',
          };
        default:
          return {
            success: false,
            message: `Action '${action}' is not supported with vision-based interaction in Docker mode`,
          };
      }
    } else if (platform === 'darwin') {
      // macOS: Use cliclick
      switch (action) {
        case 'click':
          await executeCliclick(`c:${coords.x},${coords.y}`);
          await new Promise((resolve) => setTimeout(resolve, 500));

          return {
            success: true,
            action: 'click',
            element: elementDescription,
            coordinates: { x: coords.x, y: coords.y },
            confidence: coords.confidence,
          };

        case 'double_click':
          await executeCliclick(`dc:${coords.x},${coords.y}`);
          await new Promise((resolve) => setTimeout(resolve, 500));

          return {
            success: true,
            action: 'double_click',
            element: elementDescription,
            coordinates: { x: coords.x, y: coords.y },
            confidence: coords.confidence,
          };

        case 'right_click':
          await executeCliclick(`rc:${coords.x},${coords.y}`);
          await new Promise((resolve) => setTimeout(resolve, 500));

          return {
            success: true,
            action: 'right_click',
            element: elementDescription,
            coordinates: { x: coords.x, y: coords.y },
            confidence: coords.confidence,
          };

        case 'type': {
          if (!value) {
            throw new Error('Value is required for type action');
          }

          // Click first, then type
          await executeCliclick(`c:${coords.x},${coords.y}`);
          await new Promise((resolve) => setTimeout(resolve, 200));

          // Escape special characters for cliclick
          const escapedValue = value
            .replace(/\\/g, '\\\\')
            .replace(/"/g, '\\"')
            .replace(/`/g, '\\`')
            .replace(/\$\(/g, '\\$(');
          await executeCliclick(`t:"${escapedValue}"`);
          await new Promise((resolve) => setTimeout(resolve, 500));

          return {
            success: true,
            action: 'type',
            element: elementDescription,
            value,
            coordinates: { x: coords.x, y: coords.y },
            confidence: coords.confidence,
          };
        }

        case 'hover':
          await executeCliclick(`m:${coords.x},${coords.y}`);
          await new Promise((resolve) => setTimeout(resolve, 500));

          return {
            success: true,
            action: 'hover',
            element: elementDescription,
            coordinates: { x: coords.x, y: coords.y },
            confidence: coords.confidence,
          };

        default:
          return {
            success: false,
            message: `Action '${action}' is not supported with vision-based interaction`,
          };
      }
    } else if (platform === 'linux') {
      // Linux: Use xdotool
      switch (action) {
        case 'click':
          await executeCommand(`xdotool mousemove ${coords.x} ${coords.y} click 1`);
          await new Promise((resolve) => setTimeout(resolve, 500));

          return {
            success: true,
            action: 'click',
            element: elementDescription,
            coordinates: { x: coords.x, y: coords.y },
            confidence: coords.confidence,
          };

        case 'double_click':
          await executeCommand(`xdotool mousemove ${coords.x} ${coords.y} click --repeat 2 1`);
          await new Promise((resolve) => setTimeout(resolve, 500));

          return {
            success: true,
            action: 'double_click',
            element: elementDescription,
            coordinates: { x: coords.x, y: coords.y },
            confidence: coords.confidence,
          };

        case 'right_click':
          await executeCommand(`xdotool mousemove ${coords.x} ${coords.y} click 3`);
          await new Promise((resolve) => setTimeout(resolve, 500));

          return {
            success: true,
            action: 'right_click',
            element: elementDescription,
            coordinates: { x: coords.x, y: coords.y },
            confidence: coords.confidence,
          };

        case 'type':
          if (!value) {
            throw new Error('Value is required for type action');
          }

          // Click first, then type
          await executeCommand(`xdotool mousemove ${coords.x} ${coords.y} click 1`);
          await new Promise((resolve) => setTimeout(resolve, 200));
          await executeCommand(`xdotool type "${value.replace(/"/g, '\\"')}"`);
          await new Promise((resolve) => setTimeout(resolve, 500));

          return {
            success: true,
            action: 'type',
            element: elementDescription,
            value,
            coordinates: { x: coords.x, y: coords.y },
            confidence: coords.confidence,
          };

        case 'hover':
          await executeCommand(`xdotool mousemove ${coords.x} ${coords.y}`);
          await new Promise((resolve) => setTimeout(resolve, 500));

          return {
            success: true,
            action: 'hover',
            element: elementDescription,
            coordinates: { x: coords.x, y: coords.y },
            confidence: coords.confidence,
          };

        default:
          return {
            success: false,
            message: `Action '${action}' is not supported with vision-based interaction`,
          };
      }
    } else {
      // Windows: Not supported yet
      return {
        success: false,
        message: 'Vision-based interaction is not yet supported on Windows',
        suggestion: 'Use macOS (cliclick) or Linux (xdotool) for vision-based GUI automation',
      };
    }
  } catch (error: unknown) {
    return {
      success: false,
      message: `Vision-based interaction failed: ${error instanceof Error ? error.message : String(error)}`,
      suggestion:
        platform === 'darwin'
          ? 'Check if cliclick is installed (brew install cliclick) and the element description is accurate'
          : 'Check if xdotool is installed (sudo apt-get install xdotool) and the element description is accurate',
    };
  }
}

// Helper: Execute GUI interaction (using cliclick/xdotool for direct coordinate-based actions)
export async function executeGUIInteraction(
  action: string,
  x?: number,
  y?: number,
  value?: string,
  timeout: number = 5000
): Promise<Record<string, unknown>> {
  if (!currentGUIApp) {
    throw new Error('No GUI application is running');
  }

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const platform = require('os').platform();

  try {
    // If Docker mode, execute actions inside container using xdotool
    if (currentGUIApp.isDocker && currentGUIApp.containerId) {
      writeMCPLog('[GUI] Executing action in Docker container...');
      switch (action) {
        case 'click':
          if (x !== undefined && y !== undefined) {
            await executeCommand(
              `docker exec ${currentGUIApp.containerId} bash -c "DISPLAY=:99 xdotool mousemove ${x} ${y} click 1"`,
              WORKSPACE_DIR
            );
          } else {
            await executeCommand(
              `docker exec ${currentGUIApp.containerId} bash -c "DISPLAY=:99 xdotool click 1"`,
              WORKSPACE_DIR
            );
          }
          await new Promise((resolve) => setTimeout(resolve, 500));
          return { success: true, action: 'click', coordinates: { x, y }, mode: 'docker' };

        case 'double_click':
          if (x !== undefined && y !== undefined) {
            await executeCommand(
              `docker exec ${currentGUIApp.containerId} bash -c "DISPLAY=:99 xdotool mousemove ${x} ${y} click --repeat 2 1"`,
              WORKSPACE_DIR
            );
          } else {
            await executeCommand(
              `docker exec ${currentGUIApp.containerId} bash -c "DISPLAY=:99 xdotool click --repeat 2 1"`,
              WORKSPACE_DIR
            );
          }
          await new Promise((resolve) => setTimeout(resolve, 500));
          return { success: true, action: 'double_click', coordinates: { x, y }, mode: 'docker' };

        case 'right_click':
          if (x !== undefined && y !== undefined) {
            await executeCommand(
              `docker exec ${currentGUIApp.containerId} bash -c "DISPLAY=:99 xdotool mousemove ${x} ${y} click 3"`,
              WORKSPACE_DIR
            );
          } else {
            await executeCommand(
              `docker exec ${currentGUIApp.containerId} bash -c "DISPLAY=:99 xdotool click 3"`,
              WORKSPACE_DIR
            );
          }
          await new Promise((resolve) => setTimeout(resolve, 500));
          return { success: true, action: 'right_click', coordinates: { x, y }, mode: 'docker' };

        case 'move':
          if (x !== undefined && y !== undefined) {
            await executeCommand(
              `docker exec ${currentGUIApp.containerId} bash -c "DISPLAY=:99 xdotool mousemove ${x} ${y}"`,
              WORKSPACE_DIR
            );
            await new Promise((resolve) => setTimeout(resolve, 200));
            return { success: true, action: 'move', coordinates: { x, y }, mode: 'docker' };
          } else {
            return { success: false, message: 'Coordinates required for move action' };
          }

        case 'type': {
          if (!value) {
            return { success: false, message: 'Value required for type action' };
          }
          const escapedValueDocker = value.replace(/'/g, "'\\''");
          await executeCommand(
            `docker exec ${currentGUIApp.containerId} bash -c "DISPLAY=:99 xdotool type '${escapedValueDocker}'"`,
            WORKSPACE_DIR
          );
          await new Promise((resolve) => setTimeout(resolve, 500));
          return { success: true, action: 'type', value, mode: 'docker' };
        }

        case 'key':
          if (!value) {
            return { success: false, message: 'Key required for key action' };
          }
          // Validate key name: only allow alphanumeric, +, -, _, and spaces (for key combinations)
          if (!/^[a-zA-Z0-9_+\-\s]+$/.test(value)) {
            return {
              success: false,
              message: `Invalid key value: "${value}". Only alphanumeric, +, -, _, and space characters are allowed.`,
            };
          }
          await executeCommand(
            `docker exec ${currentGUIApp.containerId} bash -c "DISPLAY=:99 xdotool key ${value}"`,
            WORKSPACE_DIR
          );
          await new Promise((resolve) => setTimeout(resolve, 500));
          return { success: true, action: 'key', key: value, mode: 'docker' };

        case 'drag': {
          if (!value) {
            return {
              success: false,
              message: 'Coordinates required for drag action (format: "x1,y1,x2,y2")',
            };
          }
          const [x1, y1, x2, y2] = parseDragCoords(value);
          await executeCommand(
            `docker exec ${currentGUIApp.containerId} bash -c "DISPLAY=:99 xdotool mousemove ${x1} ${y1} mousedown 1 mousemove ${x2} ${y2} mouseup 1"`,
            WORKSPACE_DIR
          );
          await new Promise((resolve) => setTimeout(resolve, 500));
          return {
            success: true,
            action: 'drag',
            from: { x: x1, y: y1 },
            to: { x: x2, y: y2 },
            mode: 'docker',
          };
        }
        case 'screenshot': {
          const screenshotPath = path.join(WORKSPACE_DIR, 'screenshot.png');
          await takeScreenshot(screenshotPath);
          return { success: true, action: 'screenshot', path: screenshotPath, mode: 'docker' };
        }
        case 'wait':
          await new Promise((resolve) => setTimeout(resolve, timeout));
          return { success: true, action: 'wait', duration: timeout, mode: 'docker' };

        default:
          return { success: false, message: `Action '${action}' is not supported in Docker mode` };
      }
    }

    // Local mode: Bring window to front first
    await focusApplicationWindow();
    await new Promise((resolve) => setTimeout(resolve, 500));

    if (platform === 'darwin') {
      // macOS: Use cliclick
      switch (action) {
        case 'click':
          if (x !== undefined && y !== undefined) {
            await executeCliclick(`c:${x},${y}`);
          } else {
            await executeCliclick('c:.');
          }
          await new Promise((resolve) => setTimeout(resolve, 500));
          return { success: true, action: 'click', coordinates: { x, y } };

        case 'double_click':
          if (x !== undefined && y !== undefined) {
            await executeCliclick(`dc:${x},${y}`);
          } else {
            await executeCliclick('dc:.');
          }
          await new Promise((resolve) => setTimeout(resolve, 500));
          return { success: true, action: 'double_click', coordinates: { x, y } };

        case 'right_click':
          if (x !== undefined && y !== undefined) {
            await executeCliclick(`rc:${x},${y}`);
          } else {
            await executeCliclick('rc:.');
          }
          await new Promise((resolve) => setTimeout(resolve, 500));
          return { success: true, action: 'right_click', coordinates: { x, y } };

        case 'move':
          if (x !== undefined && y !== undefined) {
            await executeCliclick(`m:${x},${y}`);
            await new Promise((resolve) => setTimeout(resolve, 200));
            return { success: true, action: 'move', coordinates: { x, y } };
          } else {
            return { success: false, message: 'Coordinates required for move action' };
          }

        case 'type': {
          if (!value) {
            return { success: false, message: 'Value required for type action' };
          }
          const escapedValue = value.replace(/"/g, '\\"');
          await executeCliclick(`t:"${escapedValue}"`);
          await new Promise((resolve) => setTimeout(resolve, 500));
          return { success: true, action: 'type', value };
        }
        case 'key':
          if (!value) {
            return { success: false, message: 'Key required for key action' };
          }
          await executeCliclick(`kp:${value}`);
          await new Promise((resolve) => setTimeout(resolve, 500));
          return { success: true, action: 'key', key: value };

        case 'drag': {
          // value should be "x1,y1,x2,y2"
          if (!value) {
            return {
              success: false,
              message: 'Coordinates required for drag action (format: "x1,y1,x2,y2")',
            };
          }
          const [x1, y1, x2, y2] = parseDragCoords(value);
          await executeCliclick(`dd:${x1},${y1} m:${x2},${y2} du:${x2},${y2}`);
          await new Promise((resolve) => setTimeout(resolve, 500));
          return { success: true, action: 'drag', from: { x: x1, y: y1 }, to: { x: x2, y: y2 } };
        }
        case 'screenshot': {
          const screenshotPath = path.join(WORKSPACE_DIR, 'screenshot.png');
          await takeScreenshot(screenshotPath);
          return { success: true, action: 'screenshot', path: screenshotPath };
        }
        case 'wait':
          await new Promise((resolve) => setTimeout(resolve, timeout));
          return { success: true, action: 'wait', duration: timeout };

        default:
          return { success: false, message: `Action '${action}' is not supported` };
      }
    } else if (platform === 'linux') {
      // Linux: Use xdotool
      switch (action) {
        case 'click':
          if (x !== undefined && y !== undefined) {
            await executeCommand(`xdotool mousemove ${x} ${y} click 1`);
          } else {
            await executeCommand('xdotool click 1');
          }
          await new Promise((resolve) => setTimeout(resolve, 500));
          return { success: true, action: 'click', coordinates: { x, y } };

        case 'double_click':
          if (x !== undefined && y !== undefined) {
            await executeCommand(`xdotool mousemove ${x} ${y} click --repeat 2 1`);
          } else {
            await executeCommand('xdotool click --repeat 2 1');
          }
          await new Promise((resolve) => setTimeout(resolve, 500));
          return { success: true, action: 'double_click', coordinates: { x, y } };

        case 'right_click':
          if (x !== undefined && y !== undefined) {
            await executeCommand(`xdotool mousemove ${x} ${y} click 3`);
          } else {
            await executeCommand('xdotool click 3');
          }
          await new Promise((resolve) => setTimeout(resolve, 500));
          return { success: true, action: 'right_click', coordinates: { x, y } };

        case 'move':
          if (x !== undefined && y !== undefined) {
            await executeCommand(`xdotool mousemove ${x} ${y}`);
            await new Promise((resolve) => setTimeout(resolve, 200));
            return { success: true, action: 'move', coordinates: { x, y } };
          } else {
            return { success: false, message: 'Coordinates required for move action' };
          }

        case 'type':
          if (!value) {
            return { success: false, message: 'Value required for type action' };
          }
          await executeCommand(`xdotool type "${value.replace(/"/g, '\\"')}"`);
          await new Promise((resolve) => setTimeout(resolve, 500));
          return { success: true, action: 'type', value };

        case 'key':
          if (!value) {
            return { success: false, message: 'Key required for key action' };
          }
          // Validate key name: only allow alphanumeric, +, -, _, and spaces (for key combinations)
          if (!/^[a-zA-Z0-9_+\-\s]+$/.test(value)) {
            return {
              success: false,
              message: `Invalid key value: "${value}". Only alphanumeric, +, -, _, and space characters are allowed.`,
            };
          }
          await executeCommand(`xdotool key ${value}`);
          await new Promise((resolve) => setTimeout(resolve, 500));
          return { success: true, action: 'key', key: value };

        case 'drag': {
          if (!value) {
            return {
              success: false,
              message: 'Coordinates required for drag action (format: "x1,y1,x2,y2")',
            };
          }
          const [x1, y1, x2, y2] = parseDragCoords(value);
          await executeCommand(
            `xdotool mousemove ${x1} ${y1} mousedown 1 mousemove ${x2} ${y2} mouseup 1`
          );
          await new Promise((resolve) => setTimeout(resolve, 500));
          return { success: true, action: 'drag', from: { x: x1, y: y1 }, to: { x: x2, y: y2 } };
        }
        case 'screenshot': {
          const screenshotPath = path.join(WORKSPACE_DIR, 'screenshot.png');
          await takeScreenshot(screenshotPath);
          return { success: true, action: 'screenshot', path: screenshotPath };
        }

        case 'wait':
          await new Promise((resolve) => setTimeout(resolve, timeout));
          return { success: true, action: 'wait', duration: timeout };

        default:
          return { success: false, message: `Action '${action}' is not supported` };
      }
    } else {
      // Windows: Not fully supported yet
      return {
        success: false,
        message: 'Direct GUI interaction is not yet fully supported on Windows',
        suggestion:
          'Use macOS (cliclick) or Linux (xdotool) for GUI automation, or use vision-based interaction',
      };
    }
  } catch (error: unknown) {
    return {
      success: false,
      message: `GUI interaction failed: ${error instanceof Error ? error.message : String(error)}`,
      suggestion:
        platform === 'darwin'
          ? 'Check if cliclick is installed (brew install cliclick)'
          : 'Check if xdotool is installed (sudo apt-get install xdotool)',
    };
  }
}

function parseDragCoords(value: string): [number, number, number, number] {
  const parts = value.split(',').map(Number);
  if (parts.length !== 4) {
    throw new Error(
      `Drag coordinates must have exactly 4 values (x1,y1,x2,y2), got ${parts.length}`
    );
  }
  const [x1, y1, x2, y2] = parts;
  if (
    !Number.isFinite(x1) ||
    !Number.isFinite(y1) ||
    !Number.isFinite(x2) ||
    !Number.isFinite(y2)
  ) {
    throw new Error(`Drag coordinates must be finite numbers, got: ${value}`);
  }
  if (
    !Number.isInteger(x1) ||
    !Number.isInteger(y1) ||
    !Number.isInteger(x2) ||
    !Number.isInteger(y2)
  ) {
    throw new Error(`Drag coordinates must be integers, got: ${value}`);
  }
  return [x1, y1, x2, y2];
}
