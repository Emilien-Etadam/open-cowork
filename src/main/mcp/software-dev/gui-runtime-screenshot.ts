import * as fs from 'fs/promises';

import { writeMCPLog } from '../mcp-logger.js';
import { WORKSPACE_DIR, executeCommand } from './file-ops.js';
import { currentGUIApp } from './gui-runtime-state.js';

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
      headers['HTTP-Referer'] = 'https://github.com/Emilien-Etadam/lygodactylus';
      headers['X-Title'] = 'Lygodactylus';
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
