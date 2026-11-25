import type { CtanClient } from '../api/client.js';
import type {
  ApiLang,
  ConsortiumCatalog,
  ConsortiumId,
  FrequencyDef,
  Line,
  LineDirectionInfo,
  LineStop,
  Municipality,
  NetworkTopology,
  Nucleo,
  Stop,
  StopLineRef,
  SyncProgressCallback,
  TariffZone,
  TransportMode,
} from '../types.js';
import { haversineMeters } from '../utils/geo.js';
import type { CacheStore } from './store.js';

export interface SyncCatalogOptions {
  lang?: ApiLang;
  force?: boolean;
  onProgress?: SyncProgressCallback;
}

export interface SyncTopologyOptions {
  lang?: ApiLang;
  force?: boolean;
  enrichLineDetails?: boolean;
  concurrency?: number;
  onProgress?: SyncProgressCallback;
}

/**
 * Synchronizes a consortium's full metadata catalog (`lines`, `stops`, `nucleos`,
 * `municipios`, `zones`, `modes`, `frequencies`, `fares`) in parallel.
 */
export async function syncConsortiumCatalog(
  client: CtanClient,
  cache: CacheStore,
  consorcioId: ConsortiumId,
  options: SyncCatalogOptions = {},
): Promise<ConsortiumCatalog> {
  const lang = options.lang ?? 'ES';
  if (!options.force) {
    const cached = await cache.getCatalog(consorcioId, lang);
    if (cached) {
      return cached;
    }
  }

  options.onProgress?.(1, 3, `Fetching catalog for consortium ${consorcioId}`);

  const [
    rawLines,
    rawStops,
    rawNucleos,
    rawMunicipios,
    rawZones,
    rawModes,
    rawFrequencies,
    interurbanFares,
    urbanFares,
  ] = await Promise.all([
    client.fetchLines(consorcioId, lang),
    client.fetchStops(consorcioId, lang),
    client.fetchNucleos(consorcioId, lang),
    client.fetchMunicipios(consorcioId, lang),
    client.fetchZones(consorcioId, lang),
    client.fetchTransportModes(consorcioId, lang),
    client.fetchFrequencies(consorcioId, lang),
    client.fetchInterurbanFares(consorcioId, lang),
    client.fetchUrbanFares(consorcioId, lang),
  ]);

  options.onProgress?.(2, 3, 'Indexing consortium entities');

  const municipios: Record<string, Municipality> = {};
  for (const m of rawMunicipios) {
    municipios[m.id] = m;
  }

  const nucleos: Record<string, Nucleo> = {};
  for (const n of rawNucleos) {
    nucleos[n.id] = n;
  }

  const zones: Record<string, TariffZone> = {};
  for (const z of rawZones) {
    zones[z.id] = z;
  }

  const modes: Record<string, TransportMode> = {};
  for (const mode of rawModes) {
    modes[mode.id] = mode;
  }

  const frequencies: Record<string, FrequencyDef> = {};
  for (const freq of rawFrequencies) {
    frequencies[freq.id] = freq;
  }

  const lines: Record<string, Line> = {};
  for (const line of rawLines) {
    lines[line.id] = line;
  }

  const stops: Record<string, Stop> = {};
  for (const stop of rawStops) {
    const nucleoName = stop.nucleoName || nucleos[stop.nucleoId]?.name || '';
    const municipioName = stop.municipioName || municipios[stop.municipioId]?.name || '';
    stops[stop.id] = {
      ...stop,
      nucleoName,
      municipioName,
    };
  }

  const catalog: ConsortiumCatalog = {
    schemaVersion: 1,
    consorcioId,
    syncedAt: new Date().toISOString(),
    lang,
    lines,
    stops,
    nucleos,
    municipios,
    zones,
    modes,
    frequencies,
    interurbanFares,
    urbanFares,
  };

  await cache.saveCatalog(catalog);
  options.onProgress?.(3, 3, 'Catalog ready');
  return catalog;
}

function assignCumulativeDistances(stops: LineStop[]): LineStop[] {
  if (stops.length === 0) {
    return [];
  }
  const result: LineStop[] = [];
  let cumulative = 0;
  let prevLat: number | null = null;
  let prevLon: number | null = null;

  for (let i = 0; i < stops.length; i++) {
    const stop = stops[i]!;
    if (i > 0 && prevLat !== null && prevLon !== null && stop.lat !== null && stop.lon !== null) {
      cumulative += Math.round(haversineMeters(prevLat, prevLon, stop.lat, stop.lon));
    }
    if (stop.lat !== null && stop.lon !== null) {
      prevLat = stop.lat;
      prevLon = stop.lon;
    }
    result.push({
      ...stop,
      distanceMeters: cumulative,
    });
  }

  return result;
}

function detectCircularLine(line: Line, dir1: LineStop[], dir2: LineStop[]): boolean {
  if (line.isCircular) {
    return true;
  }
  if (dir2.length === 0 && dir1.length >= 4) {
    const first = dir1[0]!;
    const last = dir1[dir1.length - 1]!;
    if (first.id === last.id) {
      return true;
    }
    if (first.lat !== null && first.lon !== null && last.lat !== null && last.lon !== null) {
      return haversineMeters(first.lat, first.lon, last.lat, last.lon) <= 500;
    }
  }
  return false;
}

