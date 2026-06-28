import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const nativeToolsPath = path.resolve(process.cwd(), 'src/main/agent/agent-runner-native-tools.ts');
const piSetupPath = path.resolve(process.cwd(), 'src/main/agent/agent-runner-pi-setup.ts');
const nativeToolsContent = readFileSync(nativeToolsPath, 'utf8');
const piSetupContent = readFileSync(piSetupPath, 'utf8');

describe('agent-runner native tools', () => {
  it('registers LiteLLM-friendly tool aliases for filesystem, web, and planning tools', () => {
    expect(nativeToolsContent).toContain("cloneToolWithName(findTool, 'glob', 'Glob')");
    expect(nativeToolsContent).toContain('createGrepToolDefinition(ctx.cwd)');
    expect(nativeToolsContent).toContain("createWebFetchTool('web_fetch', 'Web Fetch')");
    expect(nativeToolsContent).toContain("createWebFetchTool('WebFetch', 'Web Fetch')");
    expect(nativeToolsContent).toContain("createTodoWriteTool('todo_write', 'Todo Write')");
    expect(nativeToolsContent).toContain("createTodoWriteTool('TodoWrite', 'Todo Write')");
    expect(nativeToolsContent).toContain("createAskUserQuestionTool(ctx, 'ask_user_question'");
    expect(nativeToolsContent).toContain("createAskUserQuestionTool(ctx, 'AskUserQuestion'");
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
  });
});
