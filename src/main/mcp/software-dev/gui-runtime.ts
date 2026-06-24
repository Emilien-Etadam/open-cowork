import * as fs from 'fs/promises';
import * as path from 'path';
import { exec, execFile } from 'child_process';
import { promisify } from 'util';

import { writeMCPLog } from '../mcp-logger.js';
import { startGUIApplicationInDocker, type GUIAppInstance } from './docker-gui.js';
import { WORKSPACE_DIR, executeCommand } from './file-ops.js';

const execFileAsync = promisify(execFile);

export interface ScreenContext {
  screenWidth: number;
  screenHeight: number;
  lastScreenshot: string;
  lastAnalysis: string;
  elements: Array<{
    description: string;
    type: string;
    position: { x: number; y: number; width: number; height: number };
    functionality: string;
    state?: string;
  }>;
  lastUpdated: Date;
}

let currentGUIApp: GUIAppInstance | null = null;
let currentScreenContext: ScreenContext | null = null;

export function getCurrentGUIApp(): GUIAppInstance | null {
  return currentGUIApp;
}

export function setCurrentGUIApp(instance: GUIAppInstance | null): void {
  currentGUIApp = instance;
  currentScreenContext = null;
}

export function clearCurrentGUIApp(): void {
  currentGUIApp = null;
  currentScreenContext = null;
}

export async function startGUIApplication(
  appFilePath: string,
  appType: string,
  startCommand?: string,
  waitTime: number = 3,
  useDocker: boolean = true,
  enableVnc: boolean = true,
  vncPort: number = 5901
): Promise<GUIAppInstance> {
  // If Docker mode is enabled, use Docker
  if (useDocker) {
    if (!startCommand) {
      throw new Error('startCommand is required when using Docker mode');
    }
    return await startGUIApplicationInDocker(
      appFilePath,
      appType,
      startCommand,
      enableVnc,
      vncPort
    );
  }

  // Otherwise, start locally
  const fullPath = path.isAbsolute(appFilePath)
    ? appFilePath
    : path.join(WORKSPACE_DIR, appFilePath);

  let command: string;
  let url: string | undefined;

  // Determine start command based on app type
  if (startCommand) {
    command = startCommand;
  } else {
    switch (appType) {
      case 'python':
        command = `python "${fullPath}"`;
        break;
      case 'electron':
        command = `npm start`;
        break;
      case 'web': {
        // For web apps, start a local server
        const port = 8000 + Math.floor(Math.random() * 1000);
        command = `python -m http.server ${port}`;
        url = `http://localhost:${port}`;
        break;
      }
      case 'java':
        command = `java -jar "${fullPath}"`;
        break;
      default:
        command = fullPath;
    }
  }

  writeMCPLog(`[GUI] Starting ${appType} application: ${command}`);

  // Start the process
  const childProcess = exec(command, {
    cwd: WORKSPACE_DIR,
  });

  const instance: GUIAppInstance = {
    process: childProcess,
    pid: childProcess.pid!,
    appType,
    startTime: new Date(),
    url,
    isDocker: false,
  };

  // Wait for app to be ready
  await new Promise((resolve) => setTimeout(resolve, waitTime * 1000));

  writeMCPLog(`[GUI] Application started (PID: ${instance.pid})`);

  return instance;
}

export async function executeCliclick(
  command: string
): Promise<{ stdout: string; stderr: string }> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const platform = require('os').platform();

  if (platform !== 'darwin') {
    throw new Error(
      'cliclick is only available on macOS. Use xdotool on Linux or other tools on Windows.'
    );
  }

  // Check if cliclick is installed
  try {
    await executeCommand('which cliclick');
  } catch {
    throw new Error('cliclick is not installed. Install it with: brew install cliclick');
  }

  return await executeCommand(`cliclick ${command}`);
}

