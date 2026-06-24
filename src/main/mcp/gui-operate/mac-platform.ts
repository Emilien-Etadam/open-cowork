import { spawn } from 'child_process';
import * as path from 'path';

import { writeMCPLog } from '../mcp-logger.js';

import { isDescriptionDockRelated, scoreDockItemAgainstDescription } from './click-history.js';
import { PLATFORM } from './constants.js';
import { getDisplayConfiguration } from './display.js';
import { executeAppleScript, executeCommandSafe, executeJXAScript } from './platform-common.js';
import type { DockItemInfo } from './types.js';

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await import('fs/promises').then(({ access }) => access(filePath));
    return true;
  } catch {
    return false;
  }
}

function getResourcesDirCandidates(): string[] {
  const candidates: string[] = [];

  const envResources = process.env.OPEN_COWORK_RESOURCES_PATH;
  if (envResources) candidates.push(envResources);

  candidates.push(path.resolve(__dirname, '..'));
  candidates.push(path.resolve(__dirname, '..', 'resources'));
  candidates.push(path.resolve(__dirname, '..', '..', '..', 'resources'));

  return [...new Set(candidates)];
}

async function resolveBundledExecutable(relativeFromResources: string): Promise<string | null> {
  for (const resourcesDir of getResourcesDirCandidates()) {
    const candidate = path.join(resourcesDir, relativeFromResources);
    if (await pathExists(candidate)) return candidate;
  }
  return null;
}

let cachedCliclickPath: string | null | undefined;

export async function resolveCliclickPath(): Promise<string | null> {
  if (cachedCliclickPath !== undefined) return cachedCliclickPath;
  if (PLATFORM !== 'darwin') {
    cachedCliclickPath = null;
    return null;
  }

  const envOverride = process.env.OPEN_COWORK_CLICLICK_PATH;
  if (envOverride && (await pathExists(envOverride))) {
    cachedCliclickPath = envOverride;
    return envOverride;
  }

  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  const archBundled = await resolveBundledExecutable(
    path.join('tools', `darwin-${arch}`, 'bin', 'cliclick')
  );
  const legacyBundled = await resolveBundledExecutable(path.join('tools', 'bin', 'cliclick'));
  const bundled = archBundled || legacyBundled;
  if (bundled) {
    cachedCliclickPath = bundled;
    return bundled;
  }

  const commonLocations = ['/opt/homebrew/bin/cliclick', '/usr/local/bin/cliclick'];
  for (const p of commonLocations) {
    if (await pathExists(p)) {
      cachedCliclickPath = p;
      return p;
    }
  }

  try {
    const { stdout } = await executeCommandSafe('/usr/bin/which', ['cliclick'], { timeout: 2000 });
    const whichPath = stdout.trim();
    if (whichPath) {
      cachedCliclickPath = whichPath;
      return whichPath;
    }
  } catch {
    // ignore
  }

  cachedCliclickPath = null;
  return null;
}

export function normalizeModifierKeys(modifiers: string[]): string[] {
  const modifierMap: Record<string, string> = {
    command: 'cmd',
    cmd: 'cmd',
    shift: 'shift',
    option: 'alt',
    alt: 'alt',
    control: 'ctrl',
    ctrl: 'ctrl',
    'control/ctrl': 'ctrl',
    'command/cmd': 'cmd',
    'option/alt': 'alt',
  };

  return modifiers.map((m) => modifierMap[m.toLowerCase()]).filter((m): m is string => Boolean(m));
}

/**
 * Format coordinates for cliclick command.
 * cliclick requires a '=' prefix before negative coordinates.
 * For example: c:=-1000,500 instead of c:-1000,500
 */
export function formatCliclickCoords(x: number, y: number): string {
  if (x < 0 || y < 0) {
    return `=${x},${y}`;
  }
  return `${x},${y}`;
}

