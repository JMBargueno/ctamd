import type { CtanClient } from '../api/client.js';
import { CtamdApiError } from '../api/errors.js';
import type { CacheStore } from '../cache/store.js';
import type {
  Journey,
  JourneyLeg,
  JourneyTransfer,
  NetworkTopology,
  RouteSearchOptions,
  RouteSearchResult,
} from '../types.js';
import {
  formatDateKey,
  isSameLocalDay,
  normalizeScheduleSeconds,
  withLocalTime,
} from '../utils/time.js';
import {
  type CandidateCorridor,
  findAlternativeWalkSuggestion,
  findCandidateCorridors,
} from './corridors.js';
import { type PairedDeparture, pairLegDepartures } from './scheduleMatcher.js';
import {
  DEFAULT_DEST_WALK_METERS,
  DEFAULT_MAX_WALK_METERS,
  DEFAULT_ORIGIN_WALK_METERS,
  DEFAULT_TRANSFER_PENALTY_SECONDS,
  MAX_JOURNEY_SECONDS,
  MAX_TRANSFER_WAIT_SECONDS,
  WALK_ACCESS_PENALTY_SECONDS,
} from './transfers.js';

export type ScheduleLookup = (lineId: string, stopCode: string) => readonly number[];

function journeyScore(journey: Journey): number {
  return (
    journey.durationSeconds +
    journey.transferCount * DEFAULT_TRANSFER_PENALTY_SECONDS +
    (journey.originWalk ? WALK_ACCESS_PENALTY_SECONDS : 0) +
    (journey.destinationWalk ? WALK_ACCESS_PENALTY_SECONDS : 0)
  );
}

function journeySignature(journey: Journey): string {
  const originPart = journey.originWalk
    ? `OW:${journey.originWalk.fromStopCode}->${journey.originWalk.toStopCode}|`
    : '';
  const destPart = journey.destinationWalk
    ? `|DW:${journey.destinationWalk.fromStopCode}->${journey.destinationWalk.toStopCode}`
    : '';
  const legsPart = journey.legs
    .map(
      (leg) =>
        `${leg.lineId}:${leg.direction}:${leg.fromStopCode}:${leg.departureSeconds}->${leg.toStopCode}:${leg.arrivalSeconds}`,
    )
    .join('|');
  return originPart + legsPart + destPart;
}

function sortJourneys(journeys: Journey[], sortByDuration?: boolean): Journey[] {
  if (sortByDuration) {
    journeys.sort(
      (a, b) =>
        a.durationSeconds - b.durationSeconds ||
        a.transferCount - b.transferCount ||
        a.departureSeconds - b.departureSeconds,
    );
  } else {
    journeys.sort(
      (a, b) =>
        a.departureSeconds - b.departureSeconds ||
        a.arrivalSeconds - b.arrivalSeconds ||
        a.transferCount - b.transferCount,
    );
  }
  return journeys;
}

function finalizeJourneys(candidates: readonly Journey[], sortByDuration?: boolean): Journey[] {
  const bestByDeparture = new Map<number, Journey>();
  for (const candidate of candidates) {
    const existing = bestByDeparture.get(candidate.departureSeconds);
    if (
      !existing ||
      journeyScore(candidate) < journeyScore(existing) ||
      (journeyScore(candidate) === journeyScore(existing) &&
        (candidate.arrivalSeconds < existing.arrivalSeconds ||
          (candidate.arrivalSeconds === existing.arrivalSeconds &&
            candidate.transferCount < existing.transferCount)))
    ) {
      bestByDeparture.set(candidate.departureSeconds, candidate);
    }
  }

  const allCandidates = Array.from(bestByDeparture.values());
  allCandidates.sort(
    (a, b) =>
      a.departureSeconds - b.departureSeconds ||
      journeyScore(a) - journeyScore(b) ||
      a.arrivalSeconds - b.arrivalSeconds,
  );

  const pruned = removeDominated(allCandidates);
  return sortJourneys(pruned, sortByDuration);
}

