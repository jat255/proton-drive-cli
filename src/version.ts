const PLATFORM_MAP: Record<string, string> = { darwin: 'macos', win32: 'windows', linux: 'linux' };
const platform = PLATFORM_MAP[process.platform] ?? 'macos';
export const APP_VERSION = platform === 'windows' ? 'windows-drive@1.12.4' : 'macos-drive@2.10.1';
