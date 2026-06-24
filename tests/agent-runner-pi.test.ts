import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const agentRunnerPath = path.resolve(process.cwd(), 'src/main/claude/agent-runner.ts');
const agentRunnerRunPath = path.resolve(process.cwd(), 'src/main/claude/agent-runner-run.ts');
const agentRunnerContextPath = path.resolve(
  process.cwd(),
  'src/main/claude/agent-runner-run-context.ts'
);
const agentRunnerPiSetupPath = path.resolve(
  process.cwd(),
  'src/main/claude/agent-runner-pi-setup.ts'
);
const agentRunnerPromptsPath = path.resolve(
  process.cwd(),
  'src/main/claude/agent-runner-prompts.ts'
);
const agentRunnerMcpServersPath = path.resolve(
  process.cwd(),
  'src/main/claude/agent-runner-mcp-servers.ts'
);
const agentRunnerStreamHandlerPath = path.resolve(
  process.cwd(),
  'src/main/claude/agent-runner-stream-handler.ts'
);
const agentRunnerStreamEventsPath = path.resolve(
  process.cwd(),
  'src/main/claude/agent-runner-stream-events.ts'
);
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
const agentRunnerContextContent = readFileSync(agentRunnerContextPath, 'utf8');
const agentRunnerPiSetupContent = readFileSync(agentRunnerPiSetupPath, 'utf8');
const agentRunnerPromptsContent = readFileSync(agentRunnerPromptsPath, 'utf8');
const agentRunnerMcpServersContent = readFileSync(agentRunnerMcpServersPath, 'utf8');
const agentRunnerStreamHandlerContent = readFileSync(agentRunnerStreamHandlerPath, 'utf8');
const agentRunnerStreamEventsContent = readFileSync(agentRunnerStreamEventsPath, 'utf8');
const agentRunnerHistoryContent = readFileSync(agentRunnerHistoryPath, 'utf8');
const agentRunnerMcpBridgeContent = readFileSync(agentRunnerMcpBridgePath, 'utf8');

