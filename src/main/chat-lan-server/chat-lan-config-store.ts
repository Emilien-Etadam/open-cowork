/**
 * @module main/chat-lan-server/chat-lan-config-store
 */
import * as crypto from 'crypto';
import Store from 'electron-store';
import { createAppEncryptedStore } from '../utils/app-store';

export interface ChatLanConfig {
  enabled: boolean;
  port: number;
  token: string;
}

const DEFAULT_PORT = 19890;

function generateToken(): string {
  return crypto.randomBytes(24).toString('hex');
}

class ChatLanConfigStore {
  private store: Store<ChatLanConfig>;

  constructor() {
    this.store = createAppEncryptedStore<ChatLanConfig & Record<string, unknown>>({
      name: 'chat-lan-config',
      defaults: {
        enabled: false,
        port: DEFAULT_PORT,
        token: generateToken(),
      },
      logPrefix: '[ChatLanConfigStore]',
    }) as unknown as Store<ChatLanConfig>;

    if (!this.store.get('token')) {
      this.store.set('token', generateToken());
    }
  }

  getAll(): ChatLanConfig {
    return {
      enabled: Boolean(this.store.get('enabled')),
      port: Number(this.store.get('port')) || DEFAULT_PORT,
      token: String(this.store.get('token') || generateToken()),
    };
  }

  setEnabled(enabled: boolean): void {
    this.store.set('enabled', enabled);
  }

  setPort(port: number): void {
    const safe = Number.isFinite(port)
      ? Math.max(1024, Math.min(65535, Math.round(port)))
      : DEFAULT_PORT;
    this.store.set('port', safe);
  }

  regenerateToken(): string {
    const token = generateToken();
    this.store.set('token', token);
    return token;
  }
}

export const chatLanConfigStore = new ChatLanConfigStore();
