/**
 * Destination allowlist for the sandbox LAN network proxy.
 * Only RFC1918 / link-local targets are forwarded; loopback and public IPs are rejected.
 */
export function normalizeNetworkHost(host: string): string {
  const trimmed = host.trim().toLowerCase();
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export function isBlockedSandboxProxyTarget(host: string): boolean {
  const normalized = normalizeNetworkHost(host);
  if (!normalized) {
    return true;
  }

  if (normalized === 'localhost' || normalized.endsWith('.localhost')) {
    return true;
  }
  if (normalized === '127.0.0.1' || normalized.startsWith('127.')) {
    return true;
  }
  if (normalized === '::1' || normalized === '0.0.0.0') {
    return true;
  }

  return false;
}

export function isAllowedSandboxProxyTarget(host: string): boolean {
  const normalized = normalizeNetworkHost(host);
  if (!normalized || isBlockedSandboxProxyTarget(normalized)) {
    return false;
  }

  if (/^10\./.test(normalized)) {
    return true;
  }
  if (/^192\.168\./.test(normalized)) {
    return true;
  }
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(normalized)) {
    return true;
  }
  if (/^169\.254\./.test(normalized)) {
    return true;
  }
  if (normalized.startsWith('fe80:')) {
    return true;
  }
  if (/^f[c-d][0-9a-f]{0,2}:/i.test(normalized)) {
    return true;
  }

  return false;
}

export function assertAllowedSandboxProxyTarget(host: string): void {
  if (!isAllowedSandboxProxyTarget(host)) {
    throw new Error(`Sandbox LAN proxy target not allowed: ${host}`);
  }
}
