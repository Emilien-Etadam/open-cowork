import type { BashOperations } from '@earendil-works/pi-coding-agent';
import {
  getWslSandboxBashSession,
  type WslSandboxBashSessionOptions,
} from './wsl-sandbox-bash-session';

export type { WslSandboxBashSessionOptions } from './wsl-sandbox-bash-session';
export {
  disposeWslSandboxBashSession,
  resetWslSandboxBashSessionsForTests,
} from './wsl-sandbox-bash-session';

/**
 * Bash operations backed by a persistent WSL shell per (distro, sandboxPath).
 * Avoids spawning a new wsl.exe process for every tool call.
 */
export function createWslSandboxBashOperations(
  options: WslSandboxBashSessionOptions
): BashOperations {
  const session = getWslSandboxBashSession(options);

  return {
    exec: (command, cwd, execOptions) =>
      session.exec(command, cwd, {
        onData: (chunk) => {
          const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.from(chunk);
          execOptions.onData(buffer);
        },
        signal: execOptions.signal,
        timeout: execOptions.timeout,
        env: execOptions.env,
      }),
  };
}
