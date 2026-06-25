/**
 * @module main/chat-lan-server/chat-lan-server
 *
 * LAN-only HTTP + SSE chat API (no third-party relay).
 */
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { URL } from 'url';
import { app } from 'electron';
import type { IncomingMessage, ServerResponse } from 'http';
import type { PermissionResult, ServerEvent } from '../../renderer/types';
import { log, logError } from '../utils/logger';
import { mainAppState } from '../main-app-state';
import { configStore } from '../config/config-store';
import { getWorkingDir, getWorkspacePathUnsupportedReason } from '../main-working-dir';
import { chatLanConfigStore } from './chat-lan-config-store';
import { subscribeChatLanEvents } from './chat-lan-event-bus';

const BIND_HOST = '0.0.0.0';

export interface ChatLanStatus {
  running: boolean;
  port: number;
  enabled: boolean;
  urls: string[];
}

let server: http.Server | null = null;
let unsubscribeEvents: (() => void) | null = null;
const sseClients = new Set<ServerResponse>();

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}

function getTokenFromRequest(req: IncomingMessage, url: URL): string | null {
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) {
    return auth.slice('Bearer '.length).trim();
  }
  const queryToken = url.searchParams.get('token');
  return queryToken?.trim() || null;
}

function isAuthorized(req: IncomingMessage, url: URL): boolean {
  const expected = chatLanConfigStore.getAll().token;
  const provided = getTokenFromRequest(req, url);
  return Boolean(provided && expected && provided === expected);
}

function unauthorized(res: ServerResponse): void {
  json(res, 401, { error: 'unauthorized' });
}

function getLanUrls(port: number): string[] {
  const urls: string[] = [];
  const ifaces = os.networkInterfaces();
  for (const entries of Object.values(ifaces)) {
    if (!entries) continue;
    for (const entry of entries) {
      if (entry.internal || entry.family !== 'IPv4') continue;
      urls.push(`http://${entry.address}:${port}/`);
    }
  }
  return [...new Set(urls)];
}