// Helper: Take screenshot (cross-platform, supports Docker Xvfb)
export async function takeScreenshot(outputPath: string): Promise<string> {
  // If Docker mode, take screenshot inside container from Xvfb display
  if (currentGUIApp && currentGUIApp.isDocker && currentGUIApp.containerId) {
    writeMCPLog('[Screenshot] Taking screenshot from Docker container Xvfb display...');
    // Use scrot inside container to capture Xvfb display
    const containerScreenshotPath = `/tmp/screenshot_${Date.now()}.png`;
    try {
      // Wait a moment for GUI to update (important for capturing latest state)
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Delete old screenshot if exists to avoid cache issues
      await executeCommand(
        `docker exec ${currentGUIApp.containerId} bash -c "rm -f ${containerScreenshotPath}"`,
        WORKSPACE_DIR
      ).catch(() => {}); // Ignore error if file doesn't exist

      // Take screenshot inside container with overwrite flag
      await executeCommand(
        `docker exec ${currentGUIApp.containerId} bash -c "DISPLAY=:99 scrot -o ${containerScreenshotPath}"`,
        WORKSPACE_DIR
      );

      // Wait for screenshot file to exist in container
      writeMCPLog('[Screenshot] Waiting for screenshot file to be ready...');
      await new Promise((resolve) => setTimeout(resolve, 100));
      let fileExists = false;
      for (let i = 0; i < 20; i++) {
        // Max 2 seconds (20 * 100ms)
        try {
          await executeCommand(
            `docker exec ${currentGUIApp.containerId} bash -c "test -f ${containerScreenshotPath}"`,
            WORKSPACE_DIR
          );
          writeMCPLog(`[Screenshot] Screenshot file ready`);
          fileExists = true;
          break;
        } catch (e) {
          // File not ready yet
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      if (!fileExists) {
        writeMCPLog(
          '[Screenshot] Warning: Screenshot file verification timed out, proceeding anyway...'
        );
      }

      // Copy screenshot from container to host
      await executeCommand(
        `docker cp ${currentGUIApp.containerId}:${containerScreenshotPath} "${outputPath}"`,
        WORKSPACE_DIR
      );

      writeMCPLog(`[Screenshot] Screenshot copied from container to ${outputPath}`);

      return outputPath;
    } catch (error: unknown) {
      writeMCPLog(
        `[Screenshot] Failed to take screenshot from container: ${error instanceof Error ? error.message : String(error)}`
      );
      throw new Error(
        `Failed to take screenshot from Docker container: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  // Otherwise, take screenshot from local display
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const platform = require('os').platform();

  let command: string;
  if (platform === 'darwin') {
    command = `screencapture -x "${outputPath}"`;
  } else if (platform === 'win32') {
    command = `powershell -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Drawing.Bitmap]::FromScreen([System.Windows.Forms.Screen]::PrimaryScreen.Bounds).Save('${outputPath}')"`;
  } else {
    // Linux
    command = `import -window root "${outputPath}"`;
  }

  await executeCommand(command);
  return outputPath;
}

// Helper: Call vision API (supports Anthropic, OpenAI-compatible, and OpenRouter)

export async function callVisionAPI(
  base64Image: string,
  prompt: string,
  maxTokens: number = 2048
): Promise<string> {
  // Get API configuration from environment (supports Anthropic/OpenRouter/OpenAI-compatible)
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN;
  const openAIApiKey = process.env.OPENAI_API_KEY;
  const apiKey = anthropicApiKey || openAIApiKey;
  const hasOpenAIConfig = Boolean(
    process.env.OPENAI_API_KEY || process.env.OPENAI_BASE_URL || process.env.OPENAI_MODEL
  );
  const baseUrl = process.env.ANTHROPIC_BASE_URL || process.env.OPENAI_BASE_URL;
  const model =
    process.env.CLAUDE_MODEL ||
    process.env.ANTHROPIC_DEFAULT_SONNET_MODEL ||
    process.env.OPENAI_MODEL ||
    'claude-sonnet-4-6';
  // Get enableThinking from configStore
  // const enableThinking = configStore.get('enableThinking') ?? false;
  // writeMCPLog(`[Vision] configStore: ${JSON.stringify(configStore.getAll())}`);
  // writeMCPLog(`[Vision] enableThinking: ${enableThinking}`);

  if (!apiKey) {
    throw new Error('API key not configured. Please configure it in Settings.');
  }

  // console.error(`[Vision] Using model: ${model} (baseURL: ${baseUrl || 'default'}), enableThinking: ${enableThinking}`);

  // Log the prompt
  writeMCPLog(prompt, 'PROMPT');

  // Check if using OpenRouter
  const isOpenRouter =
    !!baseUrl && (baseUrl.includes('openrouter.ai') || baseUrl.includes('openrouter'));

  // Check if model/config is OpenAI-compatible (Gemini, GPT, etc.)
  const isOpenAICompatible =
    hasOpenAIConfig ||
    model.includes('gemini') ||
    model.includes('gpt-') ||
    model.includes('openai/') ||
    isOpenRouter ||
    (baseUrl ? baseUrl.includes('api.openai.com') : false);

  if (isOpenAICompatible) {
    // Use OpenAI-compatible API format (for Gemini, GPT, etc. via OpenRouter)
    const openAIBaseUrl = baseUrl || 'https://api.openai.com/v1';
    const openAIUrl = openAIBaseUrl.endsWith('/v1')
      ? `${openAIBaseUrl}/chat/completions`
      : `${openAIBaseUrl}/v1/chat/completions`;

    // Use Node.js built-in https module for better compatibility
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const https = require('https');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const http = require('http');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const url = require('url');

    const urlObj = new url.URL(openAIUrl);
    const isHttps = urlObj.protocol === 'https:';
    const httpModule = isHttps ? https : http;

    // Build request body with optional reasoning parameter for OpenRouter
    const requestBodyObj: Record<string, unknown> = {
      model: model,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: {
                url: `data:image/png;base64,${base64Image}`,
              },
            },
            {
              type: 'text',
              text: prompt,
            },
          ],
        },
      ],
      max_tokens: maxTokens,
    };

    // For OpenRouter: control reasoning/thinking based on settings
    // When enableThinking is false, set effort to 'none' to disable extended thinking
    // if (isOpenRouter && !enableThinking) {
    //   requestBodyObj.reasoning = { effort: 'none' };
    // }

    const requestBody = JSON.stringify(requestBodyObj);

    const headers: Record<string, string | number> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'Content-Length': Buffer.byteLength(requestBody),
    };

    if (isOpenRouter) {
      headers['HTTP-Referer'] = 'https://github.com/OpenCoworkAI/open-cowork';
      headers['X-Title'] = 'Open Cowork';
    }

    return new Promise<string>((resolve, reject) => {
      const options = {
        hostname: urlObj.hostname,
        port: urlObj.port || (isHttps ? 443 : 80),
        path: urlObj.pathname + urlObj.search,
        method: 'POST',
        headers: headers,
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const req = httpModule.request(options, (res: any) => {
        let data = '';

        res.on('data', (chunk: Buffer) => {
          data += chunk.toString();
        });

        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            try {
              const jsonData = JSON.parse(data);
              const responseContent = jsonData.choices[0]?.message?.content || '';

              // Log the response
              writeMCPLog(JSON.stringify(jsonData), 'RESPONSE');

              resolve(responseContent);
            } catch (e: unknown) {
              reject(
                new Error(
                  `Failed to parse API response: ${e instanceof Error ? e.message : String(e)}`
                )
              );
            }
          } else {
            reject(
              new Error(`API request failed: ${res.statusCode} ${res.statusMessage} - ${data}`)
            );
          }
        });
      });

      req.on('error', (error: Error) => {
        reject(new Error(`API request error: ${error.message}`));
      });

      req.write(requestBody);
      req.end();
    });
  } else {
    // Use Anthropic API format
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Anthropic = require('@anthropic-ai/sdk');
    const anthropic = new Anthropic({
      apiKey: apiKey,
      baseURL: baseUrl,
    });

    const message = await anthropic.messages.create({
      model: model,
      max_tokens: maxTokens,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/png',
                data: base64Image,
              },
            },
            {
              type: 'text',
              text: prompt,
            },
          ],
        },
      ],
    });

    const responseContent = message.content[0].type === 'text' ? message.content[0].text : '';

    // Log the response
    writeMCPLog(responseContent, 'RESPONSE');

    return responseContent;
  }
}