async function convertCliclickToCocoaCoordinates(
  globalX: number,
  globalY: number
): Promise<{ cocoaX: number; cocoaY: number }> {
  const config = await getDisplayConfiguration();
  const mainDisplay = config.displays.find((d) => d.isMain) || config.displays[0];
  const mainHeight = mainDisplay.height;

  let targetDisplay = config.displays[0];
  for (const display of config.displays) {
    if (
      globalX >= display.originX &&
      globalX < display.originX + display.width &&
      globalY >= display.originY &&
      globalY < display.originY + display.height
    ) {
      targetDisplay = display;
      break;
    }
  }

  const localX = globalX - targetDisplay.originX;
  const localY = globalY - targetDisplay.originY;
  const originYCocoa = mainHeight - targetDisplay.height - targetDisplay.originY;
  const cocoaX = targetDisplay.originX + localX;
  const cocoaY = originYCocoa + (targetDisplay.height - localY);

  return { cocoaX, cocoaY };
}

type PythonExec = {
  python: string;
  pythonRoot: string;
  env: NodeJS.ProcessEnv;
};

let cachedPythonExec: PythonExec | null | undefined;

function isDevEnvironment(): boolean {
  const isDev = !!process.env.VITE_DEV_SERVER_URL || process.env.NODE_ENV === 'development';
  writeMCPLog(`[isDevEnvironment] isDev=${isDev}`, 'Python Resolve');
  return isDev;
}

