import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CtamdValidationError } from '../../src/api/errors.js';
import { FavoritesStore, normalizeFavoriteAlias } from '../../src/config/favorites.js';

const tempDirs: string[] = [];

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    await fs.rm(tempDirs.pop()!, { recursive: true, force: true }).catch(() => undefined);
  }
});

describe('FavoritesStore', () => {
  it('validates aliases and stores stop and nucleo favorites across consortia', async () => {
    const dir = await makeTempDir('ctamd-favs-');
    const store = new FavoritesStore({ configDir: dir, nowFn: () => 1_700_000_000_000 });

    expect(normalizeFavoriteAlias(' Casa ')).toBe('casa');
    expect(() => normalizeFavoriteAlias('3023')).toThrow(CtamdValidationError);
    expect(() => normalizeFavoriteAlias('bad alias!')).toThrow(CtamdValidationError);

    await store.add('casa', {
      consorcioId: 1,
      kind: 'stop',
      id: '3023',
      name: 'Plaza de Armas',
    });
    await store.add('armilla', {
      consorcioId: 3,
      kind: 'nucleo',
      id: '176',
      name: 'Armilla',
    });

    const list = await store.list();
    expect(list).toHaveLength(2);
    expect(list[0]?.alias).toBe('armilla');
    expect(list[0]?.consorcioId).toBe(3);
    expect(list[0]?.kind).toBe('nucleo');
    expect(list[1]?.alias).toBe('casa');
    expect(list[1]?.consorcioId).toBe(1);

    expect(await store.resolveAlias('3023')).toBeNull();
    expect((await store.resolveAlias('CASA'))?.id).toBe('3023');

    expect(await store.remove('casa')).toBe(true);
    expect(await store.remove('missing')).toBe(false);
  });
});
