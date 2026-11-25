import { CtanClient, type CtanClientOptions } from './api/client.js';
import { CtamdValidationError } from './api/errors.js';
import { CacheStore } from './cache/store.js';
import { syncConsortiumCatalog, syncConsortiumTopology } from './cache/sync.js';
import { CONSORTIUMS, findNearestConsortiums, resolveConsortium } from './consortiums.js';
import { ArrivalProviderRegistry } from './realtime/provider.js';
import { parseOdSchedule } from './routing/odParser.js';
import { fetchStopTimesByLine, routeWithHydrationDetailed } from './routing/router.js';
import type {
  ApiLang,
  CacheStatus,
  ConsortiumCatalog,
  ConsortiumId,
  ConsortiumInfo,
  FareJumpResult,
  FaresSummary,
  Line,
  LineDetail,
  LineDirectionInfo,
  LineSchedule,
  LineStop,
  NearbyStop,
  NetworkTopology,
  Nucleo,
  OdScheduleResult,
  RouteSearchOptions,
  RouteSearchResult,
  SalesPoint,
  ServiceAlert,
  Stop,
  StopServicesResult,
  SyncProgressCallback,
} from './types.js';
import { boundingBox, haversineMeters } from './utils/geo.js';
import { normalizeSearchText } from './utils/text.js';
import { formatDateKey } from './utils/time.js';

export interface CtamdOptions {
  cacheDir?: string;
  client?: CtanClient;
  cache?: CacheStore;
  providerRegistry?: ArrivalProviderRegistry;
  clientOptions?: CtanClientOptions;
  defaultLang?: ApiLang;
}

export interface LineRoute {
  consorcioId: ConsortiumId;
  line: LineDetail;
  directions: Array<{
    info: LineDirectionInfo;
    stops: LineStop[];
  }>;
  schedule?: LineSchedule;
}

export interface StopScheduleEntry {
  lineId: string;
  lineCode: string;
  displayCode: string;
  lineName: string;
  lineColor: string;
  times: string[];
}

export function normalizeLineQuery(label: string): string[] {
  const cleaned = label.trim().toUpperCase();
  if (!cleaned) {
    return [];
  }
  const candidates = new Set<string>([cleaned, cleaned.replace(/-/g, '')]);
  if (/^\d+$/.test(cleaned)) {
    const stripped = cleaned.replace(/^0+/, '') || '0';
    candidates.add(stripped);
    if (stripped.length < 4) {
      candidates.add(stripped.padStart(4, '0'));
    }
  }
  return Array.from(candidates);
}

export function findMatchingLine(lines: readonly Line[], query: string): Line | undefined {
  const trimmed = query.trim();
  if (!trimmed) {
    return undefined;
  }

  const byId = lines.find((line) => line.id === trimmed);
  if (byId) {
    return byId;
  }

  const candidates = normalizeLineQuery(trimmed);
  for (const cand of candidates) {
    const exactDisplay = lines.find(
      (line) =>
        line.displayCode.toUpperCase() === cand ||
        line.displayCode.toUpperCase().replace(/-/g, '') === cand,
    );
    if (exactDisplay) {
      return exactDisplay;
    }

    const exactCode = lines.find(
      (line) =>
        line.code.toUpperCase() === cand || line.code.toUpperCase().replace(/-/g, '') === cand,
    );
    if (exactCode) {
      return exactCode;
    }
  }

  const normQuery = normalizeSearchText(trimmed);
  const byName = lines.filter((line) => normalizeSearchText(line.name).includes(normQuery));
  if (byName.length === 1) {
    return byName[0];
  }

  return undefined;
}

function assignCumulativeDistances(stops: LineStop[]): LineStop[] {
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
    result.push({ ...stop, distanceMeters: cumulative });
  }
  return result;
}

export class Ctamd {
  readonly client: CtanClient;
  readonly cache: CacheStore;
  readonly providers: ArrivalProviderRegistry;
  readonly defaultLang: ApiLang;

  constructor(options: CtamdOptions = {}) {
    this.client = options.client ?? new CtanClient(options.clientOptions);
    this.cache = options.cache ?? new CacheStore(options.cacheDir);
    this.providers = options.providerRegistry ?? new ArrivalProviderRegistry(this.client);
    this.defaultLang = options.defaultLang ?? 'ES';
  }

  listConsortiums(): readonly ConsortiumInfo[] {
    return CONSORTIUMS;
  }