// Helper: Get actual screen dimensions
export async function getScreenDimensions(): Promise<{ width: number; height: number }> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const platform = require('os').platform();

    // For Docker mode, use the configured Xvfb resolution
    if (currentGUIApp?.isDocker) {
      // Default Xvfb resolution is 1024x768
      writeMCPLog('[Vision] Using Docker Xvfb resolution: 1024x768');
      return { width: 1024, height: 768 };
    }

    if (platform === 'darwin') {
      // macOS: Use system_profiler to get display resolution
      try {
        const { stdout } = await executeCommand(
          `system_profiler SPDisplaysDataType | grep Resolution`
        );
        const match = stdout.match(/(\d+)\s*x\s*(\d+)/);
        if (match) {
          return { width: parseInt(match[1]), height: parseInt(match[2]) };
        }
      } catch (e) {
        writeMCPLog('[Vision] Failed to get macOS screen resolution, using default');
      }
    } else if (platform === 'linux') {
      // Linux: Use xdpyinfo or xrandr
      try {
        const { stdout } = await executeCommand(`xdpyinfo | grep dimensions`);
        const match = stdout.match(/(\d+)x(\d+)/);
        if (match) {
          return { width: parseInt(match[1]), height: parseInt(match[2]) };
        }
      } catch (e) {
        try {
          const { stdout } = await executeCommand(`xrandr | grep '*' | awk '{print $1}'`);
          const match = stdout.match(/(\d+)x(\d+)/);
          if (match) {
            return { width: parseInt(match[1]), height: parseInt(match[2]) };
          }
        } catch (e2) {
          writeMCPLog('[Vision] Failed to get Linux screen resolution, using default');
        }
      }
    }

    // Fallback: common default
    writeMCPLog('[Vision] Using default screen resolution: 1920x1080');
    return { width: 1920, height: 1080 };
  } catch (error: unknown) {
    writeMCPLog(
      `[Vision] Error getting screen dimensions: ${error instanceof Error ? error.message : String(error)}`
    );
    return { width: 1920, height: 1080 };
  }
}

// Helper: Get image dimensions
export async function getImageDimensions(
  imagePath: string
): Promise<{ width: number; height: number }> {
  try {
    // Use sips on macOS or identify on Linux to get image dimensions
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const platform = require('os').platform();

    if (platform === 'darwin') {
      const { stdout } = await executeCommand(`sips -g pixelWidth -g pixelHeight "${imagePath}"`);
      const widthMatch = stdout.match(/pixelWidth:\s*(\d+)/);
      const heightMatch = stdout.match(/pixelHeight:\s*(\d+)/);

      if (widthMatch && heightMatch) {
        return {
          width: parseInt(widthMatch[1]),
          height: parseInt(heightMatch[1]),
        };
      }
    } else {
      // Try ImageMagick's identify command
      try {
        const { stdout } = await executeCommand(`identify -format "%w %h" "${imagePath}"`);
        const [width, height] = stdout.trim().split(' ').map(Number);
        if (width && height) {
          return { width, height };
        }
      } catch (e) {
        // Fallback: read PNG header manually
      }
    }

    // Fallback: read PNG dimensions from file header
    const buffer = await fs.readFile(imagePath);
    if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
      // PNG file
      const width = buffer.readUInt32BE(16);
      const height = buffer.readUInt32BE(20);
      return { width, height };
    }

    throw new Error('Could not determine image dimensions');
  } catch (error: unknown) {
    writeMCPLog(
      `[Vision] Error getting image dimensions: ${error instanceof Error ? error.message : String(error)}`
    );
    // Return screen dimensions as fallback
    return await getScreenDimensions();
  }
}

// Helper: Analyze and build screen context (comprehensive UI understanding)
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

    currentScreenContext = context;

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

