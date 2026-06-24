import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const agentRunnerRunPath = path.resolve(process.cwd(), 'src/main/claude/agent-runner-run.ts');
const agentRunnerRunContent = readFileSync(agentRunnerRunPath, 'utf8');

/**
 * These tests pin the post-rescue catch-block disposition for loop-guard
 * aborts. The bug they guard against: when handleLoopGuardDecision called
 * controller.abort(), the AbortError ended up in the generic "Aborted by
 * user" branch which overwrote the loop-guard's 'error' trace step with
 * status:'completed', title:'Cancelled'.
 */
describe('agent-runner loop-guard abort preserves error trace status', () => {
  it('declares an abortedByLoopGuard flag in the prompt() scope', () => {
    expect(agentRunnerRunContent).toContain('let abortedByLoopGuard = false;');
  });

  it('sets the flag immediately before controller.abort() in handleLoopGuardDecision', () => {
    // The assignment must appear in the loop-guard block AND must precede the
    // controller.abort() call so the AbortError handler sees the flag.
    const setIdx = agentRunnerRunContent.indexOf('abortedByLoopGuard = true;');
    expect(setIdx).toBeGreaterThan(-1);

    const abortIdx = agentRunnerRunContent.indexOf('controller.abort();', setIdx);
    expect(abortIdx).toBeGreaterThan(setIdx);

    // No other lines should sneak between the flag set and the abort call —
    // keep them adjacent so the intent is obvious.
    const between = agentRunnerRunContent.slice(setIdx, abortIdx);
    const nonTrivialLines = between
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith('//'));
    expect(nonTrivialLines.length).toBeLessThanOrEqual(2);
  });

  it('the AbortError catch branch checks abortedByLoopGuard before falling into the user-cancel branch', () => {
    // Pull out the AbortError handler block for inspection.
    const start = agentRunnerRunContent.indexOf("error.name === 'AbortError'");
    expect(start).toBeGreaterThan(-1);
    const end = agentRunnerRunContent.indexOf('} else {', start);
    expect(end).toBeGreaterThan(start);
    const block = agentRunnerRunContent.slice(start, end + 800);

    // The branch for loop-guard must exist and must be reached BEFORE the
    // generic "Aborted by user" path that emits 'Cancelled'.
    const loopGuardBranchIdx = block.indexOf("abortDisposition === 'loop_guard'");
    const userCancelIdx = block.indexOf("title: 'Cancelled'");
    expect(loopGuardBranchIdx).toBeGreaterThan(-1);
    expect(userCancelIdx).toBeGreaterThan(loopGuardBranchIdx);
  });

  it('the loop-guard catch branch does NOT overwrite the trace status with Cancelled', () => {
    // Capture the loop-guard branch body and assert the executable code
    // contains neither sendTraceUpdate nor a 'Cancelled' literal — the guard
    // already published the error trace.
    const branchStart = agentRunnerRunContent.indexOf(
      "} else if (abortDisposition === 'loop_guard') {"
    );
    expect(branchStart).toBeGreaterThan(-1);
    const branchEnd = agentRunnerRunContent.indexOf('} else {', branchStart);
    expect(branchEnd).toBeGreaterThan(branchStart);
    const branch = agentRunnerRunContent.slice(branchStart, branchEnd);

    // Strip single-line comments so the explanatory prose can mention
    // "Cancelled" without tripping the assertion.
    const codeOnly = branch
      .split('\n')
      .map((line) => line.replace(/\/\/.*$/, ''))
      .join('\n');

    expect(codeOnly).not.toContain('Cancelled');
    expect(codeOnly).not.toContain('sendTraceUpdate');
    expect(branch).toContain('Aborted by loop guard');
  });

  it('the post-prompt short-circuit also returns early on a swallowed loop-guard abort', () => {
    // Some SDK builds swallow AbortError and return void instead of throwing.
    // For that path we still need to skip the "Task completed" trace update.
    expect(agentRunnerRunContent).toContain('shouldPreserveExistingTrace(abortDisposition)');
    expect(agentRunnerRunContent).toContain(
      "abortDisposition === 'loop_guard' ? 'loop guard' : 'stream error'"
    );
  });

  it('the loop-guard decision handler still publishes the error trace step before aborting', () => {
    // The trace update with status:'error' and the loop-detected title must
    // stay in place so the catch branch has something to preserve.
    expect(agentRunnerRunContent).toContain("title: 'Stopped: tool-call loop detected'");
    const titleIdx = agentRunnerRunContent.indexOf("title: 'Stopped: tool-call loop detected'");
    const localStart = agentRunnerRunContent.lastIndexOf('sendTraceUpdate', titleIdx);
    const localBlock = agentRunnerRunContent.slice(localStart, titleIdx);
    expect(localBlock).toContain("status: 'error'");
  });

  it('always emits the buildAbortUserMessage explanation, even if a prior error set hasEmittedError', () => {
    // Regression test for bot review on PR #225: the original block gated the
    // sendMessage(buildAbortUserMessage) on `if (!hasEmittedError)`, which
    // suppressed the loop-guard explanation when any earlier path had already
    // emitted an error. Users would then see only the error trace step with no
    // chat message explaining why the session stopped.
    //
    // Pin: the sendMessage that wraps buildAbortUserMessage must NOT be inside
    // an `if (!hasEmittedError)` gate, and the assignment to hasEmittedError
    // should follow the sendMessage so the suppression intent is preserved for
    // later generic-error paths.
    const sendIdx = agentRunnerRunContent.indexOf('text: buildAbortUserMessage(decision)');
    expect(sendIdx).toBeGreaterThan(-1);

    // The 200 chars immediately before the sendMessage must not contain a
    // bare `if (!hasEmittedError) {` gate (i.e., the old suppression check).
    const preamble = agentRunnerRunContent.slice(Math.max(0, sendIdx - 400), sendIdx);
    expect(preamble).not.toMatch(/if\s*\(\s*!hasEmittedError\s*\)\s*\{/);

    // hasEmittedError should be assigned AFTER the sendMessage to suppress
    // duplicate generic errors later in this turn, not before.
    const trailing = agentRunnerRunContent.slice(sendIdx, sendIdx + 400);
    expect(trailing).toContain('hasEmittedError = true');
  });
});
