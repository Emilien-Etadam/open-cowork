import { describe, expect, it } from 'vitest';
import {
  ALLOWED_CLIENT_EVENT_TYPES,
  isAllowedClientEvent,
  isAllowedClientEventType,
} from '../src/shared/client-event-allowlist';

describe('client-event-allowlist', () => {
  it('allows known session and settings events', () => {
    for (const type of ALLOWED_CLIENT_EVENT_TYPES) {
      expect(isAllowedClientEventType(type)).toBe(true);
    }
  });

  it('rejects unknown event types', () => {
    expect(isAllowedClientEventType('session.hijack')).toBe(false);
    expect(isAllowedClientEventType('')).toBe(false);
    expect(isAllowedClientEventType(null)).toBe(false);
  });

  it('validates event objects', () => {
    expect(isAllowedClientEvent({ type: 'session.list', payload: {} })).toBe(true);
    expect(isAllowedClientEvent({ type: 'evil.event', payload: {} })).toBe(false);
    expect(isAllowedClientEvent(null)).toBe(false);
  });
});
