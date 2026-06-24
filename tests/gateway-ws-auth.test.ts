import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const gatewayPath = path.resolve('src/main/remote/gateway.ts');
const gatewaySource = fs.readFileSync(gatewayPath, 'utf8');

describe('gateway websocket auth hardening', () => {
  it('does not auto-authenticate all non-token modes without checks', () => {
    expect(gatewaySource).not.toContain("// Other auth modes don't require token for WS");
    expect(gatewaySource).toContain("this.config.auth.mode === 'open'");
    expect(gatewaySource).toContain('isLoopbackHostname');
  });

  it('rejects websocket auth when token is missing in protected modes', () => {
    expect(gatewaySource).toContain("error: 'Authentication required'");
  });
});