  resolveConsortium(input: string | number): ConsortiumInfo {
    return resolveConsortium(input);
  }

  async getCatalog(
    consorcio: string | number,
    options: { lang?: ApiLang; refresh?: boolean; onProgress?: SyncProgressCallback } = {},
  ): Promise<ConsortiumCatalog> {
    const info = resolveConsortium(consorcio);
    const lang = options.lang ?? this.defaultLang;
    return syncConsortiumCatalog(this.client, this.cache, info.id, {
      lang,
      force: options.refresh,
      onProgress: options.onProgress,
    });
  }

  async ensureTopology(
    consorcio: string | number,
    options: {
      lang?: ApiLang;
      refresh?: boolean;
      enrichLineDetails?: boolean;
      onProgress?: SyncProgressCallback;
    } = {},
  ): Promise<NetworkTopology> {
    const info = resolveConsortium(consorcio);
    const lang = options.lang ?? this.defaultLang;
    return syncConsortiumTopology(this.client, this.cache, info.id, {
      lang,
      force: options.refresh,
      enrichLineDetails: options.enrichLineDetails,
      onProgress: options.onProgress,
    });
  }

  async matchStops(
    consorcio: string | number,
    query: string,
    options: { lang?: ApiLang; refresh?: boolean } = {},
  ): Promise<Stop[]> {
    const trimmed = query.trim();
    if (!trimmed) {
      return [];
    }

    const catalog = await this.getCatalog(consorcio, options);
    const allStops = Object.values(catalog.stops);

    if (/^\d+$/.test(trimmed)) {
      const exact = catalog.stops[trimmed] ?? allStops.find((s) => s.code === trimmed);
      if (exact) {
        return [exact];
      }
    }

    const normQuery = normalizeSearchText(trimmed);
    const nameExact: Stop[] = [];
    const nameMatches: Stop[] = [];
    const townMatches: Stop[] = [];

    for (const stop of allStops) {
      const normName = normalizeSearchText(stop.name);
      if (normName === normQuery) {
        nameExact.push(stop);
      } else if (normName.includes(normQuery)) {
        nameMatches.push(stop);
      } else if (
        normalizeSearchText(stop.nucleoName).includes(normQuery) ||
        normalizeSearchText(stop.municipioName).includes(normQuery)
      ) {
        townMatches.push(stop);
      }
    }

    const sortByName = (a: Stop, b: Stop) =>
      a.name.localeCompare(b.name) ||
      a.nucleoName.localeCompare(b.nucleoName) ||
      a.id.localeCompare(b.id);

    return [
      ...nameExact.sort(sortByName),
      ...nameMatches.sort(sortByName),
      ...townMatches.sort(sortByName),
    ];
  }

  async matchNucleos(
    consorcio: string | number,
    query: string,
    options: { lang?: ApiLang; refresh?: boolean } = {},
  ): Promise<Nucleo[]> {
    const trimmed = query.trim();
    if (!trimmed) {
      return [];
    }

    const catalog = await this.getCatalog(consorcio, options);
    const allNucleos = Object.values(catalog.nucleos);

    if (/^\d+$/.test(trimmed)) {
      const exact = catalog.nucleos[trimmed];
      if (exact) {
        return [exact];
      }
    }

    const normQuery = normalizeSearchText(trimmed);
    const exact: Nucleo[] = [];
    const startsWith: Nucleo[] = [];
    const includes: Nucleo[] = [];

    for (const nucleo of allNucleos) {
      const normName = normalizeSearchText(nucleo.name);
      if (normName === normQuery) {
        exact.push(nucleo);
      } else if (normName.startsWith(normQuery)) {
        startsWith.push(nucleo);
      } else if (normName.includes(normQuery)) {
        includes.push(nucleo);
      }
    }

    const sortByName = (a: Nucleo, b: Nucleo) =>
      a.name.localeCompare(b.name) || a.id.localeCompare(b.id);

    return [
      ...exact.sort(sortByName),
      ...startsWith.sort(sortByName),
      ...includes.sort(sortByName),
    ];
  }