async function resolvePythonExec(): Promise<PythonExec | null> {
  if (cachedPythonExec !== undefined) {
    writeMCPLog(
      `[resolvePythonExec] Using cached Python: ${cachedPythonExec?.python}`,
      'Python Resolve'
    );
    return cachedPythonExec;
  }

  writeMCPLog('[resolvePythonExec] Resolving Python executable...', 'Python Resolve');
  const baseEnv: NodeJS.ProcessEnv = { ...process.env };
  const isDev = isDevEnvironment();

  writeMCPLog(`[resolvePythonExec] Dev environment: ${isDev}`, 'Python Resolve');
  if (isDev) {
    writeMCPLog(
      `[resolvePythonExec] Dev mode: Will prioritize current terminal Python`,
      'Python Resolve'
    );
    writeMCPLog(
      `[resolvePythonExec] Current PATH: ${process.env.PATH?.substring(0, 200) || 'not set'}...`,
      'Python Resolve'
    );
    writeMCPLog(
      `[resolvePythonExec] CONDA_PREFIX: ${process.env.CONDA_PREFIX || 'not set'}`,
      'Python Resolve'
    );
  }

  const envPython = process.env.OPEN_COWORK_PYTHON_PATH;
  const envPythonHome = process.env.OPEN_COWORK_PYTHON_HOME;
  if (envPython && (await pathExists(envPython))) {
    writeMCPLog(`[resolvePythonExec] Found explicit override: ${envPython}`, 'Python Resolve');
    const pythonRoot = envPythonHome || path.resolve(envPython, '..', '..');
    const extraSite = path.join(pythonRoot, 'site-packages');
    const env: NodeJS.ProcessEnv = {
      ...baseEnv,
      PYTHONHOME: pythonRoot,
      PYTHONNOUSERSITE: '1',
      PYTHONDONTWRITEBYTECODE: '1',
      PYTHONUTF8: '1',
    };
    if (await pathExists(extraSite)) {
      env.PYTHONPATH = [extraSite, baseEnv.PYTHONPATH].filter(Boolean).join(path.delimiter);
    }
    cachedPythonExec = { python: envPython, pythonRoot, env };
    writeMCPLog(
      `[resolvePythonExec] Using explicit override Python: ${envPython}`,
      'Python Resolve'
    );
    return cachedPythonExec;
  }

  if (isDev) {
    writeMCPLog(
      '[resolvePythonExec] Dev mode: Attempting to find Python in current PATH',
      'Python Resolve'
    );
    try {
      const whichCmd = PLATFORM === 'win32' ? 'where' : 'which';
      const pythonArg = PLATFORM === 'win32' ? 'python' : 'python';
      writeMCPLog(
        `[resolvePythonExec] Dev mode: Running command: ${whichCmd} ${pythonArg}`,
        'Python Resolve'
      );
      const { stdout } = await executeCommandSafe(whichCmd, [pythonArg], { timeout: 2000 });
      const pythonPath = stdout.trim().split(/\r?\n/).filter(Boolean)[0];
      writeMCPLog(
        `[resolvePythonExec] Dev mode: which/where result: ${pythonPath}`,
        'Python Resolve'
      );

      if (pythonPath && (await pathExists(pythonPath))) {
        writeMCPLog(
          `[resolvePythonExec] Dev mode: Found Python at: ${pythonPath}`,
          'Python Resolve'
        );
        cachedPythonExec = {
          python: pythonPath,
          pythonRoot: path.resolve(pythonPath, '..', '..'),
          env: {
            ...baseEnv,
            PYTHONNOUSERSITE: '1',
            PYTHONDONTWRITEBYTECODE: '1',
            PYTHONUTF8: '1',
          },
        };
        writeMCPLog(
          `[resolvePythonExec] Dev mode: Using Python from PATH: ${pythonPath}`,
          'Python Resolve'
        );
        writeMCPLog(
          `[resolvePythonExec] Dev mode: Preserving environment (CONDA_PREFIX=${process.env.CONDA_PREFIX || 'not set'})`,
          'Python Resolve'
        );
        return cachedPythonExec;
      } else {
        writeMCPLog(
          `[resolvePythonExec] Dev mode: Python path not found or doesn't exist: ${pythonPath}`,
          'Python Resolve'
        );
      }
    } catch (error) {
      writeMCPLog(
        `[resolvePythonExec] Dev mode: which/where command failed: ${error instanceof Error ? error.message : String(error)}`,
        'Python Resolve'
      );
    }

    const python3Cmd = PLATFORM === 'win32' ? 'python' : 'python3';
    writeMCPLog(
      `[resolvePythonExec] Dev mode: Trying ${python3Cmd} --version as fallback`,
      'Python Resolve'
    );
    try {
      const testResult = await executeCommandSafe(python3Cmd, ['--version'], { timeout: 2000 });
      writeMCPLog(
        `[resolvePythonExec] Dev mode: ${python3Cmd} --version result: stdout=${testResult.stdout}, stderr=${testResult.stderr}`,
        'Python Resolve'
      );
      if (testResult.stdout || testResult.stderr) {
        let pythonPath = python3Cmd;
        try {
          const whichResult = await executeCommandSafe(
            PLATFORM === 'win32' ? 'where' : 'which',
            [python3Cmd],
            { timeout: 2000 }
          );
          const resolvedPath = whichResult.stdout.trim().split(/\r?\n/).filter(Boolean)[0];
          writeMCPLog(
            `[resolvePythonExec] Dev mode: Resolved ${python3Cmd} path: ${resolvedPath}`,
            'Python Resolve'
          );
          if (resolvedPath && (await pathExists(resolvedPath))) {
            pythonPath = resolvedPath;
          }
        } catch (error) {
          writeMCPLog(
            `[resolvePythonExec] Dev mode: Failed to resolve ${python3Cmd} path: ${error instanceof Error ? error.message : String(error)}`,
            'Python Resolve'
          );
        }

        cachedPythonExec = {
          python: pythonPath,
          pythonRoot: pythonPath !== python3Cmd ? path.resolve(pythonPath, '..', '..') : '',
          env: {
            ...baseEnv,
            PYTHONNOUSERSITE: '1',
            PYTHONDONTWRITEBYTECODE: '1',
            PYTHONUTF8: '1',
          },
        };
        writeMCPLog(
          `[resolvePythonExec] Dev mode: Using ${python3Cmd} (${pythonPath}) from current environment`,
          'Python Resolve'
        );
        return cachedPythonExec;
      }
    } catch (error) {
      writeMCPLog(
        `[resolvePythonExec] Dev mode: ${python3Cmd} --version test failed: ${error instanceof Error ? error.message : String(error)}`,
        'Python Resolve'
      );
    }
    writeMCPLog(
      '[resolvePythonExec] Dev mode: Failed to find Python in current environment, falling back to bundled Python',
      'Python Resolve'
    );
  }

  if (PLATFORM === 'darwin') {
    const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
    writeMCPLog(`[resolvePythonExec] Checking bundled Python (arch: ${arch})`, 'Python Resolve');
    const packaged = await resolveBundledExecutable(path.join('python', 'bin', 'python3'));
    const devBundled = await resolveBundledExecutable(
      path.join('python', `darwin-${arch}`, 'bin', 'python3')
    );
    writeMCPLog(
      `[resolvePythonExec] Packaged Python: ${packaged || 'not found'}`,
      'Python Resolve'
    );
    writeMCPLog(
      `[resolvePythonExec] Dev bundled Python: ${devBundled || 'not found'}`,
      'Python Resolve'
    );
    const pythonPath = packaged || devBundled;
    if (pythonPath) {
      const pythonRoot = path.resolve(pythonPath, '..', '..');
      const extraSite = path.join(pythonRoot, 'site-packages');
      const env: NodeJS.ProcessEnv = {
        ...baseEnv,
        PYTHONHOME: pythonRoot,
        PYTHONNOUSERSITE: '1',
        PYTHONDONTWRITEBYTECODE: '1',
        PYTHONUTF8: '1',
      };
      if (await pathExists(extraSite)) {
        env.PYTHONPATH = [extraSite, baseEnv.PYTHONPATH].filter(Boolean).join(path.delimiter);
        writeMCPLog(
          `[resolvePythonExec] Found extra site-packages: ${extraSite}`,
          'Python Resolve'
        );
      }

      cachedPythonExec = { python: pythonPath, pythonRoot, env };
      writeMCPLog(`[resolvePythonExec] Using bundled Python: ${pythonPath}`, 'Python Resolve');
      return cachedPythonExec;
    }

    const systemPython = '/usr/bin/python3';
    writeMCPLog(`[resolvePythonExec] Checking system Python: ${systemPython}`, 'Python Resolve');
    if (await pathExists(systemPython)) {
      cachedPythonExec = {
        python: systemPython,
        pythonRoot: path.resolve(systemPython, '..', '..'),
        env: {
          ...baseEnv,
          PYTHONNOUSERSITE: '1',
          PYTHONDONTWRITEBYTECODE: '1',
          PYTHONUTF8: '1',
        },
      };
      writeMCPLog(`[resolvePythonExec] Using system Python: ${systemPython}`, 'Python Resolve');
      return cachedPythonExec;
    }
  }

  try {
    writeMCPLog(
      '[resolvePythonExec] Checking PATH for Python (generic fallback)',
      'Python Resolve'
    );
    const { stdout } = await executeCommandSafe(
      PLATFORM === 'win32' ? 'where' : 'which',
      ['python'],
      { timeout: 2000 }
    );
    const p = stdout.trim().split(/\r?\n/).filter(Boolean)[0];
    if (p) {
      cachedPythonExec = {
        python: p,
        pythonRoot: path.resolve(p, '..', '..'),
        env: {
          ...baseEnv,
          PYTHONNOUSERSITE: '1',
          PYTHONDONTWRITEBYTECODE: '1',
          PYTHONUTF8: '1',
        },
      };
      writeMCPLog(`[resolvePythonExec] Using PATH Python: ${p}`, 'Python Resolve');
      return cachedPythonExec;
    }
  } catch (error) {
    writeMCPLog(
      `[resolvePythonExec] PATH lookup failed: ${error instanceof Error ? error.message : String(error)}`,
      'Python Resolve'
    );
  }

  writeMCPLog('[resolvePythonExec] No Python executable found!', 'Python Resolve Error');
  cachedPythonExec = null;
  return null;
}

