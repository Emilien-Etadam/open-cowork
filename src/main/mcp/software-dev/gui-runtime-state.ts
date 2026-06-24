import type { GUIAppInstance } from './docker-gui.js';

export interface ScreenContext {
  screenWidth: number;
  screenHeight: number;
  lastScreenshot: string;
  lastAnalysis: string;
  elements: Array<{
    description: string;
    type: string;
    position: { x: number; y: number; width: number; height: number };
    functionality: string;
    state?: string;
  }>;
  lastUpdated: Date;
}

export let currentGUIApp: GUIAppInstance | null = null;
export let currentScreenContext: ScreenContext | null = null;

export function getCurrentGUIApp(): GUIAppInstance | null {
  return currentGUIApp;
}

export function setCurrentGUIApp(instance: GUIAppInstance | null): void {
  currentGUIApp = instance;
  currentScreenContext = null;
}

export function clearCurrentGUIApp(): void {
  currentGUIApp = null;
  currentScreenContext = null;
}

export function setCurrentScreenContext(context: ScreenContext | null): void {
  currentScreenContext = context;
}