function findFirstDepartureAtOrAfter(
  departures: readonly PairedDeparture[],
  minDepartureSec: number,
): PairedDeparture | null {
  let lo = 0;
  let hi = departures.length - 1;
  let match: PairedDeparture | null = null;

  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const candidate = departures[mid]!;
    if (candidate.departureSeconds >= minDepartureSec) {
      match = candidate;
      hi = mid - 1;
    } else {
      lo = mid + 1;
    }
  }

  return match;
}

/**
 * Removes Pareto-dominated journeys.
 */
export function removeDominated(journeys: readonly Journey[]): Journey[] {
  return journeys.filter((journey, idx) => {
    return !journeys.some((other, otherIdx) => {
      if (idx === otherIdx) {
        return false;
      }
      const noWorse =
        other.departureSeconds >= journey.departureSeconds &&
        other.arrivalSeconds <= journey.arrivalSeconds &&
        other.transferCount <= journey.transferCount;
      if (!noWorse) {
        return false;
      }
      return (
        other.departureSeconds > journey.departureSeconds ||
        other.arrivalSeconds < journey.arrivalSeconds ||
        other.transferCount < journey.transferCount
      );
    });
  });
}

/**
 * Materializes exact timed journeys for pre-discovered candidate corridors using a schedule lookup.
 */
