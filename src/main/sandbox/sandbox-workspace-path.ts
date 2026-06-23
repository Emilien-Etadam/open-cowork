/**
 * Path helpers for WSL sandbox workspaces.
 *
 * The agent sees a virtual `/workspace` root while commands and file tools may
 * use either WSL Unix paths or Windows `\\wsl.localhost\...` UNC paths.
 */

/** Escape a path for interpolation inside a POSIX single-quoted shell string. */
export function shellEscapePosixPath(value: string): string {
  return value.replace(/'/g, "'\\''");
}

/** Convert a WSL Unix path to a Windows UNC path reachable from Node/Electron. */
export function wslUnixPathToWindowsUnc(distro: string, unixPath: string): string {
  const normalized = unixPath.replace(/\\/g, '/').replace(/\/+$/, '');
  const withoutLeadingSlash = normalized.replace(/^\//, '');
  return `\\\\wsl.localhost\\${distro}\\${withoutLeadingSlash.replace(/\//g, '\\')}`;
}

/** Convert a `\\wsl.localhost\Distro\...` UNC path back to a Unix path. */
export function wslUncPathToUnix(uncPath: string): string | null {
  const match = uncPath.match(/^\\\\wsl(?:\.localhost|\$)\\([^\\]+)\\(.+)$/i);
  if (!match) {
    return null;
  }
  return `/${match[2].replace(/\\/g, '/')}`;
}

/** Rewrite virtual `/workspace` references in a shell command to the sandbox path. */
export function rewriteVirtualWorkspacePaths(
  command: string,
  sandboxPath: string,
  virtualWorkspacePath = '/workspace'
): string {
  const escapedVirtual = virtualWorkspacePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return command
    .replace(new RegExp(`${escapedVirtual}/`, 'g'), `${sandboxPath}/`)
    .replace(new RegExp(`${escapedVirtual}(?=\\s|$|[;&|])`, 'g'), sandboxPath);
}

/** Resolve the cwd passed to bash into the isolated WSL sandbox directory. */
export function resolveSandboxBashCwd(
  cwd: string,
  sandboxPath: string,
  virtualWorkspacePath = '/workspace'
): string {
  const unixFromUnc = wslUncPathToUnix(cwd);
  const normalizedCwd = (unixFromUnc ?? cwd).replace(/\\/g, '/').replace(/\/+$/, '') || '/';

  if (normalizedCwd === sandboxPath || normalizedCwd.startsWith(`${sandboxPath}/`)) {
    return normalizedCwd;
  }

  if (normalizedCwd === virtualWorkspacePath) {
    return sandboxPath;
  }

  if (normalizedCwd.startsWith(`${virtualWorkspacePath}/`)) {
    return `${sandboxPath}${normalizedCwd.slice(virtualWorkspacePath.length)}`;
  }

  return sandboxPath;
}
