import { writeMCPLog } from '../mcp-logger.js';

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