export async function executePython(
  code: string,
  timeout: number = 10000
): Promise<{ stdout: string; stderr: string }> {
  const execInfo = await resolvePythonExec();
  if (!execInfo) {
    throw new Error(
      'Python 3 runtime not found.\n' +
        '- Recommended (macOS): bundle Python into the app at Resources/python/bin/python3 with required packages (Pillow, pyobjc-framework-Quartz)\n' +
        '- Or install python3 + dependencies on this machine.\n'
    );
  }

  const { python, env } = execInfo;
  writeMCPLog(`[executePython] Using Python: ${python}`, 'Python Execution');
  writeMCPLog(`[executePython] Python root: ${execInfo.pythonRoot}`, 'Python Execution');
  writeMCPLog(`[executePython] PYTHONHOME: ${env.PYTHONHOME || 'not set'}`, 'Python Execution');
  writeMCPLog(`[executePython] PYTHONPATH: ${env.PYTHONPATH || 'not set'}`, 'Python Execution');
  writeMCPLog(`[executePython] CONDA_PREFIX: ${env.CONDA_PREFIX || 'not set'}`, 'Python Execution');
  writeMCPLog(`[executePython] Code length: ${code.length} chars`, 'Python Execution');
  writeMCPLog(`[executePython] Timeout: ${timeout}ms`, 'Python Execution');

  return await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(python, ['-c', code], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    const timer = setTimeout(() => {
      try {
        if (process.platform === 'win32') {
          child.kill();
        } else {
          child.kill('SIGKILL');
        }
      } catch {
        // ignore
      }
      writeMCPLog(
        `[executePython] Execution timed out after ${timeout}ms`,
        'Python Execution Error'
      );
      reject(new Error('Python execution timed out'));
    }, timeout);

    child.on('error', (err) => {
      clearTimeout(timer);
      writeMCPLog(`[executePython] Spawn failed: ${err.message}`, 'Python Execution Error');
      reject(new Error(`Python spawn failed: ${err.message}`));
    });

    child.stdout.on('data', (d) => {
      const data = d.toString();
      stdout += data;
      writeMCPLog(
        `[executePython] stdout chunk: ${data.substring(0, 200)}${data.length > 200 ? '...' : ''}`,
        'Python Execution'
      );
    });

    child.stderr.on('data', (d) => {
      const data = d.toString();
      stderr += data;
      writeMCPLog(
        `[executePython] stderr chunk: ${data.substring(0, 200)}${data.length > 200 ? '...' : ''}`,
        'Python Execution Error'
      );
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      writeMCPLog(`[executePython] Process closed with code: ${code}`, 'Python Execution');
      if (code === 0) {
        writeMCPLog(
          `[executePython] Execution succeeded. stdout length: ${stdout.length}, stderr length: ${stderr.length}`,
          'Python Execution'
        );
        resolve({ stdout, stderr });
      } else {
        const msg = (stderr || stdout).trim();
        writeMCPLog(
          `[executePython] Execution failed with exit code ${code}: ${msg.substring(0, 500)}${msg.length > 500 ? '...' : ''}`,
          'Python Execution Error'
        );
        reject(new Error(msg || `Python exited with code ${code}`));
      }
    });
  });
}