export function findJourneysFromCorridors(
  topology: NetworkTopology,
  corridors: readonly CandidateCorridor[],
  scheduleLookup: ScheduleLookup,
  options: { sortByDuration?: boolean; afterSeconds?: number } = {},
): Journey[] {
  const stopName = (code: string): string => topology.stops[code]?.name || code;
  const pairedCache = new Map<string, PairedDeparture[]>();

  const getPairedForLeg = (leg: CandidateCorridor['legs'][number]): PairedDeparture[] => {
    const cacheKey = `${leg.lineId}:${leg.direction}:${leg.boardStopCode}->${leg.alightStopCode}:${leg.isTerminusAlight ? 1 : 0}`;
    const cached = pairedCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const boardTimes = scheduleLookup(leg.lineId, leg.boardStopCode);
    const alightTimes = scheduleLookup(leg.lineId, leg.alightStopCode);
    const paired = pairLegDepartures(boardTimes, alightTimes, leg.estimatedDurationSeconds, {
      fallbackOnEmptyMatch: Boolean(leg.isTerminusAlight),
    });
    pairedCache.set(cacheKey, paired);
    return paired;
  };

  const candidatesBySignature = new Map<string, Journey>();

  for (const corridor of corridors) {
    if (corridor.legs.length === 0) {
      continue;
    }

    const legDepartures = corridor.legs.map(getPairedForLeg);
    if (legDepartures.some((list) => list.length === 0)) {
      continue;
    }

    const originWalkSeconds = corridor.originWalk?.walkSeconds ?? 0;
    const destWalkSeconds = corridor.destinationWalk?.walkSeconds ?? 0;
    const firstLegList = legDepartures[0]!;

    for (const firstDep of firstLegList) {
      const doorDepartureSeconds = firstDep.departureSeconds - originWalkSeconds;
      if (options.afterSeconds !== undefined && doorDepartureSeconds < options.afterSeconds) {
        continue;
      }

      const legs: JourneyLeg[] = [
        {
          lineId: corridor.legs[0]!.lineId,
          lineLabel: corridor.legs[0]!.lineLabel,
          lineColor: corridor.legs[0]!.lineColor,
          mode: corridor.legs[0]!.mode,
          direction: corridor.legs[0]!.direction,
          fromStopCode: corridor.legs[0]!.boardStopCode,
          fromStopName: stopName(corridor.legs[0]!.boardStopCode),
          toStopCode: corridor.legs[0]!.alightStopCode,
          toStopName: stopName(corridor.legs[0]!.alightStopCode),
          departureSeconds: firstDep.departureSeconds,
          arrivalSeconds: firstDep.arrivalSeconds,
          stopsCount: corridor.legs[0]!.stopsCount,
          estimated: firstDep.estimated,
        },
      ];

      const transfers: JourneyTransfer[] = [];
      let prevArrival = firstDep.arrivalSeconds;
      let valid = true;

      for (let i = 1; i < corridor.legs.length; i++) {
        const corridorLeg = corridor.legs[i]!;
        const corridorTransfer = corridor.transfers[i - 1]!;
        const minConnectDep = prevArrival + corridorTransfer.minTransferSeconds;
        const nextDep = findFirstDepartureAtOrAfter(legDepartures[i]!, minConnectDep);

        if (!nextDep) {
          valid = false;
          break;
        }

        const waitSeconds = nextDep.departureSeconds - prevArrival;
        if (waitSeconds > MAX_TRANSFER_WAIT_SECONDS) {
          valid = false;
          break;
        }

        transfers.push({
          fromStopCode: corridorTransfer.fromStopCode,
          fromStopName: stopName(corridorTransfer.fromStopCode),
          toStopCode: corridorTransfer.toStopCode,
          toStopName: stopName(corridorTransfer.toStopCode),
          walkMeters: corridorTransfer.walkMeters,
          walkSeconds: corridorTransfer.walkSeconds,
          arrivalSeconds: prevArrival,
          departureSeconds: nextDep.departureSeconds,
          waitSeconds,
        });

        legs.push({
          lineId: corridorLeg.lineId,
          lineLabel: corridorLeg.lineLabel,
          lineColor: corridorLeg.lineColor,
          mode: corridorLeg.mode,
          direction: corridorLeg.direction,
          fromStopCode: corridorLeg.boardStopCode,
          fromStopName: stopName(corridorLeg.boardStopCode),
          toStopCode: corridorLeg.alightStopCode,
          toStopName: stopName(corridorLeg.alightStopCode),
          departureSeconds: nextDep.departureSeconds,
          arrivalSeconds: nextDep.arrivalSeconds,
          stopsCount: corridorLeg.stopsCount,
          estimated: nextDep.estimated,
        });

        prevArrival = nextDep.arrivalSeconds;
      }

      if (!valid) {
        continue;
      }

      const departureSeconds = doorDepartureSeconds;
      const arrivalSeconds = prevArrival + destWalkSeconds;
      const durationSeconds = arrivalSeconds - departureSeconds;
      if (durationSeconds <= 0 || durationSeconds > MAX_JOURNEY_SECONDS) {
        continue;
      }

      const journey: Journey = {
        legs,
        transfers,
        ...(corridor.originWalk
          ? {
              originWalk: {
                fromStopCode: corridor.originWalk.fromStopCode,
                fromStopName: stopName(corridor.originWalk.fromStopCode),
                toStopCode: corridor.originWalk.toStopCode,
                toStopName: stopName(corridor.originWalk.toStopCode),
                walkMeters: corridor.originWalk.walkMeters,
                walkSeconds: corridor.originWalk.walkSeconds,
              },
            }
          : {}),
        ...(corridor.destinationWalk
          ? {
              destinationWalk: {
                fromStopCode: corridor.destinationWalk.fromStopCode,
                fromStopName: stopName(corridor.destinationWalk.fromStopCode),
                toStopCode: corridor.destinationWalk.toStopCode,
                toStopName: stopName(corridor.destinationWalk.toStopCode),
                walkMeters: corridor.destinationWalk.walkMeters,
                walkSeconds: corridor.destinationWalk.walkSeconds,
              },
            }
          : {}),
        departureSeconds,
        arrivalSeconds,
        durationSeconds,
        transferCount: transfers.length,
        estimated: legs.some((l) => l.estimated),
      };

      const sig = journeySignature(journey);
      if (!candidatesBySignature.has(sig)) {
        candidatesBySignature.set(sig, journey);
      }
    }
  }

  return finalizeJourneys(Array.from(candidatesBySignature.values()), options.sortByDuration);
}

/**
 * Synthesizes offline estimated journeys directly from cached network topology distances and speeds.
 */