  async getStopServices(
    consorcio: string | number,
    stopId: string,
    options: {
      startDateTime?: Date;
      hours?: number;
      noCache?: boolean;
      lang?: ApiLang;
      now?: Date;
    } = {},
  ): Promise<StopServicesResult & { warnings: string[] }> {
    const info = resolveConsortium(consorcio);
    const cleanId = stopId.trim();
    if (!cleanId) {
      throw new CtamdValidationError('Stop ID cannot be empty.');
    }

    const hours = Math.max(1, Math.min(24, Math.trunc(options.hours ?? 1)));
    const canUseFreshCache = !options.noCache && !options.startDateTime && hours === 1;
    const windowKey = `h${hours}`;

    if (canUseFreshCache) {
      const fresh = await this.cache.getServices(info.id, cleanId, windowKey);
      if (fresh) {
        return { ...fresh, warnings: [] };
      }
    }

    let catalog: ConsortiumCatalog | null = null;
    try {
      catalog = await this.getCatalog(info.id, { lang: options.lang });
    } catch {
      // Allow live stop service query even if catalog sync fails
    }

    let stop = catalog?.stops[cleanId];
    if (!stop) {
      try {
        stop = await this.client.fetchStopDetail(info.id, cleanId);
      } catch {
        // Proceed with minimal stop metadata
      }
    }

    try {
      const { result, warnings } = await this.providers.fetchStopServices(info.id, cleanId, {
        startDateTime: options.startDateTime,
        hours,
        lang: options.lang ?? this.defaultLang,
        now: options.now,
        stop,
        linesById: catalog?.lines,
      });

      if (canUseFreshCache) {
        await this.cache.saveServices(info.id, cleanId, result, windowKey);
      }

      return { ...result, warnings };
    } catch (err) {
      if (canUseFreshCache) {
        const stale = await this.cache.getStaleServices(info.id, cleanId, windowKey);
        if (stale) {
          return { ...stale, warnings: [] };
        }
      }
      throw err;
    }
  }

  async getStopDaySchedule(
    consorcio: string | number,
    stopId: string,
    date: Date = new Date(),
    options: { lineQuery?: string; lang?: ApiLang; refresh?: boolean } = {},
  ): Promise<{
    consorcioId: ConsortiumId;
    stop: Stop;
    date: string;
    entries: StopScheduleEntry[];
  }> {
    const info = resolveConsortium(consorcio);
    const cleanId = stopId.trim();
    const catalog = await this.getCatalog(info.id, { lang: options.lang });
    const stop = catalog.stops[cleanId] ?? (await this.client.fetchStopDetail(info.id, cleanId));

    const dateKey = formatDateKey(date);
    let byLine = options.refresh
      ? null
      : await this.cache.getStopDaySchedules(info.id, cleanId, dateKey);

    if (!byLine) {
      byLine = await fetchStopTimesByLine(this.client, info.id, cleanId, date, {
        startHour: 5,
        endHour: 23,
      });
      await this.cache.saveStopDaySchedules(info.id, cleanId, dateKey, byLine);
    }

    const lineFilterCandidates = options.lineQuery
      ? new Set(normalizeLineQuery(options.lineQuery))
      : null;

    if (options.lineQuery) {
      const matchedCatalog = findMatchingLine(Object.values(catalog.lines), options.lineQuery);
      if (matchedCatalog) {
        lineFilterCandidates?.add(matchedCatalog.id);
        lineFilterCandidates?.add(matchedCatalog.code.toUpperCase());
        lineFilterCandidates?.add(matchedCatalog.displayCode.toUpperCase());
      }
    }

    const entries: StopScheduleEntry[] = [];
    for (const [lineId, times] of Object.entries(byLine)) {
      const line = catalog.lines[lineId];
      const displayCode = line?.displayCode ?? lineId;
      const lineCode = line?.code ?? lineId;

      if (lineFilterCandidates) {
        const matches =
          lineFilterCandidates.has(lineId.toUpperCase()) ||
          lineFilterCandidates.has(lineCode.toUpperCase()) ||
          lineFilterCandidates.has(displayCode.toUpperCase()) ||
          lineFilterCandidates.has(displayCode.toUpperCase().replace(/-/g, ''));
        if (!matches) {
          continue;
        }
      }

      entries.push({
        lineId,
        lineCode,
        displayCode,
        lineName: line?.name ?? '',
        lineColor: line?.color ?? '#00a86b',
        times,
      });
    }

    entries.sort((a, b) => a.displayCode.localeCompare(b.displayCode));
    return {
      consorcioId: info.id,
      stop,
      date: dateKey,
      entries,
    };
  }

