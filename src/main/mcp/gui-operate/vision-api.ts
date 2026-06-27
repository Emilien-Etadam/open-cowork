import { writeMCPLog } from '../mcp-logger.js';

import { OPENAI_PLATFORM_BASE_URL } from './constants.js';

/**
 * Call vision API to analyze images with timeout and retry.
 */
export async function callVisionAPI(
  base64Image: string,
  prompt: string,
  maxTokens: number = 2048,
  functionName?: string
): Promise<string> {
  const MAX_RETRIES = 3;
  const TIMEOUT_MS = 90000;

  const logPrefix = functionName ? `[callVisionAPI:${functionName}]` : '[callVisionAPI]';
  let compatibilityFallbackUsed = false;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      writeMCPLog(
        `${logPrefix} Attempt ${attempt}/${MAX_RETRIES} - Starting API call`,
        'API Request'
      );

      const result = await callVisionAPIWithTimeout(
        base64Image,
        prompt,
        maxTokens,
        functionName,
        TIMEOUT_MS
      );

      writeMCPLog(`${logPrefix} Attempt ${attempt}/${MAX_RETRIES} - Success`, 'API Request');
      return result;
    } catch (error: unknown) {
      const isLastAttempt = attempt === MAX_RETRIES;
      const errorMessage = String(error instanceof Error ? error.message : error || '');

      if (isVisionRequestShapeError(errorMessage)) {
        if (!compatibilityFallbackUsed) {
          compatibilityFallbackUsed = true;
          writeMCPLog(
            `${logPrefix} Attempt ${attempt}/${MAX_RETRIES} - Request-shape error detected, running one compatibility fallback: ${errorMessage}`,
            'API Request Error'
          );
          try {
            const compatResult = await callVisionAPIWithTimeout(
              base64Image,
              prompt,
              maxTokens,
              functionName,
              TIMEOUT_MS,
              true,
              errorMessage
            );
            writeMCPLog(`${logPrefix} Compatibility fallback succeeded`, 'API Request');
            return compatResult;
          } catch (compatError: unknown) {
            const compatMessage = String(
              compatError instanceof Error ? compatError.message : compatError || ''
            );
            writeMCPLog(
              `${logPrefix} Compatibility fallback failed: ${compatMessage}`,
              'API Request Error'
            );
            throw new Error(compatMessage || errorMessage);
          }
        }
        writeMCPLog(
          `${logPrefix} Attempt ${attempt}/${MAX_RETRIES} - Deterministic error, stop retry: ${errorMessage}`,
          'API Request Error'
        );
        throw new Error(errorMessage);
      }

      if (errorMessage.includes('timeout')) {
        writeMCPLog(
          `${logPrefix} Attempt ${attempt}/${MAX_RETRIES} - Timeout after ${TIMEOUT_MS}ms`,
          'API Request Error'
        );
      } else {
        writeMCPLog(
          `${logPrefix} Attempt ${attempt}/${MAX_RETRIES} - Error: ${errorMessage}`,
          'API Request Error'
        );
      }

      if (isLastAttempt) {
        writeMCPLog(`${logPrefix} All ${MAX_RETRIES} attempts failed`, 'API Request Failed');
        throw new Error(`Vision API failed after ${MAX_RETRIES} attempts: ${errorMessage}`);
      }

      const waitTime = Math.pow(2, attempt - 1) * 1000;
      writeMCPLog(`${logPrefix} Waiting ${waitTime}ms before retry...`, 'API Request Retry');
      await new Promise((resolve) => setTimeout(resolve, waitTime));
    }
  }

  throw new Error('Vision API failed: Maximum retries exceeded');
}

export function isVisionRequestShapeError(errorMessage: string): boolean {
  if (!errorMessage) {
    return false;
  }
  return (
    errorMessage.includes('Unsupported parameter') ||
    errorMessage.includes('Instructions are required') ||
    errorMessage.includes('Stream must be set to true')
  );
}

export function getBaseUrlHost(baseUrl: string | undefined): string {
  if (!baseUrl) {
    return '(unset)';
  }
  try {
    return new URL(baseUrl).host || '(unknown)';
  } catch {
    return '(invalid-url)';
  }
}