export function buildEstimatedJourneysFromCorridors(
  topology: NetworkTopology,
  corridors: readonly CandidateCorridor[],
  options: { anchorSeconds?: number; sortByDuration?: boolean } = {},
): Journey[] {
  const stopName = (code: string): string => topology.stops[code]?.name || code;
  const anchorSeconds = Math.max(0, Math.round(options.anchorSeconds ?? 8 * 3_600));
  const candidatesBySignature = new Map<string, Journey>();

  for (const corridor of corridors) {
    if (corridor.legs.length === 0) {
      continue;
    }

    const originWalkSeconds = corridor.originWalk?.walkSeconds ?? 0;
    const destWalkSeconds = corridor.destinationWalk?.walkSeconds ?? 0;
    let cursor = anchorSeconds + originWalkSeconds;

    const legs: JourneyLeg[] = [];
    const transfers: JourneyTransfer[] = [];

    for (let i = 0; i < corridor.legs.length; i++) {
      const cLeg = corridor.legs[i]!;
      if (i > 0) {
        const cTransfer = corridor.transfers[i - 1]!;
        const waitSeconds = cTransfer.minTransferSeconds + 180;
        const dep = cursor + waitSeconds;
        transfers.push({
          fromStopCode: cTransfer.fromStopCode,
          fromStopName: stopName(cTransfer.fromStopCode),
          toStopCode: cTransfer.toStopCode,
          toStopName: stopName(cTransfer.toStopCode),
          walkMeters: cTransfer.walkMeters,
          walkSeconds: cTransfer.walkSeconds,
          arrivalSeconds: cursor,
          departureSeconds: dep,
          waitSeconds,
        });
        cursor = dep;
      }

      const legDep = cursor;
      const legArr = legDep + Math.max(60, Math.round(cLeg.estimatedDurationSeconds));
      legs.push({
        lineId: cLeg.lineId,
        lineLabel: cLeg.lineLabel,
        lineColor: cLeg.lineColor,
        mode: cLeg.mode,
        direction: cLeg.direction,
        fromStopCode: cLeg.boardStopCode,
        fromStopName: stopName(cLeg.boardStopCode),
        toStopCode: cLeg.alightStopCode,
        toStopName: stopName(cLeg.alightStopCode),
        departureSeconds: legDep,
        arrivalSeconds: legArr,
        stopsCount: cLeg.stopsCount,
        estimated: true,
      });
      cursor = legArr;
    }

    const departureSeconds = anchorSeconds;
    const arrivalSeconds = cursor + destWalkSeconds;
    const durationSeconds = arrivalSeconds - departureSeconds;
    if (durationSeconds <= 0 || durationSeconds > MAX_JOURNEY_SECONDS) {
      continue;
    }

    const journey: Journey = {
      legs,
      transfers,
      ...(corridor.originWalk
        ? {
            originWalk: {
              fromStopCode: corridor.originWalk.fromStopCode,
              fromStopName: stopName(corridor.originWalk.fromStopCode),
              toStopCode: corridor.originWalk.toStopCode,
              toStopName: stopName(corridor.originWalk.toStopCode),
              walkMeters: corridor.originWalk.walkMeters,
              walkSeconds: corridor.originWalk.walkSeconds,
            },
          }
        : {}),
      ...(corridor.destinationWalk
        ? {
            destinationWalk: {
              fromStopCode: corridor.destinationWalk.fromStopCode,
              fromStopName: stopName(corridor.destinationWalk.fromStopCode),
              toStopCode: corridor.destinationWalk.toStopCode,
              toStopName: stopName(corridor.destinationWalk.toStopCode),
              walkMeters: corridor.destinationWalk.walkMeters,
              walkSeconds: corridor.destinationWalk.walkSeconds,
            },
          }
        : {}),
      departureSeconds,
      arrivalSeconds,
      durationSeconds,
      transferCount: transfers.length,
      estimated: true,
    };

    const sig = journeySignature(journey);
    if (!candidatesBySignature.has(sig)) {
      candidatesBySignature.set(sig, journey);
    }
  }

  return finalizeJourneys(Array.from(candidatesBySignature.values()), options.sortByDuration);
}

/**
 * Fetches CTAN stop departures across hourly windows for a given day and groups them by `lineId`.
 */
