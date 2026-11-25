import type {
  ApiLang,
  ConsortiumId,
  FareJumpResult,
  FrequencyDef,
  InterurbanFare,
  Line,
  LineDetail,
  LineSchedule,
  LineScheduleBlock,
  LineScheduleNucleoHeader,
  LineSchedulePlanner,
  LineScheduleTrip,
  LineStop,
  Municipality,
  Nucleo,
  OdBlock,
  SalesPoint,
  ServiceAlert,
  Stop,
  StopBoardingType,
  StopService,
  StopServicesResult,
  TariffZone,
  TransportMode,
  UrbanFare,
  ZoneJump,
} from '../types.js';
import { parseCoordinate } from '../utils/geo.js';
import { cleanApiText, splitCommaList } from '../utils/text.js';
import {
  computeEtaMinutes,
  formatCtanHoraIni,
  parseClockToSeconds,
  parseCtanTimestamp,
} from '../utils/time.js';
import { CtamdApiError, CtamdValidationError } from './errors.js';

export const DEFAULT_BASE_URL = 'https://api.ctan.es/v1';
const DEFAULT_USER_AGENT = 'ctamd/0.1.0 (+https://github.com/JMBargueno/ctamd)';
const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);

const DEFAULT_MODE_COLORS: Array<[RegExp, string]> = [
  [/metro/i, '#e63946'],
  [/tren|cercan/i, '#7b2cbf'],
  [/tranv/i, '#f77f00'],
  [/barco|catamar/i, '#0077b6'],
  [/bici/i, '#2a9d8f'],
  [/bus/i, '#00a86b'],
];

export function defaultColorForMode(mode: string | null | undefined): string {
  const cleaned = cleanApiText(mode);
  for (const [pattern, hex] of DEFAULT_MODE_COLORS) {
    if (pattern.test(cleaned)) {
      return hex;
    }
  }
  return '#00a86b';
}

export function normalizeHexColor(raw: string | null | undefined): string | null {
  const cleaned = cleanApiText(raw).replace(/^#/, '');
  if (/^[0-9a-fA-F]{6}$/.test(cleaned) || /^[0-9a-fA-F]{3}$/.test(cleaned)) {
    return `#${cleaned.toLowerCase()}`;
  }
  return null;
}

export function parseApiNumber(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '') {
    return null;
  }
  const num = typeof raw === 'number' ? raw : Number(cleanApiText(String(raw)));
  return Number.isFinite(num) ? num : null;
}

/**
 * Extracts public route label (e.g. `M-101A`, `M-167`, `B-042`) from line name when
 * CTAN's `codigo` is purely numeric (common in Sevilla CTAS), or returns `codigo` otherwise.
 */
export function extractDisplayLineCode(rawCode: string, rawName: string): string {
  const code = cleanApiText(rawCode);
  const name = cleanApiText(rawName);
  if (code && !/^\d+$/.test(code)) {
    return code;
  }
  const prefixMatch = /^([A-Z]{1,3}-\d+[A-Z0-9]*)\b/i.exec(name);
  if (prefixMatch) {
    return prefixMatch[1]!.toUpperCase();
  }
  const spacePrefixMatch = /^([A-Z]\d+[A-Z0-9]*)\b/i.exec(name);
  if (spacePrefixMatch) {
    return spacePrefixMatch[1]!.toUpperCase();
  }
  return code || name;
}

export interface RawConsortiumDto {
  idConsorcio?: string | number;
  nombre?: string;
  nombreCorto?: string;
}

export interface RawLineDto {
  idLinea?: string | number;
  codigo?: string;
  nombre?: string;
  hayNoticia?: string | number | boolean;
  hayNoticias?: string | number | boolean;
  modo?: string;
  idModo?: string | number;
  operadores?: string;
  observacionesModoTransporte?: string;
}

export interface RawLineDetailDto extends RawLineDto {
  termometroIda?: string;
  termometroVuelta?: string;
  polilinea?: string;
  polilineaIda?: string;
  polilineaVuelta?: string;
  color?: string;
  tieneIda?: string | number | boolean;
  tieneVuelta?: string | number | boolean;
  pmr?: string;
  concesion?: string;
  observaciones?: string;
}

export interface RawLineStopDto {
  idParada?: string | number;
  idLinea?: string | number;
  idNucleo?: string | number;
  idZona?: string;
  nombre?: string;
  latitud?: string | number;
  longitud?: string | number;
  sentido?: string | number;
  orden?: string | number;
  modos?: string;
}

export interface RawStopDto {
  idParada?: string | number;
  idNucleo?: string | number;
  idZona?: string;
  nombre?: string;
  latitud?: string | number;
  longitud?: string | number;
  modos?: string;
  idMunicipio?: string | number;
  municipio?: string;
  nucleo?: string;
  descripcion?: string;
  observaciones?: string;
  principal?: string | number;
  inactiva?: string | number;
  correspondecias?: string;
  correspondencias?: string;
}

export interface RawStopServiceDto {
  idParada?: string | number;
  idLinea?: string | number;
  servicio?: string;
  nombre?: string;
  linea?: string;
  sentido?: string | number;
  destino?: string;
  tipo?: string | number;
}

export interface RawStopServicesResponse {
  servicios?: RawStopServiceDto[];
  horaIni?: string;
  horaFin?: string;
}

export interface RawOdScheduleResponse {
  bloques?: Array<{ nombre?: string; color?: string; tipo?: string }>;
  horario?: Array<{
    idlinea?: string | number;
    idLinea?: string | number;
    codigo?: string;
    horas?: string[];
    dias?: string;
    frecuencia?: string;
    observaciones?: string;
    demandahoras?: string;
  }>;
  frecuencias?: Array<{
    idfrecuencia?: string | number;
    idFreq?: string | number;
    acronimo?: string;
    codigo?: string;
    nombre?: string;
  }>;
  error?: string;
}

