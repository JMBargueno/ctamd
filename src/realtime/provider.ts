import type { CtanClient } from '../api/client.js';
import type {
  ApiLang,
  ConsortiumId,
  Line,
  Stop,
  StopService,
  StopServicesResult,
} from '../types.js';
import { computeEtaMinutes, parseCtanTimestamp } from '../utils/time.js';

export interface StopArrivalQueryOptions {
  startDateTime?: Date;
  hours?: number;
  lang?: ApiLang;
  signal?: AbortSignal;
  now?: Date;
  stop?: Stop;
  linesById?: Record<string, Line>;
}

/**
 * Pluggable arrival provider interface enabling future per-consortium SAE/GPS adapters
 * alongside the official `api.ctan.es/v1` scheduled departures provider.
 */
export interface ArrivalProvider {
  readonly name: string;
  readonly source: 'scheduled' | 'realtime';
  supports(consorcioId: ConsortiumId): boolean;
  fetchStopServices(
    consorcioId: ConsortiumId,
    stopId: string,
    options?: StopArrivalQueryOptions,
  ): Promise<StopServicesResult>;
}

function advanceOneHour(date: Date): Date {
  return new Date(date.getTime() + 3_600_000);
}

function enrichServices(
  services: StopService[],
  linesById: Record<string, Line> | undefined,
  now: Date,
): StopService[] {
  return services.map((service) => {
    const catalogLine = linesById?.[service.lineId];
    return {
      ...service,
      displayCode: catalogLine?.displayCode || service.displayCode,
      lineColor: catalogLine?.color || service.lineColor,
      etaMinutes: computeEtaMinutes(service.departureSeconds, now),
    };
  });
}

/**
 * Default CTAN arrival provider backed by `/Consorcios/:id/paradas/:idParada/servicios`.
 */
export class CtanScheduledProvider implements ArrivalProvider {
  readonly name = 'ctan-scheduled';
  readonly source = 'scheduled' as const;

  constructor(private readonly client: CtanClient) {}

  supports(_consorcioId: ConsortiumId): boolean {
    return true;
  }

  async fetchStopServices(
    consorcioId: ConsortiumId,
    stopId: string,
    options: StopArrivalQueryOptions = {},
  ): Promise<StopServicesResult> {
    const now = options.now ?? new Date();
    const hours = Math.max(1, Math.min(24, Math.trunc(options.hours ?? 1)));
    const startBase = options.startDateTime;

    const mergedServices: StopService[] = [];
    const seen = new Set<string>();
    let firstWindow: StopServicesResult | null = null;
    let lastWindowEnd = '';
    let cursorDate = startBase;

    for (let step = 0; step < hours; step++) {
      const windowResult = await this.client.fetchStopServices(consorcioId, stopId, cursorDate, {
        signal: options.signal,
        now,
      });

      if (!firstWindow) {
        firstWindow = windowResult;
      }
      if (windowResult.windowEnd) {
        lastWindowEnd = windowResult.windowEnd;
      }

      for (const svc of windowResult.services) {
        const key = `${svc.lineId}|${svc.direction}|${svc.departureTime}|${svc.destination}`;
        if (!seen.has(key)) {
          seen.add(key);
          mergedServices.push(svc);
        }
      }

      if (step + 1 < hours) {
        const nextBase =
          parseCtanTimestamp(windowResult.windowEnd) ?? advanceOneHour(cursorDate ?? now);
        cursorDate = nextBase;
      }
    }

    const enriched = enrichServices(mergedServices, options.linesById, now).sort(
      (a, b) =>
        a.departureSeconds - b.departureSeconds || a.displayCode.localeCompare(b.displayCode),
    );

    return {
      consorcioId,
      stopId: firstWindow?.stopId ?? stopId,
      stopCode: firstWindow?.stopCode ?? stopId,
      stopName: options.stop?.name || firstWindow?.stopName || '',
      nucleoName: options.stop?.nucleoName || firstWindow?.nucleoName || '',
      lat: options.stop?.lat ?? firstWindow?.lat ?? null,
      lon: options.stop?.lon ?? firstWindow?.lon ?? null,
      windowStart: firstWindow?.windowStart ?? '',
      windowEnd: lastWindowEnd || firstWindow?.windowEnd || '',
      fetchedAt: firstWindow?.fetchedAt ?? now.toISOString(),
      stale: false,
      source: 'scheduled',
      providerName: this.name,
      services: enriched,
    };
  }
}

/**
 * Registry that resolves real-time SAE providers when registered for a consortium
 * and transparently falls back to `CtanScheduledProvider`.
 */
export class ArrivalProviderRegistry {
  private readonly realtimeProviders: ArrivalProvider[] = [];
  readonly fallbackProvider: ArrivalProvider;

  constructor(client: CtanClient, realtimeProviders: readonly ArrivalProvider[] = []) {
    this.fallbackProvider = new CtanScheduledProvider(client);
    for (const provider of realtimeProviders) {
      this.register(provider);
    }
  }

  register(provider: ArrivalProvider): void {
    this.realtimeProviders.push(provider);
  }

  listProviders(): ArrivalProvider[] {
    return [...this.realtimeProviders, this.fallbackProvider];
  }

  async fetchStopServices(
    consorcioId: ConsortiumId,
    stopId: string,
    options: StopArrivalQueryOptions = {},
  ): Promise<{ result: StopServicesResult; warnings: string[] }> {
    const warnings: string[] = [];

    for (const provider of this.realtimeProviders) {
      if (!provider.supports(consorcioId)) {
        continue;
      }
      try {
        const result = await provider.fetchStopServices(consorcioId, stopId, options);
        return { result, warnings };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        warnings.push(
          `Real-time provider '${provider.name}' unavailable (${message}); falling back to CTAN scheduled departures.`,
        );
      }
    }

    const result = await this.fallbackProvider.fetchStopServices(consorcioId, stopId, options);
    return { result, warnings };
  }
}
