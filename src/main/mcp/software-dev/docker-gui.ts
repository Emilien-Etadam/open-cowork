import * as fs from 'fs/promises';
import * as path from 'path';
import { exec, execFile } from 'child_process';
import { promisify } from 'util';

import { writeMCPLog } from '../mcp-logger.js';
import { WORKSPACE_DIR, executeCommand } from './file-ops.js';

const execFileAsync = promisify(execFile);

export interface GUIAppInstance {
  process: ReturnType<typeof exec> | null;
  pid: number;
  appType: string;
  startTime: Date;
  url?: string;
  isDocker?: boolean;
  containerId?: string;
  vncPort?: number;
}

export interface DockerGUITestConfig {
  appFiles: string[];
  enableVnc: boolean;
  vncPort: number;
  displayNumber: number;
}

export async function buildDockerGUITestImage(config: DockerGUITestConfig): Promise<string> {
  // Validate config values to prevent injection in Dockerfile template
  if (!Number.isInteger(config.vncPort) || config.vncPort < 1024 || config.vncPort > 65535) {
    throw new Error(
      `Invalid VNC port: ${config.vncPort}. Must be an integer between 1024 and 65535.`
    );
  }
  if (
    !Number.isInteger(config.displayNumber) ||
    config.displayNumber < 0 ||
    config.displayNumber > 99
  ) {
    throw new Error(
      `Invalid display number: ${config.displayNumber}. Must be an integer between 0 and 99.`
    );
  }

  const imageName = 'mcp-gui-test';
  const dockerfilePath = path.join(WORKSPACE_DIR, '.mcp-gui-test', 'Dockerfile');

  writeMCPLog('[Docker] Building GUI test image...');

  // Create Dockerfile
  const dockerfile = `FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive

# Install dependencies
RUN apt-get update && apt-get install -y \\
    python3 \\
    python3-pip \\
    python3-tk \\
    python-is-python3 \\
    xvfb \\
    xdotool \\
    scrot \\
    imagemagick \\
    x11vnc \\
    wget \\
    curl \\
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy application and test files (will be mounted)
# Files will be mounted at runtime

# Create entrypoint script
RUN echo '#!/bin/bash\\n\\
# Start virtual display\\n\\
echo "Starting Xvfb on :${config.displayNumber}..."\\n\\
Xvfb :${config.displayNumber} -screen 0 1024x768x24 -ac +extension GLX +render -noreset &\\n\\
export DISPLAY=:${config.displayNumber}\\n\\
\\n\\
# Wait for X server to start\\n\\
sleep 2\\n\\
\\n\\
# Start VNC server if enabled\\n\\
if [ "$ENABLE_VNC" = "true" ]; then\\n\\
    echo "Starting VNC server on port ${config.vncPort}..."\\n\\
    x11vnc -display :${config.displayNumber} -rfbport ${config.vncPort} -forever -nopw -shared -bg -o /tmp/x11vnc.log\\n\\
    sleep 2\\n\\
    if pgrep -x x11vnc > /dev/null; then\\n\\
        echo "VNC server started successfully on port ${config.vncPort}"\\n\\
    else\\n\\
        echo "ERROR: VNC server failed to start. Check /tmp/x11vnc.log"\\n\\
        cat /tmp/x11vnc.log\\n\\
    fi\\n\\
    echo ""\\n\\
fi\\n\\
\\n\\
# Show current working directory and file structure\\n\\
echo "Current working directory: $(pwd)"\\n\\
echo "Workspace contents:"\\n\\
ls -la /workspace 2>&1 | head -20\\n\\
echo ""\\n\\
\\n\\
# Execute start command (passed as argument) in background\\n\\
if [ -n "$TEST_COMMAND" ]; then\\n\\
    echo "Starting GUI application: $TEST_COMMAND"\\n\\
    echo "Working directory: $(pwd)"\\n\\
    # Change to workspace directory to ensure correct path context\\n\\
    cd /workspace\\n\\
    DISPLAY=:${config.displayNumber} bash -c "$TEST_COMMAND" > /tmp/app.log 2>&1 &\\n\\
    APP_PID=$!\\n\\
    echo "GUI application started with PID: $APP_PID"\\n\\
    echo "Container will keep running to maintain the GUI application..."\\n\\
else\\n\\
    echo "No start command specified. Keeping container alive..."\\n\\
fi\\n\\
\\n\\
# Keep container alive so GUI app continues running\\n\\
echo "Container is ready. GUI application is running in background."\\n\\
echo "Use VNC to view the application or interact with it via MCP tools."\\n\\
tail -f /dev/null\\n\\
' > /entrypoint.sh && chmod +x /entrypoint.sh

# Expose VNC port
EXPOSE ${config.vncPort}

# Set environment variables
ENV DISPLAY=:${config.displayNumber}
ENV ENABLE_VNC=false

ENTRYPOINT ["/entrypoint.sh"]
`;

  // Ensure directory exists
  await fs.mkdir(path.dirname(dockerfilePath), { recursive: true });
  await fs.writeFile(dockerfilePath, dockerfile);

  // Build image
  try {
    const { stdout, stderr } = await execFileAsync(
      'docker',
      ['build', '-t', imageName, '-f', dockerfilePath, path.dirname(dockerfilePath)],
      { cwd: WORKSPACE_DIR, maxBuffer: 10 * 1024 * 1024, timeout: 300000 }
    );
    writeMCPLog('[Docker] Image built successfully');
    writeMCPLog(stdout);
    if (stderr) writeMCPLog(stderr);
    return imageName;
  } catch (error: unknown) {
    writeMCPLog(
      '[Docker] Failed to build image:',
      error instanceof Error ? error.message : String(error)
    );
    throw new Error(
      `Failed to build Docker image: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

export async function startGUIApplicationInDocker(
  appFilePath: string,
  appType: string,
  startCommand: string,
  enableVnc: boolean = true,
  vncPort: number = 5901
): Promise<GUIAppInstance> {
  writeMCPLog('[Docker] Starting GUI application in isolated Docker environment...');

  const config: DockerGUITestConfig = {
    appFiles: [appFilePath],
    enableVnc,
    vncPort,
    displayNumber: 99,
  };

  // Build Docker image
  const imageName = await buildDockerGUITestImage(config);

  // Prepare volume mounts - mount entire workspace to preserve file structure
  // This ensures all related files (dependencies, modules, etc.) are available
  const workspacePath = path.resolve(WORKSPACE_DIR);

  // Start container
  const containerName = `mcp-gui-test-${Date.now()}`;
  const dockerArgs = [
    'run',
    '--rm',
    '-d',
    '--name',
    containerName,
    '-v',
    `${workspacePath}:/workspace`,
    '-w',
    '/workspace',
    '-e',
    `ENABLE_VNC=${enableVnc}`,
    '-e',
    `TEST_COMMAND=${startCommand}`,
    ...(enableVnc ? ['-p', `${vncPort}:${vncPort}`] : []),
    imageName,
  ];

  writeMCPLog(`[Docker] Starting container: ${containerName}`);
  writeMCPLog(`[Docker] Command: docker ${dockerArgs.join(' ')}`);

  try {
    const { stdout } = await execFileAsync('docker', dockerArgs, {
      cwd: WORKSPACE_DIR,
      maxBuffer: 10 * 1024 * 1024,
      timeout: 300000,
    });
    const containerId = stdout.trim();

    // Validate container ID format (hex string, 12-64 chars)
    if (!/^[a-f0-9]{12,64}$/.test(containerId)) {
      throw new Error(`Invalid container ID returned from docker run: ${containerId}`);
    }

    writeMCPLog(`[Docker] Container started: ${containerId.substring(0, 12)}`);

    // Wait for Xvfb and VNC to start
    writeMCPLog('[Docker] Waiting for Xvfb and VNC services to start...');
    await new Promise((resolve) => setTimeout(resolve, 5000));

    // Wait a bit more for GUI application to start
    writeMCPLog('[Docker] Waiting for GUI application to initialize...');
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // Save diagnostics to .docker-logs directory
    writeMCPLog('[Docker] Collecting and saving diagnostics...');
    try {
      const logFile = await saveDockerDiagnostics(containerId, WORKSPACE_DIR);
      writeMCPLog(`[Docker] Full diagnostics saved to: ${logFile}`);
    } catch (error: unknown) {
      writeMCPLog(
        `[Docker] Warning: Failed to save diagnostics: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    if (enableVnc) {
      // Verify VNC server is running
      let vncRunning = false;
      for (let i = 0; i < 10; i++) {
        try {
          const { stdout: checkOutput } = await execFileAsync('docker', [
            'exec',
            containerId,
            'bash',
            '-c',
            'ps aux | grep x11vnc | grep -v grep',
          ]);
          if (checkOutput.trim()) {
            vncRunning = true;
            writeMCPLog('[Docker] VNC server is running');
            break;
          }
        } catch (e) {
          // VNC not ready yet
        }
        writeMCPLog(`[Docker] Waiting for VNC server... (${i + 1}/10)`);
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }

      if (!vncRunning) {
        writeMCPLog('[Docker] Warning: VNC server may not be running. Check container logs.');
      }

      // Check port mapping
      try {
        const { stdout: portCheck } = await execFileAsync('docker', [
          'port',
          containerId,
          `${vncPort}/tcp`,
        ]);
        writeMCPLog(`[Docker] Port mapping: ${portCheck.trim()}`);
      } catch (e) {
        writeMCPLog(`[Docker] Warning: Could not verify port mapping: ${e}`);
      }

      writeMCPLog('');
      writeMCPLog('========================================');
      writeMCPLog('VNC Viewer Connection');
      writeMCPLog('========================================');
      writeMCPLog(`VNC Port: ${vncPort}`);
      writeMCPLog(`Connection: localhost:${vncPort}`);
      writeMCPLog('');
      writeMCPLog('Install VNC Viewer:');
      writeMCPLog('  brew install --cask vnc-viewer');
      writeMCPLog('');
      writeMCPLog('Then open VNC Viewer and connect to:');
      writeMCPLog(`  localhost:${vncPort}`);
      writeMCPLog('');
      writeMCPLog('If connection refused, check container logs:');
      writeMCPLog(`  docker logs ${containerId}`);
      writeMCPLog('========================================');
      writeMCPLog('');
    }

    const instance: GUIAppInstance = {
      process: null,
      pid: 0,
      appType,
      startTime: new Date(),
      isDocker: true,
      containerId,
      vncPort: enableVnc ? vncPort : undefined,
    };

    return instance;
  } catch (error: unknown) {
    writeMCPLog(
      '[Docker] Failed to start container:',
      error instanceof Error ? error.message : String(error)
    );
    throw new Error(
      `Failed to start Docker container: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

export async function stopGUIApplication(
  instance: GUIAppInstance,
  force: boolean = false
): Promise<void> {
  if (!instance) {
    return;
  }

  // If Docker container, stop it
  if (instance.isDocker && instance.containerId) {
    writeMCPLog(`[Docker] Stopping container: ${instance.containerId.substring(0, 12)}`);

    try {
      if (force) {
        await execFileAsync('docker', ['kill', instance.containerId]);
      } else {
        await execFileAsync('docker', ['stop', instance.containerId]);
      }
      writeMCPLog('[Docker] Container stopped successfully');
    } catch (error: unknown) {
      writeMCPLog(
        `[Docker] Error stopping container: ${error instanceof Error ? error.message : String(error)}`
      );
    }
    return;
  }

  // Otherwise, stop local process
  if (!instance.process) {
    return;
  }

  writeMCPLog(`[GUI] Stopping application (PID: ${instance.pid})`);

  try {
    if (force) {
      if (process.platform === 'win32') {
        instance.process.kill(); // On Windows, kill() sends TerminateProcess
      } else {
        instance.process.kill('SIGKILL');
      }
    } else {
      if (process.platform === 'win32') {
        instance.process.kill(); // On Windows, kill() sends TerminateProcess
      } else {
        instance.process.kill('SIGTERM');
      }
    }

    // Wait a bit for cleanup
    await new Promise((resolve) => setTimeout(resolve, 1000));
  } catch (error: unknown) {
    writeMCPLog(
      `[GUI] Error stopping application: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

// Helper: Get Docker container logs
export async function getDockerContainerLogs(
  containerId: string,
  tail: number = 0
): Promise<string> {
  try {
    const args = ['logs', ...(tail > 0 ? ['--tail', String(tail)] : []), containerId];
    const { stdout } = await execFileAsync('docker', args);
    return stdout;
  } catch (error: unknown) {
    writeMCPLog(
      `[Docker] Error getting logs: ${error instanceof Error ? error.message : String(error)}`
    );
    return `Error getting logs: ${error instanceof Error ? error.message : String(error)}`;
  }
}

// Helper: Save Docker container logs and diagnostics to file
export async function saveDockerDiagnostics(
  containerId: string,
  outputDir: string = WORKSPACE_DIR
): Promise<string> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const logDir = path.join(outputDir, '.docker-logs');
  await fs.mkdir(logDir, { recursive: true });

  const logFile = path.join(logDir, `container-${containerId.substring(0, 12)}-${timestamp}.log`);

  let diagnostics = `========================================\n`;
  diagnostics += `Docker Container Diagnostics\n`;
  diagnostics += `Container ID: ${containerId}\n`;
  diagnostics += `Timestamp: ${new Date().toISOString()}\n`;
  diagnostics += `========================================\n\n`;

  // 1. Container logs
  diagnostics += `--- Container Logs ---\n`;
  try {
    const logs = await getDockerContainerLogs(containerId);
    diagnostics += logs;
  } catch (error: unknown) {
    diagnostics += `Error getting logs: ${error instanceof Error ? error.message : String(error)}\n`;
  }
  diagnostics += `\n\n`;

  // 2. Check running processes
  diagnostics += `--- Running Processes ---\n`;
  try {
    const { stdout } = await execFileAsync('docker', ['exec', containerId, 'bash', '-c', 'ps aux']);
    diagnostics += stdout;
  } catch (error: unknown) {
    diagnostics += `Error checking processes: ${error instanceof Error ? error.message : String(error)}\n`;
  }
  diagnostics += `\n\n`;

  // 3. Check Xvfb
  diagnostics += `--- Xvfb Status ---\n`;
  try {
    const { stdout } = await execFileAsync('docker', [
      'exec',
      containerId,
      'bash',
      '-c',
      'ps aux | grep Xvfb | grep -v grep',
    ]);
    diagnostics += stdout || 'Xvfb not running\n';
  } catch (error: unknown) {
    diagnostics += `Error checking Xvfb: ${error instanceof Error ? error.message : String(error)}\n`;
  }
  diagnostics += `\n\n`;

  // 4. Check VNC server
  diagnostics += `--- VNC Server Status ---\n`;
  try {
    const { stdout } = await execFileAsync('docker', [
      'exec',
      containerId,
      'bash',
      '-c',
      'ps aux | grep x11vnc | grep -v grep',
    ]);
    diagnostics += stdout || 'VNC server not running\n';
  } catch (error: unknown) {
    diagnostics += `Error checking VNC: ${error instanceof Error ? error.message : String(error)}\n`;
  }
  diagnostics += `\n\n`;

  // 5. Check X11 windows
  diagnostics += `--- X11 Windows ---\n`;
  try {
    const { stdout } = await execFileAsync('docker', [
      'exec',
      containerId,
      'bash',
      '-c',
      "DISPLAY=:99 xwininfo -root -tree 2>&1 || echo 'xwininfo not available or no windows'",
    ]);
    diagnostics += stdout;
  } catch (error: unknown) {
    diagnostics += `Error checking windows: ${error instanceof Error ? error.message : String(error)}\n`;
  }
  diagnostics += `\n\n`;

  // 6. Check environment variables
  diagnostics += `--- Environment Variables ---\n`;
  try {
    const { stdout } = await execFileAsync('docker', [
      'exec',
      containerId,
      'bash',
      '-c',
      "env | grep -E '(DISPLAY|ENABLE_VNC|TEST_COMMAND)'",
    ]);
    diagnostics += stdout || 'No relevant environment variables found\n';
  } catch (error: unknown) {
    diagnostics += `Error checking environment: ${error instanceof Error ? error.message : String(error)}\n`;
  }
  diagnostics += `\n\n`;

  // 7. Check VNC log
  diagnostics += `--- VNC Server Log ---\n`;
  try {
    const { stdout } = await executeCommand(
      `docker exec ${containerId} bash -c "cat /tmp/x11vnc.log 2>&1 || echo 'VNC log not found'"`,
      WORKSPACE_DIR
    );
    diagnostics += stdout;
  } catch (error: unknown) {
    diagnostics += `Error reading VNC log: ${error instanceof Error ? error.message : String(error)}\n`;
  }
  diagnostics += `\n\n`;

  // 8. Check application log
  diagnostics += `--- Application Log ---\n`;
  try {
    const { stdout } = await executeCommand(
      `docker exec ${containerId} bash -c "cat /tmp/app.log 2>&1 || echo 'Application log not found'"`,
      WORKSPACE_DIR
    );
    diagnostics += stdout;
  } catch (error: unknown) {
    diagnostics += `Error reading application log: ${error instanceof Error ? error.message : String(error)}\n`;
  }
  diagnostics += `\n\n`;

  // 9. Check if application is running
  diagnostics += `--- Application Process Check ---\n`;
  try {
    const { stdout } = await executeCommand(
      `docker exec ${containerId} bash -c "ps aux | grep -E '(python|java|node|electron)' | grep -v grep || echo 'No application processes found'"`,
      WORKSPACE_DIR
    );
    diagnostics += stdout;
  } catch (error: unknown) {
    diagnostics += `Error checking application: ${error instanceof Error ? error.message : String(error)}\n`;
  }
  diagnostics += `\n\n`;

  // 10. Network connectivity
  diagnostics += `--- Network Status ---\n`;
  try {
    const { stdout } = await executeCommand(
      `docker exec ${containerId} bash -c "netstat -tlnp 2>&1 | grep -E '(5901|VNC)' || netstat -tlnp 2>&1 | head -10 || echo 'netstat not available'"`,
      WORKSPACE_DIR
    );
    diagnostics += stdout;
  } catch (error: unknown) {
    diagnostics += `Error checking network: ${error instanceof Error ? error.message : String(error)}\n`;
  }
  diagnostics += `\n========================================\n`;

  // Save to file
  await fs.writeFile(logFile, diagnostics, 'utf-8');
  writeMCPLog(`[Docker] Diagnostics saved to: ${logFile}`);

  return logFile;
}
