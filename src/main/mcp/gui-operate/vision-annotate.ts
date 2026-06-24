import * as fs from 'fs/promises';
import * as path from 'path';

import { writeMCPLog } from '../mcp-logger.js';

import { ensureAppContextRestored, getClickHistoryForDisplay } from './click-history.js';
import { PLATFORM } from './constants.js';
import { getDisplayConfiguration } from './display.js';
import { executePython } from './mac-platform.js';
import { executeCommandSafe } from './platform-common.js';
import { clickHistoryState } from './state.js';
import type { BoundingBox, ClickHistoryEntry } from './types.js';

/**
 * Annotate screenshot with click history markers.
 * Returns path to annotated image and click history info.
 */
export async function annotateScreenshotWithClickHistory(
  screenshotPath: string,
  displayIndex: number
): Promise<{ annotatedPath: string; clickHistoryInfo: string }> {
  if (!clickHistoryState.currentAppName && clickHistoryState.clickHistory.length === 0) {
    await ensureAppContextRestored();
  }

  writeMCPLog(
    `[annotateScreenshot] Total clicks in history: ${clickHistoryState.clickHistory.length}`,
    'Click History Debug'
  );
  writeMCPLog(
    `[annotateScreenshot] Full click history: ${JSON.stringify(clickHistoryState.clickHistory)}`,
    'Click History Debug'
  );
  writeMCPLog(
    `[annotateScreenshot] Requested displayIndex: ${displayIndex}`,
    'Click History Debug'
  );

  const clickHistoryForDisplay = getClickHistoryForDisplay(displayIndex);

  writeMCPLog(
    `[annotateScreenshot] Filtered clicks for display ${displayIndex}: ${clickHistoryForDisplay.length}`,
    'Click History Debug'
  );

  if (clickHistoryForDisplay.length === 0) {
    return {
      annotatedPath: screenshotPath,
      clickHistoryInfo: 'No previous clicks recorded.',
    };
  }

  const timestamp = Date.now();
  const basename = path.basename(screenshotPath, '.png');
  const annotatedPath = path.join(
    path.dirname(screenshotPath),
    `${basename}_annotated_${timestamp}.png`
  );

  const imageDims = await getImageDimensions(screenshotPath);

  const config = await getDisplayConfiguration();
  const targetDisplay = config.displays.find((d) => d.index === displayIndex);
  const rawScaleFactor = targetDisplay?.scaleFactor || 1;
  const scaleFactor = PLATFORM === 'win32' ? 1 : rawScaleFactor;

  writeMCPLog(
    `[annotateScreenshot] Image dimensions: ${imageDims.width}x${imageDims.height}, rawScaleFactor: ${rawScaleFactor}, effective: ${scaleFactor}`,
    'Image Info'
  );

  const mostRecentClick = clickHistoryForDisplay.reduce(
    (latest, current) => (current.timestamp > latest.timestamp ? current : latest),
    clickHistoryForDisplay[0]
  );

  writeMCPLog(
    `[annotateScreenshot] Most recent click: (${mostRecentClick.x}, ${mostRecentClick.y}) at timestamp ${mostRecentClick.timestamp}`,
    'Click Sorting'
  );

  const remainingClicks = clickHistoryForDisplay.filter((click) => click !== mostRecentClick);
  const sortedClicks = remainingClicks.sort((a, b) => {
    const scoreA = (a.successCount || 0) * 2 + a.count;
    const scoreB = (b.successCount || 0) * 2 + b.count;

    if (scoreB !== scoreA) {
      return scoreB - scoreA;
    }
    return b.timestamp - a.timestamp;
  });

  writeMCPLog(
    `[annotateScreenshot] Sorted ${sortedClicks.length} remaining clicks by weighted score (successCount*2 + count) and recency`,
    'Click Sorting'
  );

  const MIN_DISTANCE_PIXELS = 200;
  const MAX_MARKERS = 5;
  const filteredClicks: ClickHistoryEntry[] = [];

  filteredClicks.push(mostRecentClick);

  for (const entry of sortedClicks) {
    if (filteredClicks.length >= MAX_MARKERS) {
      writeMCPLog(
        `[annotateScreenshot] Reached maximum of ${MAX_MARKERS} markers, stopping`,
        'Click Filtering'
      );
      break;
    }

    const pixelX = entry.x * scaleFactor;
    const pixelY = entry.y * scaleFactor;

    let tooClose = false;
    for (const selected of filteredClicks) {
      const selectedPixelX = selected.x * scaleFactor;
      const selectedPixelY = selected.y * scaleFactor;

      const distance = Math.sqrt(
        Math.pow(pixelX - selectedPixelX, 2) + Math.pow(pixelY - selectedPixelY, 2)
      );

      if (distance < MIN_DISTANCE_PIXELS) {
        tooClose = true;
        writeMCPLog(
          `[annotateScreenshot] Skipping click at (${entry.x}, ${entry.y}) - too close to (${selected.x}, ${selected.y}), distance: ${Math.round(distance)}px`,
          'Click Filtering'
        );
        break;
      }
    }

    if (!tooClose) {
      filteredClicks.push(entry);
    }
  }

  writeMCPLog(
    `[annotateScreenshot] Filtered clicks: ${clickHistoryForDisplay.length} -> ${filteredClicks.length} (removed overlapping, max ${MAX_MARKERS})`,
    'Click Filtering'
  );

  const uniqueClicks = filteredClicks.map((entry, index) => ({
    ...entry,
    displayIndex_original: entry.displayIndex,
    displayNumber: index,
  }));

  writeMCPLog(
    `[annotateScreenshot] Renumbered ${uniqueClicks.length} clicks with consecutive indices 0-${uniqueClicks.length - 1} (most recent click is #0)`,
    'Click Renumbering'
  );

  const historyLines = uniqueClicks.map((entry) => {
    const pixelX = entry.x * scaleFactor;
    const pixelY = entry.y * scaleFactor;

    const normX = Math.round((pixelX / imageDims.width) * 1000);
    const normY = Math.round((pixelY / imageDims.height) * 1000);

    return `  #${entry.displayNumber}: [${normY}, ${normX}] (logical: ${entry.x}, ${entry.y}) - ${entry.operation}`;
  });
  const clickHistoryInfo = `Previous clicks on this display (normalized to 0-1000, sorted by frequency):\n${historyLines.join('\n')}`;

  const pythonScript = `
import sys
import json
from PIL import Image, ImageDraw, ImageFont

try:
    # Load image
    img = Image.open(json.loads(${JSON.stringify(JSON.stringify(screenshotPath.replace(/\\/g, '/')))}))
    img_width, img_height = img.size
    scale_factor = ${scaleFactor}
    
    # Create a semi-transparent overlay for drawing
    overlay = Image.new('RGBA', img.size, (255, 255, 255, 0))
    draw = ImageDraw.Draw(overlay)
    
    # Try to use a nice font, fallback to default
    # Platform-specific font paths
    import platform
    font = None
    small_font = None
    
    if platform.system() == 'Windows':
        # Windows fonts
        font_paths = [
            'C:/Windows/Fonts/arial.ttf',
            'C:/Windows/Fonts/segoeui.ttf',
            'C:/Windows/Fonts/tahoma.ttf',
        ]
    else:
        # macOS fonts
        font_paths = [
            '/System/Library/Fonts/Helvetica.ttc',
            '/System/Library/Fonts/SFNSDisplay.ttf',
            '/Library/Fonts/Arial.ttf',
        ]
    
    for font_path in font_paths:
        try:
            font = ImageFont.truetype(font_path, 32)
            small_font = ImageFont.truetype(font_path, 20)
            break
        except:
            continue
    
    if font is None:
        font = ImageFont.load_default()
        small_font = ImageFont.load_default()
    
    # Draw markers for each click
    clicks = ${JSON.stringify(uniqueClicks)}
    
    for click in clicks:
        # Logical coordinates from click history
        logical_x, logical_y = click['x'], click['y']
        display_number = click['displayNumber']  # Use the renumbered consecutive index
        
        # Convert logical coordinates to pixel coordinates for drawing
        pixel_x = int(logical_x * scale_factor)
        pixel_y = int(logical_y * scale_factor)
        
        # Calculate normalized coordinates (0-1000) for display
        norm_x = round((pixel_x / img_width) * 1000)
        norm_y = round((pixel_y / img_height) * 1000)
        
        # Draw circle with semi-transparent fill and bright outline
        radius = 20
        # Semi-transparent yellow fill
        draw.ellipse(
            [(pixel_x - radius, pixel_y - radius), (pixel_x + radius, pixel_y + radius)],
            fill=(255, 255, 0, 60),  # Yellow with 60/255 opacity
            outline=(255, 200, 0, 255),  # Bright orange outline, fully opaque
            width=3
        )
        
        # Draw crosshair (the exact click position) - bright and visible
        cross_size = 12
        draw.line(
            [(pixel_x - cross_size, pixel_y), (pixel_x + cross_size, pixel_y)], 
            fill=(255, 0, 0, 255),  # Bright red, fully opaque
            width=2
        )
        draw.line(
            [(pixel_x, pixel_y - cross_size), (pixel_x, pixel_y + cross_size)], 
            fill=(255, 0, 0, 255),  # Bright red, fully opaque
            width=2
        )
        
        # Draw center dot for extra visibility
        dot_radius = 3
        draw.ellipse(
            [(pixel_x - dot_radius, pixel_y - dot_radius), (pixel_x + dot_radius, pixel_y + dot_radius)],
            fill=(255, 0, 0, 255)  # Bright red dot
        )
        
        # Draw number label with NORMALIZED coordinates (0-1000)
        label = f"#{display_number}"
        coord_label = f"[{norm_y},{norm_x}]"
        
        # Get text bounding boxes
        bbox_num = draw.textbbox((0, 0), label, font=font)
        bbox_coord = draw.textbbox((0, 0), coord_label, font=small_font)
        
        num_width = bbox_num[2] - bbox_num[0]
        num_height = bbox_num[3] - bbox_num[1]
        coord_width = bbox_coord[2] - bbox_coord[0]
        coord_height = bbox_coord[3] - bbox_coord[1]
        
        # Use the wider of the two labels for background width
        max_width = max(num_width, coord_width)
        total_height = num_height + coord_height + 4  # 4px spacing between lines
        
        # Position label above and to the right of the marker
        label_x = pixel_x + radius + 8
        label_y = pixel_y - radius - total_height - 8
        
        # Ensure label stays within image bounds
        if label_x + max_width + 10 > img_width:
            label_x = pixel_x - radius - max_width - 18
        if label_y < 0:
            label_y = pixel_y + radius + 8
        
        # Draw semi-transparent background rectangle with border
        padding = 4
        # Background with transparency
        draw.rectangle(
            [
                (label_x - padding, label_y - padding),
                (label_x + max_width + padding, label_y + total_height + padding)
            ],
            fill=(0, 0, 0, 180),  # Black with 180/255 opacity
            outline=(255, 200, 0, 255),  # Orange border
            width=2
        )
        
        # Draw number text in bright yellow
        draw.text((label_x, label_y), label, fill=(255, 255, 0, 255), font=font)
        
        # Draw normalized coordinate text below the number in white
        coord_y = label_y + num_height + 2
        draw.text((label_x, coord_y), coord_label, fill=(255, 255, 255, 255), font=small_font)
    
    # Convert back to RGB and composite with original image
    if img.mode != 'RGBA':
        img = img.convert('RGBA')
    img = Image.alpha_composite(img, overlay)
    img = img.convert('RGB')
    
    # Save annotated image
    img.save('${annotatedPath.replace(/\\/g, '/').replace(/'/g, "\\'")}')
    print('SUCCESS')
    
except Exception as e:
    print(f'ERROR: {str(e)}', file=sys.stderr)
    sys.exit(1)
`.trim();

  try {
    const result = await executePython(pythonScript, 20000);

    if (result.stdout.includes('SUCCESS')) {
      writeMCPLog(
        `[annotateScreenshot] Successfully annotated screenshot with ${clickHistoryForDisplay.length} click markers`,
        'Screenshot Annotation'
      );
      writeMCPLog(
        `[annotateScreenshot] Annotated image saved to: ${annotatedPath}`,
        'Screenshot Annotation'
      );
      return { annotatedPath, clickHistoryInfo };
    }

    writeMCPLog(
      `[annotateScreenshot] Python script did not return SUCCESS: ${result.stdout}`,
      'Screenshot Annotation Error'
    );
    throw new Error('Failed to annotate screenshot');
  } catch (error: unknown) {
    writeMCPLog(
      `[annotateScreenshot] Error annotating screenshot: ${error instanceof Error ? error.message : String(error)}`,
      'Screenshot Annotation Error'
    );
    return {
      annotatedPath: screenshotPath,
      clickHistoryInfo,
    };
  }
}

