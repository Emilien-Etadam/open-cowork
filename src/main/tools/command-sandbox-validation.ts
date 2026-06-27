import * as path from 'path';
import type { MountedPath } from '../../renderer/types';
import { isUncPath } from '../../shared/local-file-path';
import { isPathWithinRoot } from './path-containment';

export interface CommandSandboxValidationInput {
  mounts: MountedPath[];
  command: string;
  cwd: string;
}

/**
 * Validate that a shell command does not escape the mounted workspace.
 */
export function validateCommandSandbox(input: CommandSandboxValidationInput): void {
  const { mounts, command, cwd } = input;

  if (!mounts.length) {
    throw new Error('No mounted workspace for this session');
  }

  const normalizedCwd = path.normalize(cwd);
  const cwdAllowed = mounts.some((mount) => {
    const mountRoot = path.normalize(mount.real);
    return isPathWithinRoot(normalizedCwd, mountRoot);
  });
  if (!cwdAllowed) {
    throw new Error('Working directory is outside the mounted workspace');
  }

  if (
    // eslint-disable-next-line no-useless-escape
    /(?:^|[\s;|&])\.\.(?:[\s;|&\/\\]|$)/.test(command) ||
    command.includes('../') ||
    command.includes('..\\')
  ) {
    throw new Error('Command blocked: path traversal (..) is not allowed');
  }

  const pathPatterns = [
    // eslint-disable-next-line no-useless-escape
    /[A-Za-z]:[\\\/][^\s;|&"'<>]*/g,
    /\\\\[^\s;|&"'<>]+/g,
    /(?:^|[\s;|&"'])\/[^\s;|&"'<>]+/g,
    /"([^"]+)"/g,
    /'([^']+)'/g,
  ];

  const extractedPaths: string[] = [];
  for (const pattern of pathPatterns) {
    let match: RegExpExecArray | null;
    const testStr = command;
    pattern.lastIndex = 0;
    while ((match = pattern.exec(testStr)) !== null) {
      const candidate = match[1] || match[0];
      const trimmed = candidate.trim().replace(/^["'\s]+|["'\s]+$/g, '');
      if (trimmed) {
        extractedPaths.push(trimmed);
      }
    }
  }

  for (const candidatePath of extractedPaths) {
    const isAbsolute =
      path.isAbsolute(candidatePath) || /^[A-Za-z]:/.test(candidatePath) || isUncPath(candidatePath);
    if (!isAbsolute) {
      continue;
    }

    const normalizedPath = path.normalize(candidatePath);
    const allowed = mounts.some((mount) => {
      const mountRoot = path.normalize(mount.real);
      return isPathWithinRoot(normalizedPath, mountRoot);
    });

    if (!allowed) {
      throw new Error(`Command blocked: path "${candidatePath}" is outside the mounted workspace`);
    }
  }

  const dangerousPatterns = [
    // eslint-disable-next-line no-useless-escape
    /rm\s+-rf?\s+[\/~]/i,
    /dd\s+if=/i,
    /mkfs/i,
    />\s*\/dev\//i,
    /curl.*\|\s*(?:ba)?sh/i,
    /wget.*\|\s*(?:ba)?sh/i,
    /format\s+[A-Za-z]:/i,
    /del\s+\/[sfq]/i,
    /rmdir\s+\/[sq]/i,
    /reg\s+(add|delete)/i,
    /net\s+(user|localgroup)/i,
    /powershell\s+.*-enc/i,
    /Set-ExecutionPolicy/i,
  ];

  for (const pattern of dangerousPatterns) {
    if (pattern.test(command)) {
      throw new Error('Command blocked: potentially dangerous operation');
    }
  }
}
