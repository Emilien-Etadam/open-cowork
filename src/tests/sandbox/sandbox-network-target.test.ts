import { describe, expect, it } from 'vitest';
import {
  isAllowedSandboxProxyTarget,
  isBlockedSandboxProxyTarget,
} from '../../main/sandbox/sandbox-network-target';

describe('sandbox-network-target', () => {
  it('allows RFC1918 IPv4 addresses', () => {
    expect(isAllowedSandboxProxyTarget('192.168.30.115')).toBe(true);
    expect(isAllowedSandboxProxyTarget('10.0.0.5')).toBe(true);
    expect(isAllowedSandboxProxyTarget('172.16.0.1')).toBe(true);
  });

  it('blocks loopback and public targets', () => {
    expect(isBlockedSandboxProxyTarget('127.0.0.1')).toBe(true);
    expect(isBlockedSandboxProxyTarget('localhost')).toBe(true);
    expect(isAllowedSandboxProxyTarget('127.0.0.1')).toBe(false);
    expect(isAllowedSandboxProxyTarget('8.8.8.8')).toBe(false);
    expect(isAllowedSandboxProxyTarget('example.com')).toBe(false);
  });

  it('allows link-local addresses', () => {
    expect(isAllowedSandboxProxyTarget('169.254.10.2')).toBe(true);
  });
});