export async function fetchStopTimesByLine(
  client: CtanClient,
  consorcioId: NetworkTopology['consorcioId'],
  stopCode: string,
  date: Date,
  options: { startHour?: number; endHour?: number; signal?: AbortSignal } = {},
): Promise<Record<string, string[]>> {
  const startHour = Math.max(0, Math.min(23, options.startHour ?? 5));
  const endHour = Math.max(startHour, Math.min(23, options.endHour ?? 23));

  const seenPerLine = new Map<string, Set<string>>();
  const orderedPerLine = new Map<string, string[]>();

  for (let hour = startHour; hour <= endHour; hour++) {
    if (options.signal?.aborted) {
      break;
    }
    const windowDate = withLocalTime(date, hour, 0, 0);
    const res = await client.fetchStopServices(consorcioId, stopCode, windowDate, {
      signal: options.signal,
      now: windowDate,
    });
    for (const svc of res.services) {
      let seen = seenPerLine.get(svc.lineId);
      if (!seen) {
        seen = new Set<string>();
        seenPerLine.set(svc.lineId, seen);
        orderedPerLine.set(svc.lineId, []);
      }
      if (!seen.has(svc.departureTime)) {
        seen.add(svc.departureTime);
        orderedPerLine.get(svc.lineId)!.push(svc.departureTime);
      }
    }
  }

  const out: Record<string, string[]> = {};
  for (const [lineId, times] of orderedPerLine.entries()) {
    out[lineId] = times;
  }
  return out;
}

function splitIntoHydrationBatches(
  corridors: readonly CandidateCorridor[],
  firstBatchSize: number,
): CandidateCorridor[][] {
  if (corridors.length === 0) {
    return [];
  }
  const batches: CandidateCorridor[][] = [];
  const firstSize = Math.max(1, firstBatchSize);
  batches.push(corridors.slice(0, firstSize));
  for (let i = firstSize; i < corridors.length; i += 2) {
    batches.push(corridors.slice(i, i + 2));
  }
  return batches;
}

