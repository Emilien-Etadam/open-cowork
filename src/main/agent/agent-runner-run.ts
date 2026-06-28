import { v4 as uuidv4 } from 'uuid';
import { setMaxListeners } from 'node:events';
import type { Message, Session } from '../../renderer/types';
import { configStore } from '../config/config-store';
import { getSandboxAdapter } from '../sandbox/sandbox-adapter';
import { SandboxSync } from '../sandbox/sandbox-sync';
import { log, logCtx, logCtxError, logError, logTiming } from '../utils/logger';
import {
  resolveAbortDisposition,
  shouldPreserveExistingTrace,
  toUserFacingErrorText,
} from './agent-runner-message-end';
import { bootstrapSandboxEnvironment } from './agent-runner-sandbox-bootstrap';
import { preparePiSessionRun } from './agent-runner-pi-setup';
import {
  type AgentRunnerRunContext,
  VIRTUAL_WORKSPACE_PATH,
  sendTimeoutMessage,
} from './agent-runner-run-context';
export { type AgentRunnerRunContext } from './agent-runner-run-context';
import { runPromptWithStreamHandling } from './agent-runner-stream-handler';
import { withAsyncTimeout } from '../utils/async-timeout';

const PI_SESSION_SETUP_TIMEOUT_MS = 180_000;