export async function performMacMouseMoveViaQuartz(
  globalX: number,
  globalY: number,
  modifiers: string[]
): Promise<void> {
  const { cocoaX, cocoaY } = await convertCliclickToCocoaCoordinates(globalX, globalY);
  const modsJson = JSON.stringify(normalizeModifierKeys(modifiers));
  const script = `
import Quartz, json
mods = json.loads(${JSON.stringify(modsJson)})
flag_map = {
  "cmd": Quartz.kCGEventFlagMaskCommand,
  "ctrl": Quartz.kCGEventFlagMaskControl,
  "shift": Quartz.kCGEventFlagMaskShift,
  "alt": Quartz.kCGEventFlagMaskAlternate,
}
flags = 0
for m in mods:
  flags |= flag_map.get(m, 0)
event = Quartz.CGEventCreateMouseEvent(None, Quartz.kCGEventMouseMoved, (${cocoaX}, ${cocoaY}), Quartz.kCGMouseButtonLeft)
if flags:
  Quartz.CGEventSetFlags(event, flags)
Quartz.CGEventPost(Quartz.kCGHIDEventTap, event)
  `.trim();
  await executePython(script, 5000);
}

export async function performMacClickViaQuartz(
  globalX: number,
  globalY: number,
  clickType: 'single' | 'double' | 'right' | 'triple',
  modifiers: string[]
): Promise<void> {
  const { cocoaX, cocoaY } = await convertCliclickToCocoaCoordinates(globalX, globalY);
  const modsJson = JSON.stringify(normalizeModifierKeys(modifiers));
  const clickCount = clickType === 'double' ? 2 : clickType === 'triple' ? 3 : 1;
  const isRight = clickType === 'right';
  const script = `
import Quartz, json, time
mods = json.loads(${JSON.stringify(modsJson)})
flag_map = {
  "cmd": Quartz.kCGEventFlagMaskCommand,
  "ctrl": Quartz.kCGEventFlagMaskControl,
  "shift": Quartz.kCGEventFlagMaskShift,
  "alt": Quartz.kCGEventFlagMaskAlternate,
}
flags = 0
for m in mods:
  flags |= flag_map.get(m, 0)
button = Quartz.kCGMouseButtonRight if ${isRight ? 'True' : 'False'} else Quartz.kCGMouseButtonLeft
down_event = Quartz.kCGEventRightMouseDown if ${isRight ? 'True' : 'False'} else Quartz.kCGEventLeftMouseDown
up_event = Quartz.kCGEventRightMouseUp if ${isRight ? 'True' : 'False'} else Quartz.kCGEventLeftMouseUp
def post(evt_type, click_state):
  ev = Quartz.CGEventCreateMouseEvent(None, evt_type, (${cocoaX}, ${cocoaY}), button)
  Quartz.CGEventSetIntegerValueField(ev, Quartz.kCGMouseEventClickState, click_state)
  if flags:
    Quartz.CGEventSetFlags(ev, flags)
  Quartz.CGEventPost(Quartz.kCGHIDEventTap, ev)
for i in range(${clickCount}):
  state = i + 1 if ${clickCount} > 1 else 1
  post(down_event, state)
  post(up_event, state)
  if ${clickCount} > 1:
    time.sleep(0.05)
  `.trim();
  await executePython(script, 8000);
}

