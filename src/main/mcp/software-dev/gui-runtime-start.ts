import * as path from 'path';
import { exec } from 'child_process';

import { writeMCPLog } from '../mcp-logger.js';
import { startGUIApplicationInDocker, type GUIAppInstance } from './docker-gui.js';
import { WORKSPACE_DIR } from './file-ops.js';

export async function startGUIApplication(
  appFilePath: string,
  appType: string,
  startCommand?: string,
  waitTime: number = 3,
  useDocker: boolean = true,
  enableVnc: boolean = true,
  vncPort: number = 5901
): Promise<GUIAppInstance> {
  // If Docker mode is enabled, use Docker
  if (useDocker) {
    if (!startCommand) {
      throw new Error('startCommand is required when using Docker mode');
    }
    return await startGUIApplicationInDocker(
      appFilePath,
      appType,
      startCommand,
      enableVnc,
      vncPort
    );
  }

  // Otherwise, start locally
  const fullPath = path.isAbsolute(appFilePath)
    ? appFilePath
    : path.join(WORKSPACE_DIR, appFilePath);

  let command: string;
  let url: string | undefined;

  // Determine start command based on app type
  if (startCommand) {
    command = startCommand;
  } else {
    switch (appType) {
      case 'python':
        command = `python "${fullPath}"`;
        break;
      case 'electron':
        command = `npm start`;
        break;
      case 'web': {
        // For web apps, start a local server
        const port = 8000 + Math.floor(Math.random() * 1000);
        command = `python -m http.server ${port}`;
        url = `http://localhost:${port}`;
        break;
      }
      case 'java':
        command = `java -jar "${fullPath}"`;
        break;
      default:
        command = fullPath;
    }
  }

  writeMCPLog(`[GUI] Starting ${appType} application: ${command}`);

  // Start the process
  const childProcess = exec(command, {
    cwd: WORKSPACE_DIR,
  });

  const instance: GUIAppInstance = {
    process: childProcess,
    pid: childProcess.pid!,
    appType,
    startTime: new Date(),
    url,
    isDocker: false,
  };

  // Wait for app to be ready
  await new Promise((resolve) => setTimeout(resolve, waitTime * 1000));

  writeMCPLog(`[GUI] Application started (PID: ${instance.pid})`);

  return instance;
}
