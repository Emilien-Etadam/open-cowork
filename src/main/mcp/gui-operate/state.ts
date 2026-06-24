import { SCREENSHOT_REUSE_WINDOW_MS } from './constants.js';
import type {
  ClickHistoryEntry,
  DisplayConfiguration,
  Region,
  ScreenshotCacheEntry,
} from './types.js';

export const screenshotState = {
  lastScreenshotCache: null as ScreenshotCacheEntry | null,
  screenshotRequestCounts: new Map<string, number>(),
};

export const clickHistoryState = {
  clickHistory: [] as ClickHistoryEntry[],
  clickHistoryCounter: 0,
  currentAppName: '',
  lastClickEntry: null as ClickHistoryEntry | null,
  restoreAppContextPromise: null as Promise<boolean> | null,
};

export const displayState = {
  displayConfigCache: null as DisplayConfiguration | null,
  displayConfigCacheTime: 0,
};

export function toRegionKey(region?: Region): string {
  if (!region) {
    return 'full';
  }
  return `${region.x},${region.y},${region.width},${region.height}`;
}

export function getReusableScreenshot(
  displayIndex: number,
  regionKey: string
): ScreenshotCacheEntry | null {
  if (!screenshotState.lastScreenshotCache) {
    return null;
  }
  if (screenshotState.lastScreenshotCache.displayIndex !== displayIndex) {
    return null;
  }
  if (screenshotState.lastScreenshotCache.regionKey !== regionKey) {
    return null;
  }
  const age = Date.now() - screenshotState.lastScreenshotCache.capturedAt;
  if (age > SCREENSHOT_REUSE_WINDOW_MS) {
    return null;
  }
  return screenshotState.lastScreenshotCache;
}

export function updateScreenshotCache(entry: ScreenshotCacheEntry): void {
  screenshotState.lastScreenshotCache = entry;
}
