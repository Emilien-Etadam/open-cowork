import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { app } from 'electron';

import path from 'path';
import { log, logError, logWarn } from '../utils/logger';

function resolveChromeExecutable(platform: NodeJS.Platform): string {
  if (platform === 'darwin') {
    return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  }

  if (platform === 'win32') {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require('fs') as typeof import('fs');
    const candidates = [
      path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(
        process.env['PROGRAMFILES'] || 'C:\\Program Files',
        'Google',
        'Chrome',
        'Application',
        'chrome.exe'
      ),
      path.join(
        process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)',
        'Google',
        'Chrome',
        'Application',
        'chrome.exe'
      ),
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    ];
    for (const candidate of candidates) {
      if (candidate && fs.existsSync(candidate)) {
        return candidate;
      }
    }
    return 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  }

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fs = require('fs') as typeof import('fs');
  const linuxCandidates = ['google-chrome', 'google-chrome-stable', 'chromium-browser', 'chromium'];
  for (const candidate of linuxCandidates) {
    if (candidate.includes(path.sep) && fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return 'google-chrome';
}

/**
 * Check if Chrome debugging port is accessible.
 */
export async function isChromeDebugPortReady(): Promise<boolean> {
  try {
    log(`[MCPManager] Checking Chrome debug port: http://localhost:9222/json/version`);
    const response = await fetch('http://localhost:9222/json/version', {
      signal: AbortSignal.timeout(2000),
    });

    if (response.ok) {
      const data = await response.json();
      log(`[MCPManager] Chrome debug port response: ${JSON.stringify(data)}`);
      return true;
    }

    log(`[MCPManager] Chrome debug port returned status: ${response.status}`);
    return false;
  } catch (error: unknown) {
    log(
      `[MCPManager] Chrome debug port check failed: ${error instanceof Error ? error.message : String(error)}`
    );
    return false;
  }
}

/**
 * Wait for Chrome debugging port to become ready with retries.
 */
export async function waitForChromeDebugPort(
  maxRetries: number = 15,
  delayMs: number = 1000
): Promise<boolean> {
  log(`[MCPManager] Waiting for Chrome debug port (max ${maxRetries} retries)...`);

  for (let i = 0; i < maxRetries; i++) {
    const isReady = await isChromeDebugPortReady();
    if (isReady) {
      log(`[MCPManager] Chrome debug port ready ✓ (attempt ${i + 1})`);
      return true;
    }

    if (i < maxRetries - 1) {
      log(`[MCPManager] Port not ready, retrying in ${delayMs}ms... (${i + 1}/${maxRetries})`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  logWarn(`[MCPManager] Chrome debug port not ready after ${maxRetries} attempts`);
  return false;
}

/**
 * Get Chrome user data directory for remote debugging.
 * Chrome 136+ requires --user-data-dir for remote debugging to work properly.
 */
export function getChromeUserDataDir(): string {
  return path.join(app.getPath('userData'), 'chrome-mcp-debug');
}

/**
 * Start Chrome with remote debugging enabled on port 9222.
 * Following official guide: https://github.com/ChromeDevTools/chrome-devtools-mcp
 */
export async function startChromeWithDebugging(): Promise<void> {
  const { spawn } = await import('child_process');
  const os = await import('os');

  const platform = os.platform();
  const userDataDir = getChromeUserDataDir();

  log(`[MCPManager] Platform: ${platform}`);
  log(`[MCPManager] User data dir: ${userDataDir}`);

  const chromeArgs = [
    '--remote-debugging-port=9222',
    '--user-data-dir=' + userDataDir,
    '--no-first-run',
    '--no-default-browser-check',
    '--new-window',
    'about:blank',
  ];

  const chromePath = resolveChromeExecutable(platform);

  log(`[MCPManager] Chrome path: ${chromePath}`);
  log(`[MCPManager] Chrome args: ${JSON.stringify(chromeArgs)}`);

  await new Promise<void>((resolve, reject) => {
    const chromeProcess = spawn(chromePath, chromeArgs, {
      detached: true,
      stdio: 'ignore',
    });

    chromeProcess.once('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') {
        reject(
          new Error(
            `Chrome executable not found (${chromePath}). Please install Google Chrome or Chromium.`
          )
        );
        return;
      }
      reject(error);
    });

    chromeProcess.once('spawn', () => {
      chromeProcess.unref();
      log(`[MCPManager] Chrome spawned successfully`);
      resolve();
    });
  });
}

/**
 * Ensure Chrome is ready by checking connection and auto-starting if needed.
 */
export async function ensureChromeReady(serverName: string, client: Client): Promise<void> {
  log(`[MCPManager] Ensuring Chrome is ready for ${serverName}...`);

  log(`[MCPManager] Step 1: Checking if Chrome debug port 9222 is accessible...`);
  const portReady = await isChromeDebugPortReady();

  if (portReady) {
    log(`[MCPManager] ✓ Chrome debug port (9222) is accessible`);

    log(`[MCPManager] Verifying MCP tool connection with list_pages...`);
    try {
      const result = await client.callTool({
        name: 'list_pages',
        arguments: {},
      });
      log(`[MCPManager] ✓ Chrome connected successfully, using existing instance`);
      log(`[MCPManager] list_pages result:`, result);
      return;
    } catch (error: unknown) {
      logWarn(`[MCPManager] ⚠️ Port accessible but tool call failed`);
      const chromeErr = error as { code?: unknown; message?: unknown };
      logWarn(`[MCPManager] Error code: ${chromeErr.code}, message: ${chromeErr.message}`);
      log(`[MCPManager] Will try to start new Chrome instance...`);
    }
  } else {
    log(`[MCPManager] ✗ Chrome debug port (9222) not accessible`);
    log(`[MCPManager] Will start new Chrome instance with debugging enabled...`);
  }

  log(`[MCPManager] Step 2: Starting Chrome with remote debugging...`);
  try {
    await startChromeWithDebugging();
    log(`[MCPManager] Chrome start command executed`);

    log(`[MCPManager] Step 3: Waiting for Chrome debug port to become ready...`);
    const portBecameReady = await waitForChromeDebugPort(15, 1000);

    if (!portBecameReady) {
      logError(`[MCPManager] ❌ Chrome debug port did not become ready after 15 seconds`);
      logError(`[MCPManager] Possible reasons:`);
      logError(`[MCPManager]   1. Chrome failed to start`);
      logError(`[MCPManager]   2. Another process is using port 9222`);
      logError(`[MCPManager]   3. Firewall blocking the port`);
      throw new Error('Chrome 浏览器未就绪，无法执行此操作: debug port did not become ready');
    }

    log(`[MCPManager] ✓ Chrome debug port is now ready`);

    log(`[MCPManager] Step 4: Verifying MCP tool connection...`);
    for (let i = 0; i < 5; i++) {
      try {
        const result = await client.callTool({
          name: 'list_pages',
          arguments: {},
        });
        log(`[MCPManager] ✓ Chrome MCP connection verified successfully!`);
        log(`[MCPManager] list_pages result:`, result);
        return;
      } catch (verifyError: unknown) {
        const ve = verifyError as { code?: unknown; message?: unknown };
        if (i < 4) {
          log(`[MCPManager] Connection verification attempt ${i + 1}/5 failed, retrying...`);
          log(`[MCPManager] Error: ${ve.message}`);
          await new Promise((resolve) => setTimeout(resolve, 1000));
        } else {
          logError(
            `[MCPManager] ❌ Chrome started but MCP connection verification failed after 5 attempts`
          );
          logError(`[MCPManager] Last error code: ${ve.code}, message: ${ve.message}`);
          logError(`[MCPManager] The chrome-devtools-mcp server may not be working correctly`);
          throw new Error(
            'Chrome 浏览器未就绪，无法执行此操作: MCP connection verification failed after 5 attempts'
          );
        }
      }
    }
  } catch (startError: unknown) {
    logError(`[MCPManager] ❌ Failed to start Chrome with debugging`);
    const startErrMsg = startError instanceof Error ? startError.message : String(startError);
    logError(`[MCPManager] Error: ${startErrMsg}`);
    throw new Error(`Chrome 浏览器未就绪，无法执行此操作: ${startErrMsg}`);
  }
}
