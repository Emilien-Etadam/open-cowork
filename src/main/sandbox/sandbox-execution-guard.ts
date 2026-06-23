import type { SandboxAdapter } from './sandbox-adapter';

export interface SandboxExecutionGuardInput {
  sandboxEnabled: boolean;
  platform: NodeJS.Platform;
  sandbox: SandboxAdapter;
  syncFailed?: boolean;
  syncError?: string;
}

/**
 * Returns a user-facing block reason when sandbox execution must not proceed.
 */
export function getSandboxExecutionBlockReason(input: SandboxExecutionGuardInput): string | null {
  if (!input.sandboxEnabled) {
    return null;
  }

  if (input.syncFailed) {
    return (
      input.syncError?.trim() ||
      'Sandbox file sync failed. Fix WSL2 setup or disable sandbox in Settings.'
    );
  }

  if (input.platform === 'win32') {
    if (input.sandbox.isBlocked) {
      return (
        input.sandbox.blockingReason ||
        'WSL2 sandbox is required but unavailable. Install or configure WSL2, then restart the app.'
      );
    }

    if (!input.sandbox.isWSL) {
      return 'Windows sandbox requires WSL2. Install WSL2 (wsl --install) or disable sandbox in Settings.';
    }
  }

  if (input.platform === 'darwin' && input.sandbox.isBlocked) {
    return (
      input.sandbox.blockingReason ||
      'Lima sandbox is required but unavailable. Install Lima or disable sandbox in Settings.'
    );
  }

  if (input.platform === 'darwin' && !input.sandbox.isLima && !input.sandbox.isWSL) {
    if (input.sandbox.mode === 'native') {
      return 'macOS sandbox requires Lima. Install Lima or disable sandbox in Settings.';
    }
  }

  return null;
}
