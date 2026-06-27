import { describe, expect, it, vi } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'http';
import { URL } from 'url';

vi.mock('../src/main/chat-lan-server/chat-lan-config-store', () => ({
  chatLanConfigStore: {
    getAll: () => ({
      enabled: true,
      port: 19890,
      token: 'secret-token',
    }),
  },
}));

import {
  applyChatLanSecurityHeaders,
  getTokenFromRequest,
  isChatLanAuthorized,
} from '../src/main/chat-lan-server/chat-lan-auth';

function makeRequest(headers: Record<string, string | string[] | undefined> = {}): IncomingMessage {
  return { headers } as IncomingMessage;
}

describe('chat-lan-auth', () => {
  it('accepts bearer authorization header', () => {
    const req = makeRequest({ authorization: 'Bearer secret-token' });
    const url = new URL('http://localhost/api/health');
    expect(getTokenFromRequest(req, url)).toBe('secret-token');
    expect(isChatLanAuthorized(req, url)).toBe(true);
  });

  it('accepts legacy query token for backward compatibility', () => {
    const req = makeRequest();
    const url = new URL('http://localhost/api/events?token=secret-token');
    expect(isChatLanAuthorized(req, url)).toBe(true);
  });

  it('rejects missing or invalid tokens', () => {
    const req = makeRequest();
    const url = new URL('http://localhost/api/health');
    expect(isChatLanAuthorized(req, url)).toBe(false);

    const badReq = makeRequest({ authorization: 'Bearer wrong-token' });
    expect(isChatLanAuthorized(badReq, url)).toBe(false);
  });

  it('applies security headers', () => {
    const headers: Record<string, string | number | string[]> = {};
    const res = {
      setHeader: (name: string, value: string) => {
        headers[name] = value;
      },
    } as unknown as ServerResponse;

    applyChatLanSecurityHeaders(res);

    expect(headers['X-Content-Type-Options']).toBe('nosniff');
    expect(headers['X-Frame-Options']).toBe('DENY');
    expect(headers['Referrer-Policy']).toBe('no-referrer');
    expect(headers['Cache-Control']).toBe('no-store');
    expect(String(headers['Content-Security-Policy'])).toContain("default-src 'self'");
  });
});
