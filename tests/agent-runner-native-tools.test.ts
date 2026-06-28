import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const nativeToolsPath = path.resolve(process.cwd(), 'src/main/agent/agent-runner-native-tools.ts');
const piSetupPath = path.resolve(process.cwd(), 'src/main/agent/agent-runner-pi-setup.ts');
const promptsPath = path.resolve(process.cwd(), 'src/main/agent/agent-runner-prompts.ts');
const wslSessionPath = path.resolve(process.cwd(), 'src/main/agent/wsl-sandbox-bash-session.ts');
const nativeToolsContent = readFileSync(nativeToolsPath, 'utf8');
const piSetupContent = readFileSync(piSetupPath, 'utf8');
const promptsContent = readFileSync(promptsPath, 'utf8');
const wslSessionContent = readFileSync(wslSessionPath, 'utf8');

describe('agent-runner native tools', () => {
  it('registers LiteLLM-friendly tool aliases for filesystem, web, and planning tools', () => {
    expect(nativeToolsContent).toContain("cloneToolWithName(findTool, 'glob', 'Glob')");
    expect(nativeToolsContent).toContain('createGrepToolDefinition(ctx.cwd)');
    expect(nativeToolsContent).toContain("createWebFetchTool('web_fetch', 'Web Fetch')");
    expect(nativeToolsContent).toContain("createWebFetchTool('WebFetch', 'Web Fetch')");
    expect(nativeToolsContent).toContain("createHttpRequestTool('http_request', 'HTTP Request')");
    expect(nativeToolsContent).toContain("createHttpRequestTool('HttpRequest', 'HTTP Request')");
    expect(nativeToolsContent).toContain("createTodoWriteTool('todo_write', 'Todo Write')");
    expect(nativeToolsContent).toContain("createTodoWriteTool('TodoWrite', 'Todo Write')");
    expect(nativeToolsContent).toContain("createAskUserQuestionTool(ctx, 'ask_user_question'");
    expect(nativeToolsContent).toContain("createAskUserQuestionTool(ctx, 'AskUserQuestion'");
  });

  it('supports optional headers on web fetch', () => {
    expect(nativeToolsContent).toContain('headers: Type.Optional');
    expect(nativeToolsContent).toContain("from './http-request'");
  });

  it('uses flat TypeBox schemas without deeply nested required fields', () => {
    expect(nativeToolsContent).toContain('Type.Optional(Type.Boolean');
    expect(nativeToolsContent).not.toContain('additionalProperties');
  });

  it('waits for user answers through requestUserQuestion callback', () => {
    expect(nativeToolsContent).toContain(
      'ctx.requestUserQuestion(ctx.sessionId, toolCallId, questions)'
    );
    expect(nativeToolsContent).toContain('formatQuestionAnswers');
  });

  it('is wired into pi session setup', () => {
    expect(piSetupContent).toContain('buildNativeCustomTools');
    expect(piSetupContent).toContain('requestUserQuestion: ctx.requestUserQuestion');
    expect(piSetupContent).toContain('...nativeCustomTools');
    expect(piSetupContent).toContain('http_request');
  });

  it('documents sandbox network routing in prompts', () => {
    expect(promptsContent).toContain('<sandbox_network>');
    expect(promptsContent).toContain('http_request');
    expect(promptsContent).toContain('sandboxLanNetworkEnabled');
  });

  it('injects host HTTP proxy env into WSL bash sessions', () => {
    expect(wslSessionContent).toContain('getSandboxNetworkProxy');
    expect(wslSessionContent).toContain('ensureSandboxNetworkProxy');
    expect(wslSessionContent).toContain('sandboxLanNetworkEnabled');
    expect(wslSessionContent).toContain('buildBashSetupScript');
  });
});
