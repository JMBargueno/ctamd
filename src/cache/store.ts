import type { Dirent } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { CtamdApiError } from '../api/errors.js';
import { CONSORTIUMS, getConsortiumById } from '../consortiums.js';
import type {
  ApiLang,
  CacheStatus,
  ConsortiumCacheStatus,
  ConsortiumCatalog,
  ConsortiumId,
  FrequencyDef,
  LineSchedule,
  NetworkTopology,
  OdBlock,
  SalesPoint,
  StopServicesResult,
} from '../types.js';
import { getCacheDir } from './paths.js';

export const CATALOG_TTL_MS = 7 * 24 * 60 * 60 * 1_000;
export const TOPOLOGY_TTL_MS = 7 * 24 * 60 * 60 * 1_000;
export const POINTS_TTL_MS = 7 * 24 * 60 * 60 * 1_000;
export const SCHEDULE_TTL_MS = 24 * 60 * 60 * 1_000;
export const SERVICES_FRESH_TTL_MS = 60 * 1_000;
export const SERVICES_STALE_TTL_MS = 10 * 60 * 1_000;
export const COMPLETENESS_RATIO = 0.8;

interface CachedEnvelope<T> {
  updatedAt: string;
  data: T;
}

export interface CachedOdScheduleData {
  bloques: OdBlock[];
  horario: Array<{
    lineId: string;
    code: string;
    times: string[];
    frequencyAcronym: string;
    observations: string;
  }>;
  frequencies: FrequencyDef[];
}

function sanitizeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_');
}

export interface CacheStoreOptions {
  cacheDir?: string;
  nowFn?: () => number;
}

export class CacheStore {
  readonly cacheDir: string;
  private readonly nowFn: () => number;

  constructor(options: CacheStoreOptions | string = {}) {
    if (typeof options === 'string') {
      this.cacheDir = path.resolve(options);
      this.nowFn = Date.now;
    } else {
      this.cacheDir = path.resolve(options.cacheDir ?? getCacheDir());
      this.nowFn = options.nowFn ?? Date.now;
    }
  }

  private consortiumDir(consorcioId: ConsortiumId): string {
    return path.join(this.cacheDir, 'consorcios', String(consorcioId));
  }

  private catalogPath(consorcioId: ConsortiumId): string {
    return path.join(this.consortiumDir(consorcioId), 'catalog.json');
  }

  private topologyPath(consorcioId: ConsortiumId): string {
    return path.join(this.consortiumDir(consorcioId), 'topology.json');
  }

  private pointsPath(consorcioId: ConsortiumId): string {
    return path.join(this.consortiumDir(consorcioId), 'points.json');
  }

  private odSchedulePath(
    consorcioId: ConsortiumId,
    fromNucleoId: string,
    toNucleoId: string,
    lang: ApiLang,
  ): string {
    return path.join(
      this.consortiumDir(consorcioId),
      'schedules',
      'od',
      `${sanitizeSegment(fromNucleoId)}-${sanitizeSegment(toNucleoId)}-${lang}.json`,
    );
  }

  private lineSchedulePath(
    consorcioId: ConsortiumId,
    lineId: string,
    monthDayKey: string,
    lang: ApiLang,
  ): string {
    return path.join(
      this.consortiumDir(consorcioId),
      'schedules',
      'line',
      `${sanitizeSegment(lineId)}-${sanitizeSegment(monthDayKey)}-${lang}.json`,
    );
  }

  private stopDaySchedulePath(consorcioId: ConsortiumId, stopId: string, dateKey: string): string {
    return path.join(
      this.consortiumDir(consorcioId),
      'schedules',
      'stop',
      `${sanitizeSegment(stopId)}-${sanitizeSegment(dateKey)}.json`,
    );
  }

  private servicesPath(consorcioId: ConsortiumId, stopId: string, windowKey: string): string {
    return path.join(
      this.consortiumDir(consorcioId),
      'services',
      `${sanitizeSegment(stopId)}-${sanitizeSegment(windowKey)}.json`,
    );
  }

