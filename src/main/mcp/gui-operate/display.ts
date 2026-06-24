import { writeMCPLog } from '../mcp-logger.js';

import { DISPLAY_CONFIG_CACHE_TTL, PLATFORM } from './constants.js';
import { displayState } from './state.js';
import { executeAppleScript, executeCommandSafe } from './platform-common.js';
import type { DisplayConfiguration, DisplayInfo } from './types.js';
import { windowsGetDisplayConfiguration } from './windows-platform.js';

/**
 * Get display configuration using platform-specific methods
 * - macOS: AppleScript/system_profiler
 * - Windows: PowerShell with System.Windows.Forms
 * Returns information about all connected displays
 */
export async function getDisplayConfiguration(): Promise<DisplayConfiguration> {
  const now = Date.now();
  if (
    displayState.displayConfigCache &&
    now - displayState.displayConfigCacheTime < DISPLAY_CONFIG_CACHE_TTL
  ) {
    return displayState.displayConfigCache;
  }

  if (PLATFORM === 'win32') {
    try {
      const config = await windowsGetDisplayConfiguration();
      displayState.displayConfigCache = config;
      displayState.displayConfigCacheTime = now;
      return config;
    } catch (error: unknown) {
      throw new Error(
        `Failed to get display information on Windows: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  if (PLATFORM !== 'darwin') {
    throw new Error(`Display detection is not supported on platform: ${PLATFORM}`);
  }

  try {
    const appleScript = `
      use framework "AppKit"
      use scripting additions
      
      set displayList to ""
      set screenCount to (current application's NSScreen's screens()'s |count|())
      
      repeat with i from 1 to screenCount
        set theScreen to (current application's NSScreen's screens()'s objectAtIndex:(i - 1))
        set theFrame to theScreen's frame()
        set theVisibleFrame to theScreen's visibleFrame()
        
        -- Get display name (if available)
        set displayName to "Display " & i
        
        -- Check if this is the main display
        set isMain to (theScreen's isEqual:(current application's NSScreen's mainScreen())) as boolean
        
        -- Get coordinates
        set originX to (current application's NSMinX(theFrame)) as integer
        set originY to (current application's NSMinY(theFrame)) as integer
        set screenWidth to (current application's NSWidth(theFrame)) as integer
        set screenHeight to (current application's NSHeight(theFrame)) as integer
        
        -- Get scale factor (for Retina displays)
        set scaleFactor to (theScreen's backingScaleFactor()) as real
        
        set displayInfo to "index:" & (i - 1) & ",name:" & displayName & ",isMain:" & isMain & ",width:" & screenWidth & ",height:" & screenHeight & ",originX:" & originX & ",originY:" & originY & ",scaleFactor:" & scaleFactor
        
        if displayList is "" then
          set displayList to displayInfo
        else
          set displayList to displayList & "|" & displayInfo
        end if
      end repeat
      
      return displayList
    `;

    const result = await executeAppleScript(appleScript);
    const output = result.stdout.trim();

    if (!output) {
      throw new Error('No display information returned from AppleScript');
    }

    const displays: DisplayInfo[] = [];
    const displayStrings = output.split('|');

    for (const displayStr of displayStrings) {
      const props: Record<string, string> = {};
      for (const prop of displayStr.split(',')) {
        const [key, value] = prop.split(':');
        if (key && value !== undefined) {
          props[key] = value;
        }
      }

      displays.push({
        index: parseInt(props['index'] || '0'),
        name: props['name'] || 'Unknown Display',
        isMain: props['isMain'] === 'true',
        width: parseInt(props['width'] || '1920'),
        height: parseInt(props['height'] || '1080'),
        originX: parseInt(props['originX'] || '0'),
        originY: parseInt(props['originY'] || '0'),
        scaleFactor: parseFloat(props['scaleFactor'] || '1.0'),
      });
    }

    displays.sort((a, b) => a.index - b.index);

    const mainDisplay = displays.find((d) => d.isMain) || displays[0];
    const mainDisplayIndex = mainDisplay.index;
    const mainDisplayHeight = mainDisplay.height;

    const convertedDisplays: DisplayInfo[] = displays.map((display) => {
      let cliclickOriginY: number;

      if (display.isMain) {
        cliclickOriginY = 0;
        writeMCPLog(
          `[Display Config] Display ${display.index} (Main): Cocoa originY=${display.originY}, cliclick originY=${cliclickOriginY}`,
          'Coordinate Conversion'
        );
      } else {
        const cocoaTopEdge = display.originY + display.height;
        cliclickOriginY = mainDisplayHeight - cocoaTopEdge;

        writeMCPLog(
          `[Display Config] Display ${display.index}: Cocoa originY=${display.originY}, height=${display.height}, cocoaTopEdge=${cocoaTopEdge}, mainHeight=${mainDisplayHeight}, cliclick originY=${cliclickOriginY}`,
          'Coordinate Conversion'
        );
      }

      return {
        ...display,
        originY: cliclickOriginY,
      };
    });

    let totalWidth = 0;
    let maxHeight = 0;
    let maxDisplayHeight = 0;

    for (const display of convertedDisplays) {
      const right = display.originX + display.width;
      const bottom = display.originY + display.height;

      if (right > totalWidth) {
        totalWidth = right;
      }
      if (bottom > maxHeight) {
        maxHeight = bottom;
      }
      if (display.height > maxDisplayHeight) {
        maxDisplayHeight = display.height;
      }

      writeMCPLog(
        `[Display Config] Display ${display.index}: originX=${display.originX}, originY=${display.originY}, width=${display.width}, height=${display.height}, right=${right}, bottom=${bottom}`,
        'Dimension Calculation'
      );
    }

    const totalHeight = maxDisplayHeight;

    writeMCPLog(
      `[Display Config] Total dimensions: width=${totalWidth}, height=${totalHeight}, maxBottom=${maxHeight}`,
      'Dimension Calculation'
    );

    const config: DisplayConfiguration = {
      displays: convertedDisplays,
      totalWidth,
      totalHeight,
      mainDisplayIndex,
    };

    displayState.displayConfigCache = config;
    displayState.displayConfigCacheTime = now;

    return config;
  } catch (error: unknown) {
    writeMCPLog(
      `AppleScript display detection failed, using fallback: ${error instanceof Error ? error.message : String(error)}`,
      'Display Detection'
    );

    try {
      const result = await executeCommandSafe('system_profiler', ['SPDisplaysDataType', '-json']);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let data: any;
      try {
        data = JSON.parse(result.stdout);
      } catch {
        writeMCPLog('[GUI] Failed to parse system_profiler JSON output', 'Display Detection Error');
        throw new Error('Failed to parse system_profiler display data');
      }
      const displays: DisplayInfo[] = [];

      let index = 0;
      for (const gpu of data.SPDisplaysDataType || []) {
        for (const display of gpu.spdisplays_ndrvs || []) {
          const resolution = display._spdisplays_resolution || '';
          const match = resolution.match(/(\d+)\s*x\s*(\d+)/);

          displays.push({
            index,
            name: display._name || `Display ${index + 1}`,
            isMain: display.spdisplays_main === 'spdisplays_yes',
            width: match ? parseInt(match[1]) : 1920,
            height: match ? parseInt(match[2]) : 1080,
            originX: 0,
            originY: 0,
            scaleFactor: resolution.includes('Retina') ? 2.0 : 1.0,
          });
          index++;
        }
      }

      if (displays.length === 0) {
        displays.push({
          index: 0,
          name: 'Main Display',
          isMain: true,
          width: 1920,
          height: 1080,
          originX: 0,
          originY: 0,
          scaleFactor: 1.0,
        });
      }

      const config: DisplayConfiguration = {
        displays,
        totalWidth: displays.reduce((max, d) => Math.max(max, d.originX + d.width), 0),
        totalHeight: displays.reduce((max, d) => Math.max(max, Math.abs(d.originY) + d.height), 0),
        mainDisplayIndex: displays.findIndex((d) => d.isMain) || 0,
      };

      displayState.displayConfigCache = config;
      displayState.displayConfigCacheTime = now;

      return config;
    } catch (fallbackError: unknown) {
      throw new Error(
        `Failed to get display information: ${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}`
      );
    }
  }
}

/**
 * Convert display-local coordinates to global screen coordinates
 */
export async function convertToGlobalCoordinates(
  x: number,
  y: number,
  displayIndex: number = 0
): Promise<{ globalX: number; globalY: number }> {
  const config = await getDisplayConfiguration();

  const display = config.displays.find((d) => d.index === displayIndex);
  if (!display) {
    throw new Error(
      `Display index ${displayIndex} not found. Available displays: 0-${config.displays.length - 1}`
    );
  }

  if (x < 0 || x >= display.width || y < 0 || y >= display.height) {
    writeMCPLog(
      `[convertToGlobalCoordinates] Warning: Coordinates (${x}, ${y}) may be outside display ${displayIndex} bounds (${display.width}x${display.height})`,
      'Coordinate Warning'
    );
  }

  writeMCPLog(
    `[convertToGlobalCoordinates] Display info: width=${display.width}, height=${display.height}, originX=${display.originX}, originY=${display.originY}, scaleFactor=${display.scaleFactor}`,
    'Coordinate Conversion'
  );

  const globalX = display.originX + x;
  const globalY = display.originY + y;

  writeMCPLog(
    `[convertToGlobalCoordinates] Input: (${x}, ${y}) + Origin: (${display.originX}, ${display.originY}) = Global: (${globalX}, ${globalY})`,
    'Coordinate Conversion'
  );

  return { globalX, globalY };
}

/**
 * Convert normalized (0-1000) coordinates to display-local logical coordinates.
 */
export async function convertNormalizedToDisplayCoordinates(
  xNormalized: number,
  yNormalized: number,
  displayIndex: number = 0
): Promise<{ x: number; y: number }> {
  const config = await getDisplayConfiguration();

  const display = config.displays.find((d) => d.index === displayIndex);
  if (!display) {
    throw new Error(
      `Display index ${displayIndex} not found. Available displays: 0-${config.displays.length - 1}`
    );
  }

  const xn = Math.max(0, Math.min(1000, xNormalized));
  const yn = Math.max(0, Math.min(1000, yNormalized));

  let x = Math.round((xn / 1000) * display.width);
  let y = Math.round((yn / 1000) * display.height);

  if (display.width > 0) x = Math.max(0, Math.min(display.width - 1, x));
  if (display.height > 0) y = Math.max(0, Math.min(display.height - 1, y));

  writeMCPLog(
    `[convertNormalizedToDisplayCoordinates] Normalized (${xNormalized}, ${yNormalized}) -> clamped (${xn}, ${yn}) -> logical (${x}, ${y}) on display ${displayIndex} (${display.width}x${display.height})`,
    'Coordinate Conversion'
  );

  return { x, y };
}

/**
 * Resolve click coordinates to display-local logical coordinates.
 */
export async function resolveClickCoordinates(
  xInput: number,
  yInput: number,
  displayIndex: number = 0,
  coordinateType: 'absolute' | 'normalized' | 'auto' = 'auto'
): Promise<{ x: number; y: number }> {
  const config = await getDisplayConfiguration();
  const display = config.displays.find((d) => d.index === displayIndex);

  if (!display) {
    throw new Error(
      `Display index ${displayIndex} not found. Available displays: 0-${config.displays.length - 1}`
    );
  }

  if (!Number.isFinite(xInput) || !Number.isFinite(yInput)) {
    throw new Error(`Invalid click coordinates: x=${xInput}, y=${yInput}`);
  }

  if (coordinateType === 'normalized') {
    return convertNormalizedToDisplayCoordinates(xInput, yInput, displayIndex);
  }

  const x = Math.round(xInput);
  const y = Math.round(yInput);

  if (coordinateType === 'auto') {
    const isOutOfBounds = x < 0 || y < 0 || x >= display.width || y >= display.height;
    const looksNormalized = xInput >= 0 && xInput <= 1000 && yInput >= 0 && yInput <= 1000;

    if (isOutOfBounds && looksNormalized) {
      const converted = await convertNormalizedToDisplayCoordinates(xInput, yInput, displayIndex);
      writeMCPLog(
        `[resolveClickCoordinates] auto mode converted normalized (${xInput}, ${yInput}) -> logical (${converted.x}, ${converted.y}) on display ${displayIndex}`,
        'Coordinate Conversion'
      );
      return converted;
    }
  }

  const clampedX = display.width > 0 ? Math.max(0, Math.min(display.width - 1, x)) : x;
  const clampedY = display.height > 0 ? Math.max(0, Math.min(display.height - 1, y)) : y;

  if (clampedX !== x || clampedY !== y) {
    writeMCPLog(
      `[resolveClickCoordinates] Clamped absolute coordinates (${x}, ${y}) -> (${clampedX}, ${clampedY}) on display ${displayIndex}`,
      'Coordinate Conversion'
    );
  }

  return { x: clampedX, y: clampedY };
}
