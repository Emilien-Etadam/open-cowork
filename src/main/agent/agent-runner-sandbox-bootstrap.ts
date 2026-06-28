/**
 * WSL / Lima sandbox initialization: file sync, skills copy, and UI progress events.
 */
import * as fs from 'fs';
import { execFileSync } from 'child_process';
import { v4 as uuidv4 } from 'uuid';
import type { Message, ServerEvent, TraceStep } from '../../renderer/types';
import { getSandboxExecutionBlockReason } from '../sandbox/sandbox-execution-guard';
import type { SandboxAdapter } from '../sandbox/sandbox-adapter';
import { SandboxSync } from '../sandbox/sandbox-sync';
import { pathConverter } from '../sandbox/wsl-bridge';
import { log, logError } from '../utils/logger';
import { getCachedLimaInstanceName, SANDBOX_SKILLS_DIR } from '../paths/sandbox-paths';

export interface SandboxBootstrapDeps {
  sessionId: string;
  workingDir: string | undefined;
  thinkingStepId: string;
  sandboxEnabled: boolean;
  sandbox: SandboxAdapter;
  sendToRenderer: (event: ServerEvent) => void;
  sendMessage: (sessionId: string, message: Message) => void;
  sendTraceUpdate: (sessionId: string, stepId: string, updates: Partial<TraceStep>) => void;
  getBuiltinSkillsPath: () => string;
  getRuntimeSkillsDir: () => string;
  syncUserSkillsToAppDir: (appSkillsDir: string) => void;
  syncConfiguredSkillsToRuntimeDir: (runtimeSkillsDir: string) => void;
}

export interface SandboxBootstrapResult {
  sandboxPath: string | null;
  useSandboxIsolation: boolean;
  /** When true, the caller should abort the run() early. */
  aborted: boolean;
}

function sendSandboxUnavailable(
  deps: SandboxBootstrapDeps,
  reason: string,
  traceTitle: string
): void {
  const errorMsg: Message = {
    id: uuidv4(),
    sessionId: deps.sessionId,
    role: 'assistant',
    content: [{ type: 'text', text: `**Sandbox indisponible** : ${reason}` }],
    timestamp: Date.now(),
  };
  deps.sendMessage(deps.sessionId, errorMsg);
  deps.sendTraceUpdate(deps.sessionId, deps.thinkingStepId, {
    status: 'error',
    title: traceTitle,
  });
}

