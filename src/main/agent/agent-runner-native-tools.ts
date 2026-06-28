import { Type, type TSchema } from 'typebox';
import {
  createFindToolDefinition,
  createGrepToolDefinition,
  type ToolDefinition,
} from '@earendil-works/pi-coding-agent';
import type { QuestionItem } from '../../renderer/types';

const webFetchParameters = Type.Object({
  url: Type.String({ description: 'HTTP or HTTPS URL to fetch' }),
});

const todoItemSchema = Type.Object({
  content: Type.String({ description: 'Task description' }),
  status: Type.String({
    description: 'One of: pending, in_progress, completed, cancelled',
  }),
  id: Type.Optional(Type.String({ description: 'Stable todo id' })),
  activeForm: Type.Optional(Type.String({ description: 'Short in-progress label' })),
});

const todoWriteParameters = Type.Object({
  merge: Type.Optional(Type.Boolean({ description: 'Merge with existing todos' })),
  todos: Type.Array(todoItemSchema, { description: 'Todo list items' }),
});

const questionOptionSchema = Type.Object({
  label: Type.String({ description: 'Option label' }),
  description: Type.Optional(Type.String({ description: 'Option description' })),
});

const questionItemSchema = Type.Object({
  question: Type.String({ description: 'Question text' }),
  header: Type.Optional(Type.String({ description: 'Short section header' })),
  multiSelect: Type.Optional(Type.Boolean({ description: 'Allow multiple selections' })),
  options: Type.Optional(Type.Array(questionOptionSchema, { description: 'Selectable options' })),
});

const askUserQuestionParameters = Type.Object({
  questions: Type.Array(questionItemSchema, { description: 'Questions for the user' }),
});

export interface NativeToolsContext {
  cwd: string;
  sessionId: string;
  requestUserQuestion?: (
    sessionId: string,
    toolUseId: string,
    questions: QuestionItem[]
  ) => Promise<string>;
}

function cloneToolWithName(tool: ToolDefinition, name: string, label: string): ToolDefinition {
  return {
    ...tool,
    name,
    label,
    execute: tool.execute.bind(tool),
  };
}

