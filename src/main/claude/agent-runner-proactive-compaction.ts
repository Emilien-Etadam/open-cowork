import { v4 as uuidv4 } from 'uuid';
import type { AgentSession as PiAgentSession } from '@earendil-works/pi-coding-agent';
import type { Message } from '../../renderer/types';
import { mt } from '../i18n';
import { log, logWarn } from '../utils/logger';
import type { AgentRunnerRunContext } from './agent-runner-run-context';

export async function runProactiveCompaction(
  piSession: PiAgentSession,
  ctx: AgentRunnerRunContext,
  sessionId: string
): Promise<boolean> {
  log('[ClaudeAgentRunner] Proactive compaction before prompt for session:', sessionId);
  ctx.renderer.sendSessionNotice(sessionId, mt('noticeCompactionStart'), 'info');

  try {
    const result = await piSession.compact();
    const compactionMessage: Message = {
      id: uuidv4(),
      sessionId,
      role: 'system',
      content: [
        {
          type: 'compaction_summary',
          summary: result.summary,
          tokensBefore: result.tokensBefore,
        },
      ],
      timestamp: Date.now(),
    };
    ctx.renderer.sendMessage(sessionId, compactionMessage);
    ctx.renderer.sendSessionNotice(sessionId, mt('noticeCompactionCompleted'), 'success');
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logWarn('[ClaudeAgentRunner] Proactive compaction failed:', message);
    ctx.renderer.sendSessionNotice(
      sessionId,
      mt('noticeCompactionFailed', { error: message }),
      'warning'
    );
    return false;
  }
}
