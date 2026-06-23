import type { ToolDefinition } from '@mariozechner/pi-coding-agent';
import type { TSchema } from 'typebox';
import type { Message, Session } from '../../renderer/types';

export type AgentRuntimeCustomTool = ToolDefinition<TSchema, unknown>;

export interface ContextBudget {
  contextWindow: number;
  maxTokens: number;
  currentInputTokens: number;
}

export interface BeforeSessionRunContext {
  session: Session;
  prompt: string;
  existingMessages: Message[];
  isColdStart: boolean;
  contextBudget?: ContextBudget;
}

export interface BeforeSessionRunResult {
  promptPrefix?: string;
  customTools?: AgentRuntimeCustomTool[];
}

export interface AfterSessionRunContext {
  session: Session;
  prompt: string;
  messages: Message[];
}

export interface SessionDeletedContext {
  sessionId: string;
  session?: Session | null;
}

export interface AgentRuntimeExtension {
  name: string;
  beforeSessionRun?(context: BeforeSessionRunContext): Promise<BeforeSessionRunResult | void>;
  afterSessionRun?(context: AfterSessionRunContext): Promise<void>;
  onSessionDeleted?(context: SessionDeletedContext): Promise<void>;
}
