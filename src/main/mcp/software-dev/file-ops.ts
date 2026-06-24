import * as fs from 'fs/promises';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

import { writeMCPLog } from '../mcp-logger.js';

const execFileAsync = promisify(execFile);

// Get workspace directory from environment or use current directory
export const WORKSPACE_DIR = process.env.WORKSPACE_DIR || process.cwd();

// Helper: Execute Claude Code command
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function executeClaudeCode(
  prompt: string,
  workingDir: string = WORKSPACE_DIR
): Promise<string> {
  try {
    // Check if claude-code is available
    const claudeCodePath = process.env.CLAUDE_CODE_PATH || 'claude-code';

    // Execute claude-code with the prompt
    const { stdout, stderr } = await execFileAsync(
      'bash',
      ['-c', `${claudeCodePath} "${prompt.replace(/"/g, '\\"')}"`],
      {
        cwd: workingDir,
        maxBuffer: 10 * 1024 * 1024, // 10MB buffer
        timeout: 120000, // 2 minute timeout
      }
    );

    if (stderr && !stderr.includes('Warning')) {
      writeMCPLog('[ClaudeCode] stderr:', stderr);
    }

    return stdout || stderr || 'Command executed successfully';
  } catch (error: unknown) {
    writeMCPLog('[ClaudeCode] Error:', error instanceof Error ? error.message : String(error));
    throw new Error(
      `Claude Code execution failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

// Helper: Validate and resolve a file path within WORKSPACE_DIR (reject absolute + traversal)
export function resolveContainedPath(filePath: string): string {
  if (path.isAbsolute(filePath)) {
    throw new Error(`Absolute paths not allowed: ${filePath}`);
  }
  const fullPath = path.resolve(WORKSPACE_DIR, filePath);
  if (
    !fullPath.startsWith(path.resolve(WORKSPACE_DIR) + path.sep) &&
    fullPath !== path.resolve(WORKSPACE_DIR)
  ) {
    throw new Error(`Path traversal detected: ${filePath}`);
  }
  return fullPath;
}

// Helper: Read file content
export async function readFile(filePath: string): Promise<string> {
  if (path.isAbsolute(filePath)) {
    throw new Error(`Absolute paths not allowed: ${filePath}`);
  }
  const fullPath = path.resolve(WORKSPACE_DIR, filePath);
  if (!fullPath.startsWith(path.resolve(WORKSPACE_DIR))) {
    throw new Error(`Path traversal detected: ${filePath}`);
  }
  try {
    return await fs.readFile(fullPath, 'utf-8');
  } catch (error: unknown) {
    throw new Error(
      `Failed to read file ${filePath}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

// Helper: Write file content
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function writeFile(filePath: string, content: string): Promise<void> {
  const fullPath = resolveContainedPath(filePath);
  try {
    // Ensure directory exists
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, content, 'utf-8');
  } catch (error: unknown) {
    throw new Error(
      `Failed to write file ${filePath}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

// Helper: Delete file
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function deleteFile(filePath: string): Promise<void> {
  const fullPath = resolveContainedPath(filePath);
  try {
    await fs.unlink(fullPath);
  } catch (error: unknown) {
    throw new Error(
      `Failed to delete file ${filePath}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

// Helper: Check if file exists
export async function fileExists(filePath: string): Promise<boolean> {
  const fullPath = path.isAbsolute(filePath) ? filePath : path.join(WORKSPACE_DIR, filePath);
  try {
    await fs.access(fullPath);
    return true;
  } catch {
    return false;
  }
}

// Helper: Execute shell command
export async function executeCommand(
  command: string,
  workingDir: string = WORKSPACE_DIR
): Promise<{ stdout: string; stderr: string }> {
  try {
    // Use execFileAsync with bash -c instead of exec to avoid direct shell interpolation
    return await execFileAsync('bash', ['-c', command], {
      cwd: workingDir,
      maxBuffer: 10 * 1024 * 1024,
      timeout: 300000, // 5 minute timeout
    });
  } catch (error: unknown) {
    const err = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string };
    throw new Error(
      `Command execution failed: ${err.message}\nStdout: ${err.stdout}\nStderr: ${err.stderr}`
    );
  }
}