  private async writeJsonAtomic(filePath: string, payload: unknown): Promise<void> {
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });
    const tmpPath = `${filePath}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
    try {
      await fs.writeFile(tmpPath, JSON.stringify(payload), 'utf8');
      await fs.rename(tmpPath, filePath);
    } catch (err) {
      await fs.rm(tmpPath, { force: true }).catch(() => undefined);
      throw err;
    }
  }

  private async readJson<T>(filePath: string): Promise<T | null> {
    try {
      const raw = await fs.readFile(filePath, 'utf8');
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  private isWithinTtl(isoTimestamp: string | undefined, ttlMs: number): boolean {
    if (!isoTimestamp) {
      return false;
    }
    const ts = Date.parse(isoTimestamp);
    if (!Number.isFinite(ts)) {
      return false;
    }
    const age = this.nowFn() - ts;
    return age >= 0 && age <= ttlMs;
  }

  async getCatalog(
    consorcioId: ConsortiumId,
    lang: ApiLang = 'ES',
  ): Promise<ConsortiumCatalog | null> {
    const catalog = await this.readJson<ConsortiumCatalog>(this.catalogPath(consorcioId));
    if (catalog?.schemaVersion !== 1 || catalog.consorcioId !== consorcioId) {
      return null;
    }
    if (catalog.lang !== lang) {
      return null;
    }
    if (!this.isWithinTtl(catalog.syncedAt, CATALOG_TTL_MS)) {
      return null;
    }
    return catalog;
  }

  async saveCatalog(catalog: ConsortiumCatalog): Promise<void> {
    await this.writeJsonAtomic(this.catalogPath(catalog.consorcioId), catalog);
  }

  async getTopology(consorcioId: ConsortiumId): Promise<NetworkTopology | null> {
    const topology = await this.readJson<NetworkTopology>(this.topologyPath(consorcioId));
    if (topology?.schemaVersion !== 1 || topology.consorcioId !== consorcioId) {
      return null;
    }
    if (!this.isWithinTtl(topology.syncedAt, TOPOLOGY_TTL_MS)) {
      return null;
    }
    return topology;
  }

  async saveTopology(topology: NetworkTopology, options: { force?: boolean } = {}): Promise<void> {
    if (!options.force) {
      const existing = await this.readJson<NetworkTopology>(
        this.topologyPath(topology.consorcioId),
      );
      if (existing?.schemaVersion === 1) {
        const existingLines = Object.keys(existing.lines).length;
        const incomingLines = Object.keys(topology.lines).length;
        if (existingLines > 0 && incomingLines < existingLines * COMPLETENESS_RATIO) {
          throw new CtamdApiError(
            `Incomplete topology sync rejected for consortium ${topology.consorcioId}: received ${incomingLines} lines vs ${existingLines} cached (minimum 80% required).`,
          );
        }

        const existingStops = Object.keys(existing.stops).length;
        const incomingStops = Object.keys(topology.stops).length;
        if (existingStops > 0 && incomingStops < existingStops * COMPLETENESS_RATIO) {
          throw new CtamdApiError(
            `Incomplete topology sync rejected for consortium ${topology.consorcioId}: received ${incomingStops} stops vs ${existingStops} cached (minimum 80% required).`,
          );
        }
      }
    }

    await this.writeJsonAtomic(this.topologyPath(topology.consorcioId), topology);
  }

  async getSalesPoints(consorcioId: ConsortiumId): Promise<SalesPoint[] | null> {
    const envelope = await this.readJson<CachedEnvelope<SalesPoint[]>>(
      this.pointsPath(consorcioId),
    );
    if (!envelope || !Array.isArray(envelope.data)) {
      return null;
    }
    if (!this.isWithinTtl(envelope.updatedAt, POINTS_TTL_MS)) {
      return null;
    }
    return envelope.data;
  }

  async saveSalesPoints(consorcioId: ConsortiumId, points: SalesPoint[]): Promise<void> {
    const envelope: CachedEnvelope<SalesPoint[]> = {
      updatedAt: new Date(this.nowFn()).toISOString(),
      data: points,
    };
    await this.writeJsonAtomic(this.pointsPath(consorcioId), envelope);
  }

  async getOdSchedule(
    consorcioId: ConsortiumId,
    fromNucleoId: string,
    toNucleoId: string,
    lang: ApiLang = 'ES',
  ): Promise<CachedOdScheduleData | null | undefined> {
    const envelope = await this.readJson<CachedEnvelope<CachedOdScheduleData | null>>(
      this.odSchedulePath(consorcioId, fromNucleoId, toNucleoId, lang),
    );
    if (!envelope || !('data' in envelope)) {
      return undefined;
    }
    if (!this.isWithinTtl(envelope.updatedAt, SCHEDULE_TTL_MS)) {
      return undefined;
    }
    return envelope.data;
  }

  async saveOdSchedule(
    consorcioId: ConsortiumId,
    fromNucleoId: string,
    toNucleoId: string,
    lang: ApiLang,
    data: CachedOdScheduleData | null,
  ): Promise<void> {
    const envelope: CachedEnvelope<CachedOdScheduleData | null> = {
      updatedAt: new Date(this.nowFn()).toISOString(),
      data,
    };
    await this.writeJsonAtomic(
      this.odSchedulePath(consorcioId, fromNucleoId, toNucleoId, lang),
      envelope,
    );
  }

  async getLineSchedule(
    consorcioId: ConsortiumId,
    lineId: string,
    monthDayKey: string,
    lang: ApiLang = 'ES',
  ): Promise<LineSchedule | null> {
    const envelope = await this.readJson<CachedEnvelope<LineSchedule>>(
      this.lineSchedulePath(consorcioId, lineId, monthDayKey, lang),
    );
    if (!envelope?.data) {
      return null;
    }
    if (!this.isWithinTtl(envelope.updatedAt, SCHEDULE_TTL_MS)) {
      return null;
    }
    return envelope.data;
  }

  async saveLineSchedule(
    consorcioId: ConsortiumId,
    lineId: string,
    monthDayKey: string,
    lang: ApiLang,
    schedule: LineSchedule,
  ): Promise<void> {
    const envelope: CachedEnvelope<LineSchedule> = {
      updatedAt: new Date(this.nowFn()).toISOString(),
      data: schedule,
    };
    await this.writeJsonAtomic(
      this.lineSchedulePath(consorcioId, lineId, monthDayKey, lang),
      envelope,
    );
  }

  async getStopDaySchedules(
    consorcioId: ConsortiumId,
    stopId: string,
    dateKey: string,
  ): Promise<Record<string, string[]> | null> {
    const envelope = await this.readJson<CachedEnvelope<Record<string, string[]>>>(
      this.stopDaySchedulePath(consorcioId, stopId, dateKey),
    );
    if (!envelope?.data || typeof envelope.data !== 'object') {
      return null;
    }
    if (!this.isWithinTtl(envelope.updatedAt, SCHEDULE_TTL_MS)) {
      return null;
    }
    return envelope.data;
  }

  async saveStopDaySchedules(
    consorcioId: ConsortiumId,
    stopId: string,
    dateKey: string,
    byLineId: Record<string, string[]>,
  ): Promise<void> {
    const envelope: CachedEnvelope<Record<string, string[]>> = {
      updatedAt: new Date(this.nowFn()).toISOString(),
      data: byLineId,
    };
    await this.writeJsonAtomic(this.stopDaySchedulePath(consorcioId, stopId, dateKey), envelope);
  }

  async getServices(
    consorcioId: ConsortiumId,
    stopId: string,
    windowKey = 'current',
  ): Promise<StopServicesResult | null> {
    const envelope = await this.readJson<CachedEnvelope<StopServicesResult>>(
      this.servicesPath(consorcioId, stopId, windowKey),
    );
    if (!envelope?.data) {
      return null;
    }
    if (!this.isWithinTtl(envelope.updatedAt, SERVICES_FRESH_TTL_MS)) {
      return null;
    }
    return { ...envelope.data, stale: false };
  }

  async getStaleServices(
    consorcioId: ConsortiumId,
    stopId: string,
    windowKey = 'current',
  ): Promise<StopServicesResult | null> {
    const envelope = await this.readJson<CachedEnvelope<StopServicesResult>>(
      this.servicesPath(consorcioId, stopId, windowKey),
    );
    if (!envelope?.data) {
      return null;
    }
    if (!this.isWithinTtl(envelope.updatedAt, SERVICES_STALE_TTL_MS)) {
      return null;
    }
    return { ...envelope.data, stale: true };
  }

  async saveServices(
    consorcioId: ConsortiumId,
    stopId: string,
    result: StopServicesResult,
    windowKey = 'current',
  ): Promise<void> {
    const envelope: CachedEnvelope<StopServicesResult> = {
      updatedAt: new Date(this.nowFn()).toISOString(),
      data: { ...result, stale: false },
    };
    await this.writeJsonAtomic(this.servicesPath(consorcioId, stopId, windowKey), envelope);
  }

  private async countFilesAndBytes(dirPath: string): Promise<{ count: number; bytes: number }> {
    let entries: Dirent[];
    try {
      entries = await fs.readdir(dirPath, { withFileTypes: true });
    } catch {
      return { count: 0, bytes: 0 };
    }

    let count = 0;
    let bytes = 0;
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        const sub = await this.countFilesAndBytes(fullPath);
        count += sub.count;
        bytes += sub.bytes;
      } else if (entry.isFile()) {
        count += 1;
        const stat = await fs.stat(fullPath).catch(() => null);
        bytes += stat?.size ?? 0;
      }
    }
    return { count, bytes };
  }

  private async getConsortiumStatus(consorcioId: ConsortiumId): Promise<ConsortiumCacheStatus> {
    const info = getConsortiumById(consorcioId)!;
    const base = this.consortiumDir(consorcioId);
    const catalog = await this.readJson<ConsortiumCatalog>(this.catalogPath(consorcioId));
    const topology = await this.readJson<NetworkTopology>(this.topologyPath(consorcioId));
    const pointsStat = await fs.stat(this.pointsPath(consorcioId)).catch(() => null);
    const schedulesStats = await this.countFilesAndBytes(path.join(base, 'schedules'));
    const servicesStats = await this.countFilesAndBytes(path.join(base, 'services'));
    const totalStats = await this.countFilesAndBytes(base);

    return {
      consorcioId,
      shortCode: info.shortCode,
      name: info.name,
      catalog: {
        present: Boolean(catalog && catalog.schemaVersion === 1),
        fresh: Boolean(
          catalog &&
            catalog.schemaVersion === 1 &&
            this.isWithinTtl(catalog.syncedAt, CATALOG_TTL_MS),
        ),
        linesCount: catalog ? Object.keys(catalog.lines).length : 0,
        stopsCount: catalog ? Object.keys(catalog.stops).length : 0,
        nucleosCount: catalog ? Object.keys(catalog.nucleos).length : 0,
        syncedAt: catalog?.syncedAt ?? null,
      },
      topology: {
        present: Boolean(topology && topology.schemaVersion === 1),
        fresh: Boolean(
          topology &&
            topology.schemaVersion === 1 &&
            this.isWithinTtl(topology.syncedAt, TOPOLOGY_TTL_MS),
        ),
        linesCount: topology ? Object.keys(topology.lines).length : 0,
        stopsCount: topology ? Object.keys(topology.stops).length : 0,
        syncedAt: topology?.syncedAt ?? null,
      },
      schedulesCount: schedulesStats.count,
      servicesCount: servicesStats.count,
      pointsPresent: Boolean(pointsStat?.isFile()),
      totalBytes: totalStats.bytes,
    };
  }

  async getStatus(consorcioId?: ConsortiumId): Promise<CacheStatus> {
    const targetIds: ConsortiumId[] = consorcioId ? [consorcioId] : CONSORTIUMS.map((c) => c.id);

    const consortiumStatuses: ConsortiumCacheStatus[] = [];
    for (const id of targetIds) {
      const st = await this.getConsortiumStatus(id);
      if (consorcioId || st.totalBytes > 0) {
        consortiumStatuses.push(st);
      }
    }

    const totalStats = await this.countFilesAndBytes(
      consorcioId ? this.consortiumDir(consorcioId) : this.cacheDir,
    );

    return {
      cacheDir: this.cacheDir,
      consortiums: consortiumStatuses,
      totalBytes: totalStats.bytes,
    };
  }

  async clear(consorcioId?: ConsortiumId): Promise<void> {
    const target = consorcioId ? this.consortiumDir(consorcioId) : this.cacheDir;
    await fs.rm(target, { recursive: true, force: true });
  }
}
