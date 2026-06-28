/**
 * @module main/runtime/gui-runtime
 *
 * Coordinates Python and GUI tool runtimes for macOS/Linux automation.
 */
import { ensureCliclickRuntime } from './gui-tools-runtime';
import { ensurePythonRuntime, isPythonRuntimeReady } from './python-runtime';

export { ensurePythonRuntime, getBundledPythonPaths, isPythonRuntimeReady } from './python-runtime';
export {
  ensureCliclickRuntime,
  getBundledCliclickPath,
  isCliclickRuntimeReady,
} from './gui-tools-runtime';

export async function ensureGuiRuntimeReady(): Promise<void> {
  if (process.platform === 'darwin' || process.platform === 'linux') {
    await ensurePythonRuntime();
  }
  if (process.platform === 'darwin') {
    await ensureCliclickRuntime();
  }
}

export function isGuiRuntimeReady(): boolean {
  if (process.platform === 'darwin' || process.platform === 'linux') {
    if (!isPythonRuntimeReady()) {
      return false;
    }
  }
  if (process.platform === 'darwin') {
    // cliclick is optional — Quartz fallback exists
    return true;
  }
  return true;
}
