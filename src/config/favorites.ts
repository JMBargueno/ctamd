import fs from 'node:fs/promises';
import path from 'node:path';
import { CtamdError, CtamdValidationError } from '../api/errors.js';
import type { ConsortiumId, FavoriteItem, FavoriteKind } from '../types.js';
import { getConfigDir } from './paths.js';

interface FavoritesFile {
  schemaVersion: 1;
  favorites: Record<string, FavoriteItem>;
}

const ALIAS_PATTERN = /^[a-z0-9][a-z0-9_-]{0,31}$/;

/**
 * Validates and normalizes a favorite alias (lowercase, 1-32 chars, non-numeric).
 */
export function normalizeFavoriteAlias(alias: string): string {
  const cleaned = alias.trim().toLowerCase();
  if (!cleaned) {
    throw new CtamdValidationError('Favorite alias cannot be empty.');
  }
  if (/^\d+$/.test(cleaned)) {
    throw new CtamdValidationError(
      `Favorite alias '${cleaned}' cannot be purely numeric because numeric queries represent stop or town IDs.`,
    );
  }
  if (!ALIAS_PATTERN.test(cleaned)) {
    throw new CtamdValidationError(
      `Invalid favorite alias '${alias}'. Use 1-32 letters, digits, '-' or '_', starting with a letter or digit.`,
    );
  }
  return cleaned;
}

export interface FavoritesStoreOptions {
  configDir?: string;
  nowFn?: () => number;
}

export class FavoritesStore {
  readonly configDir: string;
  private readonly nowFn: () => number;

  constructor(options: FavoritesStoreOptions | string = {}) {
    if (typeof options === 'string') {
      this.configDir = path.resolve(options);
      this.nowFn = Date.now;
    } else {
      this.configDir = path.resolve(options.configDir ?? getConfigDir());
      this.nowFn = options.nowFn ?? Date.now;
    }
  }

  private get filePath(): string {
    return path.join(this.configDir, 'favorites.json');
  }

  private async readStore(): Promise<Record<string, FavoriteItem>> {
    let raw: string;
    try {
      raw = await fs.readFile(this.filePath, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') {
        return {};
      }
      throw new CtamdError(
        `Unable to read favorites file '${this.filePath}': ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    let parsed: Partial<FavoritesFile> | null;
    try {
      parsed = JSON.parse(raw) as Partial<FavoritesFile> | null;
    } catch (err) {
      throw new CtamdError(
        `Favorites file '${this.filePath}' contains invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (parsed?.schemaVersion !== 1 || !parsed.favorites || typeof parsed.favorites !== 'object') {
      throw new CtamdError(`Favorites file '${this.filePath}' has an unrecognized schema.`);
    }
    return parsed.favorites;
  }

  private async writeStore(favorites: Record<string, FavoriteItem>): Promise<void> {
    await fs.mkdir(this.configDir, { recursive: true });
    const payload: FavoritesFile = {
      schemaVersion: 1,
      favorites,
    };
    const tmpPath = `${this.filePath}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
    try {
      await fs.writeFile(tmpPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
      await fs.rename(tmpPath, this.filePath);
    } catch (err) {
      await fs.rm(tmpPath, { force: true }).catch(() => undefined);
      throw err;
    }
  }

  async list(): Promise<FavoriteItem[]> {
    const favorites = await this.readStore();
    return Object.values(favorites).sort((a, b) => a.alias.localeCompare(b.alias));
  }

  async get(alias: string): Promise<FavoriteItem | null> {
    const normalized = normalizeFavoriteAlias(alias);
    const favorites = await this.readStore();
    return favorites[normalized] ?? null;
  }

  async add(
    alias: string,
    entry: { consorcioId: ConsortiumId; kind: FavoriteKind; id: string; name: string },
  ): Promise<FavoriteItem> {
    const normalized = normalizeFavoriteAlias(alias);
    const favorites = await this.readStore();
    const item: FavoriteItem = {
      alias: normalized,
      consorcioId: entry.consorcioId,
      kind: entry.kind,
      id: entry.id,
      name: entry.name,
      addedAt: new Date(this.nowFn()).toISOString(),
    };
    favorites[normalized] = item;
    await this.writeStore(favorites);
    return item;
  }

  async remove(alias: string): Promise<boolean> {
    const normalized = normalizeFavoriteAlias(alias);
    const favorites = await this.readStore();
    if (!Object.hasOwn(favorites, normalized)) {
      return false;
    }
    delete favorites[normalized];
    await this.writeStore(favorites);
    return true;
  }

  async resolveAlias(query: string): Promise<FavoriteItem | null> {
    const cleaned = query.trim().toLowerCase();
    if (!cleaned || /^\d+$/.test(cleaned) || !ALIAS_PATTERN.test(cleaned)) {
      return null;
    }
    const favorites = await this.readStore();
    return favorites[cleaned] ?? null;
  }
}
