import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CacheStore } from '../../src/cache/store.js';
import type { ConsortiumCatalog, NetworkTopology, StopServicesResult } from '../../src/types.js';

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

describe('CacheStore', () => {
  it('partitions catalogs and topologies per consortium and enforces TTLs + 80% completeness', async () => {
    const cacheDir = await makeTempDir('ctamd-cache-');
    let nowMs = Date.parse('2026-11-25T08:00:00.000Z');
    const store = new CacheStore({ cacheDir, nowFn: () => nowMs });

    const sevCatalog: ConsortiumCatalog = {
      schemaVersion: 1,
      consorcioId: 1,
      syncedAt: new Date(nowMs).toISOString(),
      lang: 'ES',
      lines: {
        '1': {
          id: '1',
          code: '1011',
          displayCode: 'M-101A',
          name: 'Line',
          modeId: '1',
          mode: 'Bus',
          operators: [],
          hasNews: false,
          color: '#00a86b',
          isCircular: false,
          directions: [],
        },
      },
      stops: {},
      nucleos: {},
      municipios: {},
      zones: {},
      modes: {},
      frequencies: {},
      interurbanFares: [],
      urbanFares: [],
    };
    await store.saveCatalog(sevCatalog);
    expect(await store.getCatalog(1, 'ES')).not.toBeNull();
    expect(await store.getCatalog(3, 'ES')).toBeNull();

    const baseTopo: NetworkTopology = {
      schemaVersion: 1,
      consorcioId: 1,
      syncedAt: new Date(nowMs).toISOString(),
      lines: {
        '1': sevCatalog.lines['1']!,
        '2': sevCatalog.lines['1']!,
        '3': sevCatalog.lines['1']!,
        '4': sevCatalog.lines['1']!,
        '5': sevCatalog.lines['1']!,
      },
      stops: {},
      lineStops: {},
    };
    await store.saveTopology(baseTopo);

    const incompleteTopo: NetworkTopology = {
      ...baseTopo,
      lines: { '1': sevCatalog.lines['1']! },
    };
    await expect(store.saveTopology(incompleteTopo)).rejects.toThrow('Incomplete topology sync');

    // Fresh/stale services fallback
    const services: StopServicesResult = {
      consorcioId: 1,
      stopId: '3023',
      stopCode: '3023',
      stopName: 'Plaza de Armas',
      nucleoName: 'Sevilla',
      lat: 37.39,
      lon: -6.0,
      windowStart: '2026-11-25 08:00',
      windowEnd: '2026-11-25 09:00',
      fetchedAt: new Date(nowMs).toISOString(),
      stale: false,
      source: 'scheduled',
      providerName: 'ctan-scheduled',
      services: [],
    };
    await store.saveServices(1, '3023', services);
    expect((await store.getServices(1, '3023'))?.stale).toBe(false);

    nowMs += 90_000; // past 60s fresh TTL, within 10m stale TTL
    expect(await store.getServices(1, '3023')).toBeNull();
    expect((await store.getStaleServices(1, '3023'))?.stale).toBe(true);

    const status = await store.getStatus();
    expect(status.consortiums).toHaveLength(1);
    expect(status.consortiums[0]?.shortCode).toBe('CTAS');

    await store.clear(1);
    expect((await store.getStatus()).consortiums).toHaveLength(0);
  });
});
