import os from 'node:os';
import path from 'node:path';

export const CONFIG_DIR_ENV_VAR = 'CTAMD_CONFIG_DIR';
export const DEFAULT_CONSORCIO_ENV_VAR = 'CTAMD_CONSORCIO';

/**
 * Resolves the local user config directory, honoring `CTAMD_CONFIG_DIR` if set.
 */
export function getConfigDir(): string {
  const override = process.env[CONFIG_DIR_ENV_VAR]?.trim();
  if (override) {
    return path.resolve(override);
  }

  if (process.platform === 'win32') {
    const appData = process.env.APPDATA?.trim() || path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(appData, 'ctamd');
  }

  if (process.platform === 'darwin') {
    const xdg = process.env.XDG_CONFIG_HOME?.trim();
    if (xdg) {
      return path.join(xdg, 'ctamd');
    }
    return path.join(os.homedir(), 'Library', 'Application Support', 'ctamd');
  }

  const xdgConfig = process.env.XDG_CONFIG_HOME?.trim() || path.join(os.homedir(), '.config');
  return path.join(xdgConfig, 'ctamd');
}
