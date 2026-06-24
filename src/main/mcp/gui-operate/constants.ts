import * as os from 'os';
import * as path from 'path';

export const PLATFORM = os.platform(); // 'darwin' for macOS, 'win32' for Windows

export const OPEN_COWORK_DATA_DIR =
  PLATFORM === 'win32'
    ? path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'open-cowork')
    : path.join(os.homedir(), 'Library', 'Application Support', 'open-cowork');

export const GUI_OPERATE_DIR = path.join(OPEN_COWORK_DATA_DIR, 'gui_operate');
export const SCREENSHOTS_DIR = path.join(GUI_OPERATE_DIR, 'screenshots');
export const SCREENSHOT_REUSE_WINDOW_MS = 5 * 60_000;
export const OPENAI_PLATFORM_BASE_URL = 'https://api.openai.com/v1';

export const APP_NAME_ALIAS_GROUPS: string[][] = [
  ['calendar', '日历'],
  ['notes', '备忘录'],
  ['music', '音乐'],
  ['finder', '访达'],
  ['system settings', 'settings', '系统设置'],
  ['ticktick', '滴答清单'],
  ['wechat', '微信'],
  ['trash', '废纸篓'],
  ['chrome', 'google chrome'],
];

export const GUI_APPS_DIR = path.join(OPEN_COWORK_DATA_DIR, 'gui_apps');
export const GUI_LAST_APP_FILE = path.join(GUI_APPS_DIR, '_last_app.json');

export const DISPLAY_CONFIG_CACHE_TTL = 5000; // 5 seconds cache