describe('ClaudeAgentRunner Open Cowork SDK integration', () => {
  it('avoids dynamic re-import shadowing for config store singletons', () => {
    expect(agentRunnerPiSetupContent).toContain(
      "import { configStore } from '../config/config-store'"
    );
    expect(agentRunnerMcpServersContent).toContain(
      "import { mcpConfigStore } from '../mcp/mcp-config-store'"
    );
    expect(agentRunnerPiSetupContent).not.toContain(
      "const { configStore } = await import('../config/config-store')"
    );
    expect(agentRunnerMcpServersContent).not.toContain(
      "const { mcpConfigStore } = await import('../mcp/mcp-config-store')"
    );
  });

  it('keeps MCP config build resilient', () => {
    expect(agentRunnerMcpBridgeContent).toContain('function safeStringify');
    expect(agentRunnerMcpServersContent).toContain(
      'Failed to prepare MCP server config, skipping server'
    );
  });

  it('uses standard markdown link guidance for sources citations', () => {
    expect(agentRunnerPromptsContent).toContain(
      'otherwise use standard Markdown links: [Title](https://claude.ai/chat/URL)'
    );
  });

  it('avoids duplicating the current user prompt in contextual history assembly', () => {
    expect(agentRunnerPiSetupContent).toContain('buildColdStartContextualPrompt');
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
    expect(agentRunnerMcpServersContent).toContain(
      "log('[ClaudeAgentRunner] Final mcpServers summary:'"
    );
    expect(agentRunnerMcpServersContent).toContain(
      "if (process.env.COWORK_LOG_SDK_MESSAGES_FULL === '1') {"
    );
    expect(agentRunnerMcpServersContent).toContain(
      "log('[ClaudeAgentRunner] Final mcpServers config:'"
    );
  });

  it('summarizes noisy SDK message updates instead of logging every text delta', () => {
    expect(agentRunnerStreamHandlerContent).toContain(
      'const streamEventCounts = new Map<string, number>();'
    );
    expect(agentRunnerStreamEventsContent).toContain(
      "if (updateType !== 'text_delta' && updateType !== 'thinking_delta') {"
    );
    expect(agentRunnerStreamEventsContent).toContain("'[ClaudeAgentRunner] Event: message_end'");
    expect(agentRunnerStreamEventsContent).toContain(
      'messageUpdateCounts: deps.getStreamEventSummary()'
    );
    expect(agentRunnerStreamEventsContent).toContain(
      "if (process.env.COWORK_LOG_SDK_MESSAGES_FULL === '1') {"
    );
    expect(agentRunnerStreamEventsContent).toContain(
      "'[ClaudeAgentRunner] message_end raw message:'"
    );
  });

  it('reuses the shared user-facing error helper', () => {
    expect(agentRunnerRunContent).toContain("from './agent-runner-message-end'");
    expect(agentRunnerStreamEventsContent).toContain('resolveMessageEndPayload');
    expect(agentRunnerStreamEventsContent).toContain('toUserFacingErrorText');
    expect(agentRunnerRunContent).toContain('toUserFacingErrorText');
    expect(agentRunnerRunContent).toContain('const errorText = toUserFacingErrorText(');
  });

  it('uses pi DefaultResourceLoader with additionalSkillPaths and appendSystemPrompt', () => {
    expect(agentRunnerPiSetupContent).toContain('import { type CachedPiSession, createPiSession');
    expect(agentRunnerPiSetupContent).not.toContain('systemPromptOverride');
    expect(
      readFileSync(
        path.resolve(process.cwd(), 'src/main/claude/agent-runner-pi-session.ts'),
        'utf8'
      )
    ).toContain('additionalSkillPaths: skillPaths');
    expect(
      readFileSync(
        path.resolve(process.cwd(), 'src/main/claude/agent-runner-pi-session.ts'),
        'utf8'
      )
    ).toContain('appendSystemPrompt: coworkAppendPrompt');
  });

  it('recreates cached pi sessions when the runtime signature changes', () => {
    expect(agentRunnerPiSetupContent).toContain(
      "import { buildPiSessionRuntimeSignature } from './pi-session-runtime'"
    );
    expect(agentRunnerPiSetupContent).toContain(
      'const sessionRuntimeSignature = buildPiSessionRuntimeSignature({'
    );
    expect(agentRunnerPiSetupContent).toContain(
      'cachedSession?.runtimeSignature !== sessionRuntimeSignature'
    );
    expect(agentRunnerPiSetupContent).toContain('Runtime changed, recreating cached pi session:');
    expect(
      readFileSync(
        path.resolve(process.cwd(), 'src/main/claude/agent-runner-pi-session.ts'),
        'utf8'
      )
    ).toContain('runtimeSignature: sessionRuntimeSignature');
  });

  it('uses the normalized route protocol so openrouter follows the openai-compatible path', () => {
    expect(agentRunnerPiSetupContent).toContain('resolvePiRouteProtocol');
    expect(agentRunnerPiSetupContent).toContain('const configProtocol = resolvePiRouteProtocol(');
    expect(agentRunnerPiSetupContent).toContain('resolveSyntheticPiModelFallback');
  });

  it('nudges the model to proceed with reasonable assumptions', () => {
    expect(agentRunnerPromptsContent).toContain('proceed immediately with reasonable assumptions');
    expect(agentRunnerPromptsContent).toContain('within two days');
    expect(agentRunnerPromptsContent).toContain('most recent two relevant publication days');
  });

  it('routes MCP image results through structured helpers instead of stringifying base64 into text', () => {
    expect(agentRunnerMcpBridgeContent).toContain(
      "import { normalizeMcpToolResultForModel } from './tool-result-utils'"
    );
    expect(agentRunnerMcpBridgeContent).toContain(
      'const normalizedResult = normalizeMcpToolResultForModel(result);'
    );
    expect(agentRunnerStreamEventsContent).toContain(
      'const normalizedToolResult = normalizeToolExecutionResultForUi(event.result);'
    );
    expect(agentRunnerMcpBridgeContent).not.toContain('else textParts.push(JSON.stringify(part));');
    expect(agentRunnerStreamEventsContent).not.toContain(": JSON.stringify(event.result || '');");
  });

  it('persists assistant model metadata for pi-ai thinking replay', () => {
    expect(agentRunnerStreamEventsContent).toContain('api: deps.piSetup.piModel.api');
    expect(agentRunnerStreamEventsContent).toContain('provider: deps.piSetup.piModel.provider');
    expect(agentRunnerStreamEventsContent).toContain('model: deps.piSetup.piModel.id');
  });

  it('does not reference removed AskUserQuestion or TodoWrite tools', () => {
    expect(agentRunnerContent).not.toContain('AskUserQuestion');
    expect(agentRunnerContent).not.toContain('TodoWrite');
    expect(agentRunnerContent).not.toContain('pendingQuestions');
    expect(agentRunnerPiSetupContent).toContain('buildCoworkAppendPrompt');
    expect(agentRunnerPiSetupContent).not.toContain('AskUserQuestion');
    expect(agentRunnerPiSetupContent).not.toContain('TodoWrite');
    expect(agentRunnerPromptsContent).not.toContain('AskUserQuestion');
    expect(agentRunnerPromptsContent).not.toContain('TodoWrite');
    expect(agentRunnerStreamHandlerContent).not.toContain('AskUserQuestion');
    expect(agentRunnerStreamHandlerContent).not.toContain('TodoWrite');
    expect(agentRunnerStreamEventsContent).not.toContain('AskUserQuestion');
    expect(agentRunnerStreamEventsContent).not.toContain('TodoWrite');
  });

  it('chat-first behavioral rules are present', () => {
    expect(agentRunnerPromptsContent).toContain('CHAT FIRST');
    expect(agentRunnerPromptsContent).toContain(
      'Do NOT create, write, or edit files unless the user explicitly asks'
    );
    expect(agentRunnerPromptsContent).toContain('START DOING IT');
  });

  it('re-exports the run context interface from the facade', () => {
    expect(agentRunnerRunContent).toContain("from './agent-runner-run-context'");
    expect(agentRunnerRunContent).toContain('export { type AgentRunnerRunContext }');
    expect(agentRunnerContextContent).toContain('export interface AgentRunnerRunContext');
  });
});