/**
 * Synchronizes ordered stop sequences and reverse stop-to-line graphs for a consortium,
 * enabling multi-transfer stop-to-stop routing and offline topology estimates.
 */
export async function syncConsortiumTopology(
  client: CtanClient,
  cache: CacheStore,
  consorcioId: ConsortiumId,
  options: SyncTopologyOptions = {},
): Promise<NetworkTopology> {
  const lang = options.lang ?? 'ES';
  if (!options.force) {
    const cached = await cache.getTopology(consorcioId);
    if (cached) {
      return cached;
    }
  }

  const catalog = await syncConsortiumCatalog(client, cache, consorcioId, {
    lang,
    force: options.force,
  });

  const lineList = Object.values(catalog.lines);
  const total = lineList.length;
  const concurrency = Math.max(1, Math.min(6, options.concurrency ?? 4));

  const lines: Record<string, Line> = {};
  const lineStops: Record<string, LineStop[]> = {};
  const stops: Record<string, Stop> = {};
  for (const [id, stop] of Object.entries(catalog.stops)) {
    stops[id] = { ...stop, lines: [] };
  }

  const stopLineRefs = new Map<string, Map<string, StopLineRef>>();

  let cursor = 0;
  let completed = 0;

  const worker = async (): Promise<void> => {
    while (cursor < lineList.length) {
      const idx = cursor;
      cursor += 1;
      const baseLine = lineList[idx]!;

      let color = baseLine.color;
      let isCircular = baseLine.isCircular;
      if (options.enrichLineDetails) {
        try {
          const detail = await client.fetchLineDetail(consorcioId, baseLine.id, lang);
          color = detail.color;
          isCircular = detail.isCircular;
        } catch {
          // Keep catalog defaults if detail request fails
        }
      }

      let rawStops: LineStop[] = [];
      try {
        rawStops = await client.fetchLineStops(consorcioId, baseLine.id, lang);
      } catch {
        rawStops = [];
      }

      const byDirection = new Map<number, LineStop[]>();
      for (const ls of rawStops) {
        const list = byDirection.get(ls.direction) ?? [];
        list.push(ls);
        byDirection.set(ls.direction, list);

        if (!stops[ls.id]) {
          stops[ls.id] = {
            id: ls.id,
            code: ls.code,
            name: ls.name,
            nucleoId: ls.nucleoId,
            nucleoName: catalog.nucleos[ls.nucleoId]?.name || '',
            municipioId: catalog.nucleos[ls.nucleoId]?.municipioId || '',
            municipioName: '',
            zoneId: ls.zoneId,
            lat: ls.lat,
            lon: ls.lon,
            modes: ls.modes,
            lines: [],
          };
        }

        let refs = stopLineRefs.get(ls.id);
        if (!refs) {
          refs = new Map<string, StopLineRef>();
          stopLineRefs.set(ls.id, refs);
        }
        if (!refs.has(baseLine.id)) {
          refs.set(baseLine.id, {
            lineId: baseLine.id,
            code: baseLine.code,
            displayCode: baseLine.displayCode,
            color,
          });
        }
      }

      const dir1 = assignCumulativeDistances(
        (byDirection.get(1) ?? []).sort((a, b) => a.order - b.order),
      );
      const dir2 = assignCumulativeDistances(
        (byDirection.get(2) ?? []).sort((a, b) => a.order - b.order),
      );
      const circular = detectCircularLine({ ...baseLine, isCircular }, dir1, dir2);

      const directions: LineDirectionInfo[] = [];
      if (dir1.length > 0) {
        const dirKey = circular ? 99 : 1;
        lineStops[`${baseLine.id}:${dirKey}`] = dir1.map((s) => ({ ...s, direction: dirKey }));
        directions.push({
          direction: dirKey,
          destination: dir1[dir1.length - 1]!.name || baseLine.name,
          startTime: '',
          endTime: '',
        });
      }
      if (dir2.length > 0) {
        lineStops[`${baseLine.id}:2`] = dir2;
        directions.push({
          direction: 2,
          destination: dir2[dir2.length - 1]!.name || baseLine.name,
          startTime: '',
          endTime: '',
        });
      }
      for (const [dir, list] of byDirection.entries()) {
        if (dir !== 1 && dir !== 2 && list.length > 0) {
          const ordered = assignCumulativeDistances(list.sort((a, b) => a.order - b.order));
          lineStops[`${baseLine.id}:${dir}`] = ordered;
          directions.push({
            direction: dir,
            destination: ordered[ordered.length - 1]!.name || baseLine.name,
            startTime: '',
            endTime: '',
          });
        }
      }

      lines[baseLine.id] = {
        ...baseLine,
        color,
        isCircular: circular,
        directions,
      };

      completed += 1;
      options.onProgress?.(completed, total, baseLine.displayCode || baseLine.code);
    }
  };

  if (total > 0) {
    const workerCount = Math.min(concurrency, total);
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
  }

  for (const [stopId, refs] of stopLineRefs.entries()) {
    const stop = stops[stopId];
    if (stop) {
      stop.lines = Array.from(refs.values()).sort((a, b) =>
        a.displayCode.localeCompare(b.displayCode),
      );
    }
  }

  const topology: NetworkTopology = {
    schemaVersion: 1,
    consorcioId,
    syncedAt: new Date().toISOString(),
    lines,
    stops,
    lineStops,
  };

  await cache.saveTopology(topology, { force: options.force });
  return topology;
}
