import { describe, expect, it } from 'vitest';
import {
  buildScheduledTaskFallbackTitle,
  buildScheduledTaskTitle,
  summarizeSchedulePrompt,
} from '../src/shared/schedule/task-title';

describe('scheduled task title', () => {
  it('prefixes English titles with [Scheduled Task]', () => {
    expect(buildScheduledTaskTitle('Summarize my inbox')).toBe(
      '[Scheduled Task] Summarize my inbox'
    );
  });

  it('prefixes Chinese titles with [定时任务] when locale is zh', () => {
    expect(buildScheduledTaskTitle('帮我整理今天的待办', 'zh')).toBe(
      '[定时任务] 帮我整理今天的待办'
    );
  });

  it('normalizes whitespace and line breaks', () => {
    expect(buildScheduledTaskTitle('  第一行\n\n第二行   第三行  ', 'zh')).toBe(
      '[定时任务] 第一行 第二行 第三行'
    );
  });

  it('strips duplicated schedule prefix across locales', () => {
    expect(buildScheduledTaskTitle('[定时任务] 每日汇总', 'zh')).toBe('[定时任务] 每日汇总');
    expect(buildScheduledTaskTitle('[Scheduled Task] Daily summary')).toBe(
      '[Scheduled Task] Daily summary'
    );
  });

  it('truncates very long prompt summary', () => {
    const longPrompt = 'a'.repeat(70);
    expect(summarizeSchedulePrompt(longPrompt)).toBe(`${'a'.repeat(45)}...`);
  });

  it('falls back for empty prompt', () => {
    expect(buildScheduledTaskTitle('   ')).toBe('[Scheduled Task] Untitled Task');
    expect(buildScheduledTaskTitle('   ', 'zh')).toBe('[定时任务] 未命名任务');
  });

  it('builds fallback title from prompt summary', () => {
    expect(buildScheduledTaskFallbackTitle('请帮我查一下近一周内的 Agent 论文', 'zh')).toBe(
      '[定时任务] 请帮我查一下近一周内的 Agent 论文'
    );
    expect(buildScheduledTaskFallbackTitle('Summarize recent Agent papers')).toBe(
      '[Scheduled Task] Summarize recent Agent papers'
    );
  });
});
