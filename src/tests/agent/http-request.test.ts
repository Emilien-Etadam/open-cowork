import { describe, expect, it } from 'vitest';
import {
  formatHttpRequestResult,
  parseHttpHeaders,
  parseHttpRequestOptions,
} from '../../main/agent/http-request';

describe('http-request', () => {
  it('parses optional headers from tool params', () => {
    expect(parseHttpHeaders({ Authorization: 'Bearer abc', 'X-Api-Key': '123' })).toEqual({
      Authorization: 'Bearer abc',
      'X-Api-Key': '123',
    });
  });

  it('builds request options with default GET method', () => {
    expect(parseHttpRequestOptions({ url: 'http://192.168.1.10/api' })).toEqual({
      url: 'http://192.168.1.10/api',
      method: 'GET',
      headers: undefined,
      body: undefined,
    });
  });

  it('normalizes method casing', () => {
    expect(parseHttpRequestOptions({ url: 'http://localhost', method: 'post' }).method).toBe(
      'POST'
    );
  });

  it('formats successful responses', () => {
    const text = formatHttpRequestResult({
      url: 'http://192.168.30.115/health',
      status: 200,
      contentType: 'application/json',
      body: '{"ok":true}',
      truncated: false,
    });
    expect(text).toContain('Status: 200');
    expect(text).toContain('{"ok":true}');
  });
});
