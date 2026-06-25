/**
 * Shared types for RemoteControlPanel sub-components
 */

export interface GatewayStatus {
  running: boolean;
  port?: number;
  publicUrl?: string;
  channels: Array<{ type: string; connected: boolean; error?: string }>;
  activeSessions: number;
  pendingPairings: number;
}

export interface PairedUser {
  userId: string;
  userName?: string;
  channelType: string;
  pairedAt: number;
  lastActiveAt: number;
}

export interface PairingRequest {
  code: string;
  channelType: string;
  userId: string;
  userName?: string;
  createdAt: number;
  expiresAt: number;
}

export interface RemoteConfig {
  gateway: {
    enabled: boolean;
    port: number;
    bind: string;
    defaultWorkingDirectory?: string;
    autoApproveSafeTools?: boolean;
    auth: {
      mode: string;
      token?: string;
      requirePairing?: boolean;
    };
  };
  channels: {
    slack?: {
      botToken: string;
      appToken?: string;
      useSocketMode?: boolean;
      dm: {
        policy: string;
      };
    };
  };
}

export type ConfigStep = 'slack' | 'advanced';

export type LocalizedBanner = { key?: string; text?: string | null };
