import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const agentRunnerPath = path.resolve(process.cwd(), 'src/main/claude/agent-runner.ts');
const agentRunnerRunPath = path.resolve(process.cwd(), 'src/main/claude/agent-runner-run.ts');
const agentRunnerHistoryPath = path.resolve(
  process.cwd(),
  'src/main/claude/agent-runner-history.ts'
);
const agentRunnerMcpBridgePath = path.resolve(
  process.cwd(),
  'src/main/claude/agent-runner-mcp-bridge.ts'
);
const agentRunnerContent = readFileSync(agentRunnerPath, 'utf8');
const agentRunnerRunContent = readFileSync(agentRunnerRunPath, 'utf8');
const agentRunnerHistoryContent = readFileSync(agentRunnerHistoryPath, 'utf8');
const agentRunnerMcpBridgeContent = readFileSync(agentRunnerMcpBridgePath, 'utf8');

describe('ClaudeAgentRunner Open Cowork SDK integration', () => {
  it('avoids dynamic re-import shadowing for config store singletons', () => {
    expect(agentRunnerRunContent).toContain(
      "import { mcpConfigStore } from '../mcp/mcp-config-store'"
    );
    expect(agentRunnerRunContent).toContain("import { configStore } from '../config/config-store'");
    expect(agentRunnerRunContent).not.toContain(
      "const { configStore } = await import('../config/config-store')"
    );
    expect(agentRunnerRunContent).not.toContain(
      "const { mcpConfigStore } = await import('../mcp/mcp-config-store')"
    );
  });

  it('keeps MCP config build resilient', () => {
    expect(agentRunnerMcpBridgeContent).toContain('function safeStringify');
    expect(agentRunnerRunContent).toContain('Failed to prepare MCP server config, skipping server');
  });

  it('uses standard markdown link guidance for sources citations', () => {
    expect(agentRunnerRunContent).toContain(
      'otherwise use standard Markdown links: [Title](https://claude.ai/chat/URL)'
    );
  });

  it('avoids duplicating the current user prompt in contextual history assembly', () => {
    expect(agentRunnerRunContent).toContain('buildColdStartContextualPrompt');
    expect(agentRunnerHistoryContent).toContain(
      'messagesAfterCompactionAnchor(options.existingMessages)'
    );
    expect(agentRunnerHistoryContent).toContain(
      'const conversationMessages = anchoredMessages.filter'
    );
    // Image-containing messages are filtered out individually (not skipping entire history)
    expect(agentRunnerHistoryContent).toContain(
      'const textOnlyMessages = conversationMessages.filter'
    );
    expect(agentRunnerHistoryContent).toContain('textOnlyMessages.slice(0, -1)');
    expect(agentRunnerHistoryContent).toContain(
      "textOnlyMessages[textOnlyMessages.length - 1]?.role === 'user'"
    );
  });

  it('keeps MCP server logging compact unless full debug logging is enabled', () => {
    expect(agentRunnerRunContent).toContain("log('[ClaudeAgentRunner] Final mcpServers summary:'");
    expect(agentRunnerRunContent).toContain(
      "if (process.env.COWORK_LOG_SDK_MESSAGES_FULL === '1') {"
    );
    expect(agentRunnerRunContent).toContain("log('[ClaudeAgentRunner] Final mcpServers config:'");
  });

  it('summarizes noisy SDK message updates instead of logging every text delta', () => {
    expect(agentRunnerRunContent).toContain('const streamEventCounts = new Map<string, number>();');
    expect(agentRunnerRunContent).toContain(
      "if (updateType !== 'text_delta' && updateType !== 'thinking_delta') {"
    );
    expect(agentRunnerRunContent).toContain("'[ClaudeAgentRunner] Event: message_end'");
    expect(agentRunnerRunContent).toContain('messageUpdateCounts: getStreamEventSummary()');
    expect(agentRunnerRunContent).toContain(
      "if (process.env.COWORK_LOG_SDK_MESSAGES_FULL === '1') {"
    );
    expect(agentRunnerRunContent).toContain("'[ClaudeAgentRunner] message_end raw message:'");
  });

  it('reuses the shared user-facing error helper', () => {
    expect(agentRunnerRunContent).toContain("from './agent-runner-message-end'");
    expect(agentRunnerRunContent).toContain('resolveMessageEndPayload');
    expect(agentRunnerRunContent).toContain('toUserFacingErrorText');
    expect(agentRunnerRunContent).toContain(
      'const errorText = toUserFacingErrorText(toErrorText(error));'
    );
  });

  it('uses pi DefaultResourceLoader with additionalSkillPaths and appendSystemPrompt', () => {
    expect(agentRunnerRunContent).toContain('additionalSkillPaths: skillPaths');
    expect(agentRunnerRunContent).toContain('appendSystemPrompt: coworkAppendPrompt');
    expect(agentRunnerRunContent).not.toContain('systemPromptOverride');
  });

  it('recreates cached pi sessions when the runtime signature changes', () => {
    expect(agentRunnerRunContent).toContain(
      "import { buildPiSessionRuntimeSignature } from './pi-session-runtime'"
    );
    expect(agentRunnerRunContent).toContain(
      'const sessionRuntimeSignature = buildPiSessionRuntimeSignature({'
    );
    expect(agentRunnerRunContent).toContain(
      'cachedSession.runtimeSignature !== sessionRuntimeSignature'
    );
    expect(agentRunnerRunContent).toContain('Runtime changed, recreating cached pi session:');
    expect(agentRunnerRunContent).toContain('runtimeSignature: sessionRuntimeSignature');
  });

  it('uses the normalized route protocol so openrouter follows the openai-compatible path', () => {
    expect(agentRunnerRunContent).toContain('resolvePiRouteProtocol');
    expect(agentRunnerRunContent).toContain('const configProtocol = resolvePiRouteProtocol(');
    expect(agentRunnerRunContent).toContain('resolveSyntheticPiModelFallback');
  });

  it('nudges the model to proceed with reasonable assumptions', () => {
    expect(agentRunnerRunContent).toContain('proceed immediately with reasonable assumptions');
    expect(agentRunnerRunContent).toContain('within two days');
    expect(agentRunnerRunContent).toContain('most recent two relevant publication days');
  });

  it('routes MCP image results through structured helpers instead of stringifying base64 into text', () => {
    expect(agentRunnerMcpBridgeContent).toContain(
      "import { normalizeMcpToolResultForModel } from './tool-result-utils'"
    );
    expect(agentRunnerMcpBridgeContent).toContain(
      'const normalizedResult = normalizeMcpToolResultForModel(result);'
    );
    expect(agentRunnerRunContent).toContain(
      'const normalizedToolResult = normalizeToolExecutionResultForUi(event.result);'
    );
    expect(agentRunnerMcpBridgeContent).not.toContain('else textParts.push(JSON.stringify(part));');
    expect(agentRunnerRunContent).not.toContain(": JSON.stringify(event.result || '');");
  });

  it('persists assistant model metadata for pi-ai thinking replay', () => {
    expect(agentRunnerRunContent).toContain('api: piModel.api');
    expect(agentRunnerRunContent).toContain('provider: piModel.provider');
    expect(agentRunnerRunContent).toContain('model: piModel.id');
  });

  it('does not reference removed AskUserQuestion or TodoWrite tools', () => {
    expect(agentRunnerContent).not.toContain('AskUserQuestion');
    expect(agentRunnerContent).not.toContain('TodoWrite');
    expect(agentRunnerContent).not.toContain('pendingQuestions');
    expect(agentRunnerRunContent).not.toContain('AskUserQuestion');
    expect(agentRunnerRunContent).not.toContain('TodoWrite');
  });

  it('chat-first behavioral rules are present', () => {
    expect(agentRunnerRunContent).toContain('CHAT FIRST');
    expect(agentRunnerRunContent).toContain(
      'Do NOT create, write, or edit files unless the user explicitly asks'
    );
    expect(agentRunnerRunContent).toContain('START DOING IT');
  });
});
