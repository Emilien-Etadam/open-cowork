import type { IncomingMessage, ServerResponse } from 'http';
import type { URL } from 'url';
import { chatLanConfigStore } from './chat-lan-config-store';

export function getTokenFromRequest(req: IncomingMessage, url: URL): string | null {
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) {
    return auth.slice('Bearer '.length).trim();
  }
  const queryToken = url.searchParams.get('token');
  return queryToken?.trim() || null;
}

export function isChatLanAuthorized(req: IncomingMessage, url: URL): boolean {
  const expected = chatLanConfigStore.getAll().token;
  const provided = getTokenFromRequest(req, url);
  return Boolean(provided && expected && provided === expected);
}

export function applyChatLanSecurityHeaders(res: ServerResponse): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'unsafe-inline'");
}
