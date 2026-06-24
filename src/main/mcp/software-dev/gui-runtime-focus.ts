import { execFile } from 'child_process';
import { promisify } from 'util';

import { writeMCPLog } from '../mcp-logger.js';
import { currentGUIApp } from './gui-runtime-state.js';

const execFileAsync = promisify(execFile);

export async function focusApplicationWindow(appName?: string): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const platform = require('os').platform();

  writeMCPLog(
    `[GUI] Attempting to bring window to front (platform: ${platform}, appName: ${appName || 'auto-detect'})`
  );

  try {
    if (platform === 'darwin') {
      // macOS: Use AppleScript via osascript (no shell interpolation)
      writeMCPLog('[GUI] Using macOS AppleScript to focus window...');

      if (appName) {
        const { stdout, stderr } = await execFileAsync(
          '/usr/bin/osascript',
          ['-e', `tell application "${appName}" to activate`],
          { timeout: 10000 }
        );
        writeMCPLog(`[GUI] AppleScript result - stdout: ${stdout}, stderr: ${stderr}`);
      } else {
        // Try multiple approaches to find and focus Python windows
        try {
          // Approach 1: Find process by name containing "Python"
          const { stdout, stderr } = await execFileAsync(
            '/usr/bin/osascript',
            [
              '-e',
              'tell application "System Events" to set frontmost of first process whose name contains "Python" to true',
            ],
            { timeout: 10000 }
          );
          writeMCPLog(`[GUI] AppleScript (Python) result - stdout: ${stdout}, stderr: ${stderr}`);
        } catch (err1: unknown) {
          writeMCPLog(
            `[GUI] Failed to focus Python process: ${err1 instanceof Error ? err1.message : String(err1)}`
          );

          // Approach 2: Try to find any Python-related window
          try {
            await execFileAsync(
              '/usr/bin/osascript',
              [
                '-e',
                'tell application "System Events" to set frontmost of first process whose unix id is greater than 0 and name contains "python" to true',
              ],
              { timeout: 10000 }
            );
            writeMCPLog('[GUI] Successfully focused python process (lowercase)');
          } catch (err2: unknown) {
            writeMCPLog(
              `[GUI] Failed to focus python process: ${err2 instanceof Error ? err2.message : String(err2)}`
            );

            // Approach 3: Get the PID and focus by PID
            if (currentGUIApp && currentGUIApp.pid) {
              try {
                await execFileAsync(
                  '/usr/bin/osascript',
                  [
                    '-e',
                    `tell application "System Events" to set frontmost of first process whose unix id is ${currentGUIApp.pid} to true`,
                  ],
                  { timeout: 10000 }
                );
                writeMCPLog(`[GUI] Successfully focused process by PID: ${currentGUIApp.pid}`);
              } catch (err3: unknown) {
                writeMCPLog(
                  `[GUI] Failed to focus by PID: ${err3 instanceof Error ? err3.message : String(err3)}`
                );
              }
            }
          }
        }
      }
    } else if (platform === 'win32') {
      // Windows: Use PowerShell to bring window to front
      writeMCPLog('[GUI] Using Windows PowerShell to focus window...');

      const script = appName
        ? `Add-Type @"\nusing System;\nusing System.Runtime.InteropServices;\npublic class Win32 {\n  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);\n  [DllImport("user32.dll")] public static extern IntPtr FindWindow(string lpClassName, string lpWindowName);\n}\n"@; $hwnd = [Win32]::FindWindow($null, "${appName}"); [Win32]::SetForegroundWindow($hwnd)`
        : `Add-Type @"\nusing System;\nusing System.Runtime.InteropServices;\npublic class Win32 {\n  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();\n  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);\n}\n"@; $hwnd = [Win32]::GetForegroundWindow(); [Win32]::SetForegroundWindow($hwnd)`;

      const { stdout, stderr } = await execFileAsync('powershell', ['-Command', script], {
        timeout: 10000,
      });
      writeMCPLog(`[GUI] PowerShell result - stdout: ${stdout}, stderr: ${stderr}`);
    } else {
      // Linux: Use xdotool (safe: arguments passed as array, no shell)
      writeMCPLog('[GUI] Using Linux xdotool to focus window...');

      try {
        if (appName) {
          const { stdout, stderr } = await execFileAsync(
            'xdotool',
            ['search', '--name', appName, 'windowactivate'],
            { timeout: 10000 }
          );
          writeMCPLog(`[GUI] xdotool result - stdout: ${stdout}, stderr: ${stderr}`);
        } else {
          const { stdout, stderr } = await execFileAsync(
            'xdotool',
            ['search', '--class', 'python', 'windowactivate'],
            { timeout: 10000 }
          );
          writeMCPLog(`[GUI] xdotool result - stdout: ${stdout}, stderr: ${stderr}`);
        }
      } catch (err: unknown) {
        writeMCPLog(
          `[GUI] xdotool not available or failed: ${err instanceof Error ? err.message : String(err)}`
        );
        writeMCPLog('[GUI] Please install xdotool: sudo apt-get install xdotool');
      }
    }

    writeMCPLog('[GUI] Window focus command executed successfully');
  } catch (error: unknown) {
    writeMCPLog(
      `[GUI] Failed to focus window: ${error instanceof Error ? error.message : String(error)}`
    );
    writeMCPLog(
      '[GUI] Window may still be in background - screenshots might capture wrong content'
    );
  }
}