  async getLines(
    consorcio: string | number,
    options: {
      mode?: string;
      nucleoQuery?: string;
      search?: string;
      lang?: ApiLang;
      refresh?: boolean;
    } = {},
  ): Promise<Line[]> {
    const info = resolveConsortium(consorcio);
    const catalog = await this.getCatalog(info.id, {
      lang: options.lang,
      refresh: options.refresh,
    });

    let lines = Object.values(catalog.lines);

    if (options.nucleoQuery) {
      const nucleos = await this.matchNucleos(info.id, options.nucleoQuery, { lang: options.lang });
      if (nucleos.length === 0) {
        throw new CtamdValidationError(
          `No town/núcleo matched '${options.nucleoQuery}' in ${info.name}.`,
        );
      }
      const nucleoLines = await this.client.fetchNucleoLines(info.id, nucleos[0]!.id);
      const allowedIds = new Set(nucleoLines.map((l) => l.id));
      lines = lines.filter((l) => allowedIds.has(l.id));
    }

    if (options.mode) {
      const normMode = normalizeSearchText(options.mode);
      lines = lines.filter((l) => normalizeSearchText(l.mode).includes(normMode));
    }

    if (options.search) {
      const normSearch = normalizeSearchText(options.search);
      lines = lines.filter(
        (l) =>
          normalizeSearchText(l.displayCode).includes(normSearch) ||
          normalizeSearchText(l.code).includes(normSearch) ||
          normalizeSearchText(l.name).includes(normSearch),
      );
    }

    return lines.sort(
      (a, b) => a.displayCode.localeCompare(b.displayCode) || a.code.localeCompare(b.code),
    );
  }