async function sleepWithAbort(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0 || signal.aborted) {
    return;
  }
  await new Promise<void>((resolve) => {
    const onAbort = (): void => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Runs Phase 1 corridor discovery, progressively hydrates stop schedules from cache or CTAN
 * `/paradas/:id/servicios` windows, and computes Pareto-optimal timed journeys.
 */
export async function routeWithHydrationDetailed(
  client: CtanClient,
  cache: CacheStore,
  topology: NetworkTopology,
  options: RouteSearchOptions & { fullDay?: boolean },
): Promise<RouteSearchResult> {
  const maxTransfers = options.maxTransfers ?? 2;
  const maxWalkMeters = options.maxWalkMeters ?? DEFAULT_MAX_WALK_METERS;
  const maxOriginWalkMeters = Math.max(
    0,
    options.maxOriginWalkMeters ?? DEFAULT_ORIGIN_WALK_METERS,
  );
  const maxDestWalkMeters = Math.max(0, options.maxDestWalkMeters ?? DEFAULT_DEST_WALK_METERS);

  const corridors = findCandidateCorridors(topology, options.fromStopCode, options.toStopCode, {
    maxTransfers,
    maxWalkMeters,
    maxOriginWalkMeters,
    maxDestWalkMeters,
    maxCorridors: 6,
  });

  const walkSuggestion =
    maxOriginWalkMeters === 0 || maxDestWalkMeters === 0
      ? findAlternativeWalkSuggestion(
          topology,
          options.fromStopCode,
          options.toStopCode,
          corridors,
          {
            maxTransfers,
            maxWalkMeters,
            maxOriginWalkMeters,
            maxDestWalkMeters,
            maxCorridors: 6,
          },
        )
      : undefined;

  if (corridors.length === 0) {
    return {
      consorcioId: topology.consorcioId,
      journeys: [],
      rateLimited: false,
      partial: false,
      estimatedFallback: Boolean(options.estimate),
      hydratedCorridors: 0,
      totalCorridors: 0,
      warnings: [],
      ...(walkSuggestion ? { walkSuggestion } : {}),
    };
  }

  const now = new Date();
  const baseDate = options.date ?? now;
  const dateKey = formatDateKey(baseDate);

  const stopSchedules = new Map<string, Map<string, number[]>>();
  const hydratedStops = new Set<string>();
  const attemptedStops = new Set<string>();

  for (const corridor of corridors) {
    for (const leg of corridor.legs) {
      for (const stopCode of [leg.boardStopCode, leg.alightStopCode]) {
        if (hydratedStops.has(stopCode)) {
          continue;
        }
        const shouldUseCache = !options.refresh || Boolean(options.estimate);
        const cached = shouldUseCache
          ? await cache.getStopDaySchedules(topology.consorcioId, stopCode, dateKey)
          : null;
        if (cached) {
          const map = new Map<string, number[]>();
          for (const [lineId, times] of Object.entries(cached)) {
            map.set(lineId, normalizeScheduleSeconds(times));
          }
          stopSchedules.set(stopCode, map);
          hydratedStops.add(stopCode);
          attemptedStops.add(stopCode);
        }
      }
    }
  }

  const scheduleLookup: ScheduleLookup = (lineId, stopCode) =>
    stopSchedules.get(stopCode)?.get(lineId) ?? [];

  const countHydratedCorridors = (): number =>
    corridors.filter((corridor) =>
      corridor.legs.every(
        (leg) => hydratedStops.has(leg.boardStopCode) && hydratedStops.has(leg.alightStopCode),
      ),
    ).length;

  if (options.estimate) {
    const cachedCorridors = corridors.filter((corridor) =>
      corridor.legs.every(
        (leg) => hydratedStops.has(leg.boardStopCode) && hydratedStops.has(leg.alightStopCode),
      ),
    );
    const timedJourneys =
      cachedCorridors.length > 0
        ? findJourneysFromCorridors(topology, cachedCorridors, scheduleLookup, {
            sortByDuration: options.sortByDuration,
            afterSeconds: options.afterSeconds,
          })
        : [];

    const uncachedCorridors =
      timedJourneys.length === 0
        ? corridors
        : corridors.filter((corridor) => !cachedCorridors.includes(corridor));

    const defaultAnchor = isSameLocalDay(baseDate, now)
      ? now.getHours() * 3600 + now.getMinutes() * 60
      : 8 * 3600;
    const anchorSeconds = options.afterSeconds ?? defaultAnchor;

    const estJourneys =
      uncachedCorridors.length > 0
        ? buildEstimatedJourneysFromCorridors(topology, uncachedCorridors, {
            anchorSeconds,
            sortByDuration: options.sortByDuration,
          })
        : [];

    const combined = sortJourneys(
      removeDominated([...timedJourneys, ...estJourneys]),
      options.sortByDuration,
    );

    return {
      consorcioId: topology.consorcioId,
      journeys: combined,
      rateLimited: false,
      partial: false,
      estimatedFallback: true,
      hydratedCorridors: cachedCorridors.length,
      totalCorridors: corridors.length,
      warnings: ['Showing offline topology-based route estimates (--estimate).'],
      ...(walkSuggestion ? { walkSuggestion } : {}),
    };
  }

  const firstBatchSize =
    options.hydrationBatchSize ?? (corridors[0]?.transfers.length === 0 ? 3 : 2);
  const batches = splitIntoHydrationBatches(corridors, firstBatchSize);
  const requestDelayMs = Math.max(0, options.requestDelayMs ?? 60);

  const isWindowedSearch = !options.fullDay && options.afterSeconds !== undefined;
  const startHour = isWindowedSearch
    ? Math.max(5, Math.min(23, Math.floor(options.afterSeconds! / 3600)))
    : 5;
  const endHour = isWindowedSearch ? Math.min(23, startHour + 5) : 23;

  const abortController = new AbortController();
  const state: {
    circuitOpen: boolean;
    rateLimitError: CtamdApiError | null;
    lastApiError: CtamdApiError | null;
    uncachedAttemptCount: number;
    uncachedSuccessCount: number;
  } = {
    circuitOpen: false,
    rateLimitError: null,
    lastApiError: null,
    uncachedAttemptCount: 0,
    uncachedSuccessCount: 0,
  };

  for (const batch of batches) {
    if (state.circuitOpen || abortController.signal.aborted) {
      break;
    }

    const batchStops: string[] = [];
    for (const corridor of batch) {
      for (const leg of corridor.legs) {
        for (const stopCode of [leg.boardStopCode, leg.alightStopCode]) {
          if (!attemptedStops.has(stopCode)) {
            attemptedStops.add(stopCode);
            batchStops.push(stopCode);
          }
        }
      }
    }

    if (batchStops.length === 0) {
      continue;
    }

    let cursor = 0;
    const worker = async (): Promise<void> => {
      while (cursor < batchStops.length && !state.circuitOpen && !abortController.signal.aborted) {
        const stopCode = batchStops[cursor]!;
        cursor += 1;
        state.uncachedAttemptCount += 1;

        try {
          const byLine = await fetchStopTimesByLine(
            client,
            topology.consorcioId,
            stopCode,
            baseDate,
            {
              startHour,
              endHour,
              signal: abortController.signal,
            },
          );
          if (!isWindowedSearch) {
            await cache
              .saveStopDaySchedules(topology.consorcioId, stopCode, dateKey, byLine)
              .catch(() => undefined);
          }
          const map = new Map<string, number[]>();
          for (const [lineId, times] of Object.entries(byLine)) {
            map.set(lineId, normalizeScheduleSeconds(times));
          }
          stopSchedules.set(stopCode, map);
          hydratedStops.add(stopCode);
          state.uncachedSuccessCount += 1;
        } catch (err) {
          if (err instanceof CtamdApiError && err.statusCode === 429) {
            state.circuitOpen = true;
            state.rateLimitError = err;
            abortController.abort();
            break;
          }
          if (err instanceof CtamdApiError && !abortController.signal.aborted) {
            state.lastApiError = err;
          }
          if (!stopSchedules.has(stopCode)) {
            stopSchedules.set(stopCode, new Map());
          }
        }

        if (
          cursor < batchStops.length &&
          !state.circuitOpen &&
          !abortController.signal.aborted &&
          requestDelayMs > 0
        ) {
          await sleepWithAbort(requestDelayMs, abortController.signal);
        }
      }
    };

    const workerCount = Math.min(2, batchStops.length);
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
  }

  const hydratedCorridors = countHydratedCorridors();
  const journeys = findJourneysFromCorridors(topology, corridors, scheduleLookup, {
    sortByDuration: options.sortByDuration,
    afterSeconds: options.afterSeconds,
  });

  if (state.circuitOpen) {
    if (journeys.length > 0) {
      return {
        consorcioId: topology.consorcioId,
        journeys,
        rateLimited: true,
        partial: true,
        estimatedFallback: false,
        hydratedCorridors,
        totalCorridors: corridors.length,
        warnings: [
          `CTAN rate limit (HTTP 429) reached; showing partial results from ${hydratedCorridors}/${corridors.length} corridors. Pass --estimate for offline topology estimates.`,
        ],
        ...(walkSuggestion ? { walkSuggestion } : {}),
      };
    }

    throw new CtamdApiError(
      `${state.rateLimitError?.message ?? 'CTAN upstream rate-limited (HTTP 429)'}. Pass --estimate for offline topology estimates.`,
      429,
      state.rateLimitError?.url,
      state.rateLimitError?.retryAfterMs,
    );
  }

  if (
    state.uncachedAttemptCount > 0 &&
    state.uncachedSuccessCount === 0 &&
    state.lastApiError &&
    journeys.length === 0
  ) {
    throw state.lastApiError;
  }

  return {
    consorcioId: topology.consorcioId,
    journeys,
    rateLimited: false,
    partial: false,
    estimatedFallback: false,
    hydratedCorridors,
    totalCorridors: corridors.length,
    warnings: [],
    ...(walkSuggestion ? { walkSuggestion } : {}),
  };
}