async function fetchUrlText(url: string, signal?: AbortSignal): Promise<string> {
  const trimmed = url.trim();
  if (!trimmed) {
    throw new Error('url is required');
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error('Invalid URL');
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Only http/https URLs are supported');
  }

  const response = await fetch(parsed.toString(), {
    headers: { 'User-Agent': 'lygodactylus' },
    signal: signal ?? AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`);
  }

  const contentType = response.headers.get('content-type') || 'unknown';
  const body = await response.text();
  const limit = 20000;
  const truncated =
    body.length > limit
      ? `${body.slice(0, limit)}\n\n[Truncated ${body.length - limit} chars]`
      : body;

  return `URL: ${parsed.toString()}\nStatus: ${response.status}\nContent-Type: ${contentType}\n\n${truncated}`;
}

function createWebFetchTool(name: string, label: string): ToolDefinition<TSchema, unknown> {
  return {
    name,
    label,
    description: 'Fetch a public web page and return its text content.',
    parameters: webFetchParameters,
    async execute(_toolCallId, params, signal) {
      const record =
        typeof params === 'object' && params !== null ? (params as Record<string, unknown>) : {};
      const url = typeof record.url === 'string' ? record.url : '';
      const text = await fetchUrlText(url, signal);
      return {
        content: [{ type: 'text' as const, text }],
        details: undefined,
      };
    },
  };
}

function parseTodoItems(rawTodos: unknown): Array<{
  content: string;
  status: string;
  id?: string;
  activeForm?: string;
}> {
  if (!Array.isArray(rawTodos)) {
    throw new Error('todos is required and must be an array');
  }

  const allowedStatuses = new Set(['pending', 'in_progress', 'completed', 'cancelled']);
  return rawTodos
    .map((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        return null;
      }
      const record = item as Record<string, unknown>;
      const content = typeof record.content === 'string' ? record.content.trim() : '';
      if (!content) {
        return null;
      }
      const statusRaw = typeof record.status === 'string' ? record.status : 'pending';
      const status = allowedStatuses.has(statusRaw) ? statusRaw : 'pending';
      const id = typeof record.id === 'string' && record.id.trim() ? record.id.trim() : undefined;
      const activeForm =
        typeof record.activeForm === 'string' && record.activeForm.trim()
          ? record.activeForm.trim()
          : undefined;
      return { content, status, id, activeForm };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
}

function createTodoWriteTool(name: string, label: string): ToolDefinition<TSchema, unknown> {
  return {
    name,
    label,
    description: 'Update the session task list. Use for multi-step work tracking.',
    parameters: todoWriteParameters,
    async execute(_toolCallId, params) {
      const record =
        typeof params === 'object' && params !== null ? (params as Record<string, unknown>) : {};
      const todos = parseTodoItems(record.todos);
      const summary = todos
        .map((todo, index) => `${index + 1}. [${todo.status}] ${todo.content}`)
        .join('\n');
      return {
        content: [
          {
            type: 'text' as const,
            text:
              todos.length > 0
                ? `Todo list updated (${todos.length} items):\n${summary}`
                : 'Todo list cleared',
          },
        ],
        details: { todos },
      };
    },
  };
}

function parseQuestionItems(rawQuestions: unknown): QuestionItem[] {
  if (!Array.isArray(rawQuestions)) {
    throw new Error('questions is required and must be an array');
  }

  const questions = rawQuestions
    .map((item): QuestionItem | null => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        return null;
      }
      const record = item as Record<string, unknown>;
      const question = typeof record.question === 'string' ? record.question.trim() : '';
      if (!question) {
        return null;
      }
      const header = typeof record.header === 'string' ? record.header : undefined;
      const multiSelect =
        typeof record.multiSelect === 'boolean'
          ? record.multiSelect
          : typeof record.multi_select === 'boolean'
            ? record.multi_select
            : false;
      const rawOptions = Array.isArray(record.options) ? record.options : [];
      const options = rawOptions
        .map((option) => {
          if (!option || typeof option !== 'object' || Array.isArray(option)) {
            return null;
          }
          const optRecord = option as Record<string, unknown>;
          const label = typeof optRecord.label === 'string' ? optRecord.label.trim() : '';
          if (!label) {
            return null;
          }
          const description =
            typeof optRecord.description === 'string' ? optRecord.description : undefined;
          return { label, description };
        })
        .filter((option): option is NonNullable<typeof option> => Boolean(option));

      return {
        question,
        header,
        multiSelect,
        options: options.length > 0 ? options : undefined,
      };
    })
    .filter((item): item is QuestionItem => item !== null);

  if (questions.length === 0) {
    throw new Error('questions is required');
  }

  return questions;
}

function formatQuestionAnswers(answersJson: string, questions: QuestionItem[]): string {
  let answers: Record<string, string[]> = {};
  try {
    const parsed = JSON.parse(answersJson) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
        if (Array.isArray(value)) {
          answers[key] = value.filter((entry): entry is string => typeof entry === 'string');
        }
      }
    }
  } catch {
    answers = {};
  }

  const lines = questions.map((question, index) => {
    const selected = answers[String(index)] ?? [];
    const answerText = selected.length > 0 ? selected.join(', ') : '(no selection)';
    return `Q${index + 1}: ${question.question}\nA: ${answerText}`;
  });

  return lines.join('\n\n');
}

function createAskUserQuestionTool(
  ctx: NativeToolsContext,
  name: string,
  label: string
): ToolDefinition<TSchema, unknown> {
  return {
    name,
    label,
    description:
      'Ask the user one or more multiple-choice questions and wait for answers before continuing.',
    parameters: askUserQuestionParameters,
    async execute(toolCallId, params, signal) {
      if (!ctx.requestUserQuestion) {
        throw new Error('AskUserQuestion is not available in this runtime');
      }

      const record =
        typeof params === 'object' && params !== null ? (params as Record<string, unknown>) : {};
      const questions = parseQuestionItems(record.questions);

      if (signal?.aborted) {
        return {
          content: [{ type: 'text' as const, text: 'Question cancelled.' }],
          details: undefined,
        };
      }

      const answersJson = await ctx.requestUserQuestion(ctx.sessionId, toolCallId, questions);
      const text = formatQuestionAnswers(answersJson, questions);
      return {
        content: [{ type: 'text' as const, text }],
        details: { questions, answersJson },
      };
    },
  };
}

/**
 * Native filesystem / web / planning tools for OpenAI-compatible providers
 * (LiteLLM → vLLM → Qwen). Schemas stay flat for reliable tool calling.
 */
export function buildNativeCustomTools(ctx: NativeToolsContext): ToolDefinition[] {
  const findTool = createFindToolDefinition(ctx.cwd) as ToolDefinition;
  const grepTool = createGrepToolDefinition(ctx.cwd) as ToolDefinition;

  return [
    cloneToolWithName(findTool, 'glob', 'Glob'),
    cloneToolWithName(findTool, 'find', 'Find'),
    grepTool,
    createWebFetchTool('web_fetch', 'Web Fetch'),
    createWebFetchTool('WebFetch', 'Web Fetch'),
    createTodoWriteTool('todo_write', 'Todo Write'),
    createTodoWriteTool('TodoWrite', 'Todo Write'),
    createAskUserQuestionTool(ctx, 'ask_user_question', 'Ask User Question'),
    createAskUserQuestionTool(ctx, 'AskUserQuestion', 'Ask User Question'),
  ];
}