/**
 * Mark a point on an image with a visual indicator.
 * Creates a copy of the image with a red circle and crosshair at the specified coordinates.
 * Optionally draws a bounding box if provided.
 * Uses Python PIL/Pillow for cross-platform compatibility.
 */
export async function markPointOnImage(
  imagePath: string,
  x: number,
  y: number,
  outputPath?: string,
  boundingBox?: BoundingBox
): Promise<string> {
  const markedPath = outputPath || imagePath.replace(/\.png$/, '_marked.png');

  try {
    const bboxParams = boundingBox
      ? `bbox = {"left": ${boundingBox.left}, "top": ${boundingBox.top}, "right": ${boundingBox.right}, "bottom": ${boundingBox.bottom}}`
      : 'bbox = None';

    const pythonScript = `
try:
    from PIL import Image, ImageDraw

    # Load image
    img = Image.open("${imagePath.replace(/\\/g, '\\\\')}")
    draw = ImageDraw.Draw(img)

    # Bounding box (if provided)
    ${bboxParams}

    # Draw bounding box if provided
    if bbox:
        draw.rectangle([bbox["left"], bbox["top"], bbox["right"], bbox["bottom"]], outline='green', width=2)

    # Draw center point markers
    x, y = ${x}, ${y}
    radius = 20
    draw.ellipse([x - radius, y - radius, x + radius, y + radius], outline='red', width=3)

    # Draw crosshair
    draw.line([x - 30, y, x + 30, y], fill='red', width=2)
    draw.line([x, y - 30, x, y + 30], fill='red', width=2)

    # Draw center point
    draw.ellipse([x - 2, y - 2, x + 2, y + 2], fill='red')

    # Save marked image
    img.save("${markedPath.replace(/\\/g, '\\\\')}")
    print(f"Success: Marked image saved to ${markedPath.replace(/\\/g, '\\\\')}")
except ImportError:
    print("Error: PIL/Pillow not installed. Install with: pip install Pillow")
    exit(1)
except Exception as e:
    print(f"Error: {e}")
    exit(1)
    `.trim();

    const result = await executePython(pythonScript, 5000);

    if (result.stdout.includes('Success')) {
      const markInfo = boundingBox
        ? `point (${x}, ${y}) with bounding box [${boundingBox.left}, ${boundingBox.top}, ${boundingBox.right}, ${boundingBox.bottom}]`
        : `point (${x}, ${y})`;
      writeMCPLog(
        `[markPointOnImage] Marked ${markInfo} on image, saved to: ${markedPath}`,
        'Image Marking'
      );
      return markedPath;
    }

    throw new Error(result.stdout || result.stderr || 'Unknown error');
  } catch (error: unknown) {
    writeMCPLog(
      `[markPointOnImage] Could not mark image: ${error instanceof Error ? error.message : String(error)}`,
      'Image Marking Warning'
    );
    writeMCPLog(
      `[markPointOnImage] To enable image marking, install Pillow: pip3 install Pillow`,
      'Image Marking Warning'
    );
    return imagePath;
  }
}

/**
 * Get image dimensions.
 */
export async function getImageDimensions(
  imagePath: string
): Promise<{ width: number; height: number }> {
  try {
    if (PLATFORM === 'darwin') {
      const { stdout } = await executeCommandSafe('/usr/bin/sips', [
        '-g',
        'pixelWidth',
        '-g',
        'pixelHeight',
        imagePath,
      ]);
      const widthMatch = stdout.match(/pixelWidth:\s*(\d+)/);
      const heightMatch = stdout.match(/pixelHeight:\s*(\d+)/);

      if (widthMatch && heightMatch) {
        return {
          width: parseInt(widthMatch[1]),
          height: parseInt(heightMatch[1]),
        };
      }
    }

    const buffer = await fs.readFile(imagePath);
    if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
      const width = buffer.readUInt32BE(16);
      const height = buffer.readUInt32BE(20);
      return { width, height };
    }

    throw new Error('Could not determine image dimensions');
  } catch (error: unknown) {
    void error;
    const config = await getDisplayConfiguration();
    const mainDisplay = config.displays.find((d) => d.isMain) || config.displays[0];
    return { width: mainDisplay.width, height: mainDisplay.height };
  }
}
