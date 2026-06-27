import { type AgentRunnerRunContext, VIRTUAL_WORKSPACE_PATH } from './agent-runner-run-context';

export function buildWorkspaceInfoPrompt(
  workingDir: string | undefined,
  sandboxPath: string | null,
  useSandboxIsolation: boolean
): string {
  if (useSandboxIsolation && sandboxPath) {
    return `<workspace_info>
Your current workspace is located at: ${VIRTUAL_WORKSPACE_PATH}
This is an isolated sandbox environment. Use ${VIRTUAL_WORKSPACE_PATH} as the root path for file operations.
</workspace_info>`;
  }

  return workingDir
    ? `<workspace_info>Your current workspace is: ${workingDir}</workspace_info>`
    : '';
}

export function buildCoworkAppendPrompt(
  ctx: AgentRunnerRunContext,
  workingDir: string | undefined,
  sandboxPath: string | null,
  useSandboxIsolation: boolean
): string[] {
  const workspaceInfoPrompt = buildWorkspaceInfoPrompt(
    workingDir,
    sandboxPath,
    useSandboxIsolation
  );

  return [
    'You are an Lygodactylus assistant. Be concise, accurate, and tool-capable.',
    `CRITICAL BEHAVIORAL RULES:
1. CHAT FIRST: By default, respond to the user in plain text within the conversation. Do NOT create, write, or edit files unless the user explicitly asks you to (e.g., "create a file", "write this to...", "edit the code", "save as...", mentions a specific file path, or describes code changes they want applied). For questions, summaries, explanations, analysis, and general conversation — always reply directly in chat text.
2. When a request is actionable, proceed immediately with reasonable assumptions. If you need clarification, ask briefly in plain text.
3. For relative time windows like "within two days" in browsing or research tasks, assume the most recent two relevant publication days unless the user explicitly defines another date range.
4. For bracketed placeholders like [Agent], [Topic], etc., treat the word inside brackets as the literal search keyword unless the user says otherwise.
5. When given a task, START DOING IT. Do not restate the task, do not list what you will do, do not ask for confirmation. Just execute.`,
    workspaceInfoPrompt,
    `<citation_requirements>
If your answer uses linkable content from MCP tools, include a "Sources:" section and otherwise use standard Markdown links: [Title](https://claude.ai/chat/URL).
</citation_requirements>`,
    `<tool_behavior>
Tool routing:
- If user explicitly asks to use Chrome/browser/web navigation, prioritize Chrome MCP tools (mcp__Chrome__*) over generic WebSearch/WebFetch.
- Use WebSearch/WebFetch only when Chrome MCP is unavailable or the user explicitly asks for generic web search.
</tool_behavior>`,
    ctx.skillsPaths.getBundledPathHints(),
  ].filter((section): section is string => Boolean(section && section.trim()));
}
