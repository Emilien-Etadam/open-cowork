import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

/**
 * Execute a command safely using execFileAsync (no shell interpolation).
 * Prefer this over executeCommand when the executable and arguments are known.
 */
export async function executeCommandSafe(
  command: string,
  args: string[],
  options?: { timeout?: number }
): Promise<{ stdout: string; stderr: string }> {
  try {
    const result = await execFileAsync(command, args, { timeout: options?.timeout || 30000 });
    return {
      stdout: typeof result.stdout === 'string' ? result.stdout : '',
      stderr: typeof result.stderr === 'string' ? result.stderr : '',
    };
  } catch (error: unknown) {
    throw new Error(
      `Command execution failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Execute an AppleScript via osascript safely (no shell interpolation).
 */
export async function executeAppleScript(
  script: string,
  timeout: number = 10000
): Promise<{ stdout: string; stderr: string }> {
  return executeCommandSafe('/usr/bin/osascript', ['-e', script], { timeout });
}

/**
 * Execute a JXA (JavaScript for Automation) script via osascript safely.
 */
export async function executeJXAScript(
  script: string,
  timeout: number = 10000
): Promise<{ stdout: string; stderr: string }> {
  return executeCommandSafe('/usr/bin/osascript', ['-l', 'JavaScript', '-e', script], { timeout });
}