async function bootstrapWslSandbox(
  deps: SandboxBootstrapDeps,
  result: SandboxBootstrapResult
): Promise<void> {
  const { sandbox, workingDir, sessionId } = deps;
  if (!sandbox.isWSL || !sandbox.wslStatus?.distro || !workingDir) {
    return;
  }

  log('[AgentRunner] WSL mode active, initializing sandbox sync...');
  const isNewSession = !SandboxSync.hasSession(sessionId);

  if (isNewSession) {
    deps.sendToRenderer({
      type: 'sandbox.sync',
      payload: {
        sessionId,
        phase: 'syncing_files',
        message: 'Syncing files to sandbox...',
        detail: 'Copying project files to isolated WSL environment',
      },
    });
  }

  const syncResult = await SandboxSync.initSync(workingDir, sessionId, sandbox.wslStatus.distro);

  if (syncResult.success) {
    result.sandboxPath = syncResult.sandboxPath;
    result.useSandboxIsolation = true;
    log(`[AgentRunner] Sandbox initialized: ${result.sandboxPath}`);
    log(
      `[AgentRunner]   Files: ${syncResult.fileCount}, Size: ${syncResult.totalSize} bytes`
    );

    if (isNewSession) {
      deps.sendToRenderer({
        type: 'sandbox.sync',
        payload: {
          sessionId,
          phase: 'syncing_skills',
          message: 'Configuring skills...',
          detail: 'Copying built-in skills to sandbox',
          fileCount: syncResult.fileCount,
          totalSize: syncResult.totalSize,
        },
      });
    }

    if (isNewSession) {
      const builtinSkillsPath = deps.getBuiltinSkillsPath();
      try {
        const distro = sandbox.wslStatus!.distro!;
        const sandboxSkillsPath = `${result.sandboxPath}/${SANDBOX_SKILLS_DIR}`;

        execFileSync('wsl', ['-d', distro, '-e', 'mkdir', '-p', sandboxSkillsPath], {
          encoding: 'utf-8',
          timeout: 10000,
        });

        if (builtinSkillsPath && fs.existsSync(builtinSkillsPath)) {
          const wslSourcePath = pathConverter.toWSL(builtinSkillsPath);
          log(
            `[AgentRunner] Copying skills with rsync: ${wslSourcePath}/ -> ${sandboxSkillsPath}/`
          );

          execFileSync(
            'wsl',
            ['-d', distro, '-e', 'rsync', '-a', wslSourcePath + '/', sandboxSkillsPath + '/'],
            {
              encoding: 'utf-8',
              timeout: 120000,
            }
          );
        }

        const appSkillsDir = deps.getRuntimeSkillsDir();
        if (!fs.existsSync(appSkillsDir)) {
          fs.mkdirSync(appSkillsDir, { recursive: true });
        }
        deps.syncUserSkillsToAppDir(appSkillsDir);
        deps.syncConfiguredSkillsToRuntimeDir(appSkillsDir);

        if (fs.existsSync(appSkillsDir)) {
          const wslSourcePath = pathConverter.toWSL(appSkillsDir);
          log(
            `[AgentRunner] Copying app skills with rsync: ${wslSourcePath}/ -> ${sandboxSkillsPath}/`
          );

          execFileSync(
            'wsl',
            ['-d', distro, '-e', 'rsync', '-aL', wslSourcePath + '/', sandboxSkillsPath + '/'],
            {
              encoding: 'utf-8',
              timeout: 120000,
            }
          );
        }

        const copiedSkills = execFileSync('wsl', ['-d', distro, '-e', 'ls', sandboxSkillsPath], {
          encoding: 'utf-8',
          timeout: 10000,
        })
          .trim()
          .split(/\r?\n/)
          .filter(Boolean);

        log(`[AgentRunner] Skills copied to sandbox: ${sandboxSkillsPath}`);
        log(`[AgentRunner]   Skills: ${copiedSkills.join(', ')}`);
      } catch (error) {
        logError('[AgentRunner] Failed to copy skills to sandbox:', error);
      }
    }

    if (isNewSession) {
      deps.sendToRenderer({
        type: 'sandbox.sync',
        payload: {
          sessionId,
          phase: 'ready',
          message: 'Sandbox ready',
          detail: `Synced ${syncResult.fileCount} files`,
          fileCount: syncResult.fileCount,
          totalSize: syncResult.totalSize,
        },
      });
    }
    return;
  }

  logError('[AgentRunner] Sandbox sync failed:', syncResult.error);
  const syncBlockReason = getSandboxExecutionBlockReason({
    sandboxEnabled: deps.sandboxEnabled,
    platform: process.platform,
    sandbox,
    syncFailed: true,
    syncError: syncResult.error,
  });
  if (!syncBlockReason) {
    return;
  }

  if (isNewSession) {
    deps.sendToRenderer({
      type: 'sandbox.sync',
      payload: {
        sessionId,
        phase: 'error',
        message: 'Sandbox file sync failed',
        detail: syncBlockReason,
      },
    });
  }
  sendSandboxUnavailable(deps, syncBlockReason, 'Sandbox sync failed');
  result.aborted = true;
}

