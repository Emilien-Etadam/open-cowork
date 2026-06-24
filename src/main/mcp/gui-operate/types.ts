export type ClickType = 'single' | 'double' | 'right' | 'triple';

export type CoordinateType = 'auto' | 'absolute' | 'normalized';

export type InputMethod = 'auto' | 'keystroke' | 'paste';

export type ScrollDirection = 'up' | 'down' | 'left' | 'right';

export interface Region {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BoundingBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export type ScreenshotCacheEntry = {
  displayIndex: number;
  regionKey: string;
  path: string;
  base64Image: string;
  capturedAt: number;
  displayInfo: { width: number; height: number; scaleFactor: number };
};

export interface ClickHistoryEntry {
  index: number;
  x: number;
  y: number;
  displayIndex: number;
  timestamp: number;
  operation: string;
  count: number;
  successCount: number;
}

export interface StoredClickHistoryEntry {
  index: number;
  x_normalized: number;
  y_normalized: number;
  displayIndex: number;
  displayWidth: number;
  displayHeight: number;
  timestamp: number;
  operation: string;
  count: number;
  successCount: number;
}

export interface AppClickHistory {
  appName: string;
  lastUpdated: number;
  clicks: StoredClickHistoryEntry[];
  counter: number;
}

export interface DockItemInfo {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LastAppContext {
  appName: string;
  savedAt: number;
}

export interface DisplayInfo {
  index: number;
  name: string;
  isMain: boolean;
  width: number;
  height: number;
  originX: number;
  originY: number;
  scaleFactor: number;
}

export interface DisplayConfiguration {
  displays: DisplayInfo[];
  totalWidth: number;
  totalHeight: number;
  mainDisplayIndex: number;
}

export interface ScreenshotToolContent {
  type: string;
  text?: string;
  data?: string;
  mimeType?: string;
}

export interface ScreenshotToolResponse {
  content: ScreenshotToolContent[];
}

export interface GUIActionPlanStep {
  step: number;
  action: string;
  element_description: string;
  value?: string;
  reasoning: string;
}

export interface GUIActionPlan {
  steps: GUIActionPlanStep[];
  summary?: string;
}

export interface LocateResult {
  x: number;
  y: number;
  confidence: number;
  displayIndex: number;
  reasoning?: string;
  boundingBox?: BoundingBox;
}

export interface ExecuteActionStepResult {
  success: boolean;
  step: number;
  action: string;
  coordinates?: { x: number; y: number };
  error?: string;
}
