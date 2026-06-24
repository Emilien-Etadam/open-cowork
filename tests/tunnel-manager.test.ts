import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const forward = vi.fn();
const disconnect = vi.fn();

vi.mock('@ngrok/ngrok', () => ({
  forward,
  disconnect,
}));

vi.mock('../src/main/utils/logger', () => ({
  log: vi.fn(),
  logError: vi.fn(),
}));

const getAll = vi.fn();

vi.mock('../src/main/remote/remote-config-store', () => ({
  remoteConfigStore: {
    getAll,
  },
}));

describe('TunnelManager ngrok integration', () => {
  beforeEach(() => {
    vi.resetModules();
    forward.mockReset();
    disconnect.mockReset();
    getAll.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('starts and stops tunnels with the official @ngrok/ngrok SDK', async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    forward.mockResolvedValue({
      url: () => 'https://example.ngrok-free.app',
      close,
    });
    getAll.mockReturnValue({
      gateway: {
        tunnel: {
          enabled: true,
          type: 'ngrok',
          ngrok: { authToken: 'test-token', region: 'eu' },
        },
      },
    });

    const { tunnelManager } = await import('../src/main/remote/tunnel-manager');

    const url = await tunnelManager.start(8787);
    expect(url).toBe('https://example.ngrok-free.app');
    expect(forward).toHaveBeenCalledWith({
      addr: 8787,
      authtoken: 'test-token',
      region: 'eu',
    });
    expect(tunnelManager.getStatus()).toEqual({
      connected: true,
      url: 'https://example.ngrok-free.app',
      provider: 'ngrok',
    });

    await tunnelManager.stop();
    expect(close).toHaveBeenCalledTimes(1);
    expect(tunnelManager.getStatus().connected).toBe(false);
  });
});
