import * as fs from 'fs/promises';
import * as path from 'path';

import { writeMCPLog } from '../mcp-logger.js';
import {
  moveMouse,
  performClick,
  performKeyPress,
  performType,
  takeScreenshot,
} from './actions.js';
import { PLATFORM, SCREENSHOTS_DIR } from './constants.js';
import { getDisplayConfiguration } from './display.js';
import { tryLocateElementInDockByAccessibility } from './mac-platform.js';
import type { BoundingBox, GUIActionPlan, LocateResult } from './types.js';
import { callVisionAPI } from './vision-api.js';
import {
  annotateScreenshotWithClickHistory,
  getImageDimensions,
  markPointOnImage,
} from './vision-annotate.js';

export async function analyzeScreenshotWithVision(
  screenshotPath: string,
  elementDescription: string,
  displayIndex?: number
): Promise<{
  x: number;
  y: number;
  confidence: number;
  displayIndex: number;
  boundingBox?: BoundingBox;
}> {
  try {
    const config = await getDisplayConfiguration();
    const targetDisplay =
      displayIndex !== undefined
        ? config.displays.find((display) => display.index === displayIndex)
        : config.displays.find((display) => display.isMain);

    if (!targetDisplay) {
      throw new Error(`Display index ${displayIndex} not found`);
    }

    const { annotatedPath, clickHistoryInfo } = await annotateScreenshotWithClickHistory(
      screenshotPath,
      targetDisplay.index
    );

    writeMCPLog(
      `[analyzeScreenshotWithVision] Using screenshot: ${annotatedPath}`,
      'Screenshot Selection'
    );
    writeMCPLog(
      `[analyzeScreenshotWithVision] Click history: ${clickHistoryInfo}`,
      'Click History'
    );

    const imageBuffer = await fs.readFile(annotatedPath);
    const base64Image = imageBuffer.toString('base64');
    const imageDims = await getImageDimensions(annotatedPath);

    const prompt = `给我${elementDescription}的grounding坐标。

**注意**：图片上可能有黄色圆圈标记，这些是之前点击过的位置（仅用于相对位置参考，它们并不一定是正确的点击位置），标记格式为"#序号"和已经归一化之后的"[y,x]"坐标。这些标记不是界面的一部分，请忽略它们，只定位实际的界面元素。

坐标格式：归一化到0-1000，格式为[ymin, xmin, ymax, xmax]

返回JSON（不要markdown）:
{"box_2d": [ymin, xmin, ymax, xmax], "confidence": <0-100>}`;

    writeMCPLog(`[analyzeScreenshotWithVision] Prompt: ${prompt}`);

    const responseText = await callVisionAPI(
      base64Image,
      prompt,
      20000,
      'analyzeScreenshotWithVision'
    );
    writeMCPLog(
      `[analyzeScreenshotWithVision] Raw Response Length: ${responseText.length}`,
      'Response'
    );
    writeMCPLog(
      `[analyzeScreenshotWithVision] Raw Response (first 500 chars): ${responseText.substring(0, 500)}`,
      'Response Preview'
    );

    let jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      writeMCPLog(
        '[analyzeScreenshotWithVision] No JSON found with simple regex, trying code block pattern',
        'Parse Attempt'
      );
      const codeBlockMatch = responseText.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
      if (codeBlockMatch) {
        jsonMatch = [codeBlockMatch[1]];
        writeMCPLog(
          `[analyzeScreenshotWithVision] Found JSON in code block, length: ${jsonMatch[0].length}`,
          'Parse Success'
        );
      }
    } else {
      writeMCPLog(
        `[analyzeScreenshotWithVision] Found JSON with simple regex, length: ${jsonMatch[0].length}`,
        'Parse Success'
      );
    }

    if (!jsonMatch) {
      writeMCPLog(
        `[analyzeScreenshotWithVision] Failed to find JSON in response. Full response: ${responseText}`,
        'Parse Error'
      );
      throw new Error('Failed to parse vision model response: No JSON found in response');
    }

    let result;
    try {
      writeMCPLog(
        `[analyzeScreenshotWithVision] Attempting to parse JSON (first 200 chars): ${jsonMatch[0].substring(0, 200)}`,
        'JSON Parse'
      );
      result = JSON.parse(jsonMatch[0]);
      writeMCPLog('[analyzeScreenshotWithVision] JSON parsed successfully', 'JSON Parse Success');
    } catch (parseError: unknown) {
      writeMCPLog(
        `[analyzeScreenshotWithVision] JSON parse failed: ${parseError instanceof Error ? parseError.message : String(parseError)}`,
        'JSON Parse Error'
      );
      writeMCPLog(
        `[analyzeScreenshotWithVision] JSON string that failed to parse: ${jsonMatch[0]}`,
        'JSON Parse Error'
      );
      throw new Error(
        `Failed to parse JSON: ${parseError instanceof Error ? parseError.message : String(parseError)}. JSON string: ${jsonMatch[0].substring(0, 500)}`
      );
    }

    if (!result.box_2d || !Array.isArray(result.box_2d) || result.box_2d.length !== 4) {
      writeMCPLog(
        `[analyzeScreenshotWithVision] Invalid box_2d in response: ${JSON.stringify(result)}`,
        'Parse Error'
      );
      throw new Error(
        'Vision response missing or invalid box_2d field. Expected format: [ymin, xmin, ymax, xmax]'
      );
    }

    const [ymin_norm, xmin_norm, ymax_norm, xmax_norm] = result.box_2d;
    writeMCPLog(
      `[analyzeScreenshotWithVision] Normalized box (0-1000): [ymin=${ymin_norm}, xmin=${xmin_norm}, ymax=${ymax_norm}, xmax=${xmax_norm}]`,
      'Normalized Coordinates'
    );

    const xmin_pixel = Math.round((xmin_norm / 1000) * imageDims.width);
    const ymin_pixel = Math.round((ymin_norm / 1000) * imageDims.height);
    const xmax_pixel = Math.round((xmax_norm / 1000) * imageDims.width);
    const ymax_pixel = Math.round((ymax_norm / 1000) * imageDims.height);

    writeMCPLog(
      `[analyzeScreenshotWithVision] Pixel coordinates: xmin=${xmin_pixel}, ymin=${ymin_pixel}, xmax=${xmax_pixel}, ymax=${ymax_pixel}`,
      'Pixel Coordinates'
    );
    writeMCPLog(
      `[analyzeScreenshotWithVision] Image dimensions: ${imageDims.width}x${imageDims.height}`,
      'Image Info'
    );

    const pixelCenterX = Math.round((xmin_pixel + xmax_pixel) / 2);
    const pixelCenterY = Math.round((ymin_pixel + ymax_pixel) / 2);
    writeMCPLog(
      `[analyzeScreenshotWithVision] Calculated center from bounding box (pixels): x=${pixelCenterX}, y=${pixelCenterY}`,
      'Center Calculation'
    );

    const rawScaleFactor = targetDisplay.scaleFactor || 1;
    const effectiveScaleFactor = PLATFORM === 'win32' ? 1 : rawScaleFactor;
    writeMCPLog(
      `[analyzeScreenshotWithVision] Display scaleFactor: ${rawScaleFactor}, effective (platform=${PLATFORM}): ${effectiveScaleFactor}`,
      'Coordinate Conversion'
    );

    const logicalX = pixelCenterX / effectiveScaleFactor;
    const logicalY = pixelCenterY / effectiveScaleFactor;
    writeMCPLog(
      `[analyzeScreenshotWithVision] Logical coordinates for cliclick: x=${logicalX}, y=${logicalY}`,
      'Coordinate Conversion'
    );

    return {
      x: Math.round(logicalX),
      y: Math.round(logicalY),
      confidence: result.confidence || 0,
      displayIndex: targetDisplay.index,
      boundingBox: {
        left: xmin_pixel,
        top: ymin_pixel,
        right: xmax_pixel,
        bottom: ymax_pixel,
      },
    };
  } catch (error: unknown) {
    throw new Error(
      `Vision analysis failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

export async function planGUIActions(
  taskDescription: string,
  displayIndex?: number
): Promise<GUIActionPlan> {
  if (PLATFORM !== 'darwin' && PLATFORM !== 'win32') {
    throw new Error(`GUI action planning is not supported on platform: ${PLATFORM}`);
  }

  const screenshotPath = path.join(SCREENSHOTS_DIR, `gui_plan_${Date.now()}.png`);
  await takeScreenshot(screenshotPath, displayIndex);

  const imageDims = await getImageDimensions(screenshotPath);
  const imageBuffer = await fs.readFile(screenshotPath);
  const base64Image = imageBuffer.toString('base64');

  const prompt = `Analyze this GUI screenshot and create a step-by-step plan to accomplish the following task: "${taskDescription}"

**COORDINATE SYSTEM:**
- Image dimensions: ${imageDims.width}x${imageDims.height} pixels
- Origin (0,0) is at TOP-LEFT corner

**TASK:**
Break down the task "${taskDescription}" into a sequence of GUI operations.

**INSTRUCTIONS:**
1. Analyze the current GUI state shown in the screenshot
2. Identify what elements need to be interacted with
3. Create a step-by-step plan with specific actions
4. For each step, describe the element to interact with and what action to perform
5. Include any text values that need to be entered

**AVAILABLE ACTIONS:**
- click: Single click on an element
- double_click: Double click on an element
- right_click: Right click on an element
- type: Type text into an input field (requires value parameter)
- hover: Move mouse over an element
- key_press: Press a key (requires value parameter with key name)

**RESPONSE FORMAT (JSON only, no markdown):**
{
  "steps": [
    {
      "step": 1,
      "action": "click|double_click|right_click|type|hover|key_press",
      "element_description": "<detailed description of the element to interact with>",
      "value": "<optional: text to type or key to press>",
      "reasoning": "<explanation of why this step is needed>"
    }
  ],
  "summary": "<brief summary of the plan>"
}

Be specific and detailed in element descriptions. For example:
- Instead of "button", use "the red Start button in the top-right corner"
- Instead of "input", use "the text input field labeled 'File Name'"
- Instead of "menu", use "the File menu in the menu bar"`;

  const responseText = await callVisionAPI(base64Image, prompt, 20000, 'planGUIActions');
  writeMCPLog(`[planGUIActions] Raw Response Length: ${responseText.length}`, 'Response');
  writeMCPLog(
    `[planGUIActions] Raw Response (first 500 chars): ${responseText.substring(0, 500)}`,
    'Response Preview'
  );

  let jsonMatch = responseText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    writeMCPLog(
      '[planGUIActions] No JSON found with simple regex, trying code block pattern',
      'Parse Attempt'
    );
    const codeBlockMatch = responseText.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
    if (codeBlockMatch) {
      jsonMatch = [codeBlockMatch[1]];
      writeMCPLog(
        `[planGUIActions] Found JSON in code block, length: ${jsonMatch[0].length}`,
        'Parse Success'
      );
    }
  } else {
    writeMCPLog(
      `[planGUIActions] Found JSON with simple regex, length: ${jsonMatch[0].length}`,
      'Parse Success'
    );
  }

  if (!jsonMatch) {
    writeMCPLog(
      `[planGUIActions] Failed to find JSON in response. Full response: ${responseText}`,
      'Parse Error'
    );
    throw new Error('Failed to parse action plan response: No JSON found in response');
  }

  let plan;
  try {
    writeMCPLog(
      `[planGUIActions] Attempting to parse JSON (first 200 chars): ${jsonMatch[0].substring(0, 200)}`,
      'JSON Parse'
    );
    plan = JSON.parse(jsonMatch[0]);
    writeMCPLog(
      `[planGUIActions] JSON parsed successfully. Steps count: ${plan.steps?.length || 0}`,
      'JSON Parse Success'
    );
  } catch (parseError: unknown) {
    writeMCPLog(
      `[planGUIActions] JSON parse failed: ${parseError instanceof Error ? parseError.message : String(parseError)}`,
      'JSON Parse Error'
    );
    writeMCPLog(
      `[planGUIActions] JSON string that failed to parse: ${jsonMatch[0]}`,
      'JSON Parse Error'
    );
    throw new Error(
      `Failed to parse action plan JSON: ${parseError instanceof Error ? parseError.message : String(parseError)}. JSON string: ${jsonMatch[0].substring(0, 500)}`
    );
  }

  if (!plan.steps || !Array.isArray(plan.steps)) {
    writeMCPLog(
      `[planGUIActions] Invalid plan format. Plan keys: ${Object.keys(plan).join(', ')}, steps type: ${typeof plan.steps}`,
      'Validation Error'
    );
    throw new Error(
      `Invalid action plan format: missing steps array. Plan structure: ${JSON.stringify(plan, null, 2).substring(0, 500)}`
    );
  }

  return plan;
}

export async function locateGUIElement(
  elementDescription: string,
  displayIndex?: number
): Promise<LocateResult> {
  if (PLATFORM !== 'darwin' && PLATFORM !== 'win32') {
    throw new Error(`Element location is not supported on platform: ${PLATFORM}`);
  }

  if (PLATFORM === 'darwin') {
    try {
      const dockCoords = await tryLocateElementInDockByAccessibility(
        elementDescription,
        displayIndex
      );
      if (dockCoords) {
        return dockCoords;
      }
    } catch (dockError: unknown) {
      writeMCPLog(
        `[locateGUIElement] Dock accessibility lookup failed: ${dockError instanceof Error ? dockError.message : String(dockError)}`,
        'Dock Locate Warning'
      );
    }
  }

  const screenshotPath = path.join(SCREENSHOTS_DIR, `gui_locate_${Date.now()}.png`);
  await takeScreenshot(screenshotPath, displayIndex);

  const coords = await analyzeScreenshotWithVision(
    screenshotPath,
    elementDescription,
    displayIndex
  );

  try {
    const config = await getDisplayConfiguration();
    const targetDisplay =
      displayIndex !== undefined
        ? config.displays.find((display) => display.index === displayIndex)
        : config.displays.find((display) => display.isMain);

    if (targetDisplay) {
      const rawScaleFactor = targetDisplay.scaleFactor || 1;
      const effectiveScaleFactor = PLATFORM === 'win32' ? 1 : rawScaleFactor;
      const pixelX = coords.x * effectiveScaleFactor;
      const pixelY = coords.y * effectiveScaleFactor;

      writeMCPLog(
        `[locateGUIElement] Marking point on screenshot: logical=(${coords.x}, ${coords.y}), pixel=(${pixelX}, ${pixelY}), effectiveScale=${effectiveScaleFactor}`,
        'Image Marking'
      );

      const markedPath = await markPointOnImage(
        screenshotPath,
        pixelX,
        pixelY,
        undefined,
        coords.boundingBox
      );
      writeMCPLog(`[locateGUIElement] Marked screenshot saved to: ${markedPath}`, 'Image Marking');
    }
  } catch (markError: unknown) {
    writeMCPLog(
      `[locateGUIElement] Failed to mark screenshot: ${markError instanceof Error ? markError.message : String(markError)}`,
      'Image Marking Warning'
    );
  }

  return coords;
}

export async function executeActionStep(
  step: { step: number; action: string; element_description: string; value?: string },
  displayIndex?: number
): Promise<{
  success: boolean;
  step: number;
  action: string;
  coordinates?: { x: number; y: number };
  error?: string;
}> {
  try {
    writeMCPLog(
      `[executeActionStep] Starting step ${step.step}: ${step.action} on "${step.element_description}"`,
      'Step Execution'
    );

    const coords = await locateGUIElement(step.element_description, displayIndex);
    writeMCPLog(
      `[executeActionStep] Step ${step.step}: Located element at (${coords.x}, ${coords.y}) with confidence ${coords.confidence}%`,
      'Step Execution'
    );

    if (coords.confidence < 50) {
      writeMCPLog(
        `[executeActionStep] Step ${step.step}: Low confidence (${coords.confidence}%), aborting`,
        'Step Execution'
      );
      return {
        success: false,
        step: step.step,
        action: step.action,
        error: `Element "${step.element_description}" not found with sufficient confidence (${coords.confidence}%)`,
      };
    }

    writeMCPLog(
      `[executeActionStep] Step ${step.step}: Executing action "${step.action}"`,
      'Step Execution'
    );
    switch (step.action) {
      case 'click':
        await performClick(coords.x, coords.y, coords.displayIndex, 'single');
        writeMCPLog(
          `[executeActionStep] Step ${step.step}: Click completed successfully`,
          'Step Execution'
        );
        return {
          success: true,
          step: step.step,
          action: 'click',
          coordinates: { x: coords.x, y: coords.y },
        };

      case 'double_click':
        await performClick(coords.x, coords.y, coords.displayIndex, 'double');
        writeMCPLog(
          `[executeActionStep] Step ${step.step}: Double click completed successfully`,
          'Step Execution'
        );
        return {
          success: true,
          step: step.step,
          action: 'double_click',
          coordinates: { x: coords.x, y: coords.y },
        };

      case 'right_click':
        await performClick(coords.x, coords.y, coords.displayIndex, 'right');
        writeMCPLog(
          `[executeActionStep] Step ${step.step}: Right click completed successfully`,
          'Step Execution'
        );
        return {
          success: true,
          step: step.step,
          action: 'right_click',
          coordinates: { x: coords.x, y: coords.y },
        };

      case 'type':
        if (!step.value) {
          writeMCPLog(
            `[executeActionStep] Step ${step.step}: Type action missing value`,
            'Step Execution Error'
          );
          return {
            success: false,
            step: step.step,
            action: 'type',
            error: 'Value is required for type action',
          };
        }
        writeMCPLog(
          `[executeActionStep] Step ${step.step}: Clicking to focus, then typing "${step.value}"`,
          'Step Execution'
        );
        await performClick(coords.x, coords.y, coords.displayIndex, 'single');
        await new Promise((resolve) => setTimeout(resolve, 200));
        await performType(step.value, false);
        writeMCPLog(
          `[executeActionStep] Step ${step.step}: Type completed successfully`,
          'Step Execution'
        );
        return {
          success: true,
          step: step.step,
          action: 'type',
          coordinates: { x: coords.x, y: coords.y },
        };

      case 'hover':
        await moveMouse(coords.x, coords.y, coords.displayIndex);
        writeMCPLog(
          `[executeActionStep] Step ${step.step}: Hover completed successfully`,
          'Step Execution'
        );
        return {
          success: true,
          step: step.step,
          action: 'hover',
          coordinates: { x: coords.x, y: coords.y },
        };

      case 'key_press':
        if (!step.value) {
          writeMCPLog(
            `[executeActionStep] Step ${step.step}: Key press action missing key name`,
            'Step Execution Error'
          );
          return {
            success: false,
            step: step.step,
            action: 'key_press',
            error: 'Key name is required for key_press action',
          };
        }
        writeMCPLog(
          `[executeActionStep] Step ${step.step}: Pressing key "${step.value}"`,
          'Step Execution'
        );
        await performKeyPress(step.value, []);
        writeMCPLog(
          `[executeActionStep] Step ${step.step}: Key press completed successfully`,
          'Step Execution'
        );
        return {
          success: true,
          step: step.step,
          action: 'key_press',
        };

      default:
        writeMCPLog(
          `[executeActionStep] Step ${step.step}: Unsupported action "${step.action}"`,
          'Step Execution Error'
        );
        return {
          success: false,
          step: step.step,
          action: step.action,
          error: `Unsupported action: ${step.action}`,
        };
    }
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    const errStack = error instanceof Error ? error.stack : undefined;

    writeMCPLog(
      `[executeActionStep] Step ${step.step}: Error occurred: ${errMsg}`,
      'Step Execution Error'
    );
    writeMCPLog(
      `[executeActionStep] Step ${step.step}: Error stack: ${errStack}`,
      'Step Execution Error'
    );

    return {
      success: false,
      step: step.step,
      action: step.action,
      error: errMsg,
    };
  }
}
