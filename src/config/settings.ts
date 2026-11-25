import fs from 'node:fs/promises';
import path from 'node:path';
import { CtamdError } from '../api/errors.js';
import { isValidConsortiumId } from '../consortiums.js';
import type { ConsortiumId, UserConfig } from '../types.js';
import { getConfigDir } from './paths.js';

export interface UserConfigStoreOptions {
  configDir?: string;
}

export class UserConfigStore {
  readonly configDir: string;

  constructor(options: UserConfigStoreOptions | string = {}) {
    if (typeof options === 'string') {
      this.configDir = path.resolve(options);
    } else {
      this.configDir = path.resolve(options.configDir ?? getConfigDir());
    }
  }

  private get filePath(): string {
    return path.join(this.configDir, 'config.json');
  }

  async read(): Promise<UserConfig> {
    let raw: string;
    try {
      raw = await fs.readFile(this.filePath, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') {
        return { schemaVersion: 1 };
      }
      throw new CtamdError(
        `Unable to read config file '${this.filePath}': ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    let parsed: Partial<UserConfig> | null;
    try {
      parsed = JSON.parse(raw) as Partial<UserConfig> | null;
    } catch (err) {
      throw new CtamdError(
        `Config file '${this.filePath}' contains invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (parsed?.schemaVersion !== 1) {
      throw new CtamdError(`Config file '${this.filePath}' has an unrecognized schema.`);
    }

    const defaultId =
      typeof parsed.defaultConsortiumId === 'number' &&
      isValidConsortiumId(parsed.defaultConsortiumId)
        ? parsed.defaultConsortiumId
        : undefined;

    return {
      schemaVersion: 1,
      ...(defaultId !== undefined ? { defaultConsortiumId: defaultId } : {}),
    };
  }

  private async write(config: UserConfig): Promise<void> {
    await fs.mkdir(this.configDir, { recursive: true });
    const tmpPath = `${this.filePath}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
    try {
      await fs.writeFile(tmpPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
      await fs.rename(tmpPath, this.filePath);
    } catch (err) {
      await fs.rm(tmpPath, { force: true }).catch(() => undefined);
      throw err;
    }
  }

  async getDefaultConsortiumId(): Promise<ConsortiumId | undefined> {
    const config = await this.read();
    return config.defaultConsortiumId;
  }

  async setDefaultConsortiumId(consorcioId: ConsortiumId): Promise<UserConfig> {
    const current = await this.read();
    const updated: UserConfig = {
      ...current,
      schemaVersion: 1,
      defaultConsortiumId: consorcioId,
    };
    await this.write(updated);
    return updated;
  }

  async clearDefaultConsortiumId(): Promise<UserConfig> {
    const current = await this.read();
    const updated: UserConfig = { schemaVersion: 1 };
    if (current.defaultConsortiumId === undefined) {
      return updated;
    }
    await this.write(updated);
    return updated;
  }
}