export interface RawLineScheduleResponse {
  planificadores?: Array<{
    idPlani?: string | number;
    fechaInicio?: string;
    fechaFin?: string;
    muestraFechaFin?: string | number | boolean;
    nucleosIda?: Array<{ colspan?: string | number; nombre?: string; color?: string }>;
    nucleosVuelta?: Array<{ colspan?: string | number; nombre?: string; color?: string }>;
    bloquesIda?: Array<{ nombre?: string; color?: string; tipo?: string }>;
    bloquesVuelta?: Array<{ nombre?: string; color?: string; tipo?: string }>;
    horarioIda?: Array<{
      horas?: string[];
      frecuencia?: string;
      dias?: string;
      observaciones?: string;
    }>;
    horarioVuelta?: Array<{
      horas?: string[];
      frecuencia?: string;
      dias?: string;
      observaciones?: string;
    }>;
  }>;
  frecuencias?: Array<{
    idfrecuencia?: string | number;
    idFreq?: string | number;
    acronimo?: string;
    codigo?: string;
    nombre?: string;
  }>;
  horaCorte?: string;
  observacionesModoTransporte?: string;
}

export interface RawNewsDto {
  idNoticia?: string | number;
  idCategoria?: string | number;
  titulo?: string;
  subTitulo?: string;
  subtitulo?: string;
  resumen?: string;
  texto?: string;
  tituloEng?: string;
  subtituloEng?: string;
  resumenEng?: string;
  textoEng?: string;
  fechaInicio?: string;
  fechaFin?: string;
  fechafin?: string;
  fechaFinFija?: string;
  fechafinFija?: string;
  lineas?: string | number;
  idLinea?: string | number;
  novedad?: string | number | boolean;
  categoria?: string;
}

export interface RawSalesPointDto {
  idComercio?: string | number;
  idTipo?: string | number;
  idNucleo?: string | number;
  idMunicipio?: string | number;
  tipo?: string;
  municipio?: string;
  nucleo?: string;
  direccion?: string;
  latitud?: string | number;
  longitud?: string | number;
}

export interface CtanClientOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  sleepImpl?: (ms: number) => Promise<void>;
  maxConcurrency?: number;
  maxRetries?: number;
  timeoutMs?: number;
  retryBaseDelayMs?: number;
  maxRetryWaitMs?: number;
}

class AsyncSemaphore {
  private active = 0;
  private readonly queue: Array<() => void> = [];