export function buildVisionRuntimeSummary(
  functionName: string | undefined,
  anthropicApiKey: string | undefined,
  openAIApiKey: string | undefined,
  baseUrl: string | undefined,
  model: string,
  isOpenAICompatible: boolean,
  compatibilityMode: boolean
): Record<string, unknown> {
  return {
    functionName: functionName || '(unknown)',
    hasAnthropicApiKey: Boolean(anthropicApiKey),
    hasOpenAIApiKey: Boolean(openAIApiKey),
    hasAnyApiKey: Boolean(anthropicApiKey || openAIApiKey),
    baseUrlHost: getBaseUrlHost(baseUrl),
    model,
    isOpenAICompatible,
    compatibilityMode,
  };
}

export function pickVisionApiKey(
  selectedRoute: 'openai-chat-completions' | 'anthropic-messages',
  anthropicApiKey: string | undefined,
  openAIApiKey: string | undefined,
  isOpenRouter: boolean
): string | undefined {
  if (selectedRoute === 'anthropic-messages') {
    return anthropicApiKey;
  }
  if (isOpenRouter) {
    return anthropicApiKey || openAIApiKey;
  }
  return openAIApiKey;
}

/**
 * Call vision API with timeout.
 */
export async function callVisionAPIWithTimeout(
  base64Image: string,
  prompt: string,
  maxTokens: number,
  functionName: string | undefined,
  timeoutMs: number,
  compatibilityMode: boolean = false,
  previousErrorMessage?: string
): Promise<string> {
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN;
  const openAIApiKey = process.env.OPENAI_API_KEY;
  const openAIBaseUrl = process.env.OPENAI_BASE_URL?.trim();
  const anthropicBaseUrl = process.env.ANTHROPIC_BASE_URL?.trim();
  const openAIModel = process.env.OPENAI_MODEL?.trim();
  const anthropicModel =
    process.env.CLAUDE_MODEL?.trim() || process.env.ANTHROPIC_DEFAULT_SONNET_MODEL?.trim();
  const hasOpenAIConfig = Boolean(openAIBaseUrl || openAIModel);
  const baseUrl = openAIBaseUrl || anthropicBaseUrl;
  const model = openAIModel || anthropicModel || 'claude-sonnet-4-6';

  const isOpenRouter =
    !!baseUrl && (baseUrl.includes('openrouter.ai') || baseUrl.includes('openrouter'));

  const isOpenAICompatible =
    hasOpenAIConfig ||
    model.includes('gemini') ||
    model.includes('gpt-') ||
    model.includes('openai/') ||
    isOpenRouter ||
    (baseUrl ? baseUrl.includes('api.openai.com') : false);

  const runtimeSummary = buildVisionRuntimeSummary(
    functionName,
    anthropicApiKey,
    openAIApiKey,
    baseUrl,
    model,
    isOpenAICompatible,
    compatibilityMode
  );
  writeMCPLog(JSON.stringify(runtimeSummary), 'Vision Runtime');

  const selectedRoute = isOpenAICompatible ? 'openai-chat-completions' : 'anthropic-messages';
  writeMCPLog(
    `[Vision Routing] function=${functionName || '(unknown)'} route=${selectedRoute} host=${getBaseUrlHost(baseUrl)} model=${model}${previousErrorMessage ? ` previousError=${previousErrorMessage}` : ''}`,
    'Vision Routing'
  );

  const selectedApiKey = pickVisionApiKey(
    selectedRoute,
    anthropicApiKey,
    openAIApiKey,
    isOpenRouter
  );
  if (!selectedApiKey) {
    if (selectedRoute === 'anthropic-messages') {
      throw new Error(
        'Anthropic API key not configured. Please set ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN.'
      );
    }
    throw new Error('OpenAI API key not configured for vision route. Please set OPENAI_API_KEY.');
  }

  if (isOpenAICompatible) {
    const openAIBaseUrl = baseUrl || OPENAI_PLATFORM_BASE_URL;
    const openAIUrl = openAIBaseUrl.endsWith('/v1')
      ? `${openAIBaseUrl}/chat/completions`
      : `${openAIBaseUrl}/v1/chat/completions`;

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const https = require('https');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const http = require('http');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const url = require('url');

    const urlObj = new url.URL(openAIUrl);
    const isHttps = urlObj.protocol === 'https:';
    const httpModule = isHttps ? https : http;

    const requestBodyObj: Record<string, unknown> = {
      model,
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

    const requestBody = JSON.stringify(requestBodyObj);

    const headers: Record<string, string | number> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${selectedApiKey}`,
      'Content-Length': Buffer.byteLength(requestBody),
    };

    if (isOpenRouter) {
      headers['HTTP-Referer'] = 'https://github.com/Emilien-Etadam/lygodactylus';
      headers['X-Title'] = 'Lygodactylus';
    }

    return new Promise<string>((resolve, reject) => {
      let isResolved = false;

      const options = {
        hostname: urlObj.hostname,
        port: urlObj.port || (isHttps ? 443 : 80),
        path: urlObj.pathname + urlObj.search,
        method: 'POST',
        headers,
        timeout: timeoutMs,
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const req = httpModule.request(options, (res: any) => {
        let data = '';

        res.on('data', (chunk: Buffer) => {
          data += chunk.toString();
        });

        res.on('end', () => {
          if (isResolved) return;
          clearTimeout(timeoutId);

          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            try {
              writeMCPLog(
                `[callVisionAPIWithTimeout] Response received, length: ${data.length}`,
                'API Response'
              );
              const jsonData = JSON.parse(data);
              const responseContent = jsonData.choices[0]?.message?.content || '';

              const logLabel = functionName
                ? `Vision API Response [${functionName}]`
                : 'Vision API Response';
              writeMCPLog(responseContent, logLabel);

              isResolved = true;
              resolve(responseContent);
            } catch (e: unknown) {
              isResolved = true;
              reject(
                new Error(
                  `Failed to parse API response: ${e instanceof Error ? e.message : String(e)}`
                )
              );
            }
          } else {
            isResolved = true;
            reject(
              new Error(`API request failed: ${res.statusCode} ${res.statusMessage} - ${data}`)
            );
          }
        });
      });

      const timeoutId = setTimeout(() => {
        if (!isResolved) {
          isResolved = true;
          req.destroy();
          reject(new Error(`API request timeout after ${timeoutMs}ms`));
        }
      }, timeoutMs);

      req.on('error', (error: Error) => {
        if (isResolved) return;
        clearTimeout(timeoutId);
        isResolved = true;
        reject(new Error(`API request error: ${error.message}`));
      });

      req.on('timeout', () => {
        if (isResolved) return;
        clearTimeout(timeoutId);
        isResolved = true;
        req.destroy();
        reject(new Error(`API request timeout after ${timeoutMs}ms`));
      });

      req.write(requestBody);
      req.end();
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Anthropic = require('@anthropic-ai/sdk');
  const anthropicRouteBaseUrl = anthropicBaseUrl || baseUrl;
  const anthropicRouteModel = anthropicModel || model;
  const anthropic = new Anthropic({
    apiKey: selectedApiKey,
    baseURL: anthropicRouteBaseUrl,
    timeout: timeoutMs,
  });

  const apiCallPromise = anthropic.messages.create({
    model: anthropicRouteModel,
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

  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      reject(new Error(`API request timeout after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    const message = await Promise.race([apiCallPromise, timeoutPromise]);

    const responseContent = message.content[0].type === 'text' ? message.content[0].text : '';

    const logLabel = functionName ? `Vision API Response [${functionName}]` : 'Vision API Response';
    writeMCPLog(responseContent, logLabel);
    writeMCPLog(
      `[callVisionAPIWithTimeout] Response received, length: ${responseContent.length}`,
      'API Response'
    );

    return responseContent;
  } catch (error: unknown) {
    if (error instanceof Error && error.message.includes('timeout')) {
      throw new Error(`API request timeout after ${timeoutMs}ms`);
    }
    throw error;
  }
}
