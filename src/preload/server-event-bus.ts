import type { ServerEvent } from '../renderer/types';

type ServerEventSubscriber = (event: ServerEvent) => void;

const subscribers = new Set<ServerEventSubscriber>();
let ipcListener: ((event: Electron.IpcRendererEvent, data: ServerEvent) => void) | null = null;

export function subscribeServerEvents(
  ipcRenderer: Electron.IpcRenderer,
  callback: ServerEventSubscriber
): () => void {
  subscribers.add(callback);
  ensureIpcListener(ipcRenderer);

  return () => {
    subscribers.delete(callback);
    if (subscribers.size === 0 && ipcListener) {
      ipcRenderer.removeListener('server-event', ipcListener);
      ipcListener = null;
    }
  };
}

export function resetServerEventSubscribersForTests(): void {
  subscribers.clear();
  ipcListener = null;
}

export function getServerEventSubscriberCount(): number {
  return subscribers.size;
}

function ensureIpcListener(ipcRenderer: Electron.IpcRenderer): void {
  if (ipcListener) {
    return;
  }

  ipcListener = (_event, data) => {
    for (const subscriber of subscribers) {
      try {
        subscriber(data);
      } catch (error) {
        console.error('[Preload] Server event subscriber failed:', error);
      }
    }
  };

  ipcRenderer.on('server-event', ipcListener);
}
