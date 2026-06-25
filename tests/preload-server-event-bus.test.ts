import { describe, expect, it, vi } from 'vitest';

import {
  getServerEventSubscriberCount,
  resetServerEventSubscribersForTests,
  subscribeServerEvents,
} from '../src/preload/server-event-bus';

describe('preload server event bus', () => {
  it('notifies every subscriber without replacing previous listeners', () => {
    resetServerEventSubscribersForTests();

    const ipcRenderer = {
      on: vi.fn(),
      removeListener: vi.fn(),
    } as unknown as Electron.IpcRenderer;

    const first = vi.fn();
    const second = vi.fn();

    const unsubscribeFirst = subscribeServerEvents(ipcRenderer, first);
    const unsubscribeSecond = subscribeServerEvents(ipcRenderer, second);

    expect(getServerEventSubscriberCount()).toBe(2);
    expect(ipcRenderer.on).toHaveBeenCalledOnce();

    const listener = vi.mocked(ipcRenderer.on).mock.calls[0]?.[1] as (
      event: Electron.IpcRendererEvent,
      data: { type: string }
    ) => void;

    listener({} as Electron.IpcRendererEvent, { type: 'stream.partial' });

    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();

    unsubscribeFirst();
    expect(getServerEventSubscriberCount()).toBe(1);

    unsubscribeSecond();
    expect(getServerEventSubscriberCount()).toBe(0);
    expect(ipcRenderer.removeListener).toHaveBeenCalledOnce();
  });
});
