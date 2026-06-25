/**
 * @module main/chat-lan-server/chat-lan-event-bus
 */
import type { ServerEvent } from '../../renderer/types';

const CHAT_LAN_EVENT_TYPES = new Set<ServerEvent['type']>([
  'stream.message',
  'stream.partial',
  'stream.thinking',
  'stream.executionTime',
  'session.status',
  'session.update',
  'session.notice',
  'permission.request',
  'permission.dismiss',
  'sudo.password.request',
  'sudo.password.dismiss',
  'error',
]);

type ChatLanListener = (event: ServerEvent) => void;

const listeners = new Set<ChatLanListener>();

export function subscribeChatLanEvents(listener: ChatLanListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function broadcastChatLanEvent(event: ServerEvent): void {
  if (!CHAT_LAN_EVENT_TYPES.has(event.type)) {
    return;
  }
  for (const listener of listeners) {
    try {
      listener(event);
    } catch {
      /* ignore subscriber errors */
    }
  }
}