export async function performMacDragViaQuartz(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  modifiers: string[]
): Promise<void> {
  const from = await convertCliclickToCocoaCoordinates(fromX, fromY);
  const to = await convertCliclickToCocoaCoordinates(toX, toY);
  const modsJson = JSON.stringify(normalizeModifierKeys(modifiers));
  const script = `
import Quartz, json, time
mods = json.loads(${JSON.stringify(modsJson)})
flag_map = {
  "cmd": Quartz.kCGEventFlagMaskCommand,
  "ctrl": Quartz.kCGEventFlagMaskControl,
  "shift": Quartz.kCGEventFlagMaskShift,
  "alt": Quartz.kCGEventFlagMaskAlternate,
}
flags = 0
for m in mods:
  flags |= flag_map.get(m, 0)
def post(evt_type, x, y):
  ev = Quartz.CGEventCreateMouseEvent(None, evt_type, (x, y), Quartz.kCGMouseButtonLeft)
  if flags:
    Quartz.CGEventSetFlags(ev, flags)
  Quartz.CGEventPost(Quartz.kCGHIDEventTap, ev)
post(Quartz.kCGEventLeftMouseDown, ${from.cocoaX}, ${from.cocoaY})
post(Quartz.kCGEventLeftMouseDragged, ${to.cocoaX}, ${to.cocoaY})
post(Quartz.kCGEventLeftMouseUp, ${to.cocoaX}, ${to.cocoaY})
  `.trim();
  await executePython(script, 8000);
}

export async function macReadClipboardBytes(timeoutMs: number = 2000): Promise<Buffer | null> {
  if (PLATFORM !== 'darwin') return null;

  const pbpastePath = '/usr/bin/pbpaste';
  return await new Promise<Buffer | null>((resolve) => {
    const child = spawn(pbpastePath, [], { stdio: ['ignore', 'pipe', 'pipe'] });
    const stdoutChunks: Buffer[] = [];

    const timer = setTimeout(() => {
      try {
        if (process.platform === 'win32') {
          child.kill();
        } else {
          child.kill('SIGKILL');
        }
      } catch {
        // ignore
      }
      resolve(null);
    }, timeoutMs);

    child.on('error', () => {
      clearTimeout(timer);
      resolve(null);
    });

    child.stdout.on('data', (d) => {
      stdoutChunks.push(Buffer.isBuffer(d) ? d : Buffer.from(d));
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve(Buffer.concat(stdoutChunks));
      } else {
        resolve(null);
      }
    });
  });
}

