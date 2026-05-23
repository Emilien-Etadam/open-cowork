import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const agentRunnerPath = path.resolve(process.cwd(), 'src/main/claude/agent-runner.ts');
const agentRunnerContent = readFileSync(agentRunnerPath, 'utf8');

/**
 * These tests pin the post-rescue catch-block disposition for loop-guard
 * aborts. The bug they guard against: when handleLoopGuardDecision called
 * controller.abort(), the AbortError ended up in the generic "Aborted by
 * user" branch which overwrote the loop-guard's 'error' trace step with
 * status:'completed', title:'Cancelled'.
 */
describe('agent-runner loop-guard abort preserves error trace status', () => {
  it('declares an abortedByLoopGuard flag in the prompt() scope', () => {
    expect(agentRunnerContent).toContain('let abortedByLoopGuard = false;');
  });

  it('sets the flag immediately before controller.abort() in handleLoopGuardDecision', () => {
    // The assignment must appear in the loop-guard block AND must precede the
    // controller.abort() call so the AbortError handler sees the flag.
    const setIdx = agentRunnerContent.indexOf('abortedByLoopGuard = true;');
    expect(setIdx).toBeGreaterThan(-1);

    const abortIdx = agentRunnerContent.indexOf('controller.abort();', setIdx);
    expect(abortIdx).toBeGreaterThan(setIdx);

    // No other lines should sneak between the flag set and the abort call —
    // keep them adjacent so the intent is obvious.
    const between = agentRunnerContent.slice(setIdx, abortIdx);
    const nonTrivialLines = between
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith('//'));
    expect(nonTrivialLines.length).toBeLessThanOrEqual(2);
  });

  it('the AbortError catch branch checks abortedByLoopGuard before falling into the user-cancel branch', () => {
    // Pull out the AbortError handler block for inspection.
    const start = agentRunnerContent.indexOf("error.name === 'AbortError'");
    expect(start).toBeGreaterThan(-1);
    const end = agentRunnerContent.indexOf('} else {', start);
    expect(end).toBeGreaterThan(start);
    const block = agentRunnerContent.slice(start, end + 800);

    // The branch for loop-guard must exist and must be reached BEFORE the
    // generic "Aborted by user" path that emits 'Cancelled'.
    const loopGuardBranchIdx = block.indexOf('abortedByLoopGuard');
    const userCancelIdx = block.indexOf("title: 'Cancelled'");
    expect(loopGuardBranchIdx).toBeGreaterThan(-1);
    expect(userCancelIdx).toBeGreaterThan(loopGuardBranchIdx);
  });

  it('the loop-guard catch branch does NOT overwrite the trace status with Cancelled', () => {
    // Capture the loop-guard branch body and assert the executable code
    // contains neither sendTraceUpdate nor a 'Cancelled' literal — the guard
    // already published the error trace.
    const branchStart = agentRunnerContent.indexOf('} else if (abortedByLoopGuard) {');
    expect(branchStart).toBeGreaterThan(-1);
    const branchEnd = agentRunnerContent.indexOf('} else {', branchStart);
    expect(branchEnd).toBeGreaterThan(branchStart);
    const branch = agentRunnerContent.slice(branchStart, branchEnd);

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
    expect(agentRunnerContent).toContain('if (controller.signal.aborted && abortedByLoopGuard)');
    expect(agentRunnerContent).toContain('Aborted by loop guard (detected after prompt returned)');
  });

  it('the loop-guard decision handler still publishes the error trace step before aborting', () => {
    // The trace update with status:'error' and the loop-detected title must
    // stay in place so the catch branch has something to preserve.
    expect(agentRunnerContent).toContain("title: 'Stopped: tool-call loop detected'");
    const titleIdx = agentRunnerContent.indexOf("title: 'Stopped: tool-call loop detected'");
    const localStart = agentRunnerContent.lastIndexOf('sendTraceUpdate', titleIdx);
    const localBlock = agentRunnerContent.slice(localStart, titleIdx);
    expect(localBlock).toContain("status: 'error'");
  });
});