async function bootstrapLimaSandbox(
  deps: SandboxBootstrapDeps,
  result: SandboxBootstrapResult
): Promise<void> {
  const { sandbox, workingDir, sessionId } = deps;
  if (!sandbox.isLima || !sandbox.limaStatus?.instanceRunning || !workingDir) {
    return;
  }

  log('[AgentRunner] Lima mode active, initializing sandbox sync...');
  const { LimaSync } = await import('../sandbox/lima-sync');
  const isNewLimaSession = !LimaSync.hasSession(sessionId);

  if (isNewLimaSession) {
    deps.sendToRenderer({
      type: 'sandbox.sync',
      payload: {
        sessionId,
        phase: 'syncing_files',
        message: 'Syncing files to sandbox...',
        detail: 'Copying project files to isolated Lima environment',
      },
    });
  }

  const syncResult = await LimaSync.initSync(workingDir, sessionId);

  if (syncResult.success) {
    result.sandboxPath = syncResult.sandboxPath;
    result.useSandboxIsolation = true;
    log(`[AgentRunner] Sandbox initialized: ${result.sandboxPath}`);
    log(
      `[AgentRunner]   Files: ${syncResult.fileCount}, Size: ${syncResult.totalSize} bytes`
    );

    if (isNewLimaSession) {
      deps.sendToRenderer({
        type: 'sandbox.sync',
        payload: {
          sessionId,
          phase: 'syncing_skills',
          message: 'Configuring skills...',
          detail: 'Copying built-in skills to sandbox',
          fileCount: syncResult.fileCount,
          totalSize: syncResult.totalSize,
        },
      });
    }

    if (isNewLimaSession) {
      const builtinSkillsPath = deps.getBuiltinSkillsPath();
      const limaInstance = getCachedLimaInstanceName();
      try {
        const sandboxSkillsPath = `${result.sandboxPath}/${SANDBOX_SKILLS_DIR}`;

        execFileSync(
          'limactl',
          ['shell', limaInstance, '--', 'mkdir', '-p', sandboxSkillsPath],
          {
            encoding: 'utf-8',
            timeout: 10000,
          }
        );

        if (builtinSkillsPath && fs.existsSync(builtinSkillsPath)) {
          log(
            `[AgentRunner] Copying skills with rsync: ${builtinSkillsPath}/ -> ${sandboxSkillsPath}/`
          );

          execFileSync(
            'limactl',
            [
              'shell',
              limaInstance,
              '--',
              'rsync',
              '-av',
              builtinSkillsPath + '/',
              sandboxSkillsPath + '/',
            ],
            {
              encoding: 'utf-8',
              timeout: 120000,
            }
          );
        }

        const appSkillsDir = deps.getRuntimeSkillsDir();
        if (!fs.existsSync(appSkillsDir)) {
          fs.mkdirSync(appSkillsDir, { recursive: true });
        }
        deps.syncUserSkillsToAppDir(appSkillsDir);
        deps.syncConfiguredSkillsToRuntimeDir(appSkillsDir);

        if (fs.existsSync(appSkillsDir)) {
          log(
            `[AgentRunner] Copying app skills with rsync: ${appSkillsDir}/ -> ${sandboxSkillsPath}/`
          );

          execFileSync(
            'limactl',
            [
              'shell',
              limaInstance,
              '--',
              'rsync',
              '-avL',
              appSkillsDir + '/',
              sandboxSkillsPath + '/',
            ],
            {
              encoding: 'utf-8',
              timeout: 120000,
            }
          );
        }

        const copiedSkills = execFileSync(
          'limactl',
          ['shell', limaInstance, '--', 'ls', sandboxSkillsPath],
          {
            encoding: 'utf-8',
            timeout: 10000,
          }
        )
          .trim()
          .split(/\r?\n/)
          .filter(Boolean);

        log(`[AgentRunner] Skills copied to sandbox: ${sandboxSkillsPath}`);
        log(`[AgentRunner]   Skills: ${copiedSkills.join(', ')}`);
      } catch (error) {
        logError('[AgentRunner] Failed to copy skills to sandbox:', error);
      }
    }

    if (isNewLimaSession) {
      deps.sendToRenderer({
        type: 'sandbox.sync',
        payload: {
          sessionId,
          phase: 'ready',
          message: 'Sandbox ready',
          detail: `Synced ${syncResult.fileCount} files`,
          fileCount: syncResult.fileCount,
          totalSize: syncResult.totalSize,
        },
      });
    }
    return;
  }

  logError('[AgentRunner] Sandbox sync failed:', syncResult.error);
  const limaSyncBlockReason = getSandboxExecutionBlockReason({
    sandboxEnabled: deps.sandboxEnabled,
    platform: process.platform,
    sandbox,
    syncFailed: true,
    syncError: syncResult.error,
  });
  if (!limaSyncBlockReason) {
    return;
  }

  if (isNewLimaSession) {
    deps.sendToRenderer({
      type: 'sandbox.sync',
      payload: {
        sessionId,
        phase: 'error',
        message: 'Sandbox file sync failed',
        detail: limaSyncBlockReason,
      },
    });
  }
  sendSandboxUnavailable(deps, limaSyncBlockReason, 'Sandbox sync failed');
  result.aborted = true;
}

/**
 * Initialize sandbox isolation (WSL or Lima) before an agent run.
 */
export async function bootstrapSandboxEnvironment(
  deps: SandboxBootstrapDeps
): Promise<SandboxBootstrapResult> {
  const result: SandboxBootstrapResult = {
    sandboxPath: null,
    useSandboxIsolation: false,
    aborted: false,
  };

  const initialSandboxBlock = getSandboxExecutionBlockReason({
    sandboxEnabled: deps.sandboxEnabled,
    platform: process.platform,
    sandbox: deps.sandbox,
  });
  if (initialSandboxBlock) {
    logError('[AgentRunner] Sandbox execution blocked:', initialSandboxBlock);
    sendSandboxUnavailable(deps, initialSandboxBlock, 'Sandbox unavailable');
    result.aborted = true;
    return result;
  }

  await bootstrapWslSandbox(deps, result);
  if (result.aborted) {
    return result;
  }

  await bootstrapLimaSandbox(deps, result);
  return result;
}
