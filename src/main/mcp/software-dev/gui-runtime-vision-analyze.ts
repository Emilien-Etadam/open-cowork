import * as fs from 'fs/promises';

import { writeMCPLog } from '../mcp-logger.js';
import { callVisionAPI } from './gui-runtime-vision-api.js';
import { getImageDimensions, getScreenDimensions } from './gui-runtime-screenshot.js';
import {
  currentScreenContext,
  setCurrentScreenContext,
  type ScreenContext,
} from './gui-runtime-state.js';

export async function analyzeAndBuildScreenContext(
  screenshotPath: string,
  forceUpdate: boolean = false
): Promise<ScreenContext> {
  try {
    // Check if we can reuse existing context
    if (
      !forceUpdate &&
      currentScreenContext &&
      currentScreenContext.lastScreenshot === screenshotPath
    ) {
      const timeSinceUpdate = Date.now() - currentScreenContext.lastUpdated.getTime();
      if (timeSinceUpdate < 5000) {
        // Reuse if less than 5 seconds old
        writeMCPLog('[Vision] Reusing existing screen context (recent)');
        return currentScreenContext;
      }
    }

    // Get screen dimensions
    const screenDims = await getScreenDimensions();
    const imageDims = await getImageDimensions(screenshotPath);

    writeMCPLog(
      `[Vision] Screen: ${screenDims.width}x${screenDims.height}, Image: ${imageDims.width}x${imageDims.height}`
    );

    // Read screenshot
    const imageBuffer = await fs.readFile(screenshotPath);
    const base64Image = imageBuffer.toString('base64');

    // Build comprehensive analysis prompt
    const previousContext = currentScreenContext
      ? `

**PREVIOUS SCREEN ANALYSIS:**
${currentScreenContext.lastAnalysis}

**PREVIOUS ELEMENTS:**
${currentScreenContext.elements.map((el) => `- ${el.description} at (${el.position.x}, ${el.position.y})`).join('\n')}

Please UPDATE this analysis based on any changes you observe.`
      : '';

    const prompt = `You are analyzing a GUI screenshot to build a comprehensive understanding of the interface.

**SCREEN INFORMATION:**
- Screen resolution: ${screenDims.width}x${screenDims.height} pixels
- Screenshot resolution: ${imageDims.width}x${imageDims.height} pixels
- Coordinate system: (0,0) at TOP-LEFT corner
- X-axis: 0 (left) to ${imageDims.width} (right)
- Y-axis: 0 (top) to ${imageDims.height} (bottom)${previousContext}

**TASK:**
Provide a DETAILED analysis of this GUI screenshot, including:
1. Overall layout and structure
2. ALL visible UI elements (buttons, inputs, labels, images, etc.)
3. For EACH element: exact position, size, type, functionality, and current state
4. Spatial relationships between elements
5. Any text content visible

**RESPONSE FORMAT (JSON only, no markdown):**
{
  "overall_description": "<detailed description of the entire interface>",
  "layout_structure": "<description of layout: header, main area, footer, sidebars, etc.>",
  "elements": [
    {
      "description": "<clear description of the element>",
      "type": "<button|input|label|image|text|menu|dialog|window|etc>",
      "position": {
        "x": <center X coordinate>,
        "y": <center Y coordinate>,
        "width": <approximate width>,
        "height": <approximate height>
      },
      "functionality": "<what this element does>",
      "state": "<current state: enabled/disabled/focused/selected/etc>",
      "text_content": "<any visible text on or in the element>"
    }
  ],
  "spatial_relationships": "<description of how elements relate spatially>",
  "notable_features": "<any special or notable aspects of the UI>"
}

Be PRECISE with coordinates. Measure carefully from the top-left corner.`;

    const responseText = await callVisionAPI(base64Image, prompt, 4096);

    // Parse response
    let jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      const codeBlockMatch = responseText.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
      if (codeBlockMatch) jsonMatch = [codeBlockMatch[1]];
    }

    if (!jsonMatch) {
      throw new Error('Failed to parse screen context response');
    }

    const analysis = JSON.parse(jsonMatch[0]);

    // Build screen context
    const context: ScreenContext = {
      screenWidth: screenDims.width,
      screenHeight: screenDims.height,
      lastScreenshot: screenshotPath,
      lastAnalysis: analysis.overall_description || '',
      elements: analysis.elements || [],
      lastUpdated: new Date(),
    };

    setCurrentScreenContext(context);

    writeMCPLog(`[Vision] Screen context built: ${context.elements.length} elements identified`);
    writeMCPLog(`[Vision] Layout: ${analysis.layout_structure}`);

    return context;
  } catch (error: unknown) {
    writeMCPLog(
      `[Vision] Error building screen context: ${error instanceof Error ? error.message : String(error)}`
    );
    throw error;
  }
}