function broadcastSse(event: ServerEvent): void {
  const data = `data: ${JSON.stringify(event)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(data);
    } catch {
      sseClients.delete(client);
    }
  }
}

/** Candidate paths for the LAN chat static UI (dev + packaged). */
export function getChatLanUiPathCandidates(options?: {
  isPackaged?: boolean;
  resourcesPath?: string;
  appPath?: string;
  cwd?: string;
  moduleDir?: string;
}): string[] {
  const isPackaged = options?.isPackaged ?? app.isPackaged;
  const resourcesPath = options?.resourcesPath ?? process.resourcesPath;
  const appPath = options?.appPath ?? app.getAppPath();
  const cwd = options?.cwd ?? process.cwd();
  const moduleDir = options?.moduleDir ?? __dirname;

  const candidates: string[] = [];

  if (isPackaged && resourcesPath) {
    candidates.push(path.join(resourcesPath, 'chat-lan', 'index.html'));
  }

  if (isPackaged) {
    candidates.push(path.join(appPath, 'resources', 'chat-lan', 'index.html'));
  }

  candidates.push(
    path.join(cwd, 'resources', 'chat-lan', 'index.html'),
    path.join(moduleDir, '../../../resources/chat-lan/index.html'),
    path.join(moduleDir, '../../../../resources/chat-lan/index.html')
  );

  return candidates;
}

function resolveChatLanUiPath(): string {
  for (const candidate of getChatLanUiPathCandidates()) {
    if (fs.existsSync(candidate)) {
      log(`[ChatLan] UI path: ${candidate}`);
      return candidate;
    }
  }
  throw new Error(
    `Chat LAN UI file not found (tried: ${getChatLanUiPathCandidates().join(', ')})`
  );
}

function serveChatUi(res: ServerResponse): void {
  try {
    const html = fs.readFileSync(resolveChatLanUiPath(), 'utf8');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(html);
  } catch (error) {
    logError('[ChatLan] Failed to load UI:', error);
    res.writeHead(500);
    res.end('Chat UI missing');
  }
}

async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  if (!isAuthorized(req, url)) {
    unauthorized(res);
    return;
  }

  const sm = mainAppState.sessionManager;
  if (!sm && url.pathname !== '/api/health') {
    json(res, 503, { error: 'session_manager_unavailable' });
    return;
  }

  const method = req.method || 'GET';
  const parts = url.pathname.split('/').filter(Boolean);

  if (method === 'GET' && url.pathname === '/api/health') {
    json(res, 200, { ok: true });
    return;
  }

  if (method === 'GET' && url.pathname === '/api/sessions') {
    json(res, 200, { sessions: sm!.listSessions() });
    return;
  }

  if (
    method === 'GET' &&
    parts[0] === 'api' &&
    parts[1] === 'sessions' &&
    parts[3] === 'messages' &&
    parts[2]
  ) {
    json(res, 200, { messages: sm!.getMessages(parts[2]) });
    return;
  }

  if (method === 'POST' && url.pathname === '/api/sessions') {
    const raw = await readBody(req);
    const body = raw ? JSON.parse(raw) : {};
    const prompt = String(body.prompt || '').trim();
    if (!prompt) {
      json(res, 400, { error: 'missing_prompt' });
      return;
    }
    if (!configStore.hasUsableCredentialsForActiveSet()) {
      json(res, 400, { error: 'api_not_configured' });
      return;
    }
    const cwd = typeof body.cwd === 'string' && body.cwd.trim() ? body.cwd.trim() : getWorkingDir();
    const unsupported = getWorkspacePathUnsupportedReason(cwd);
    if (unsupported) {
      json(res, 400, { error: unsupported });
      return;
    }
    const title =
      typeof body.title === 'string' && body.title.trim() ? body.title.trim() : prompt.slice(0, 60);
    const session = await sm!.startSession(title, prompt, cwd);
    json(res, 200, { session });
    return;
  }

  if (
    method === 'POST' &&
    parts[0] === 'api' &&
    parts[1] === 'sessions' &&
    parts[3] === 'messages' &&
    parts[2]
  ) {
    const raw = await readBody(req);
    const body = raw ? JSON.parse(raw) : {};
    const prompt = String(body.prompt || '').trim();
    if (!prompt) {
      json(res, 400, { error: 'missing_prompt' });
      return;
    }
    await sm!.continueSession(parts[2], prompt, body.content);
    json(res, 200, { ok: true });
    return;
  }

  if (method === 'POST' && parts[0] === 'api' && parts[1] === 'permissions' && parts[2]) {
    const raw = await readBody(req);
    const body = raw ? JSON.parse(raw) : {};
    const result = body.result as PermissionResult;
    if (result !== 'allow' && result !== 'deny' && result !== 'allow_always') {
      json(res, 400, { error: 'invalid_result' });
      return;
    }
    sm!.handlePermissionResponse(parts[2], result);
    json(res, 200, { ok: true });
    return;
  }

  if (method === 'POST' && parts[0] === 'api' && parts[1] === 'sudo' && parts[2]) {
    const raw = await readBody(req);
    const body = raw ? JSON.parse(raw) : {};
    const password =
      typeof body.password === 'string' && body.password.length > 0 ? body.password : null;
    sm!.handleSudoPasswordResponse(parts[2], password);
    json(res, 200, { ok: true });
    return;
  }

  if (method === 'GET' && url.pathname === '/api/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.write('\n');
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
    return;
  }

  json(res, 404, { error: 'not_found' });
}

async function onRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const host = req.headers.host || 'localhost';
    const url = new URL(req.url || '/', `http://${host}`);

    if (url.pathname === '/' || url.pathname === '/index.html') {
      serveChatUi(res);
      return;
    }

    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url);
      return;
    }

    json(res, 404, { error: 'not_found' });
  } catch (error) {
    logError('[ChatLan] Request failed:', error);
    if (!res.headersSent) {
      json(res, 500, { error: 'internal_error' });
    }
  }
}

export function getChatLanStatus(): ChatLanStatus {
  const config = chatLanConfigStore.getAll();
  return {
    running: Boolean(server?.listening),
    port: config.port,
    enabled: config.enabled,
    urls: server?.listening ? getLanUrls(config.port) : [],
  };
}

export async function startChatLanServer(): Promise<void> {
  const config = chatLanConfigStore.getAll();
  if (!config.enabled) {
    return;
  }
  if (server?.listening) {
    return;
  }

  unsubscribeEvents = subscribeChatLanEvents(broadcastSse);

  server = http.createServer((req, res) => {
    void onRequest(req, res);
  });

  await new Promise<void>((resolve, reject) => {
    server!.once('error', reject);
    server!.listen(config.port, BIND_HOST, () => {
      server!.removeListener('error', reject);
      resolve();
    });
  });

  const urls = getLanUrls(config.port);
  log(`[ChatLan] Listening on ${BIND_HOST}:${config.port}`);
  for (const u of urls) {
    log(`[ChatLan] LAN URL: ${u}`);
  }
}

export async function stopChatLanServer(): Promise<void> {
  unsubscribeEvents?.();
  unsubscribeEvents = null;

  for (const client of sseClients) {
    try {
      client.end();
    } catch {
      /* ignore */
    }
  }
  sseClients.clear();

  if (!server) {
    return;
  }

  await new Promise<void>((resolve) => {
    server!.close(() => resolve());
  });
  server = null;
  log('[ChatLan] Stopped');
}

export async function restartChatLanServer(): Promise<void> {
  await stopChatLanServer();
  await startChatLanServer();
}

export async function applyChatLanConfig(): Promise<void> {
  const { enabled } = chatLanConfigStore.getAll();
  if (enabled) {
    await restartChatLanServer();
  } else {
    await stopChatLanServer();
  }
}