  constructor(private readonly maxConcurrency: number) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.active < this.maxConcurrency) {
      this.active += 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.queue.push(() => {
        this.active += 1;
        resolve();
      });
    });
  }

  private release(): void {
    this.active -= 1;
    const next = this.queue.shift();
    if (next) {
      next();
    }
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Parses an HTTP `Retry-After` header value (integer seconds or HTTP-date) into milliseconds.
 */
export function parseRetryAfterMs(
  headerValue: string | null,
  nowMs: number = Date.now(),
): number | null {
  if (!headerValue) {
    return null;
  }
  const trimmed = headerValue.trim();
  if (!trimmed) {
    return null;
  }
  if (/^\d+$/.test(trimmed)) {
    const seconds = Number.parseInt(trimmed, 10);
    return Number.isFinite(seconds) ? seconds * 1_000 : null;
  }
  if (!/[a-zA-Z]/.test(trimmed)) {
    return null;
  }
  const parsedDateMs = Date.parse(trimmed);
  if (!Number.isFinite(parsedDateMs)) {
    return null;
  }
  return Math.max(0, parsedDateMs - nowMs);
}

function toBooleanFlag(raw: unknown): boolean {
  if (typeof raw === 'boolean') {
    return raw;
  }
  if (typeof raw === 'number') {
    return raw !== 0;
  }
  const str = cleanApiText(String(raw ?? '')).toLowerCase();
  return str === '1' || str === 'true' || str === 'si';
}

function mapStopBoardingType(raw: unknown): StopBoardingType {
  const value = String(raw ?? '0').trim();
  if (value === '1') {
    return 'board_only';
  }
  if (value === '2') {
    return 'alight_only';
  }
  return 'normal';
}

function mapFrequenciesList(
  rawList:
    | Array<{
        idfrecuencia?: string | number;
        idFreq?: string | number;
        acronimo?: string;
        codigo?: string;
        nombre?: string;
      }>
    | undefined,
): FrequencyDef[] {
  if (!Array.isArray(rawList)) {
    return [];
  }
  const result: FrequencyDef[] = [];
  for (const item of rawList) {
    const id = String(item.idfrecuencia ?? item.idFreq ?? '').trim();
    const acronym = cleanApiText(item.acronimo ?? item.codigo);
    const name = cleanApiText(item.nombre);
    if (!acronym && !name) {
      continue;
    }
    result.push({ id: id || acronym, acronym, name });
  }
  return result;
}

export class CtanClient {
  readonly baseUrl: string;
  readonly fetchImpl: typeof fetch;
  private readonly sleepImpl: (ms: number) => Promise<void>;
  private readonly hasCustomSleep: boolean;
  private readonly semaphore: AsyncSemaphore;
  private readonly maxRetries: number;
  private readonly timeoutMs: number;
  private readonly retryBaseDelayMs: number;
  readonly maxRetryWaitMs: number;

  constructor(options: CtanClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.hasCustomSleep = Boolean(options.sleepImpl);
    this.sleepImpl = options.sleepImpl ?? defaultSleep;
    this.semaphore = new AsyncSemaphore(Math.max(1, options.maxConcurrency ?? 4));
    this.maxRetries = Math.max(0, options.maxRetries ?? 3);
    this.timeoutMs = Math.max(500, options.timeoutMs ?? 20_000);
    this.retryBaseDelayMs = Math.max(1, options.retryBaseDelayMs ?? 1_000);
    this.maxRetryWaitMs = Math.max(0, options.maxRetryWaitMs ?? 10_000);
  }

  private buildHeaders(): Record<string, string> {
    return {
      'User-Agent': DEFAULT_USER_AGENT,
      Accept: 'application/json',
    };
  }

  private async sleepAbortable(ms: number, signal?: AbortSignal, url?: string): Promise<void> {
    if (signal?.aborted) {
      throw new CtamdApiError(`Request aborted (${url ?? this.baseUrl})`, undefined, url);
    }
    if (ms <= 0) {
      return;
    }
    if (!signal) {
      await this.sleepImpl(ms);
      return;
    }

    if (!this.hasCustomSleep) {
      await new Promise<void>((resolve, reject) => {
        const onAbort = (): void => {
          clearTimeout(timer);
          reject(new CtamdApiError(`Request aborted (${url ?? this.baseUrl})`, undefined, url));
        };
        const timer = setTimeout(() => {
          signal.removeEventListener('abort', onAbort);
          resolve();
        }, ms);
        signal.addEventListener('abort', onAbort, { once: true });
      });
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const onAbort = (): void => {
        reject(new CtamdApiError(`Request aborted (${url ?? this.baseUrl})`, undefined, url));
      };
      signal.addEventListener('abort', onAbort, { once: true });
      this.sleepImpl(ms).then(
        () => {
          signal.removeEventListener('abort', onAbort);
          resolve();
        },
        (err) => {
          signal.removeEventListener('abort', onAbort);
          reject(err);
        },
      );
    });
  }

  private async requestRaw(
    url: string,
    options: { signal?: AbortSignal; allowHttp400Json?: boolean } = {},
  ): Promise<{ status: number; text: string }> {
    const signal = options.signal;
    let lastError: unknown;
    let totalWaitMs = 0;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (signal?.aborted) {
        throw new CtamdApiError(`Request aborted (${url})`, undefined, url);
      }

      let response: Response;
      try {
        const timeoutSignal = AbortSignal.timeout(this.timeoutMs);
        const combinedSignal = signal ? AbortSignal.any([timeoutSignal, signal]) : timeoutSignal;

        response = await this.semaphore.run(async () => {
          if (signal?.aborted) {
            throw new CtamdApiError(`Request aborted (${url})`, undefined, url);
          }
          return this.fetchImpl(url, {
            method: 'GET',
            headers: this.buildHeaders(),
            redirect: 'follow',
            signal: combinedSignal,
          });
        });
      } catch (err) {
        lastError = err;
        if (signal?.aborted) {
          throw err instanceof CtamdApiError
            ? err
            : new CtamdApiError(`Request aborted (${url})`, undefined, url);
        }
        const remainingBudget = this.maxRetryWaitMs - totalWaitMs;
        if (attempt < this.maxRetries && remainingBudget > 0) {
          const waitMs = Math.min(this.retryBaseDelayMs * 2 ** attempt, remainingBudget);
          await this.sleepAbortable(waitMs, signal, url);
          totalWaitMs += waitMs;
          continue;
        }
        throw new CtamdApiError(
          `Network error requesting ${url}: ${err instanceof Error ? err.message : String(err)}`,
          undefined,
          url,
        );
      }

      if (RETRYABLE_STATUS_CODES.has(response.status)) {
        const retryAfterMs = parseRetryAfterMs(response.headers.get('Retry-After'));
        const remainingBudget = this.maxRetryWaitMs - totalWaitMs;
        await response.body?.cancel().catch(() => undefined);

        if (attempt >= this.maxRetries || remainingBudget <= 0) {
          throw new CtamdApiError(
            `CTAN upstream returned HTTP ${response.status} after ${attempt + 1} attempts`,
            response.status,
            url,
            retryAfterMs ?? undefined,
          );
        }

        if (response.status === 429 && retryAfterMs !== null && retryAfterMs > remainingBudget) {
          throw new CtamdApiError(
            `CTAN upstream rate-limited (HTTP 429; Retry-After ${Math.ceil(retryAfterMs / 1_000)}s exceeds maxRetryWaitMs ${this.maxRetryWaitMs}ms)`,
            429,
            url,
            retryAfterMs,
          );
        }

        const rawWaitMs =
          retryAfterMs !== null
            ? Math.max(1_000, retryAfterMs)
            : this.retryBaseDelayMs * 2 ** attempt;
        const waitMs = Math.min(rawWaitMs, remainingBudget);

        if (waitMs <= 0) {
          throw new CtamdApiError(
            `CTAN upstream returned HTTP ${response.status}`,
            response.status,
            url,
            retryAfterMs ?? undefined,
          );
        }

        await this.sleepAbortable(waitMs, signal, url);
        totalWaitMs += waitMs;
        continue;
      }

      if (response.status === 204) {
        await response.body?.cancel().catch(() => undefined);
        return { status: 204, text: '' };
      }

      if (!response.ok) {
        if (options.allowHttp400Json && response.status === 400) {
          const text = await response.text();
          return { status: 400, text };
        }
        await response.body?.cancel().catch(() => undefined);
        throw new CtamdApiError(
          `CTAN upstream returned HTTP ${response.status}`,
          response.status,
          url,
        );
      }

      const text = await response.text();
      return { status: response.status, text };
    }

    throw new CtamdApiError(
      `Failed request to ${url}: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
      undefined,
      url,
    );
  }

  private buildUrl(
    path: string,
    query?: Record<string, string | number | undefined>,
    rawQueryParts?: string[],
  ): string {
    const parts: string[] = [];
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value === undefined || value === '') {
          continue;
        }
        parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
      }
    }
    if (rawQueryParts) {
      for (const part of rawQueryParts) {
        if (part) {
          parts.push(part);
        }
      }
    }
    const qs = parts.length > 0 ? `?${parts.join('&')}` : '';
    return `${this.baseUrl}${path}${qs}`;
  }

  private async requestJson<T>(
    path: string,
    options: {
      query?: Record<string, string | number | undefined>;
      rawQueryParts?: string[];
      signal?: AbortSignal;
      allowHttp400Json?: boolean;
    } = {},
  ): Promise<T | null> {
    const url = this.buildUrl(path, options.query, options.rawQueryParts);
    const { status, text } = await this.requestRaw(url, {
      signal: options.signal,
      allowHttp400Json: options.allowHttp400Json,
    });

    const trimmed = text.trim();
    if (status === 204 || trimmed === '') {
      return null;
    }

    if (trimmed.startsWith('<')) {
      throw new CtamdApiError(
        `CTAN returned an HTML response instead of JSON (${url})`,
        status,
        url,
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch (err) {
      throw new CtamdApiError(
        `Invalid JSON from CTAN (${url}): ${err instanceof Error ? err.message : String(err)}`,
        status,
        url,
      );
    }

    if (
      parsed &&
      typeof parsed === 'object' &&
      !Array.isArray(parsed) &&
      typeof (parsed as { error?: unknown }).error === 'string' &&
      !options.allowHttp400Json
    ) {
      const errMsg = cleanApiText((parsed as { error: string }).error);
      if (errMsg) {
        throw new CtamdApiError(errMsg, status, url);
      }
    }

    return parsed as T;
  }

  async fetchConsortiums(signal?: AbortSignal): Promise<RawConsortiumDto[]> {
    const res = await this.requestJson<{ consorcios?: RawConsortiumDto[] }>(
      '/Consorcios/consorcios',
      { signal },
    );
    return Array.isArray(res?.consorcios) ? res.consorcios : [];
  }

  async fetchLines(
    consorcioId: ConsortiumId,
    lang: ApiLang = 'ES',
    signal?: AbortSignal,
  ): Promise<Line[]> {
    const res = await this.requestJson<{ lineas?: RawLineDto[] }>(
      `/Consorcios/${consorcioId}/lineas`,
      { query: { lang }, signal },
    );
    const rawLines = Array.isArray(res?.lineas) ? res.lineas : [];
    const lines: Line[] = [];
    for (const raw of rawLines) {
      const id = String(raw.idLinea ?? '').trim();
      if (!id) {
        continue;
      }
      const code = cleanApiText(raw.codigo);
      const name = cleanApiText(raw.nombre);
      const mode = cleanApiText(raw.modo || raw.observacionesModoTransporte) || 'Bus';
      lines.push({
        id,
        code,
        displayCode: extractDisplayLineCode(code, name),
        name,
        modeId: String(raw.idModo ?? '').trim(),
        mode,
        operators: splitCommaList(raw.operadores),
        hasNews: toBooleanFlag(raw.hayNoticia ?? raw.hayNoticias),
        color: defaultColorForMode(mode),
        isCircular: /\bcircular\b/i.test(name),
        directions: [],
      });
    }
    return lines;
  }

  async fetchLineDetail(
    consorcioId: ConsortiumId,
    lineId: string,
    lang: ApiLang = 'ES',
    signal?: AbortSignal,
  ): Promise<LineDetail> {
    const cleanId = lineId.trim();
    if (!cleanId) {
      throw new CtamdValidationError('Line ID cannot be empty.');
    }
    const raw = await this.requestJson<RawLineDetailDto>(
      `/Consorcios/${consorcioId}/lineas/${encodeURIComponent(cleanId)}`,
      { query: { lang }, signal },
    );
    if (!raw?.idLinea) {
      throw new CtamdApiError(`Line '${cleanId}' not found in consortium ${consorcioId}.`, 404);
    }

    const code = cleanApiText(raw.codigo);
    const name = cleanApiText(raw.nombre);
    const mode = cleanApiText(raw.modo || raw.observacionesModoTransporte) || 'Bus';
    const hasOutbound = toBooleanFlag(raw.tieneIda);
    const hasInbound = toBooleanFlag(raw.tieneVuelta);
    const color = normalizeHexColor(raw.color) ?? defaultColorForMode(mode);

    return {
      id: String(raw.idLinea).trim(),
      code,
      displayCode: extractDisplayLineCode(code, name),
      name,
      modeId: String(raw.idModo ?? '').trim(),
      mode,
      operators: splitCommaList(raw.operadores),
      hasNews: toBooleanFlag(raw.hayNoticias ?? raw.hayNoticia),
      color,
      isCircular: (hasOutbound && !hasInbound) || /\bcircular\b/i.test(name),
      directions: [],
      pmr: cleanApiText(raw.pmr),
      concession: cleanApiText(raw.concesion),
      observations: cleanApiText(raw.observaciones),
      hasOutbound,
      hasInbound,
      thermometerOutboundUrl: cleanApiText(raw.termometroIda) || null,
      thermometerInboundUrl: cleanApiText(raw.termometroVuelta) || null,
      polyline: cleanApiText(raw.polilinea) || null,
      polylineOutbound: cleanApiText(raw.polilineaIda) || null,
      polylineInbound: cleanApiText(raw.polilineaVuelta) || null,
    };
  }

  async fetchLineStops(
    consorcioId: ConsortiumId,
    lineId: string,
    lang: ApiLang = 'ES',
    signal?: AbortSignal,
  ): Promise<LineStop[]> {
    const cleanId = lineId.trim();
    if (!cleanId) {
      throw new CtamdValidationError('Line ID cannot be empty.');
    }
    const res = await this.requestJson<{ paradas?: RawLineStopDto[] }>(
      `/Consorcios/${consorcioId}/lineas/${encodeURIComponent(cleanId)}/paradas`,
      { query: { lang }, signal },
    );
    const rawStops = Array.isArray(res?.paradas) ? res.paradas : [];
    const stops: LineStop[] = [];
    for (const item of rawStops) {
      const id = String(item.idParada ?? '').trim();
      if (!id) {
        continue;
      }
      const orderNum = parseApiNumber(item.orden);
      const dirNum = parseApiNumber(item.sentido);
      stops.push({
        id,
        code: id,
        name: cleanApiText(item.nombre),
        nucleoId: String(item.idNucleo ?? '').trim(),
        zoneId: cleanApiText(item.idZona),
        lat: parseCoordinate(item.latitud),
        lon: parseCoordinate(item.longitud),
        direction: dirNum !== null && dirNum > 0 ? Math.trunc(dirNum) : 1,
        order: orderNum !== null ? Math.trunc(orderNum) : stops.length + 1,
        distanceMeters: 0,
        modes: cleanApiText(item.modos) || 'Bus',
        startTime: null,
        endTime: null,
      });
    }
    return stops.sort((a, b) => a.direction - b.direction || a.order - b.order);
  }

  async fetchStops(
    consorcioId: ConsortiumId,
    lang: ApiLang = 'ES',
    signal?: AbortSignal,
  ): Promise<Stop[]> {
    const res = await this.requestJson<{ paradas?: RawStopDto[] }>(
      `/Consorcios/${consorcioId}/paradas`,
      { query: { lang }, signal },
    );
    const rawStops = Array.isArray(res?.paradas) ? res.paradas : [];
    const stops: Stop[] = [];
    for (const raw of rawStops) {
      const id = String(raw.idParada ?? '').trim();
      if (!id) {
        continue;
      }
      stops.push({
        id,
        code: id,
        name: cleanApiText(raw.nombre),
        nucleoId: String(raw.idNucleo ?? '').trim(),
        nucleoName: cleanApiText(raw.nucleo),
        municipioId: String(raw.idMunicipio ?? '').trim(),
        municipioName: cleanApiText(raw.municipio),
        zoneId: cleanApiText(raw.idZona),
        lat: parseCoordinate(raw.latitud),
        lon: parseCoordinate(raw.longitud),
        modes: cleanApiText(raw.modos) || 'Bus',
        lines: [],
      });
    }
    return stops;
  }

  async fetchStopDetail(
    consorcioId: ConsortiumId,
    stopId: string,
    signal?: AbortSignal,
  ): Promise<Stop> {
    const cleanId = stopId.trim();
    if (!cleanId) {
      throw new CtamdValidationError('Stop ID cannot be empty.');
    }
    const raw = await this.requestJson<RawStopDto>(
      `/Consorcios/${consorcioId}/paradas/${encodeURIComponent(cleanId)}`,
      { signal },
    );
    if (!raw?.idParada) {
      throw new CtamdApiError(`Stop '${cleanId}' not found in consortium ${consorcioId}.`, 404);
    }
    const corrRaw = cleanApiText(raw.correspondecias ?? raw.correspondencias)
      .replace(/^Correspondencia\s+con:\s*/i, '')
      .trim();

    return {
      id: String(raw.idParada).trim(),
      code: String(raw.idParada).trim(),
      name: cleanApiText(raw.nombre),
      nucleoId: String(raw.idNucleo ?? '').trim(),
      nucleoName: cleanApiText(raw.nucleo),
      municipioId: String(raw.idMunicipio ?? '').trim(),
      municipioName: cleanApiText(raw.municipio),
      zoneId: cleanApiText(raw.idZona),
      lat: parseCoordinate(raw.latitud),
      lon: parseCoordinate(raw.longitud),
      modes: cleanApiText(raw.descripcion) || 'Bus',
      lines: [],
      correspondencesRaw: splitCommaList(corrRaw),
      observations: cleanApiText(raw.observaciones),
      inactive: toBooleanFlag(raw.inactiva),
    };
  }

  async fetchStopServices(
    consorcioId: ConsortiumId,
    stopId: string,
    startDateTime?: Date,
    options: { signal?: AbortSignal; now?: Date } = {},
  ): Promise<StopServicesResult> {
    const cleanId = stopId.trim();
    if (!cleanId) {
      throw new CtamdValidationError('Stop ID cannot be empty.');
    }

    const rawQueryParts = startDateTime ? [`horaIni=${formatCtanHoraIni(startDateTime)}`] : [];
    const res = await this.requestJson<RawStopServicesResponse>(
      `/Consorcios/${consorcioId}/paradas/${encodeURIComponent(cleanId)}/servicios`,
      { rawQueryParts, signal: options.signal },
    );

    const now = options.now ?? new Date();
    const rawServices = Array.isArray(res?.servicios) ? res.servicios : [];
    const services: StopService[] = [];

    for (const item of rawServices) {
      const departureTime = cleanApiText(item.servicio);
      const depSec = parseClockToSeconds(departureTime);
      if (depSec === null) {
        continue;
      }
      const lineId = String(item.idLinea ?? '').trim();
      const lineCode = cleanApiText(item.linea);
      const lineName = cleanApiText(item.nombre);
      const dirNum = parseApiNumber(item.sentido);
      services.push({
        lineId,
        lineCode,
        displayCode: extractDisplayLineCode(lineCode, lineName),
        lineName,
        lineColor: defaultColorForMode('Bus'),
        direction: dirNum !== null && dirNum > 0 ? Math.trunc(dirNum) : 1,
        destination: cleanApiText(item.destino),
        departureTime: departureTime.slice(0, 5),
        departureSeconds: depSec,
        etaMinutes: computeEtaMinutes(depSec, now),
        stopType: mapStopBoardingType(item.tipo),
        source: 'scheduled',
        distanceMeters: null,
        vehicle: null,
      });
    }

    services.sort(
      (a, b) =>
        a.departureSeconds - b.departureSeconds || a.displayCode.localeCompare(b.displayCode),
    );

    const windowStart =
      cleanApiText(res?.horaIni) || (startDateTime ? formatCtanHoraIni(startDateTime) : '');
    const windowEnd = cleanApiText(res?.horaFin);
    const fetchedDate = parseCtanTimestamp(windowStart) ?? now;

    return {
      consorcioId,
      stopId: cleanId,
      stopCode: cleanId,
      stopName: '',
      nucleoName: '',
      lat: null,
      lon: null,
      windowStart,
      windowEnd,
      fetchedAt: fetchedDate.toISOString(),
      stale: false,
      source: 'scheduled',
      providerName: 'ctan-scheduled',
      services,
    };
  }

  async fetchNucleos(
    consorcioId: ConsortiumId,
    lang: ApiLang = 'ES',
    signal?: AbortSignal,
  ): Promise<Nucleo[]> {
    const res = await this.requestJson<{
      nucleos?: Array<{
        idNucleo?: string | number;
        idMunicipio?: string | number;
        idZona?: string;
        nombre?: string;
      }>;
    }>(`/Consorcios/${consorcioId}/nucleos`, { query: { lang }, signal });
    const raw = Array.isArray(res?.nucleos) ? res.nucleos : [];
    const nucleos: Nucleo[] = [];
    for (const item of raw) {
      const id = String(item.idNucleo ?? '').trim();
      if (!id) {
        continue;
      }
      nucleos.push({
        id,
        municipioId: String(item.idMunicipio ?? '').trim(),
        zoneId: cleanApiText(item.idZona),
        name: cleanApiText(item.nombre),
      });
    }
    return nucleos;
  }

  async fetchNucleoLines(
    consorcioId: ConsortiumId,
    nucleoId: string,
    signal?: AbortSignal,
  ): Promise<Line[]> {
    const cleanId = nucleoId.trim();
    const res = await this.requestJson<{ lineas?: RawLineDto[] }>(
      `/Consorcios/${consorcioId}/nucleos/${encodeURIComponent(cleanId)}/lineas`,
      { signal },
    );
    const rawLines = Array.isArray(res?.lineas) ? res.lineas : [];
    return rawLines
      .filter((l) => l.idLinea !== undefined)
      .map((raw) => {
        const code = cleanApiText(raw.codigo);
        const name = cleanApiText(raw.nombre);
        const mode = cleanApiText(raw.modo || raw.observacionesModoTransporte) || 'Bus';
        return {
          id: String(raw.idLinea).trim(),
          code,
          displayCode: extractDisplayLineCode(code, name),
          name,
          modeId: String(raw.idModo ?? '').trim(),
          mode,
          operators: splitCommaList(raw.operadores),
          hasNews: toBooleanFlag(raw.hayNoticia ?? raw.hayNoticias),
          color: defaultColorForMode(mode),
          isCircular: /\bcircular\b/i.test(name),
          directions: [],
        };
      });
  }

  async fetchMunicipios(
    consorcioId: ConsortiumId,
    lang: ApiLang = 'ES',
    signal?: AbortSignal,
  ): Promise<Municipality[]> {
    const res = await this.requestJson<{
      municipios?: Array<{ idMunicipio?: string | number; datos?: string; nombre?: string }>;
    }>(`/Consorcios/${consorcioId}/municipios/`, { query: { lang }, signal });
    const raw = Array.isArray(res?.municipios) ? res.municipios : [];
    return raw
      .filter((m) => m.idMunicipio !== undefined)
      .map((m) => ({
        id: String(m.idMunicipio).trim(),
        name: cleanApiText(m.datos ?? m.nombre),
      }));
  }

  async fetchTransportModes(
    consorcioId: ConsortiumId,
    lang: ApiLang = 'ES',
    signal?: AbortSignal,
  ): Promise<TransportMode[]> {
    const res = await this.requestJson<{
      modosTransporte?: Array<{
        idModo?: string | number;
        descripcion?: string;
        observaciones?: string;
      }>;
    }>(`/Consorcios/${consorcioId}/modostransporte`, { query: { lang }, signal });
    const raw = Array.isArray(res?.modosTransporte) ? res.modosTransporte : [];
    return raw
      .filter((m) => m.idModo !== undefined)
      .map((m) => ({
        id: String(m.idModo).trim(),
        description: cleanApiText(m.descripcion),
        observations: cleanApiText(m.observaciones),
      }));
  }

  async fetchFrequencies(
    consorcioId: ConsortiumId,
    lang: ApiLang = 'ES',
    signal?: AbortSignal,
  ): Promise<FrequencyDef[]> {
    const res = await this.requestJson<{
      frecuencias?: Array<{
        idFreq?: string | number;
        idfrecuencia?: string | number;
        codigo?: string;
        acronimo?: string;
        nombre?: string;
      }>;
    }>(`/Consorcios/${consorcioId}/frecuencias`, { query: { lang }, signal });
    return mapFrequenciesList(res?.frecuencias);
  }

  async fetchZones(
    consorcioId: ConsortiumId,
    lang: ApiLang = 'ES',
    signal?: AbortSignal,
  ): Promise<TariffZone[]> {
    const res = await this.requestJson<{
      zonas?: Array<{ idZona?: string | number; nombre?: string; color?: string }>;
    }>(`/Consorcios/${consorcioId}/zonas`, { query: { lang }, signal });
    const raw = Array.isArray(res?.zonas) ? res.zonas : [];
    return raw
      .filter((z) => z.idZona !== undefined)
      .map((z) => ({
        id: cleanApiText(String(z.idZona)),
        name: cleanApiText(z.nombre),
        color: normalizeHexColor(z.color),
      }));
  }

  async fetchZoneJumps(consorcioId: ConsortiumId, signal?: AbortSignal): Promise<ZoneJump[]> {
    const res = await this.requestJson<{
      saltos?: Array<{ origen?: string; destino?: string; saltos?: string | number }>;
    }>(`/Consorcios/${consorcioId}/saltos`, { signal });
    const raw = Array.isArray(res?.saltos) ? res.saltos : [];
    const jumps: ZoneJump[] = [];
    for (const item of raw) {
      const originZone = cleanApiText(item.origen);
      const destinationZone = cleanApiText(item.destino);
      const num = parseApiNumber(item.saltos);
      if (
        !originZone ||
        !destinationZone ||
        originZone === '--' ||
        destinationZone === '--' ||
        num === null ||
        num < 0
      ) {
        continue;
      }
      jumps.push({
        originZone,
        destinationZone,
        jumps: Math.trunc(num),
      });
    }
    return jumps;
  }

  async fetchCalculateJumps(
    consorcioId: ConsortiumId,
    originNucleoId: string,
    destNucleoId: string,
    lang: ApiLang = 'ES',
    signal?: AbortSignal,
  ): Promise<FareJumpResult> {
    const res = await this.requestJson<{
      calculo_saltos?: { saltos?: string | number; error?: string };
    }>(`/Consorcios/${consorcioId}/calculo_saltos/`, {
      query: { origen: originNucleoId, destino: destNucleoId, lang },
      signal,
    });
    const payload = res?.calculo_saltos;
    const rawJumps = parseApiNumber(payload?.saltos);
    const errorMsg = cleanApiText(payload?.error) || null;
    return {
      consorcioId,
      originNucleoId,
      originNucleoName: '',
      destinationNucleoId: destNucleoId,
      destinationNucleoName: '',
      jumps: rawJumps !== null && rawJumps >= 0 ? Math.trunc(rawJumps) : null,
      error: errorMsg,
      singleTicketEur: null,
      cardEur: null,
    };
  }

  async fetchInterurbanFares(
    consorcioId: ConsortiumId,
    lang: ApiLang = 'ES',
    signal?: AbortSignal,
  ): Promise<InterurbanFare[]> {
    const res = await this.requestJson<{
      tarifasInterurbanas?: Array<{
        saltos?: string | number;
        bs?: string | number;
        tarjeta?: string | number;
      }>;
    }>(`/Consorcios/${consorcioId}/tarifas_interurbanas`, { query: { lang }, signal });
    const raw = Array.isArray(res?.tarifasInterurbanas) ? res.tarifasInterurbanas : [];
    const fares: InterurbanFare[] = [];
    for (const item of raw) {
      const jumps = parseApiNumber(item.saltos);
      if (jumps === null) {
        continue;
      }
      fares.push({
        jumps: Math.trunc(jumps),
        singleTicketEur: parseApiNumber(item.bs),
        cardEur: parseApiNumber(item.tarjeta),
      });
    }
    return fares.sort((a, b) => a.jumps - b.jumps);
  }

  async fetchUrbanFares(
    consorcioId: ConsortiumId,
    lang: ApiLang = 'ES',
    signal?: AbortSignal,
  ): Promise<UrbanFare[]> {
    const res = await this.requestJson<{
      tarifasUrbanas?: Array<{
        nombre?: string;
        tu?: string | number;
        importeUsuario?: string | number;
      }>;
    }>(`/Consorcios/${consorcioId}/tarifas_urbanas`, { query: { lang }, signal });
    const raw = Array.isArray(res?.tarifasUrbanas) ? res.tarifasUrbanas : [];
    return raw.map((item) => ({
      name: cleanApiText(item.nombre),
      tuEur: parseApiNumber(item.tu),
      userPriceEur: parseApiNumber(item.importeUsuario),
    }));
  }

  async fetchLineSchedule(
    consorcioId: ConsortiumId,
    lineId: string,
    options: { lang?: ApiLang; day?: number; month?: number; signal?: AbortSignal } = {},
  ): Promise<LineSchedule> {
    const lang = options.lang ?? 'ES';
    const res = await this.requestJson<RawLineScheduleResponse>(
      `/Consorcios/${consorcioId}/horarios_lineas`,
      {
        query: {
          idLinea: lineId,
          lang,
          dia: options.day,
          mes: options.month,
        },
        signal: options.signal,
      },
    );

    const mapHeaders = (
      list: Array<{ colspan?: string | number; nombre?: string; color?: string }> | undefined,
    ): LineScheduleNucleoHeader[] =>
      (list ?? []).map((item) => ({
        name: cleanApiText(item.nombre),
        colspan: Math.max(1, Math.trunc(parseApiNumber(item.colspan) ?? 1)),
        color: normalizeHexColor(item.color),
      }));

    const mapBlocks = (
      list: Array<{ nombre?: string; color?: string; tipo?: string }> | undefined,
    ): LineScheduleBlock[] =>
      (list ?? []).map((b) => ({
        name: cleanApiText(b.nombre),
        color: normalizeHexColor(b.color),
        type: String(b.tipo ?? '0').trim(),
      }));

    const mapTrips = (
      list:
        | Array<{
            horas?: string[];
            frecuencia?: string;
            dias?: string;
            observaciones?: string;
          }>
        | undefined,
    ): LineScheduleTrip[] =>
      (list ?? []).map((t) => ({
        times: Array.isArray(t.horas) ? t.horas.map((h) => cleanApiText(h)) : [],
        frequencyAcronym: cleanApiText(t.frecuencia ?? t.dias),
        observations: cleanApiText(t.observaciones),
      }));

    const planners: LineSchedulePlanner[] = (res?.planificadores ?? []).map((p) => ({
      id: String(p.idPlani ?? '').trim(),
      startDate: cleanApiText(p.fechaInicio),
      endDate: cleanApiText(p.fechaFin),
      showEndDate: toBooleanFlag(p.muestraFechaFin),
      outboundNucleos: mapHeaders(p.nucleosIda),
      inboundNucleos: mapHeaders(p.nucleosVuelta),
      outboundBlocks: mapBlocks(p.bloquesIda),
      inboundBlocks: mapBlocks(p.bloquesVuelta),
      outboundTrips: mapTrips(p.horarioIda),
      inboundTrips: mapTrips(p.horarioVuelta),
    }));

    return {
      consorcioId,
      lineId,
      planners,
      frequencies: mapFrequenciesList(res?.frecuencias),
      cutoffTime: cleanApiText(res?.horaCorte) || null,
      modeObservations: cleanApiText(res?.observacionesModoTransporte),
    };
  }

  async fetchOdSchedule(
    consorcioId: ConsortiumId,
    originNucleoId: string,
    destNucleoId: string,
    lang: ApiLang = 'ES',
    signal?: AbortSignal,
  ): Promise<{
    bloques: OdBlock[];
    horario: Array<{
      lineId: string;
      code: string;
      times: string[];
      frequencyAcronym: string;
      observations: string;
    }>;
    frequencies: FrequencyDef[];
  } | null> {
    const res = await this.requestJson<RawOdScheduleResponse>(
      `/Consorcios/${consorcioId}/horarios_origen_destino`,
      {
        query: {
          idNucleoOrigen: originNucleoId,
          idNucleoDestino: destNucleoId,
          lang,
        },
        signal,
        allowHttp400Json: true,
      },
    );

    if (!res || typeof res.error === 'string' || !Array.isArray(res.horario)) {
      return null;
    }

    const bloques: OdBlock[] = (res.bloques ?? []).map((b) => ({
      name: cleanApiText(b.nombre),
      color: normalizeHexColor(b.color),
      type: String(b.tipo ?? '1').trim(),
    }));

    const horario = res.horario.map((row) => ({
      lineId: String(row.idlinea ?? row.idLinea ?? '').trim(),
      code: cleanApiText(row.codigo),
      times: Array.isArray(row.horas) ? row.horas.map((h) => cleanApiText(h)) : [],
      frequencyAcronym: cleanApiText(row.dias ?? row.frecuencia),
      observations: cleanApiText(row.observaciones),
    }));

    return {
      bloques,
      horario,
      frequencies: mapFrequenciesList(res.frecuencias),
    };
  }

  async fetchNews(
    consorcioId: ConsortiumId,
    options: { lang?: ApiLang; lineId?: string; signal?: AbortSignal } = {},
  ): Promise<ServiceAlert[]> {
    const lang = options.lang ?? 'ES';
    const path = options.lineId
      ? `/Consorcios/${consorcioId}/lineas/${encodeURIComponent(options.lineId)}/noticias`
      : `/Consorcios/${consorcioId}/noticias`;

    const res = await this.requestJson<{ noticias?: RawNewsDto[] }>(path, {
      query: { lang },
      signal: options.signal,
    });
    const raw = Array.isArray(res?.noticias) ? res.noticias : [];

    return raw.map((n, index) => {
      const title =
        lang === 'EN'
          ? cleanApiText(n.tituloEng || n.titulo)
          : cleanApiText(n.titulo || n.tituloEng);
      const subtitle =
        lang === 'EN'
          ? cleanApiText(n.subtituloEng || n.subTitulo || n.subtitulo)
          : cleanApiText(n.subTitulo || n.subtitulo || n.subtituloEng);
      const summary =
        lang === 'EN'
          ? cleanApiText(n.resumenEng || n.resumen)
          : cleanApiText(n.resumen || n.resumenEng);
      const body =
        lang === 'EN' ? cleanApiText(n.textoEng || n.texto) : cleanApiText(n.texto || n.textoEng);
      const linesRaw =
        n.lineas !== undefined && n.lineas !== null
          ? String(n.lineas)
          : n.idLinea !== undefined && n.idLinea !== null
            ? String(n.idLinea)
            : '';

      return {
        id: String(n.idNoticia ?? index).trim(),
        consorcioId,
        categoryId: String(n.idCategoria ?? '').trim(),
        category: cleanApiText(n.categoria),
        title,
        subtitle,
        summary,
        body,
        startDate: cleanApiText(n.fechaInicio),
        endDate: cleanApiText(n.fechafin ?? n.fechaFin ?? n.fechafinFija ?? n.fechaFinFija),
        lines: splitCommaList(linesRaw).filter((line) => line.toLowerCase() !== 'null'),
        isNew: toBooleanFlag(n.novedad),
      };
    });
  }

  async fetchSalesPoints(
    consorcioId: ConsortiumId,
    lang: ApiLang = 'ES',
    signal?: AbortSignal,
  ): Promise<SalesPoint[]> {
    const res = await this.requestJson<{ puntosVenta?: RawSalesPointDto[] }>(
      `/Consorcios/${consorcioId}/puntos_venta`,
      { query: { lang }, signal },
    );
    const raw = Array.isArray(res?.puntosVenta) ? res.puntosVenta : [];
    const points: SalesPoint[] = [];
    for (const item of raw) {
      const id = String(item.idComercio ?? '').trim();
      if (!id) {
        continue;
      }
      points.push({
        id,
        typeId: String(item.idTipo ?? '').trim(),
        type: cleanApiText(item.tipo),
        nucleoId: String(item.idNucleo ?? '').trim(),
        nucleoName: cleanApiText(item.nucleo),
        municipioId: String(item.idMunicipio ?? '').trim(),
        municipioName: cleanApiText(item.municipio),
        address: cleanApiText(item.direccion),
        lat: parseCoordinate(item.latitud),
        lon: parseCoordinate(item.longitud),
      });
    }
    return points;
  }
}