  async getLineRoute(
    consorcio: string | number,
    lineQuery: string,
    options: {
      lang?: ApiLang;
      includeSchedule?: boolean;
      date?: Date;
      refresh?: boolean;
    } = {},
  ): Promise<LineRoute> {
    const info = resolveConsortium(consorcio);
    const lang = options.lang ?? this.defaultLang;
    const catalog = await this.getCatalog(info.id, { lang, refresh: options.refresh });
    const matched = findMatchingLine(Object.values(catalog.lines), lineQuery);
    if (!matched) {
      throw new CtamdValidationError(
        `Unknown line '${lineQuery}' in ${info.name} (${info.shortCode}).`,
      );
    }

    const [detail, rawStops] = await Promise.all([
      this.client.fetchLineDetail(info.id, matched.id, lang),
      this.client.fetchLineStops(info.id, matched.id, lang),
    ]);

    const grouped = new Map<number, LineStop[]>();
    for (const stop of rawStops) {
      const list = grouped.get(stop.direction) ?? [];
      list.push(stop);
      grouped.set(stop.direction, list);
    }

    const directions: LineRoute['directions'] = [];
    for (const dirNum of Array.from(grouped.keys()).sort((a, b) => a - b)) {
      const ordered = assignCumulativeDistances(
        grouped.get(dirNum)!.sort((a, b) => a.order - b.order),
      );
      const dirInfo: LineDirectionInfo = {
        direction: dirNum,
        destination: ordered[ordered.length - 1]?.name || detail.name,
        startTime: '',
        endTime: '',
      };
      directions.push({ info: dirInfo, stops: ordered });
    }

    let schedule: LineSchedule | undefined;
    if (options.includeSchedule) {
      const date = options.date ?? new Date();
      const monthDayKey = `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
      const cached = options.refresh
        ? null
        : await this.cache.getLineSchedule(info.id, detail.id, monthDayKey, lang);
      if (cached) {
        schedule = cached;
      } else {
        schedule = await this.client.fetchLineSchedule(info.id, detail.id, {
          lang,
          day: date.getDate(),
          month: date.getMonth() + 1,
        });
        await this.cache.saveLineSchedule(info.id, detail.id, monthDayKey, lang, schedule);
      }
    }

    return {
      consorcioId: info.id,
      line: {
        ...detail,
        directions: directions.map((d) => d.info),
      },
      directions,
      ...(schedule ? { schedule } : {}),
    };
  }

  async getFares(
    consorcio: string | number,
    options: {
      fromNucleoId?: string;
      toNucleoId?: string;
      lang?: ApiLang;
      refresh?: boolean;
    } = {},
  ): Promise<FaresSummary> {
    const info = resolveConsortium(consorcio);
    const lang = options.lang ?? this.defaultLang;
    const catalog = await this.getCatalog(info.id, { lang, refresh: options.refresh });

    let jumpCalculation: FareJumpResult | null = null;
    if (options.fromNucleoId && options.toNucleoId) {
      const rawJump = await this.client.fetchCalculateJumps(
        info.id,
        options.fromNucleoId,
        options.toNucleoId,
        lang,
      );
      const matchedFare =
        rawJump.jumps !== null
          ? catalog.interurbanFares.find((f) => f.jumps === rawJump.jumps)
          : undefined;
      jumpCalculation = {
        ...rawJump,
        originNucleoName: catalog.nucleos[options.fromNucleoId]?.name ?? options.fromNucleoId,
        destinationNucleoName: catalog.nucleos[options.toNucleoId]?.name ?? options.toNucleoId,
        singleTicketEur: matchedFare?.singleTicketEur ?? null,
        cardEur: matchedFare?.cardEur ?? null,
      };
    }

    return {
      consorcioId: info.id,
      interurban: catalog.interurbanFares,
      urban: catalog.urbanFares,
      jumpCalculation,
    };
  }

  async getNearbyStops(
    lat: number,
    lon: number,
    options: {
      consorcio?: string | number;
      allAreas?: boolean;
      radius?: number;
      limit?: number;
      withServices?: boolean;
      lang?: ApiLang;
    } = {},
  ): Promise<NearbyStop[]> {
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
      throw new CtamdValidationError(`Invalid latitude '${lat}'. Expected a number in [-90, 90].`);
    }
    if (!Number.isFinite(lon) || lon < -180 || lon > 180) {
      throw new CtamdValidationError(
        `Invalid longitude '${lon}'. Expected a number in [-180, 180].`,
      );
    }

    const radius = Math.max(0, options.radius ?? 500);
    const limit = Math.max(1, options.limit ?? 10);
    const lang = options.lang ?? this.defaultLang;

    let targetConsortiums: ConsortiumInfo[];
    if (options.consorcio !== undefined) {
      targetConsortiums = [resolveConsortium(options.consorcio)];
    } else if (options.allAreas) {
      targetConsortiums = [...CONSORTIUMS];
    } else {
      const nearest = findNearestConsortiums(lat, lon, 2);
      const within = nearest.filter((n) => n.withinRadius).map((n) => n.consortium);
      targetConsortiums = within.length > 0 ? within : [nearest[0]!.consortium];
    }

    const catalogs = await Promise.all(
      targetConsortiums.map((c) => this.getCatalog(c.id, { lang })),
    );

    const box = boundingBox(lat, lon, radius * 1.1);
    const nearby: NearbyStop[] = [];

    for (const catalog of catalogs) {
      for (const stop of Object.values(catalog.stops)) {
        if (stop.lat === null || stop.lon === null) {
          continue;
        }
        if (
          stop.lat < box.latMin ||
          stop.lat > box.latMax ||
          stop.lon < box.lonMin ||
          stop.lon > box.lonMax
        ) {
          continue;
        }
        const distanceMeters = Math.round(haversineMeters(lat, lon, stop.lat, stop.lon));
        if (distanceMeters <= radius) {
          nearby.push({
            consorcioId: catalog.consorcioId,
            id: stop.id,
            code: stop.code,
            name: stop.name,
            nucleoName: stop.nucleoName,
            municipioName: stop.municipioName,
            zoneId: stop.zoneId,
            lat: stop.lat,
            lon: stop.lon,
            distanceMeters,
            lines: stop.lines,
          });
        }
      }
    }

    nearby.sort((a, b) => a.distanceMeters - b.distanceMeters || a.id.localeCompare(b.id));
    const filtered = nearby.slice(0, limit);

    if (options.withServices && filtered.length > 0) {
      const topStops = filtered.slice(0, 3);
      for (const stop of topStops) {
        try {
          stop.services = await this.getStopServices(stop.consorcioId, stop.id, { lang });
        } catch {
          // Leave services undefined on individual failure
        }
      }
    }

    return filtered;
  }

  async getSalesPoints(
    consorcio: string | number,
    options: {
      query?: string;
      nucleoQuery?: string;
      lat?: number;
      lon?: number;
      radius?: number;
      limit?: number;
      lang?: ApiLang;
      refresh?: boolean;
    } = {},
  ): Promise<SalesPoint[]> {
    const info = resolveConsortium(consorcio);
    const lang = options.lang ?? this.defaultLang;

    let points = options.refresh ? null : await this.cache.getSalesPoints(info.id);
    if (!points) {
      points = await this.client.fetchSalesPoints(info.id, lang);
      await this.cache.saveSalesPoints(info.id, points);
    }

    let filtered = points.map((p) => ({ ...p }));

    if (options.nucleoQuery) {
      const normNucleo = normalizeSearchText(options.nucleoQuery);
      filtered = filtered.filter(
        (p) =>
          normalizeSearchText(p.nucleoName).includes(normNucleo) ||
          normalizeSearchText(p.municipioName).includes(normNucleo),
      );
    }

    if (options.query) {
      const normQuery = normalizeSearchText(options.query);
      filtered = filtered.filter(
        (p) =>
          normalizeSearchText(p.address).includes(normQuery) ||
          normalizeSearchText(p.type).includes(normQuery) ||
          normalizeSearchText(p.nucleoName).includes(normQuery) ||
          normalizeSearchText(p.municipioName).includes(normQuery),
      );
    }

    if (options.lat !== undefined && options.lon !== undefined) {
      const lat = options.lat;
      const lon = options.lon;
      if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
        throw new CtamdValidationError(`Invalid latitude '${lat}'.`);
      }
      if (!Number.isFinite(lon) || lon < -180 || lon > 180) {
        throw new CtamdValidationError(`Invalid longitude '${lon}'.`);
      }
      const radius = Math.max(0, options.radius ?? 1_500);
      filtered = filtered
        .filter((p) => p.lat !== null && p.lon !== null)
        .map((p) => ({
          ...p,
          distanceMeters: Math.round(haversineMeters(lat, lon, p.lat!, p.lon!)),
        }))
        .filter((p) => (p.distanceMeters ?? Number.POSITIVE_INFINITY) <= radius)
        .sort(
          (a, b) =>
            (a.distanceMeters ?? Number.POSITIVE_INFINITY) -
            (b.distanceMeters ?? Number.POSITIVE_INFINITY),
        );
    } else {
      filtered.sort(
        (a, b) => a.nucleoName.localeCompare(b.nucleoName) || a.address.localeCompare(b.address),
      );
    }

    const limit = options.limit !== undefined ? Math.max(1, options.limit) : 50;
    return filtered.slice(0, limit);
  }

  async getAlerts(
    consorcio?: string | number,
    options: {
      allAreas?: boolean;
      lineQuery?: string;
      category?: string;
      lang?: ApiLang;
    } = {},
  ): Promise<ServiceAlert[]> {
    const lang = options.lang ?? this.defaultLang;

    if (options.allAreas || consorcio === undefined) {
      const lists = await Promise.all(
        CONSORTIUMS.map((c) => this.client.fetchNews(c.id, { lang }).catch(() => [])),
      );
      let combined = lists.flat();
      if (options.category) {
        const normCat = normalizeSearchText(options.category);
        combined = combined.filter((a) => normalizeSearchText(a.category).includes(normCat));
      }
      return combined;
    }

    const info = resolveConsortium(consorcio);
    let lineId: string | undefined;
    if (options.lineQuery) {
      const catalog = await this.getCatalog(info.id, { lang });
      const matched = findMatchingLine(Object.values(catalog.lines), options.lineQuery);
      if (!matched) {
        throw new CtamdValidationError(`Unknown line '${options.lineQuery}' in ${info.name}.`);
      }
      lineId = matched.id;
    }

    let alerts = await this.client.fetchNews(info.id, { lang, lineId });
    if (options.category) {
      const normCat = normalizeSearchText(options.category);
      alerts = alerts.filter((a) => normalizeSearchText(a.category).includes(normCat));
    }
    return alerts;
  }

  async findOdSchedules(
    consorcio: string | number,
    fromNucleoId: string,
    toNucleoId: string,
    options: {
      date?: Date;
      isHoliday?: boolean;
      afterSeconds?: number;
      freqFilter?: string;
      sortByDuration?: boolean;
      lang?: ApiLang;
      refresh?: boolean;
    } = {},
  ): Promise<OdScheduleResult> {
    const info = resolveConsortium(consorcio);
    const lang = options.lang ?? this.defaultLang;
    const date = options.date ?? new Date();
    const catalog = await this.getCatalog(info.id, { lang, refresh: options.refresh });

    const originNucleo = catalog.nucleos[fromNucleoId];
    if (!originNucleo) {
      throw new CtamdValidationError(
        `Unknown origin town/núcleo ID '${fromNucleoId}' in ${info.name}.`,
      );
    }
    const destinationNucleo = catalog.nucleos[toNucleoId];
    if (!destinationNucleo) {
      throw new CtamdValidationError(
        `Unknown destination town/núcleo ID '${toNucleoId}' in ${info.name}.`,
      );
    }

    let rawOd = options.refresh
      ? undefined
      : await this.cache.getOdSchedule(info.id, fromNucleoId, toNucleoId, lang);

    if (rawOd === undefined) {
      rawOd = await this.client.fetchOdSchedule(info.id, fromNucleoId, toNucleoId, lang);
      await this.cache.saveOdSchedule(info.id, fromNucleoId, toNucleoId, lang, rawOd);
    }

    let fare: FareJumpResult | null = null;
    try {
      const faresSummary = await this.getFares(info.id, {
        fromNucleoId,
        toNucleoId,
        lang,
      });
      fare = faresSummary.jumpCalculation;
    } catch {
      fare = null;
    }

    if (!rawOd) {
      return {
        consorcioId: info.id,
        originNucleo,
        destinationNucleo,
        date: formatDateKey(date),
        journeys: [],
        totalAvailable: 0,
        originBlocks: [],
        destinationBlocks: [],
        frequencies: [],
        fare,
      };
    }

    const parsed = parseOdSchedule(rawOd, {
      date,
      isHoliday: options.isHoliday,
      afterSeconds: options.afterSeconds,
      freqFilter: options.freqFilter,
      sortByDuration: options.sortByDuration,
      linesById: catalog.lines,
      catalogFrequencies: catalog.frequencies,
    });

    return {
      consorcioId: info.id,
      originNucleo,
      destinationNucleo,
      date: formatDateKey(date),
      journeys: parsed.journeys,
      totalAvailable: parsed.journeys.length,
      originBlocks: parsed.originBlocks,
      destinationBlocks: parsed.destinationBlocks,
      frequencies: parsed.frequencies,
      fare,
    };
  }

  async findStopSchedules(
    consorcio: string | number,
    options: RouteSearchOptions & {
      fullDay?: boolean;
      lang?: ApiLang;
      onSyncProgress?: SyncProgressCallback;
    },
  ): Promise<RouteSearchResult & { topologySynced: boolean }> {
    const info = resolveConsortium(consorcio);
    const lang = options.lang ?? this.defaultLang;
    let topology = options.refresh ? null : await this.cache.getTopology(info.id);
    let topologySynced = false;

    if (!topology) {
      topology = await syncConsortiumTopology(this.client, this.cache, info.id, {
        lang,
        force: options.refresh,
        onProgress: options.onSyncProgress,
      });
      topologySynced = true;
    }

    const result = await routeWithHydrationDetailed(this.client, this.cache, topology, options);
    return { ...result, topologySynced };
  }

  async syncCache(
    consorcio: string | number,
    options: {
      lang?: ApiLang;
      topology?: boolean;
      enrichLineDetails?: boolean;
      force?: boolean;
      onProgress?: SyncProgressCallback;
    } = {},
  ): Promise<{ catalog: ConsortiumCatalog; topology?: NetworkTopology }> {
    const info = resolveConsortium(consorcio);
    const lang = options.lang ?? this.defaultLang;
    const catalog = await syncConsortiumCatalog(this.client, this.cache, info.id, {
      lang,
      force: options.force,
    });
    if (options.topology === false) {
      return { catalog };
    }
    const topology = await syncConsortiumTopology(this.client, this.cache, info.id, {
      lang,
      force: options.force,
      enrichLineDetails: options.enrichLineDetails,
      onProgress: options.onProgress,
    });
    return { catalog, topology };
  }

  async getCacheStatus(consorcio?: string | number): Promise<CacheStatus> {
    const id = consorcio !== undefined ? resolveConsortium(consorcio).id : undefined;
    return this.cache.getStatus(id);
  }

  async clearCache(consorcio?: string | number): Promise<void> {
    const id = consorcio !== undefined ? resolveConsortium(consorcio).id : undefined;
    return this.cache.clear(id);
  }
}