export async function executeAgentRun(
  ctx: AgentRunnerRunContext,
  session: Session,
  prompt: string,
  existingMessages: Message[]
): Promise<void> {
  const runStartTime = Date.now();
  logCtx('[AgentRunner] run() started');

  const controller = new AbortController();
  try {
    // SDK 会在同一 AbortSignal 上挂载较多监听器，放开上限避免无意义告警干扰排错。
    setMaxListeners(0, controller.signal);
  } catch {
    // 旧运行时不支持 EventTarget 调整监听上限时忽略即可。
  }
  ctx.activeControllers.set(session.id, controller);

  let sandboxPath: string | null = null;
  let useSandboxIsolation = false;
  let sandboxPathRegex: RegExp | null = null;
  const sanitizeOutputPaths = (content: string): string => {
    if (!sandboxPath || !useSandboxIsolation) return content;
    if (!sandboxPathRegex) {
      sandboxPathRegex = new RegExp(sandboxPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
    }
    return content.replace(sandboxPathRegex, VIRTUAL_WORKSPACE_PATH);
  };

  const thinkingStepId = uuidv4();

  try {
    ctx.pathResolver.registerSession(session.id, session.mountedPaths);
    logTiming('pathResolver.registerSession', runStartTime);

    ctx.renderer.sendTraceStep(session.id, {
      id: thinkingStepId,
      type: 'thinking',
      status: 'running',
      title: 'Processing request...',
      timestamp: Date.now(),
    });
    logTiming('sendTraceStep (thinking)', runStartTime);

    const workingDir = session.cwd || undefined;
    logCtx('[AgentRunner] Working directory:', workingDir || '(none)');

    const sandbox = getSandboxAdapter();
    const sandboxEnabled = configStore.get('sandboxEnabled') !== false;
    const sandboxBootstrap = await bootstrapSandboxEnvironment({
      sessionId: session.id,
      workingDir,
      thinkingStepId,
      sandboxEnabled,
      sandbox,
      sendToRenderer: (event) => ctx.renderer.dispatch(event),
      sendMessage: (sessionId, message) => ctx.renderer.sendMessage(sessionId, message),
      sendTraceUpdate: (sessionId, stepId, updates) =>
        ctx.renderer.sendTraceUpdate(sessionId, stepId, updates),
      getBuiltinSkillsPath: () => ctx.skillsPaths.getBuiltinSkillsPath(),
      getRuntimeSkillsDir: () => ctx.skillsPaths.getRuntimeSkillsDir(),
      syncUserSkillsToAppDir: (appSkillsDir) =>
        ctx.skillsPaths.syncUserSkillsToAppDir(appSkillsDir),
      syncConfiguredSkillsToRuntimeDir: (runtimeSkillsDir) =>
        ctx.skillsPaths.syncConfiguredSkillsToRuntimeDir(runtimeSkillsDir),
    });
    if (sandboxBootstrap.aborted) {
      return;
    }
    sandboxPath = sandboxBootstrap.sandboxPath;
    useSandboxIsolation = sandboxBootstrap.useSandboxIsolation;
    const piSetup = await withAsyncTimeout('preparePiSessionRun', PI_SESSION_SETUP_TIMEOUT_MS, () =>
      preparePiSessionRun({
        ctx,
        session,
        prompt,
        existingMessages,
        workingDir,
        sandboxPath,
        useSandboxIsolation,
        sandbox,
        runStartTime,
      })
    );

    const streamResult = await runPromptWithStreamHandling({
      ctx,
      session,
      prompt,
      existingMessages,
      thinkingStepId,
      controller,
      sanitizeOutputPaths,
      piSetup,
    });
    if (streamResult.contextOverflowHandled) {
      return;
    }

    logTiming('agent prompt completed', runStartTime);

    const abortDisposition = resolveAbortDisposition({
      abortedByTimeout: streamResult.abortedByTimeout,
      abortedByLoopGuard: streamResult.abortedByLoopGuard,
      abortedByStreamError: streamResult.abortedByStreamError,
    });
    if (controller.signal.aborted && streamResult.abortedByTimeout) {
      logCtx('[AgentRunner] Aborted due to timeout (detected after prompt returned)');
      sendTimeoutMessage(ctx, session.id, thinkingStepId);
      return;
    }
    if (controller.signal.aborted && shouldPreserveExistingTrace(abortDisposition)) {
      logCtx(
        `[AgentRunner] Aborted by ${abortDisposition === 'loop_guard' ? 'loop guard' : 'stream error'} (detected after prompt returned)`
      );
      return;
    }
    if (controller.signal.aborted) {
      logCtx('[AgentRunner] Aborted by user');
      ctx.renderer.sendTraceUpdate(session.id, thinkingStepId, {
        status: 'completed',
        title: 'Cancelled',
      });
      return;
    }
    ctx.renderer.sendTraceUpdate(session.id, thinkingStepId, {
      status: streamResult.terminalErrorText ? 'error' : 'completed',
      title: streamResult.terminalErrorText ? 'Request failed' : 'Task completed',
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      logCtx('[AgentRunner] Aborted by user');
      ctx.renderer.sendTraceUpdate(session.id, thinkingStepId, {
        status: 'completed',
        title: 'Cancelled',
      });
    } else {
      logCtxError('[AgentRunner] Error:', error);

      const errorText = toUserFacingErrorText(
        error instanceof Error ? error.message : String(error)
      );
      const errorMsg: Message = {
        id: uuidv4(),
        sessionId: session.id,
        role: 'assistant',
        content: [{ type: 'text', text: `**Error**: ${errorText}` }],
        timestamp: Date.now(),
      };
      ctx.renderer.sendMessage(session.id, errorMsg);

      ctx.renderer.sendTraceStep(session.id, {
        id: uuidv4(),
        type: 'thinking',
        status: 'error',
        title: 'Error occurred',
        timestamp: Date.now(),
      });

      if (error instanceof Error) {
        (error as Error & { alreadyReportedToUser?: boolean }).alreadyReportedToUser = true;
      }
    }
  } finally {
    ctx.activeControllers.delete(session.id);
    ctx.pathResolver.unregisterSession(session.id);

    if (useSandboxIsolation && sandboxPath) {
      try {
        const sandbox = getSandboxAdapter();

        if (sandbox.isWSL) {
          log('[AgentRunner] Syncing sandbox changes to Windows...');
          const syncResult = await SandboxSync.syncToWindows(session.id);
          if (syncResult.success) {
            log('[AgentRunner] Sync completed successfully');
          } else {
            logError('[AgentRunner] Sync failed:', syncResult.error);
          }
        } else if (sandbox.isLima) {
          log('[AgentRunner] Syncing sandbox changes to macOS...');
          const { LimaSync } = await import('../sandbox/lima-sync');
          const syncResult = await LimaSync.syncToMac(session.id);
          if (syncResult.success) {
            log('[AgentRunner] Sync completed successfully');
          } else {
            logError('[AgentRunner] Sync failed:', syncResult.error);
          }
        }
      } catch (syncErr) {
        logError('[AgentRunner] Sandbox sync error:', syncErr);
        ctx.renderer.sendMessage(session.id, {
          id: uuidv4(),
          sessionId: session.id,
          role: 'assistant',
          content: [
            {
              type: 'text',
              text: `**Warning**: Sandbox sync failed: ${syncErr instanceof Error ? syncErr.message : String(syncErr)}`,
            },
          ],
          timestamp: Date.now(),
        });
      }
    }
  }
}