export async function macWriteClipboardBytes(
  bytes: Buffer,
  timeoutMs: number = 5000
): Promise<void> {
  if (PLATFORM !== 'darwin') {
    throw new Error('pbcopy is only available on macOS.');
  }

  const pbcopyPath = '/usr/bin/pbcopy';
  await new Promise<void>((resolve, reject) => {
    const child = spawn(pbcopyPath, [], { stdio: ['pipe', 'ignore', 'pipe'] });
    const stderrChunks: Buffer[] = [];

    const timer = setTimeout(() => {
      try {
        if (process.platform === 'win32') {
          child.kill();
        } else {
          child.kill('SIGKILL');
        }
      } catch {
        // ignore
      }
      reject(new Error('pbcopy timed out'));
    }, timeoutMs);

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    child.stderr.on('data', (d) => {
      stderrChunks.push(Buffer.isBuffer(d) ? d : Buffer.from(d));
    });

    child.stdin.on('error', () => {
      // Ignore stdin errors here; we'll rely on exit code/stderr.
    });

    child.stdin.end(bytes);

    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve();
      } else {
        const stderr = Buffer.concat(stderrChunks).toString('utf8').trim();
        reject(new Error(stderr || `pbcopy exited with code ${code}`));
      }
    });
  });
}

export async function getFrontmostMacApplicationName(): Promise<string | null> {
  if (PLATFORM !== 'darwin') return null;

  try {
    const { stdout } = await executeAppleScript(
      'tell application "System Events" to get name of first process whose frontmost is true',
      5000
    );
    const name = stdout.trim();
    return name || null;
  } catch (error) {
    writeMCPLog(
      `[GuiOperateServer] Error getting frontmost app: ${error}`,
      'getFrontmostMacApplicationName'
    );
    return null;
  }
}

async function getMacDockItemsViaAccessibility(): Promise<DockItemInfo[]> {
  if (PLATFORM !== 'darwin') return [];

  const jxaScript = [
    'const se = Application("System Events");',
    'const dock = se.processes.byName("Dock");',
    'const items = dock.lists[0].uiElements();',
    'const out = [];',
    'for (let i = 0; i < items.length; i++) {',
    '  try {',
    '    const n = String(items[i].name());',
    '    const p = items[i].position();',
    '    const s = items[i].size();',
    '    if (!n || n === "missing value" || n === "null") continue;',
    '    out.push({name:n, x:Number(p[0]), y:Number(p[1]), width:Number(s[0]), height:Number(s[1])});',
    '  } catch (e) {}',
    '}',
    'JSON.stringify(out);',
  ].join(' ');

  const { stdout } = await executeJXAScript(jxaScript, 10000);

  let parsed: DockItemInfo[];
  try {
    parsed = JSON.parse(stdout.trim()) as DockItemInfo[];
  } catch {
    writeMCPLog('[GUI] Failed to parse dock items JSON', 'DockItems Error');
    parsed = [];
  }
  return parsed.filter(
    (item) =>
      item &&
      typeof item.name === 'string' &&
      typeof item.x === 'number' &&
      typeof item.y === 'number' &&
      typeof item.width === 'number' &&
      typeof item.height === 'number' &&
      item.width > 0 &&
      item.height > 0
  );
}

