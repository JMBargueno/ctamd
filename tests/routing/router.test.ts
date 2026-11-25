import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CtanClient } from '../../src/api/client.js';
import { CacheStore } from '../../src/cache/store.js';
import { findCandidateCorridors } from '../../src/routing/corridors.js';
import {
  buildEstimatedJourneysFromCorridors,
  findJourneysFromCorridors,
  removeDominated,
  routeWithHydrationDetailed,
} from '../../src/routing/router.js';
import type { NetworkTopology } from '../../src/types.js';

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

function createTopology(): NetworkTopology {
  return {
    schemaVersion: 1,
    consorcioId: 1,
    syncedAt: new Date().toISOString(),
    lines: {
      '10': {
        id: '10',
        code: '1010',
        displayCode: 'M-101',
        name: 'M-101 Sevilla - Mairena',
        modeId: '1',
        mode: 'Bus',
        operators: ['DAMAS'],
        hasNews: false,
        color: '#00a86b',
        isCircular: false,
        directions: [{ direction: 1, destination: 'Mairena', startTime: '', endTime: '' }],
      },
      '20': {
        id: '20',
        code: '1520',
        displayCode: 'M-152',
        name: 'M-152 Mairena - Almensilla',
        modeId: '1',
        mode: 'Bus',
        operators: ['DAMAS'],
        hasNews: false,
        color: '#e63946',
        isCircular: false,
        directions: [{ direction: 1, destination: 'Almensilla', startTime: '', endTime: '' }],
      },
    },
    stops: {
      S1: {
        id: 'S1',
        code: 'S1',
        name: 'Plaza de Armas',
        nucleoId: '3225',
        nucleoName: 'Sevilla',
        municipioId: '1',
        municipioName: 'Sevilla',
        zoneId: 'A',
        lat: 37.391,
        lon: -6.003,
        modes: 'Bus',
        lines: [{ lineId: '10', code: '1010', displayCode: 'M-101', color: '#00a86b' }],
      },
      S2: {
        id: 'S2',
        code: 'S2',
        name: 'Ciudad Expo',
        nucleoId: '3196',
        nucleoName: 'Mairena',
        municipioId: '2',
        municipioName: 'Mairena',
        zoneId: 'B',
        lat: 37.35,
        lon: -6.05,
        modes: 'Bus',
        lines: [
          { lineId: '10', code: '1010', displayCode: 'M-101', color: '#00a86b' },
          { lineId: '20', code: '1520', displayCode: 'M-152', color: '#e63946' },
        ],
      },
      S3: {
        id: 'S3',
        code: 'S3',
        name: 'Almensilla Centro',
        nucleoId: '3122',
        nucleoName: 'Almensilla',
        municipioId: '3',
        municipioName: 'Almensilla',
        zoneId: 'C',
        lat: 37.31,
        lon: -6.11,
        modes: 'Bus',
        lines: [{ lineId: '20', code: '1520', displayCode: 'M-152', color: '#e63946' }],
      },
    },
    lineStops: {
      '10:1': [
        {
          id: 'S1',
          code: 'S1',
          name: 'Plaza de Armas',
          nucleoId: '3225',
          zoneId: 'A',
          lat: 37.391,
          lon: -6.003,
          direction: 1,
          order: 1,
          distanceMeters: 0,
          modes: 'Bus',
          startTime: null,
          endTime: null,
        },
        {
          id: 'S2',
          code: 'S2',
          name: 'Ciudad Expo',
          nucleoId: '3196',
          zoneId: 'B',
          lat: 37.35,
          lon: -6.05,
          direction: 1,
          order: 2,
          distanceMeters: 6200,
          modes: 'Bus',
          startTime: null,
          endTime: null,
        },
      ],
      '20:1': [
        {
          id: 'S2',
          code: 'S2',
          name: 'Ciudad Expo',
          nucleoId: '3196',
          zoneId: 'B',
          lat: 37.35,
          lon: -6.05,
          direction: 1,
          order: 1,
          distanceMeters: 0,
          modes: 'Bus',
          startTime: null,
          endTime: null,
        },
        {
          id: 'S3',
          code: 'S3',
          name: 'Almensilla Centro',
          nucleoId: '3122',
          zoneId: 'C',
          lat: 37.31,
          lon: -6.11,
          direction: 1,
          order: 2,
          distanceMeters: 6900,
          modes: 'Bus',
          startTime: null,
          endTime: null,
        },
      ],
    },
  };
}

describe('Stop-to-stop CTAN routing', () => {
  it('finds multi-transfer corridors and builds offline topology estimates', () => {
    const topo = createTopology();
    const corridors = findCandidateCorridors(topo, 'S1', 'S3', { maxTransfers: 2 });
    expect(corridors).toHaveLength(1);
    expect(corridors[0]!.legs.map((l) => l.lineLabel)).toEqual(['M-101', 'M-152']);

    const est = buildEstimatedJourneysFromCorridors(topo, corridors, {
      anchorSeconds: 9 * 3600,
    });
    expect(est).toHaveLength(1);
    expect(est[0]!.estimated).toBe(true);
    expect(est[0]!.transferCount).toBe(1);
    expect(est[0]!.departureSeconds).toBe(9 * 3600);
  });

  it('aligns timed schedules and prunes Pareto-dominated journeys', () => {
    const topo = createTopology();
    const corridors = findCandidateCorridors(topo, 'S1', 'S3', { maxTransfers: 1 });
    const schedules: Record<string, Record<string, number[]>> = {
      '10:S1': { t: [8 * 3600, 9 * 3600] },
      '10:S2': { t: [8 * 3600 + 15 * 60, 9 * 3600 + 15 * 60] },
      '20:S2': { t: [8 * 3600 + 25 * 60, 9 * 3600 + 20 * 60] },
      '20:S3': { t: [8 * 3600 + 40 * 60, 9 * 3600 + 35 * 60] },
    };

    const journeys = findJourneysFromCorridors(
      topo,
      corridors,
      (lineId, stopCode) => schedules[`${lineId}:${stopCode}`]?.t ?? [],
    );
    expect(journeys).toHaveLength(2);
    expect(journeys[0]!.transfers[0]!.waitSeconds).toBe(10 * 60);

    const pruned = removeDominated([
      ...journeys,
      {
        ...journeys[0]!,
        arrivalSeconds: journeys[0]!.arrivalSeconds + 600,
        durationSeconds: journeys[0]!.durationSeconds + 600,
      },
    ]);
    expect(pruned).toHaveLength(2);
  });

  it('hydrates stop schedules with rate-limit resilience in routeWithHydrationDetailed', async () => {
    const cacheDir = await makeTempDir('ctamd-router-');
    const cache = new CacheStore(cacheDir);
    const topo = createTopology();

    const client = new CtanClient({
      maxRetries: 0,
      fetchImpl: async () => new Response(null, { status: 429, headers: { 'Retry-After': '60' } }),
    });

    const estRes = await routeWithHydrationDetailed(client, cache, topo, {
      fromStopCode: 'S1',
      toStopCode: 'S3',
      estimate: true,
    });
    expect(estRes.estimatedFallback).toBe(true);
    expect(estRes.journeys).toHaveLength(1);

    await expect(
      routeWithHydrationDetailed(client, cache, topo, {
        fromStopCode: 'S1',
        toStopCode: 'S3',
        afterSeconds: 8 * 3600,
      }),
    ).rejects.toMatchObject({ statusCode: 429 });
  });
});
