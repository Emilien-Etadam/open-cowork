import { executeCommand } from './file-ops.js';

export async function executeCliclick(
  command: string
): Promise<{ stdout: string; stderr: string }> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const platform = require('os').platform();

  if (platform !== 'darwin') {
    throw new Error(
      'cliclick is only available on macOS. Use xdotool on Linux or other tools on Windows.'
    );
  }

  // Check if cliclick is installed
  try {
    await executeCommand('which cliclick');
  } catch {
    throw new Error('cliclick is not installed. Install it with: brew install cliclick');
  }

  return await executeCommand(`cliclick ${command}`);
}