// Helper: Bring window to front and focus
export async function focusApplicationWindow(appName?: string): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const platform = require('os').platform();

  writeMCPLog(
    `[GUI] Attempting to bring window to front (platform: ${platform}, appName: ${appName || 'auto-detect'})`
  );

  try {
    if (platform === 'darwin') {
      // macOS: Use AppleScript via osascript (no shell interpolation)
      writeMCPLog('[GUI] Using macOS AppleScript to focus window...');

      if (appName) {
        const { stdout, stderr } = await execFileAsync(
          '/usr/bin/osascript',
          ['-e', `tell application "${appName}" to activate`],
          { timeout: 10000 }
        );
        writeMCPLog(`[GUI] AppleScript result - stdout: ${stdout}, stderr: ${stderr}`);
      } else {
        // Try multiple approaches to find and focus Python windows
        try {
          // Approach 1: Find process by name containing "Python"
          const { stdout, stderr } = await execFileAsync(
            '/usr/bin/osascript',
            [
              '-e',
              'tell application "System Events" to set frontmost of first process whose name contains "Python" to true',
            ],
            { timeout: 10000 }
          );
          writeMCPLog(`[GUI] AppleScript (Python) result - stdout: ${stdout}, stderr: ${stderr}`);
        } catch (err1: unknown) {
          writeMCPLog(
            `[GUI] Failed to focus Python process: ${err1 instanceof Error ? err1.message : String(err1)}`
          );

          // Approach 2: Try to find any Python-related window
          try {
            await execFileAsync(
              '/usr/bin/osascript',
              [
                '-e',
                'tell application "System Events" to set frontmost of first process whose unix id is greater than 0 and name contains "python" to true',
              ],
              { timeout: 10000 }
            );
            writeMCPLog('[GUI] Successfully focused python process (lowercase)');
          } catch (err2: unknown) {
            writeMCPLog(
              `[GUI] Failed to focus python process: ${err2 instanceof Error ? err2.message : String(err2)}`
            );

            // Approach 3: Get the PID and focus by PID
            if (currentGUIApp && currentGUIApp.pid) {
              try {
                await execFileAsync(
                  '/usr/bin/osascript',
                  [
                    '-e',
                    `tell application "System Events" to set frontmost of first process whose unix id is ${currentGUIApp.pid} to true`,
                  ],
                  { timeout: 10000 }
                );
                writeMCPLog(`[GUI] Successfully focused process by PID: ${currentGUIApp.pid}`);
              } catch (err3: unknown) {
                writeMCPLog(
                  `[GUI] Failed to focus by PID: ${err3 instanceof Error ? err3.message : String(err3)}`
                );
              }
            }
          }
        }
      }
    } else if (platform === 'win32') {
      // Windows: Use PowerShell to bring window to front
      writeMCPLog('[GUI] Using Windows PowerShell to focus window...');

      const script = appName
        ? `Add-Type @"\nusing System;\nusing System.Runtime.InteropServices;\npublic class Win32 {\n  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);\n  [DllImport("user32.dll")] public static extern IntPtr FindWindow(string lpClassName, string lpWindowName);\n}\n"@; $hwnd = [Win32]::FindWindow($null, "${appName}"); [Win32]::SetForegroundWindow($hwnd)`
        : `Add-Type @"\nusing System;\nusing System.Runtime.InteropServices;\npublic class Win32 {\n  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();\n  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);\n}\n"@; $hwnd = [Win32]::GetForegroundWindow(); [Win32]::SetForegroundWindow($hwnd)`;

      const { stdout, stderr } = await execFileAsync('powershell', ['-Command', script], {
        timeout: 10000,
      });
      writeMCPLog(`[GUI] PowerShell result - stdout: ${stdout}, stderr: ${stderr}`);
    } else {
      // Linux: Use xdotool (safe: arguments passed as array, no shell)
      writeMCPLog('[GUI] Using Linux xdotool to focus window...');

      try {
        if (appName) {
          const { stdout, stderr } = await execFileAsync(
            'xdotool',
            ['search', '--name', appName, 'windowactivate'],
            { timeout: 10000 }
          );
          writeMCPLog(`[GUI] xdotool result - stdout: ${stdout}, stderr: ${stderr}`);
        } else {
          const { stdout, stderr } = await execFileAsync(
            'xdotool',
            ['search', '--class', 'python', 'windowactivate'],
            { timeout: 10000 }
          );
          writeMCPLog(`[GUI] xdotool result - stdout: ${stdout}, stderr: ${stderr}`);
        }
      } catch (err: unknown) {
        writeMCPLog(
          `[GUI] xdotool not available or failed: ${err instanceof Error ? err.message : String(err)}`
        );
        writeMCPLog('[GUI] Please install xdotool: sudo apt-get install xdotool');
      }
    }

    writeMCPLog('[GUI] Window focus command executed successfully');
  } catch (error: unknown) {
    writeMCPLog(
      `[GUI] Failed to focus window: ${error instanceof Error ? error.message : String(error)}`
    );
    writeMCPLog(
      '[GUI] Window may still be in background - screenshots might capture wrong content'
    );
  }
}

