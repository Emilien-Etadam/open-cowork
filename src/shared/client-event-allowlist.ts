/** Client events the renderer may send to the main process via IPC. */
export const ALLOWED_CLIENT_EVENT_TYPES = [
  'session.start',
  'session.continue',
  'session.compact',
  'session.handoff',
  'session.forkFromMessage',
  'session.rewindToMessage',
  'session.stop',
  'session.delete',
  'session.batchDelete',
  'session.list',
  'session.getMessages',
  'session.getTraceSteps',
  'permission.response',
  'sudo.password.response',
  'settings.update',
  'folder.select',
  'workdir.get',
  'workdir.set',
  'workdir.select',
] as const;

export type AllowedClientEventType = (typeof ALLOWED_CLIENT_EVENT_TYPES)[number];

const ALLOWED_CLIENT_EVENT_TYPE_SET: ReadonlySet<string> = new Set(ALLOWED_CLIENT_EVENT_TYPES);

export function isAllowedClientEventType(type: unknown): type is AllowedClientEventType {
  return typeof type === 'string' && ALLOWED_CLIENT_EVENT_TYPE_SET.has(type);
}

export function isAllowedClientEvent(
  event: unknown
): event is { type: AllowedClientEventType; payload?: unknown } {
  if (!event || typeof event !== 'object') {
    return false;
  }
  const record = event as { type?: unknown };
  return isAllowedClientEventType(record.type);
}
