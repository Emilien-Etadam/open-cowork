export interface HttpRequestOptions {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface HttpRequestResult {
  url: string;
  status: number;
  contentType: string;
  body: string;
  truncated: boolean;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_BODY_CHARS = 20_000;

export function parseHttpHeaders(raw: unknown): Record<string, string> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return undefined;
  }

  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof key !== 'string' || !key.trim()) {
      continue;
    }
    if (typeof value === 'string') {
      headers[key.trim()] = value;
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      headers[key.trim()] = String(value);
    }
  }

  return Object.keys(headers).length > 0 ? headers : undefined;
}

export function parseHttpRequestOptions(record: Record<string, unknown>): HttpRequestOptions {
  const url = typeof record.url === 'string' ? record.url.trim() : '';
  if (!url) {
    throw new Error('url is required');
  }

  const method =
    typeof record.method === 'string' && record.method.trim()
      ? record.method.trim().toUpperCase()
      : 'GET';

  const headers = parseHttpHeaders(record.headers);
  const body = typeof record.body === 'string' ? record.body : undefined;

  return { url, method, headers, body };
}

export async function executeHttpRequest(options: HttpRequestOptions): Promise<HttpRequestResult> {
  let parsed: URL;
  try {
    parsed = new URL(options.url.trim());
  } catch {
    throw new Error('Invalid URL');
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Only http/https URLs are supported');
  }

  const method = (options.method || 'GET').toUpperCase();
  const headers: Record<string, string> = {
    'User-Agent': 'lygodactylus',
    ...(options.headers || {}),
  };

  const hasBody = options.body !== undefined && options.body.length > 0;
  if (hasBody && !headers['Content-Type'] && !headers['content-type']) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(parsed.toString(), {
    method,
    headers,
    body: hasBody && method !== 'GET' && method !== 'HEAD' ? options.body : undefined,
    signal: options.signal ?? AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
  });

  const contentType = response.headers.get('content-type') || 'unknown';
  const rawBody = await response.text();
  const truncated = rawBody.length > MAX_BODY_CHARS;
  const body = truncated
    ? `${rawBody.slice(0, MAX_BODY_CHARS)}\n\n[Truncated ${rawBody.length - MAX_BODY_CHARS} chars]`
    : rawBody;

  if (!response.ok) {
    throw new Error(
      `Request failed with status ${response.status}\nContent-Type: ${contentType}\n\n${body}`
    );
  }

  return {
    url: parsed.toString(),
    status: response.status,
    contentType,
    body,
    truncated,
  };
}

export function formatHttpRequestResult(result: HttpRequestResult): string {
  return `URL: ${result.url}\nStatus: ${result.status}\nContent-Type: ${result.contentType}\n\n${result.body}`;
}