// Helper: Execute GUI interaction with vision-based element location (using cliclick)
export async function executeGUIInteractionWithVision(
  action: string,
  elementDescription: string,
  value?: string,
  _timeout: number = 5000
): Promise<Record<string, unknown>> {
  if (!currentGUIApp) {
    throw new Error('No GUI application is running');
  }

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const platform = require('os').platform();
  const screenshotPath = path.join(WORKSPACE_DIR, 'gui_screenshot.png');

  try {
    // Step 0: Bring window to front before taking screenshot (skip for Docker)
    if (!currentGUIApp.isDocker) {
      writeMCPLog('[Vision] Step 0: Bringing window to front...');
      await focusApplicationWindow();
      writeMCPLog('[Vision] Waiting 1 second for window to come to front...');
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    // Step 1: Take screenshot
    writeMCPLog('[Vision] Step 1: Taking screenshot...');
    await takeScreenshot(screenshotPath);
    writeMCPLog(`[Vision] Screenshot saved to ${screenshotPath}`);

    // Step 2: Analyze with vision model to find element
    const coords = await analyzeScreenshotWithVision(screenshotPath, elementDescription);

    if (coords.confidence < 50) {
      return {
        success: false,
        message: `Element "${elementDescription}" not found with sufficient confidence (${coords.confidence}%)`,
        suggestion: 'Try a more specific description or check if the element is visible',
      };
    }

    // Step 3: Perform action - use Docker xdotool if in Docker mode, otherwise use local tools
    if (currentGUIApp.isDocker && currentGUIApp.containerId) {
      // Docker mode: use xdotool inside container
      writeMCPLog('[Vision] Using xdotool inside Docker container...');
      switch (action) {
        case 'click':
          await executeCommand(
            `docker exec ${currentGUIApp.containerId} bash -c "DISPLAY=:99 xdotool mousemove ${coords.x} ${coords.y} click 1"`,
            WORKSPACE_DIR
          );
          await new Promise((resolve) => setTimeout(resolve, 500));
          return {
            success: true,
            action: 'click',
            element: elementDescription,
            coordinates: { x: coords.x, y: coords.y },
            confidence: coords.confidence,
            mode: 'docker',
          };
        case 'double_click':
          await executeCommand(
            `docker exec ${currentGUIApp.containerId} bash -c "DISPLAY=:99 xdotool mousemove ${coords.x} ${coords.y} click --repeat 2 1"`,
            WORKSPACE_DIR
          );
          await new Promise((resolve) => setTimeout(resolve, 500));
          return {
            success: true,
            action: 'double_click',
            element: elementDescription,
            coordinates: { x: coords.x, y: coords.y },
            confidence: coords.confidence,
            mode: 'docker',
          };
        case 'right_click':
          await executeCommand(
            `docker exec ${currentGUIApp.containerId} bash -c "DISPLAY=:99 xdotool mousemove ${coords.x} ${coords.y} click 3"`,
            WORKSPACE_DIR
          );
          await new Promise((resolve) => setTimeout(resolve, 500));
          return {
            success: true,
            action: 'right_click',
            element: elementDescription,
            coordinates: { x: coords.x, y: coords.y },
            confidence: coords.confidence,
            mode: 'docker',
          };
        case 'type':
          if (!value) {
            throw new Error('Value is required for type action');
          }
          await executeCommand(
            `docker exec ${currentGUIApp.containerId} bash -c "DISPLAY=:99 xdotool mousemove ${coords.x} ${coords.y} click 1"`,
            WORKSPACE_DIR
          );
          await new Promise((resolve) => setTimeout(resolve, 200));
          await executeCommand(
            `docker exec ${currentGUIApp.containerId} bash -c "DISPLAY=:99 xdotool type '${value.replace(/'/g, "'\\''")}'"`,
            WORKSPACE_DIR
          );
          await new Promise((resolve) => setTimeout(resolve, 500));
          return {
            success: true,
            action: 'type',
            element: elementDescription,
            value,
            coordinates: { x: coords.x, y: coords.y },
            confidence: coords.confidence,
            mode: 'docker',
          };
        case 'hover':
          await executeCommand(
            `docker exec ${currentGUIApp.containerId} bash -c "DISPLAY=:99 xdotool mousemove ${coords.x} ${coords.y}"`,
            WORKSPACE_DIR
          );
          await new Promise((resolve) => setTimeout(resolve, 500));
          return {
            success: true,
            action: 'hover',
            element: elementDescription,
            coordinates: { x: coords.x, y: coords.y },
            confidence: coords.confidence,
            mode: 'docker',
          };
        default:
          return {
            success: false,
            message: `Action '${action}' is not supported with vision-based interaction in Docker mode`,
          };
      }
    } else if (platform === 'darwin') {
      // macOS: Use cliclick
      switch (action) {
        case 'click':
          await executeCliclick(`c:${coords.x},${coords.y}`);
          await new Promise((resolve) => setTimeout(resolve, 500));

          return {
            success: true,
            action: 'click',
            element: elementDescription,
            coordinates: { x: coords.x, y: coords.y },
            confidence: coords.confidence,
          };

        case 'double_click':
          await executeCliclick(`dc:${coords.x},${coords.y}`);
          await new Promise((resolve) => setTimeout(resolve, 500));

          return {
            success: true,
            action: 'double_click',
            element: elementDescription,
            coordinates: { x: coords.x, y: coords.y },
            confidence: coords.confidence,
          };

        case 'right_click':
          await executeCliclick(`rc:${coords.x},${coords.y}`);
          await new Promise((resolve) => setTimeout(resolve, 500));

          return {
            success: true,
            action: 'right_click',
            element: elementDescription,
            coordinates: { x: coords.x, y: coords.y },
            confidence: coords.confidence,
          };

        case 'type': {
          if (!value) {
            throw new Error('Value is required for type action');
          }

          // Click first, then type
          await executeCliclick(`c:${coords.x},${coords.y}`);
          await new Promise((resolve) => setTimeout(resolve, 200));

          // Escape special characters for cliclick
          const escapedValue = value
            .replace(/\\/g, '\\\\')
            .replace(/"/g, '\\"')
            .replace(/`/g, '\\`')
            .replace(/\$\(/g, '\\$(');
          await executeCliclick(`t:"${escapedValue}"`);
          await new Promise((resolve) => setTimeout(resolve, 500));

          return {
            success: true,
            action: 'type',
            element: elementDescription,
            value,
            coordinates: { x: coords.x, y: coords.y },
            confidence: coords.confidence,
          };
        }

        case 'hover':
          await executeCliclick(`m:${coords.x},${coords.y}`);
          await new Promise((resolve) => setTimeout(resolve, 500));

          return {
            success: true,
            action: 'hover',
            element: elementDescription,
            coordinates: { x: coords.x, y: coords.y },
            confidence: coords.confidence,
          };

        default:
          return {
            success: false,
            message: `Action '${action}' is not supported with vision-based interaction`,
          };
      }
    } else if (platform === 'linux') {
      // Linux: Use xdotool
      switch (action) {
        case 'click':
          await executeCommand(`xdotool mousemove ${coords.x} ${coords.y} click 1`);
          await new Promise((resolve) => setTimeout(resolve, 500));

          return {
            success: true,
            action: 'click',
            element: elementDescription,
            coordinates: { x: coords.x, y: coords.y },
            confidence: coords.confidence,
          };

        case 'double_click':
          await executeCommand(`xdotool mousemove ${coords.x} ${coords.y} click --repeat 2 1`);
          await new Promise((resolve) => setTimeout(resolve, 500));

          return {
            success: true,
            action: 'double_click',
            element: elementDescription,
            coordinates: { x: coords.x, y: coords.y },
            confidence: coords.confidence,
          };

        case 'right_click':
          await executeCommand(`xdotool mousemove ${coords.x} ${coords.y} click 3`);
          await new Promise((resolve) => setTimeout(resolve, 500));

          return {
            success: true,
            action: 'right_click',
            element: elementDescription,
            coordinates: { x: coords.x, y: coords.y },
            confidence: coords.confidence,
          };

        case 'type':
          if (!value) {
            throw new Error('Value is required for type action');
          }

          // Click first, then type
          await executeCommand(`xdotool mousemove ${coords.x} ${coords.y} click 1`);
          await new Promise((resolve) => setTimeout(resolve, 200));
          await executeCommand(`xdotool type "${value.replace(/"/g, '\\"')}"`);
          await new Promise((resolve) => setTimeout(resolve, 500));

          return {
            success: true,
            action: 'type',
            element: elementDescription,
            value,
            coordinates: { x: coords.x, y: coords.y },
            confidence: coords.confidence,
          };

        case 'hover':
          await executeCommand(`xdotool mousemove ${coords.x} ${coords.y}`);
          await new Promise((resolve) => setTimeout(resolve, 500));

          return {
            success: true,
            action: 'hover',
            element: elementDescription,
            coordinates: { x: coords.x, y: coords.y },
            confidence: coords.confidence,
          };

        default:
          return {
            success: false,
            message: `Action '${action}' is not supported with vision-based interaction`,
          };
      }
    } else {
      // Windows: Not supported yet
      return {
        success: false,
        message: 'Vision-based interaction is not yet supported on Windows',
        suggestion: 'Use macOS (cliclick) or Linux (xdotool) for vision-based GUI automation',
      };
    }
  } catch (error: unknown) {
    return {
      success: false,
      message: `Vision-based interaction failed: ${error instanceof Error ? error.message : String(error)}`,
      suggestion:
        platform === 'darwin'
          ? 'Check if cliclick is installed (brew install cliclick) and the element description is accurate'
          : 'Check if xdotool is installed (sudo apt-get install xdotool) and the element description is accurate',
    };
  }
}

// Helper: Execute GUI interaction (using cliclick/xdotool for direct coordinate-based actions)
export async function executeGUIInteraction(
  action: string,
  x?: number,
  y?: number,
  value?: string,
  timeout: number = 5000
): Promise<Record<string, unknown>> {
  if (!currentGUIApp) {
    throw new Error('No GUI application is running');
  }

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const platform = require('os').platform();

  try {
    // If Docker mode, execute actions inside container using xdotool
    if (currentGUIApp.isDocker && currentGUIApp.containerId) {
      writeMCPLog('[GUI] Executing action in Docker container...');
      switch (action) {
        case 'click':
          if (x !== undefined && y !== undefined) {
            await executeCommand(
              `docker exec ${currentGUIApp.containerId} bash -c "DISPLAY=:99 xdotool mousemove ${x} ${y} click 1"`,
              WORKSPACE_DIR
            );
          } else {
            await executeCommand(
              `docker exec ${currentGUIApp.containerId} bash -c "DISPLAY=:99 xdotool click 1"`,
              WORKSPACE_DIR
            );
          }
          await new Promise((resolve) => setTimeout(resolve, 500));
          return { success: true, action: 'click', coordinates: { x, y }, mode: 'docker' };

        case 'double_click':
          if (x !== undefined && y !== undefined) {
            await executeCommand(
              `docker exec ${currentGUIApp.containerId} bash -c "DISPLAY=:99 xdotool mousemove ${x} ${y} click --repeat 2 1"`,
              WORKSPACE_DIR
            );
          } else {
            await executeCommand(
              `docker exec ${currentGUIApp.containerId} bash -c "DISPLAY=:99 xdotool click --repeat 2 1"`,
              WORKSPACE_DIR
            );
          }
          await new Promise((resolve) => setTimeout(resolve, 500));
          return { success: true, action: 'double_click', coordinates: { x, y }, mode: 'docker' };

        case 'right_click':
          if (x !== undefined && y !== undefined) {
            await executeCommand(
              `docker exec ${currentGUIApp.containerId} bash -c "DISPLAY=:99 xdotool mousemove ${x} ${y} click 3"`,
              WORKSPACE_DIR
            );
          } else {
            await executeCommand(
              `docker exec ${currentGUIApp.containerId} bash -c "DISPLAY=:99 xdotool click 3"`,
              WORKSPACE_DIR
            );
          }
          await new Promise((resolve) => setTimeout(resolve, 500));
          return { success: true, action: 'right_click', coordinates: { x, y }, mode: 'docker' };

        case 'move':
          if (x !== undefined && y !== undefined) {
            await executeCommand(
              `docker exec ${currentGUIApp.containerId} bash -c "DISPLAY=:99 xdotool mousemove ${x} ${y}"`,
              WORKSPACE_DIR
            );
            await new Promise((resolve) => setTimeout(resolve, 200));
            return { success: true, action: 'move', coordinates: { x, y }, mode: 'docker' };
          } else {
            return { success: false, message: 'Coordinates required for move action' };
          }

        case 'type': {
          if (!value) {
            return { success: false, message: 'Value required for type action' };
          }
          const escapedValueDocker = value.replace(/'/g, "'\\''");
          await executeCommand(
            `docker exec ${currentGUIApp.containerId} bash -c "DISPLAY=:99 xdotool type '${escapedValueDocker}'"`,
            WORKSPACE_DIR
          );
          await new Promise((resolve) => setTimeout(resolve, 500));
          return { success: true, action: 'type', value, mode: 'docker' };
        }

        case 'key':
          if (!value) {
            return { success: false, message: 'Key required for key action' };
          }
          // Validate key name: only allow alphanumeric, +, -, _, and spaces (for key combinations)
          if (!/^[a-zA-Z0-9_+\-\s]+$/.test(value)) {
            return {
              success: false,
              message: `Invalid key value: "${value}". Only alphanumeric, +, -, _, and space characters are allowed.`,
            };
          }
          await executeCommand(
            `docker exec ${currentGUIApp.containerId} bash -c "DISPLAY=:99 xdotool key ${value}"`,
            WORKSPACE_DIR
          );
          await new Promise((resolve) => setTimeout(resolve, 500));
          return { success: true, action: 'key', key: value, mode: 'docker' };

        case 'drag': {
          if (!value) {
            return {
              success: false,
              message: 'Coordinates required for drag action (format: "x1,y1,x2,y2")',
            };
          }
          const [x1, y1, x2, y2] = parseDragCoords(value);
          await executeCommand(
            `docker exec ${currentGUIApp.containerId} bash -c "DISPLAY=:99 xdotool mousemove ${x1} ${y1} mousedown 1 mousemove ${x2} ${y2} mouseup 1"`,
            WORKSPACE_DIR
          );
          await new Promise((resolve) => setTimeout(resolve, 500));
          return {
            success: true,
            action: 'drag',
            from: { x: x1, y: y1 },
            to: { x: x2, y: y2 },
            mode: 'docker',
          };
        }
        case 'screenshot': {
          const screenshotPath = path.join(WORKSPACE_DIR, 'screenshot.png');
          await takeScreenshot(screenshotPath);
          return { success: true, action: 'screenshot', path: screenshotPath, mode: 'docker' };
        }
        case 'wait':
          await new Promise((resolve) => setTimeout(resolve, timeout));
          return { success: true, action: 'wait', duration: timeout, mode: 'docker' };

        default:
          return { success: false, message: `Action '${action}' is not supported in Docker mode` };
      }
    }

    // Local mode: Bring window to front first
    await focusApplicationWindow();
    await new Promise((resolve) => setTimeout(resolve, 500));

    if (platform === 'darwin') {
      // macOS: Use cliclick
      switch (action) {
        case 'click':
          if (x !== undefined && y !== undefined) {
            await executeCliclick(`c:${x},${y}`);
          } else {
            await executeCliclick('c:.');
          }
          await new Promise((resolve) => setTimeout(resolve, 500));
          return { success: true, action: 'click', coordinates: { x, y } };

        case 'double_click':
          if (x !== undefined && y !== undefined) {
            await executeCliclick(`dc:${x},${y}`);
          } else {
            await executeCliclick('dc:.');
          }
          await new Promise((resolve) => setTimeout(resolve, 500));
          return { success: true, action: 'double_click', coordinates: { x, y } };

        case 'right_click':
          if (x !== undefined && y !== undefined) {
            await executeCliclick(`rc:${x},${y}`);
          } else {
            await executeCliclick('rc:.');
          }
          await new Promise((resolve) => setTimeout(resolve, 500));
          return { success: true, action: 'right_click', coordinates: { x, y } };

        case 'move':
          if (x !== undefined && y !== undefined) {
            await executeCliclick(`m:${x},${y}`);
            await new Promise((resolve) => setTimeout(resolve, 200));
            return { success: true, action: 'move', coordinates: { x, y } };
          } else {
            return { success: false, message: 'Coordinates required for move action' };
          }

        case 'type': {
          if (!value) {
            return { success: false, message: 'Value required for type action' };
          }
          const escapedValue = value.replace(/"/g, '\\"');
          await executeCliclick(`t:"${escapedValue}"`);
          await new Promise((resolve) => setTimeout(resolve, 500));
          return { success: true, action: 'type', value };
        }
        case 'key':
          if (!value) {
            return { success: false, message: 'Key required for key action' };
          }
          await executeCliclick(`kp:${value}`);
          await new Promise((resolve) => setTimeout(resolve, 500));
          return { success: true, action: 'key', key: value };

        case 'drag': {
          // value should be "x1,y1,x2,y2"
          if (!value) {
            return {
              success: false,
              message: 'Coordinates required for drag action (format: "x1,y1,x2,y2")',
            };
          }
          const [x1, y1, x2, y2] = parseDragCoords(value);
          await executeCliclick(`dd:${x1},${y1} m:${x2},${y2} du:${x2},${y2}`);
          await new Promise((resolve) => setTimeout(resolve, 500));
          return { success: true, action: 'drag', from: { x: x1, y: y1 }, to: { x: x2, y: y2 } };
        }
        case 'screenshot': {
          const screenshotPath = path.join(WORKSPACE_DIR, 'screenshot.png');
          await takeScreenshot(screenshotPath);
          return { success: true, action: 'screenshot', path: screenshotPath };
        }
        case 'wait':
          await new Promise((resolve) => setTimeout(resolve, timeout));
          return { success: true, action: 'wait', duration: timeout };

        default:
          return { success: false, message: `Action '${action}' is not supported` };
      }
    } else if (platform === 'linux') {
      // Linux: Use xdotool
      switch (action) {
        case 'click':
          if (x !== undefined && y !== undefined) {
            await executeCommand(`xdotool mousemove ${x} ${y} click 1`);
          } else {
            await executeCommand('xdotool click 1');
          }
          await new Promise((resolve) => setTimeout(resolve, 500));
          return { success: true, action: 'click', coordinates: { x, y } };

        case 'double_click':
          if (x !== undefined && y !== undefined) {
            await executeCommand(`xdotool mousemove ${x} ${y} click --repeat 2 1`);
          } else {
            await executeCommand('xdotool click --repeat 2 1');
          }
          await new Promise((resolve) => setTimeout(resolve, 500));
          return { success: true, action: 'double_click', coordinates: { x, y } };

        case 'right_click':
          if (x !== undefined && y !== undefined) {
            await executeCommand(`xdotool mousemove ${x} ${y} click 3`);
          } else {
            await executeCommand('xdotool click 3');
          }
          await new Promise((resolve) => setTimeout(resolve, 500));
          return { success: true, action: 'right_click', coordinates: { x, y } };

        case 'move':
          if (x !== undefined && y !== undefined) {
            await executeCommand(`xdotool mousemove ${x} ${y}`);
            await new Promise((resolve) => setTimeout(resolve, 200));
            return { success: true, action: 'move', coordinates: { x, y } };
          } else {
            return { success: false, message: 'Coordinates required for move action' };
          }

        case 'type':
          if (!value) {
            return { success: false, message: 'Value required for type action' };
          }
          await executeCommand(`xdotool type "${value.replace(/"/g, '\\"')}"`);
          await new Promise((resolve) => setTimeout(resolve, 500));
          return { success: true, action: 'type', value };

        case 'key':
          if (!value) {
            return { success: false, message: 'Key required for key action' };
          }
          // Validate key name: only allow alphanumeric, +, -, _, and spaces (for key combinations)
          if (!/^[a-zA-Z0-9_+\-\s]+$/.test(value)) {
            return {
              success: false,
              message: `Invalid key value: "${value}". Only alphanumeric, +, -, _, and space characters are allowed.`,
            };
          }
          await executeCommand(`xdotool key ${value}`);
          await new Promise((resolve) => setTimeout(resolve, 500));
          return { success: true, action: 'key', key: value };

        case 'drag': {
          if (!value) {
            return {
              success: false,
              message: 'Coordinates required for drag action (format: "x1,y1,x2,y2")',
            };
          }
          const [x1, y1, x2, y2] = parseDragCoords(value);
          await executeCommand(
            `xdotool mousemove ${x1} ${y1} mousedown 1 mousemove ${x2} ${y2} mouseup 1`
          );
          await new Promise((resolve) => setTimeout(resolve, 500));
          return { success: true, action: 'drag', from: { x: x1, y: y1 }, to: { x: x2, y: y2 } };
        }
        case 'screenshot': {
          const screenshotPath = path.join(WORKSPACE_DIR, 'screenshot.png');
          await takeScreenshot(screenshotPath);
          return { success: true, action: 'screenshot', path: screenshotPath };
        }

        case 'wait':
          await new Promise((resolve) => setTimeout(resolve, timeout));
          return { success: true, action: 'wait', duration: timeout };

        default:
          return { success: false, message: `Action '${action}' is not supported` };
      }
    } else {
      // Windows: Not fully supported yet
      return {
        success: false,
        message: 'Direct GUI interaction is not yet fully supported on Windows',
        suggestion:
          'Use macOS (cliclick) or Linux (xdotool) for GUI automation, or use vision-based interaction',
      };
    }
  } catch (error: unknown) {
    return {
      success: false,
      message: `GUI interaction failed: ${error instanceof Error ? error.message : String(error)}`,
      suggestion:
        platform === 'darwin'
          ? 'Check if cliclick is installed (brew install cliclick)'
          : 'Check if xdotool is installed (sudo apt-get install xdotool)',
    };
  }
}

function parseDragCoords(value: string): [number, number, number, number] {
  const parts = value.split(',').map(Number);
  if (parts.length !== 4) {
    throw new Error(
      `Drag coordinates must have exactly 4 values (x1,y1,x2,y2), got ${parts.length}`
    );
  }
  const [x1, y1, x2, y2] = parts;
  if (
    !Number.isFinite(x1) ||
    !Number.isFinite(y1) ||
    !Number.isFinite(x2) ||
    !Number.isFinite(y2)
  ) {
    throw new Error(`Drag coordinates must be finite numbers, got: ${value}`);
  }
  if (
    !Number.isInteger(x1) ||
    !Number.isInteger(y1) ||
    !Number.isInteger(x2) ||
    !Number.isInteger(y2)
  ) {
    throw new Error(`Drag coordinates must be integers, got: ${value}`);
  }
  return [x1, y1, x2, y2];
}
