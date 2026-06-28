import type { AppConfig } from './config-schema';

/** Resolved external agent CLI path (prefers `agentCliPath`, falls back to legacy `claudeCodePath`). */
export function resolveAgentCliPath(config: Pick<AppConfig, 'agentCliPath' | 'claudeCodePath'>): string {
  return (config.agentCliPath || config.claudeCodePath || '').trim();
}
