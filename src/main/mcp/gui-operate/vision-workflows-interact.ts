import * as fs from 'fs/promises';
import * as path from 'path';

import { writeMCPLog } from '../mcp-logger.js';
import {
  appNameMatchesAliases,
  inferExpectedAppAliasesFromText,
  isLikelyAppLaunchVerification,
  saveLatestClickToHistory,
} from './click-history.js';
import { PLATFORM, SCREENSHOTS_DIR } from './constants.js';
import { getDisplayConfiguration } from './display.js';
import { getFrontmostMacApplicationName } from './mac-platform.js';
import {
  clickHistoryState,
  getReusableScreenshot,
  toRegionKey,
  updateScreenshotCache,
} from './state.js';
import { takeScreenshot } from './actions.js';
import { callVisionAPI } from './vision-api.js';
import { executeActionStep, planGUIActions } from './vision-workflows-plan.js';

export async function performVisionBasedInteraction(
  taskDescription: string,
  displayIndex?: number
): Promise<string> {
  if (PLATFORM !== 'darwin' && PLATFORM !== 'win32') {
    throw new Error(`Vision-based GUI interaction is not supported on platform: ${PLATFORM}`);
  }

  writeMCPLog(`[performVisionBasedInteraction] Starting task: "${taskDescription}"`, 'Task Start');
  writeMCPLog(
    `[performVisionBasedInteraction] Display index: ${displayIndex ?? 'main'}`,
    'Task Start'
  );

  writeMCPLog('[performVisionBasedInteraction] Step 1: Planning actions...', 'Task Planning');

  let plan;
  try {
    plan = await planGUIActions(taskDescription, displayIndex);
    writeMCPLog(
      `[performVisionBasedInteraction] Planning completed. Total steps: ${plan.steps.length}`,
      'Task Planning'
    );
    writeMCPLog(
      `[performVisionBasedInteraction] Plan summary: ${plan.summary || 'No summary'}`,
      'Task Planning'
    );
  } catch (error: unknown) {
    writeMCPLog(
      `[performVisionBasedInteraction] Planning failed: ${error instanceof Error ? error.message : String(error)}`,
      'Task Planning Error'
    );
    throw error;
  }

  writeMCPLog(
    `[performVisionBasedInteraction] Step 2: Executing ${plan.steps.length} steps...`,
    'Task Execution'
  );

  const results: Array<{
    step: number;
    success: boolean;
    action: string;
    element_description: string;
    error?: string;
    coordinates?: { x: number; y: number };
  }> = [];

  for (const step of plan.steps) {
    writeMCPLog(
      `[performVisionBasedInteraction] Executing step ${step.step}/${plan.steps.length}: ${step.action}`,
      'Task Execution'
    );

    if (results.length > 0) {
      const lastAction = results[results.length - 1]?.action;
      const waitTime = lastAction === 'type' ? 800 : 500;
      await new Promise((resolve) => setTimeout(resolve, waitTime));
    }

    const result = await executeActionStep(step, displayIndex);
    results.push({
      step: step.step,
      success: result.success,
      action: step.action,
      element_description: step.element_description,
      error: result.error,
      coordinates: result.coordinates,
    });

    if (!result.success) {
      writeMCPLog(
        `[performVisionBasedInteraction] Step ${step.step} failed, stopping execution`,
        'Task Execution Error'
      );
      break;
    }

    writeMCPLog(
      `[performVisionBasedInteraction] Step ${step.step} completed successfully`,
      'Task Execution'
    );

    if (step.action === 'click' || step.action === 'double_click') {
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }

  const allSuccessful = results.every((result) => result.success);
  writeMCPLog(
    `[performVisionBasedInteraction] Task completed. Success: ${allSuccessful}, Steps executed: ${results.length}/${plan.steps.length}`,
    'Task Completion'
  );

  return JSON.stringify({
    success: allSuccessful,
    task: taskDescription,
    plan_summary: plan.summary || 'No summary provided',
    steps_executed: results.length,
    total_steps: plan.steps.length,
    results,
    failed_at_step: allSuccessful ? undefined : results.findIndex((result) => !result.success) + 1,
  });
}

export async function verifyGUIState(question: string, displayIndex?: number): Promise<string> {
  if (PLATFORM !== 'darwin' && PLATFORM !== 'win32') {
    throw new Error(`GUI verification is not supported on platform: ${PLATFORM}`);
  }

  const normalizedDisplayIndex = displayIndex ?? 0;
  const regionKey = toRegionKey(undefined);
  const reusable = getReusableScreenshot(normalizedDisplayIndex, regionKey);

  let screenshotPath: string;
  let base64Image: string;

  if (reusable) {
    screenshotPath = reusable.path;
    base64Image = reusable.base64Image;
    writeMCPLog(
      `[verifyGUIState] Reusing recent screenshot captured ${Date.now() - reusable.capturedAt}ms ago: ${reusable.path}`,
      'Screenshot Reuse'
    );
  } else {
    screenshotPath = path.join(SCREENSHOTS_DIR, `gui_verify_${Date.now()}.png`);
    await takeScreenshot(screenshotPath, displayIndex);

    const imageBuffer = await fs.readFile(screenshotPath);
    base64Image = imageBuffer.toString('base64');

    const config = await getDisplayConfiguration();
    const display =
      config.displays.find((entry) => entry.index === normalizedDisplayIndex) || config.displays[0];

    updateScreenshotCache({
      displayIndex: normalizedDisplayIndex,
      regionKey,
      path: screenshotPath,
      base64Image,
      capturedAt: Date.now(),
      displayInfo: {
        width: display.width,
        height: display.height,
        scaleFactor: display.scaleFactor,
      },
    });
  }

  const prompt = `Analyze this GUI screenshot and answer the following question:

${question}

Provide a detailed answer based on what you can see in the image.

IMPORTANT: At the end of your response, you MUST provide a formatted judgment on whether the most recent GUI operation was accurate/successful. Use this exact format:

**Operation Success Judgment:**
- Status: [SUCCESS/FAILURE]
- Reason: [Brief explanation of why the operation succeeded or failed]

Example:
**Operation Success Judgment:**
- Status: SUCCESS
- Reason: The button was clicked correctly in the expected dialog window.`;

  let answer = await callVisionAPI(base64Image, prompt, 20000, 'verifyGUIState');
  writeMCPLog(`[verifyGUIState] Response Length: ${answer.length}`, 'Response');
  writeMCPLog(
    `[verifyGUIState] Response (first 500 chars): ${answer.substring(0, 500)}`,
    'Response Preview'
  );

  let operationSuccess = false;
  const successMatch = answer.match(
    /\*\*Operation Success Judgment:\*\*[\s\S]*?Status:\s*(SUCCESS|FAILURE)/i
  );
  if (successMatch) {
    operationSuccess = successMatch[1].toUpperCase() === 'SUCCESS';
    writeMCPLog(
      `[verifyGUIState] Parsed operation success: ${operationSuccess}`,
      'Success Parsing'
    );

    if (operationSuccess && clickHistoryState.lastClickEntry) {
      clickHistoryState.lastClickEntry.successCount =
        (clickHistoryState.lastClickEntry.successCount || 0) + 1;
      writeMCPLog(
        `[verifyGUIState] Incremented successCount for click at (${clickHistoryState.lastClickEntry.x}, ${clickHistoryState.lastClickEntry.y}) to ${clickHistoryState.lastClickEntry.successCount}`,
        'Success Tracking'
      );

      await saveLatestClickToHistory(clickHistoryState.lastClickEntry, {
        incrementCount: false,
      });
    }
  } else {
    writeMCPLog(
      '[verifyGUIState] Could not parse operation success judgment from response',
      'Success Parsing Warning'
    );
  }

  if (PLATFORM === 'darwin') {
    const expectedAliases = inferExpectedAppAliasesFromText(question);
    const requiresForegroundMatch = isLikelyAppLaunchVerification(question);

    if (expectedAliases.length > 0 && requiresForegroundMatch) {
      const frontmostApp = await getFrontmostMacApplicationName();
      if (frontmostApp) {
        const frontmostMatched = appNameMatchesAliases(frontmostApp, expectedAliases);
        writeMCPLog(
          `[verifyGUIState] Frontmost app cross-check. frontmost="${frontmostApp}", expectedAliases=${JSON.stringify(expectedAliases)}, matched=${frontmostMatched}`,
          'Success Parsing'
        );

        if (operationSuccess && !frontmostMatched) {
          operationSuccess = false;
          answer += `\n\n[System Cross-check] Frontmost app is "${frontmostApp}", which does not match the expected target app from the question.`;
          writeMCPLog(
            '[verifyGUIState] Overrode operationSuccess to false due to frontmost app mismatch.',
            'Success Parsing Warning'
          );
        }
      }
    }
  }

  answer = stripOperationSuccessJudgmentBlock(answer);

  return JSON.stringify({
    success: true,
    question,
    answer,
    operationSuccess,
    screenshot_path: screenshotPath,
    displayIndex: normalizedDisplayIndex,
  });
}

export function stripOperationSuccessJudgmentBlock(answer: string): string {
  if (!answer) {
    return answer;
  }

  const normalized = answer.replace(/\r\n/g, '\n');
  const patterns = [
    /\n?\*\*Operation Success Judgment:\*\*[\s\S]*?(?:- Status:\s*(?:SUCCESS|FAILURE)[\s\S]*?(?:\n{2,}|$))/gi,
    /\n?Operation Success Judgment:\s*[\s\S]*?(?:Status:\s*(?:SUCCESS|FAILURE)[\s\S]*?(?:\n{2,}|$))/gi,
  ];

  let stripped = normalized;
  for (const pattern of patterns) {
    stripped = stripped.replace(pattern, '\n\n');
  }

  return stripped.replace(/\n{3,}/g, '\n\n').trim();
}

export async function extractGUIInfo(
  extractionPrompt: string,
  displayIndex?: number
): Promise<string> {
  if (PLATFORM !== 'darwin' && PLATFORM !== 'win32') {
    throw new Error(`GUI extraction is not supported on platform: ${PLATFORM}`);
  }

  const screenshotPath = path.join(SCREENSHOTS_DIR, `gui_extract_${Date.now()}.png`);
  await takeScreenshot(screenshotPath, displayIndex);

  const imageBuffer = await fs.readFile(screenshotPath);
  const base64Image = imageBuffer.toString('base64');

  const prompt = `You are an expert at extracting information from GUI screenshots. Analyze this screenshot and extract the requested information.

**Extraction Request:**
${extractionPrompt}

**Instructions:**
1. Carefully examine the screenshot to find the requested information.
2. Extract the information as accurately and completely as possible.
3. If the information is structured (like a list of messages, table data, menu items), format it clearly.
4. If certain information cannot be found or is partially visible, mention what is visible and what is missing.
5. Use appropriate formatting (bullet points, numbered lists, etc.) to present the extracted information clearly.

**Response Format:**
Provide the extracted information in a clear, structured format. If extracting multiple items, organize them logically.`;

  const extractedInfo = await callVisionAPI(base64Image, prompt, 30000, 'extractGUIInfo');
  writeMCPLog(`[extractGUIInfo] Response Length: ${extractedInfo.length}`, 'Response');
  writeMCPLog(
    `[extractGUIInfo] Response (first 500 chars): ${extractedInfo.substring(0, 500)}`,
    'Response Preview'
  );

  return JSON.stringify({
    success: true,
    extraction_prompt: extractionPrompt,
    extracted_info: extractedInfo,
    screenshot_path: screenshotPath,
    displayIndex: displayIndex ?? 'all',
  });
}