export async function tryLocateElementInDockByAccessibility(
  elementDescription: string,
  displayIndex?: number
): Promise<{
  x: number;
  y: number;
  confidence: number;
  displayIndex: number;
  reasoning?: string;
} | null> {
  if (!isDescriptionDockRelated(elementDescription)) {
    return null;
  }

  const dockItems = await getMacDockItemsViaAccessibility();
  if (dockItems.length === 0) {
    return null;
  }

  let bestItem: DockItemInfo | null = null;
  let bestScore = 0;

  for (const item of dockItems) {
    const score = scoreDockItemAgainstDescription(item.name, elementDescription);
    if (score > bestScore) {
      bestScore = score;
      bestItem = item;
    }
  }

  if (!bestItem || bestScore < 120) {
    writeMCPLog(
      `[dock-accessibility] No reliable Dock match for "${elementDescription}". Best score: ${bestScore}`,
      'Dock Locate'
    );
    return null;
  }

  const centerGlobalX = Math.round(bestItem.x + bestItem.width / 2);
  const centerGlobalY = Math.round(bestItem.y + bestItem.height / 2);
  const config = await getDisplayConfiguration();

  let targetDisplay = config.displays.find(
    (d) =>
      centerGlobalX >= d.originX &&
      centerGlobalX <= d.originX + d.width &&
      centerGlobalY >= d.originY &&
      centerGlobalY <= d.originY + d.height
  );

  if (!targetDisplay) {
    targetDisplay =
      displayIndex !== undefined
        ? config.displays.find((d) => d.index === displayIndex)
        : config.displays.find((d) => d.isMain);
  }

  if (!targetDisplay) {
    return null;
  }

  const localX = Math.round(centerGlobalX - targetDisplay.originX);
  const localY = Math.round(centerGlobalY - targetDisplay.originY);

  writeMCPLog(
    `[dock-accessibility] Matched "${bestItem.name}" for "${elementDescription}" at global (${centerGlobalX}, ${centerGlobalY}), local (${localX}, ${localY}), display ${targetDisplay.index}, score=${bestScore}`,
    'Dock Locate'
  );

  return {
    x: localX,
    y: localY,
    confidence: Math.min(99, bestScore),
    displayIndex: targetDisplay.index,
    reasoning: `Matched Dock item "${bestItem.name}" via macOS Accessibility.`,
  };
}

/**
 * Execute cliclick command with error handling (macOS only)
 */
export async function executeCliclick(
  command: string
): Promise<{ stdout: string; stderr: string }> {
  if (PLATFORM !== 'darwin') {
    throw new Error('cliclick is only available on macOS. Use Windows-specific functions instead.');
  }

  const cliclickPath = await resolveCliclickPath();
  if (!cliclickPath) {
    throw new Error(
      'cliclick is required for GUI automation on macOS but was not found.\n' +
        `- Recommended: bundle it inside the app at Resources/tools/darwin-${process.arch === 'arm64' ? 'arm64' : 'x64'}/bin/cliclick\n` +
        '- Or legacy path: Resources/tools/bin/cliclick\n' +
        '- Or install it on this machine: brew install cliclick\n' +
        `Searched: bundled Resources/tools/darwin-${process.arch === 'arm64' ? 'arm64' : 'x64'}/bin/cliclick, ` +
        'Resources/tools/bin/cliclick, /opt/homebrew/bin/cliclick, /usr/local/bin/cliclick, and PATH.'
    );
  }

  const cliclickArgs = command.split(/\s+/).filter(Boolean);
  writeMCPLog(
    `[executeCliclick] Executing: ${cliclickPath} ${cliclickArgs.join(' ')}`,
    'Cliclick Command'
  );

  try {
    const result = await executeCommandSafe(cliclickPath, cliclickArgs);
    writeMCPLog(
      `[executeCliclick] Command completed. stdout: ${result.stdout}, stderr: ${result.stderr}`,
      'Cliclick Result'
    );

    if (/Accessibility privileges not enabled/i.test(result.stderr || '')) {
      const hint =
        '\n\nmacOS 权限提示 / Permissions:\n' +
        '- System Settings → Privacy & Security → Accessibility：允许 Open Cowork\n' +
        '- 如果是终端运行：允许 Terminal/iTerm\n' +
        '- 授权后请重启 Open Cowork 再重试\n';
      throw new Error(
        `cliclick cannot control UI because Accessibility permission is not enabled.${hint}`
      );
    }

    return result;
  } catch (error: unknown) {
    const baseMessage = error instanceof Error ? error.message : String(error);
    const hint =
      '\n\nmacOS 权限提示 / Permissions:\n' +
      '- System Settings → Privacy & Security → Accessibility：允许 Open Cowork\n' +
      '- System Settings → Privacy & Security → Automation：允许 Open Cowork 控制 “System Events”\n';
    throw new Error(`${baseMessage}${hint}`);
  }
}
