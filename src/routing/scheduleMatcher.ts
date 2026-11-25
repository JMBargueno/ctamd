import type { LineStop } from '../types.js';
import { haversineMeters } from '../utils/geo.js';
import { parseClockToSeconds } from '../utils/time.js';

const DEFAULT_METROPOLITAN_BUS_SPEED_MPS = 8.5;
const FALLBACK_LOOP_GAP_METERS = 350;
const SECONDS_PER_DAY = 86_400;

export interface PairedDeparture {
  departureSeconds: number;
  arrivalSeconds: number;
  estimated: boolean;
}

export function defaultSpeedForMode(mode: string | null | undefined): number {
  const m = (mode ?? '').toLowerCase();
  if (m.includes('metro') || m.includes('tren') || m.includes('cercan')) {
    return 11.5;
  }
  if (m.includes('barco') || m.includes('catamar')) {
    return 7.0;
  }
  if (m.includes('tranv')) {
    return 6.0;
  }
  return DEFAULT_METROPOLITAN_BUS_SPEED_MPS;
}

function estimateTotalCircularDistance(stops: readonly LineStop[]): number {
  if (stops.length === 0) {
    return 0;
  }
  const first = stops[0]!;
  const last = stops[stops.length - 1]!;
  let closingGap = FALLBACK_LOOP_GAP_METERS;
  if (first.lat !== null && first.lon !== null && last.lat !== null && last.lon !== null) {
    const gap = haversineMeters(last.lat, last.lon, first.lat, first.lon);
    if (Number.isFinite(gap) && gap > 0) {
      closingGap = gap;
    }
  }
  return last.distanceMeters + closingGap;
}

/**
 * Estimates travel duration in seconds between two stops along a CTAN line sequence,
 * adjusting average speed by transport mode (`Bus`, `Metro`, `Tren`, `Barco`, `Tranvía`).
 */
export function estimateLegDurationSeconds(
  stops: readonly LineStop[],
  boardIdx: number,
  alightIdx: number,
  isCircular: boolean,
  mode?: string,
): number {
  const boardStop = stops[boardIdx];
  const alightStop = stops[alightIdx];
  if (!boardStop || !alightStop) {
    return 60;
  }

  let deltaDistance: number;
  if (!isCircular || boardIdx <= alightIdx) {
    deltaDistance = Math.max(0, alightStop.distanceMeters - boardStop.distanceMeters);
  } else {
    const totalLoop = estimateTotalCircularDistance(stops);
    deltaDistance = Math.max(0, totalLoop - boardStop.distanceMeters + alightStop.distanceMeters);
  }

  if (!isCircular || boardIdx < alightIdx) {
    const startA = parseClockToSeconds(boardStop.startTime);
    const startB = parseClockToSeconds(alightStop.startTime);
    if (startA !== null && startB !== null) {
      let diff = startB - startA;
      if (diff < -6 * 3600) {
        diff += SECONDS_PER_DAY;
      }
      if (diff > 0) {
        return diff;
      }
    }
  }

  if (
    deltaDistance === 0 &&
    boardStop.lat !== null &&
    boardStop.lon !== null &&
    alightStop.lat !== null &&
    alightStop.lon !== null
  ) {
    deltaDistance =
      haversineMeters(boardStop.lat, boardStop.lon, alightStop.lat, alightStop.lon) * 1.25;
  }

  const avgSpeed = defaultSpeedForMode(mode ?? boardStop.modes);
  return Math.max(60, Math.round(deltaDistance / avgSpeed));
}

/**
 * Pairs departure times at `boardStop` with arrival times at `alightStop` via
 * maximum-cardinality monotonic sequence alignment anchored to `expectedDurationSec`.
 */
export function pairLegDepartures(
  boardTimesSec: readonly number[],
  alightTimesSec: readonly number[],
  expectedDurationSec: number,
  options: { fallbackOnEmptyMatch?: boolean } = {},
): PairedDeparture[] {
  if (boardTimesSec.length === 0) {
    return [];
  }

  const safeExpected = Math.max(60, Math.round(expectedDurationSec));

  if (alightTimesSec.length === 0) {
    return boardTimesSec.map((dep) => ({
      departureSeconds: dep,
      arrivalSeconds: dep + safeExpected,
      estimated: true,
    }));
  }

  const minTravel = Math.max(30, Math.round(Math.min(safeExpected * 0.4, safeExpected - 300)));
  const maxTravel = Math.max(Math.round(safeExpected * 2.2), safeExpected + 1200);

  const m = boardTimesSec.length;
  const n = alightTimesSec.length;
  const MATCH_REWARD = 1_000_000;
  const cols = n + 1;

  const dp = new Float64Array((m + 1) * cols);
  const choice = new Uint8Array((m + 1) * cols);

  for (let i = 1; i <= m; i++) {
    const dep = boardTimesSec[i - 1]!;
    const rowOffset = i * cols;
    const prevRowOffset = (i - 1) * cols;

    for (let j = 1; j <= n; j++) {
      const idx = rowOffset + j;
      let bestScore = dp[prevRowOffset + j]!;
      let bestChoice = 0;

      const skipAlightScore = dp[rowOffset + j - 1]!;
      if (skipAlightScore > bestScore) {
        bestScore = skipAlightScore;
        bestChoice = 1;
      }

      const arr = alightTimesSec[j - 1]!;
      const travel = arr - dep;
      if (travel >= minTravel && travel <= maxTravel) {
        const matchScore =
          dp[prevRowOffset + j - 1]! + MATCH_REWARD - Math.abs(travel - safeExpected);
        if (matchScore > bestScore) {
          bestScore = matchScore;
          bestChoice = 2;
        }
      }

      dp[idx] = bestScore;
      choice[idx] = bestChoice;
    }
  }

  const paired: PairedDeparture[] = [];
  let i = m;
  let j = n;
  while (i > 0 && j > 0) {
    const c = choice[i * cols + j];
    if (c === 2) {
      paired.push({
        departureSeconds: boardTimesSec[i - 1]!,
        arrivalSeconds: alightTimesSec[j - 1]!,
        estimated: false,
      });
      i -= 1;
      j -= 1;
    } else if (c === 0) {
      i -= 1;
    } else {
      j -= 1;
    }
  }

  paired.reverse();
  if (paired.length === 0 && options.fallbackOnEmptyMatch) {
    return boardTimesSec.map((dep) => ({
      departureSeconds: dep,
      arrivalSeconds: dep + safeExpected,
      estimated: true,
    }));
  }
  return paired;
}