// Helper: Use vision model to analyze screenshot and find element coordinates (with context)
export async function analyzeScreenshotWithVision(
  screenshotPath: string,
  elementDescription: string
): Promise<{ x: number; y: number; confidence: number }> {
  // This function uses vision capabilities to locate UI elements
  // The screenshot is analyzed and coordinates are returned

  try {
    // First, ensure we have up-to-date screen context
    const context = await analyzeAndBuildScreenContext(screenshotPath, false);

    // Read screenshot as base64
    const imageBuffer = await fs.readFile(screenshotPath);
    const base64Image = imageBuffer.toString('base64');

    // Build context-aware prompt
    const contextInfo = `
**SCREEN CONTEXT:**
- Resolution: ${context.screenWidth}x${context.screenHeight} pixels
- Overall layout: ${context.lastAnalysis}

**KNOWN ELEMENTS ON SCREEN:**
${context.elements
  .slice(0, 20)
  .map(
    (el) =>
      `- ${el.description} (${el.type}) at position (${el.position.x}, ${el.position.y}), size ${el.position.width}x${el.position.height}`
  )
  .join('\n')}
${context.elements.length > 20 ? `... and ${context.elements.length - 20} more elements` : ''}`;

    const prompt = `Analyze this GUI screenshot and locate the following element: "${elementDescription}"

${contextInfo}

**COORDINATE SYSTEM:**
- Image dimensions: ${context.screenWidth}x${context.screenHeight} pixels
- Origin (0,0) is at TOP-LEFT corner
- X increases from left to right (0 to ${context.screenWidth})
- Y increases from top to bottom (0 to ${context.screenHeight})

**TASK:**
Find the element "${elementDescription}" and provide its EXACT CENTER coordinates.

**INSTRUCTIONS:**
1. Use the screen context above to help locate the element
2. Measure coordinates precisely from the top-left corner
3. Provide the CENTER POINT of the element
4. Estimate confidence based on visual clarity and match quality

**RESPONSE FORMAT (JSON only, no markdown):**
{
  "x": <integer between 0 and ${context.screenWidth}>,
  "y": <integer between 0 and ${context.screenHeight}>,
  "confidence": <integer 0-100>,
  "reasoning": "<brief explanation of what you found and where>",
  "element_bounds": {
    "left": <left edge X>,
    "top": <top edge Y>,
    "right": <right edge X>,
    "bottom": <bottom edge Y>
  }
}

If you cannot find the element, set confidence to 0.`;

    writeMCPLog(`[analyzeScreenshotWithVision] Prompt: ${prompt}`);

    const responseText = await callVisionAPI(base64Image, prompt, 2048);

    // Parse the response
    let jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      const codeBlockMatch = responseText.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
      if (codeBlockMatch) jsonMatch = [codeBlockMatch[1]];
    }

    if (!jsonMatch) {
      writeMCPLog(`[Vision] Failed to parse response: ${responseText}`);
      throw new Error('Failed to parse vision model response');
    }

    const result = JSON.parse(jsonMatch[0]);

    // Validate and clamp coordinates
    result.x = Math.max(0, Math.min(context.screenWidth, result.x));
    result.y = Math.max(0, Math.min(context.screenHeight, result.y));

    writeMCPLog(
      `[Vision] Found element "${elementDescription}" at (${result.x}, ${result.y}) with ${result.confidence}% confidence`
    );
    writeMCPLog(`[Vision] Reasoning: ${result.reasoning}`);
    if (result.element_bounds) {
      writeMCPLog(
        `[Vision] Bounds: [${result.element_bounds.left}, ${result.element_bounds.top}] to [${result.element_bounds.right}, ${result.element_bounds.bottom}]`
      );
    }

    return {
      x: Math.round(result.x),
      y: Math.round(result.y),
      confidence: result.confidence,
    };
  } catch (error: unknown) {
    writeMCPLog(
      `[Vision] Error analyzing screenshot: ${error instanceof Error ? error.message : String(error)}`
    );
    throw new Error(
      `Vision analysis failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
