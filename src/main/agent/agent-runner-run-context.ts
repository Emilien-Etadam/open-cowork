import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import type { Message } from '../../renderer/types';
import type { AgentRuntimeExtensionManager } from '../extensions/agent-runtime-extension-manager';
import type { MCPManager } from '../mcp/mcp-manager';
import type { PathResolver } from '../sandbox/path-resolver';
import { log, logWarn } from '../utils/logger';
import type { CachedPiSession } from './agent-runner-pi-session';
import { AgentRunnerRenderer } from './agent-runner-renderer-events';
import { AgentRunnerSkillsPaths } from './agent-runner-skills-paths';

export const VIRTUAL_WORKSPACE_PATH = '/workspace';

export interface McpServersCache {
  fingerprint: string;
  servers: Record<string, unknown>;
}

export interface AgentRunnerRunContext {
  renderer: AgentRunnerRenderer;
  pathResolver: PathResolver;
  mcpManager?: MCPManager;
  extensionManager?: AgentRuntimeExtensionManager;
  activeControllers: Map<string, AbortController>;
  piSessions: Map<string, CachedPiSession>;
  requestSudoPassword?: (
    sessionId: string,
    toolUseId: string,
    command: string
  ) => Promise<string | null>;
  requestPermission?: (
    sessionId: string,
    toolUseId: string,
    toolName: string,
    input: Record<string, unknown>
  ) => Promise<'allow' | 'deny' | 'allow_always'>;
  skillsPaths: AgentRunnerSkillsPaths;
  getToolDisplayName(toolName: string): string;
  getCurrentModelString(preferredModel?: string): string;
  getMcpServersCache(): McpServersCache | null;
  setMcpServersCache(cache: McpServersCache | null): void;
  isSkillsSetupDone(): boolean;
  setSkillsSetupDone(value: boolean): void;
}

export function ensureSkillsSetup(ctx: AgentRunnerRunContext): void {
  if (ctx.isSkillsSetupDone()) {
    return;
  }

  ctx.setSkillsSetupDone(true);

  const userClaudeDir = ctx.skillsPaths.getAppClaudeDir();
  if (!fs.existsSync(userClaudeDir)) {
    fs.mkdirSync(userClaudeDir, { recursive: true });
  }

  const appSkillsDir = ctx.skillsPaths.getRuntimeSkillsDir();
  if (!fs.existsSync(appSkillsDir)) {
    fs.mkdirSync(appSkillsDir, { recursive: true });
  }

  const builtinSkillsPath = ctx.skillsPaths.getBuiltinSkillsPath();
  if (builtinSkillsPath && fs.existsSync(builtinSkillsPath)) {
    const sourceInsideAsar = /\.asar[/\\]/.test(builtinSkillsPath);
    for (const skillName of fs.readdirSync(builtinSkillsPath)) {
      const builtinSkillPath = path.join(builtinSkillsPath, skillName);
      const userSkillPath = path.join(appSkillsDir, skillName);

      try {
        const lstat = fs.lstatSync(userSkillPath);
        if (lstat.isSymbolicLink()) {
          const linkTarget = fs.readlinkSync(userSkillPath);
          if (/\.asar[/\\]/.test(linkTarget)) {
            fs.unlinkSync(userSkillPath);
            log(`[AgentRunner] Removed broken asar symlink: ${userSkillPath}`);
          }
        }
      } catch {
        // Path doesn't exist — fine, we'll create it below.
      }

      if (fs.statSync(builtinSkillPath).isDirectory() && !fs.existsSync(userSkillPath)) {
        if (sourceInsideAsar) {
          ctx.skillsPaths.copyDirectorySync(builtinSkillPath, userSkillPath);
          log(`[AgentRunner] Copied built-in skill from asar: ${skillName}`);
        } else {
          try {
            fs.symlinkSync(builtinSkillPath, userSkillPath, 'dir');
            log(`[AgentRunner] Linked built-in skill: ${skillName}`);
          } catch (error) {
            logWarn(`[AgentRunner] Failed to symlink ${skillName}, copying instead:`, error);
            ctx.skillsPaths.copyDirectorySync(builtinSkillPath, userSkillPath);
          }
        }
      }
    }
  }

  ctx.skillsPaths.syncUserSkillsToAppDir(appSkillsDir);
  ctx.skillsPaths.syncConfiguredSkillsToRuntimeDir(appSkillsDir);
}

export function sendTimeoutMessage(
  ctx: AgentRunnerRunContext,
  sessionId: string,
  thinkingStepId: string
): void {
  const errorMsg: Message = {
    id: uuidv4(),
    sessionId,
    role: 'assistant',
    content: [{ type: 'text', text: '**请求超时**：长时间未收到响应，操作已中止。' }],
    timestamp: Date.now(),
  };
  ctx.renderer.sendMessage(sessionId, errorMsg);
  ctx.renderer.sendTraceUpdate(sessionId, thinkingStepId, {
    status: 'error',
    title: 'Request timed out',
  });
}
