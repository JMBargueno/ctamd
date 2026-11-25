import { defaultColorForMode } from '../api/client.js';
import type { FrequencyDef, Line, OdBlock, OdCheckpoint, OdJourney } from '../types.js';
import { matchesFrequencyOnDate } from '../utils/frequency.js';
import { cleanApiText, normalizeSearchText } from '../utils/text.js';
import { parseClockToSeconds, SECONDS_PER_DAY } from '../utils/time.js';

export interface ParseOdScheduleOptions {
  date: Date;
  isHoliday?: boolean;
  afterSeconds?: number;
  freqFilter?: string;
  sortByDuration?: boolean;
  linesById?: Record<string, Line>;
  catalogFrequencies?: Record<string, FrequencyDef>;
}

export interface ParsedOdSchedule {
  journeys: OdJourney[];
  originBlocks: string[];
  destinationBlocks: string[];
  frequencies: FrequencyDef[];
}

function isMetadataBlock(block: OdBlock): boolean {
  const name = normalizeSearchText(block.name);
  if (name === 'lineas' || name === 'frecuencia' || name === 'observaciones') {
    return true;
  }
  return block.color === '#ffffff';
}

/**
 * Dynamically partitions the middle timepoint columns of `horarios_origen_destino`
 * into Origin blocks (first contiguous color group) and Destination blocks (second group),
 * handling all regional color palettes without hardcoding hex codes.
 */
export function partitionOdBlocks(
  bloques: readonly OdBlock[],
  expectedTimeColumns: number,
): { originIndices: number[]; destIndices: number[]; timeBlockNames: string[] } {
  const timeBlocks: OdBlock[] = [];
  for (const block of bloques) {
    if (isMetadataBlock(block)) {
      continue;
    }
    timeBlocks.push(block);
  }

  const count = Math.min(timeBlocks.length, expectedTimeColumns || timeBlocks.length);
  if (count === 0) {
    return { originIndices: [], destIndices: [], timeBlockNames: [] };
  }

  const activeBlocks = timeBlocks.slice(0, count);
  const timeBlockNames = activeBlocks.map((b) => b.name);

  if (count === 1) {
    return { originIndices: [0], destIndices: [], timeBlockNames };
  }

  const firstColor = (activeBlocks[0]?.color ?? '').toLowerCase();
  let splitIdx = -1;

  if (firstColor) {
    for (let i = 1; i < count; i++) {
      const col = (activeBlocks[i]?.color ?? '').toLowerCase();
      if (col && col !== firstColor) {
        splitIdx = i;
        break;
      }
    }
  }

  if (splitIdx <= 0 || splitIdx >= count) {
    splitIdx = Math.max(1, Math.floor(count / 2));
  }

  const originIndices: number[] = [];
  const destIndices: number[] = [];
  for (let i = 0; i < count; i++) {
    if (i < splitIdx) {
      originIndices.push(i);
    } else {
      destIndices.push(i);
    }
  }

  return { originIndices, destIndices, timeBlockNames };
}

function findFrequencyDescription(
  acronym: string,
  odFrequencies: readonly FrequencyDef[],
  catalogFrequencies?: Record<string, FrequencyDef>,
): string | undefined {
  const norm = normalizeSearchText(acronym);
  const inOd = odFrequencies.find((f) => normalizeSearchText(f.acronym) === norm);
  if (inOd?.name) {
    return inOd.name;
  }
  if (catalogFrequencies) {
    for (const freq of Object.values(catalogFrequencies)) {
      if (normalizeSearchText(freq.acronym) === norm && freq.name) {
        return freq.name;
      }
    }
  }
  return undefined;
}

/**
 * Parses a raw CTAN `horarios_origen_destino` payload into date-filtered, sorted `OdJourney` entries.
 */
export function parseOdSchedule(
  raw: {
    bloques: OdBlock[];
    horario: Array<{
      lineId: string;
      code: string;
      times: string[];
      frequencyAcronym: string;
      observations: string;
    }>;
    frequencies: FrequencyDef[];
  },
  options: ParseOdScheduleOptions,
): ParsedOdSchedule {
  const maxCols = raw.horario.reduce((max, row) => Math.max(max, row.times.length), 0);
  const { originIndices, destIndices, timeBlockNames } = partitionOdBlocks(raw.bloques, maxCols);
  const originBlocks = originIndices.map((idx) => timeBlockNames[idx] ?? `Origin ${idx + 1}`);
  const destinationBlocks = destIndices.map((idx) => timeBlockNames[idx] ?? `Dest ${idx + 1}`);

  const freqFilterNorm = options.freqFilter ? normalizeSearchText(options.freqFilter) : '';
  const showAllFreqs = freqFilterNorm === 'all';
  const journeys: OdJourney[] = [];
  const seenSignatures = new Set<string>();

  for (const row of raw.horario) {
    const freqDesc = findFrequencyDescription(
      row.frequencyAcronym,
      raw.frequencies,
      options.catalogFrequencies,
    );

    if (freqFilterNorm && !showAllFreqs) {
      if (normalizeSearchText(row.frequencyAcronym) !== freqFilterNorm) {
        continue;
      }
    } else if (!showAllFreqs) {
      if (
        !matchesFrequencyOnDate(row.frequencyAcronym, freqDesc, options.date, {
          isHoliday: options.isHoliday,
        })
      ) {
        continue;
      }
    }

    const originCheckpoints: OdCheckpoint[] = [];
    let depSec: number | null = null;
    let depBlock = '';
    let depTime = '';

    for (const idx of originIndices) {
      const rawTime = cleanApiText(row.times[idx]);
      const parsedSec = parseClockToSeconds(rawTime);
      if (parsedSec !== null) {
        const blockName = timeBlockNames[idx] ?? `Origin ${idx + 1}`;
        originCheckpoints.push({ blockName, time: rawTime.slice(0, 5) });
        if (depSec === null) {
          depSec = parsedSec;
          depBlock = blockName;
          depTime = rawTime.slice(0, 5);
        }
      }
    }

    const destinationCheckpoints: OdCheckpoint[] = [];
    let arrSec: number | null = null;
    let arrBlock = '';
    let arrTime = '';

    for (const idx of destIndices) {
      const rawTime = cleanApiText(row.times[idx]);
      const parsedSec = parseClockToSeconds(rawTime);
      if (parsedSec !== null) {
        const blockName = timeBlockNames[idx] ?? `Dest ${idx + 1}`;
        destinationCheckpoints.push({ blockName, time: rawTime.slice(0, 5) });
        if (arrSec === null) {
          arrSec = parsedSec;
          arrBlock = blockName;
          arrTime = rawTime.slice(0, 5);
        }
      }
    }

    if (depSec === null || arrSec === null) {
      continue;
    }

    if (arrSec < depSec) {
      arrSec += SECONDS_PER_DAY;
    }

    const durationSeconds = arrSec - depSec;
    if (durationSeconds <= 0 || durationSeconds > 6 * 3_600) {
      continue;
    }

    if (options.afterSeconds !== undefined && depSec < options.afterSeconds) {
      continue;
    }

    const catalogLine = options.linesById?.[row.lineId];
    const mode = catalogLine?.mode ?? 'Bus';
    const lineColor = catalogLine?.color ?? defaultColorForMode(mode);
    const displayCode = catalogLine?.displayCode ?? (row.code || row.lineId);

    const sig = `${row.lineId}|${depTime}|${arrTime}|${row.frequencyAcronym}`;
    if (seenSignatures.has(sig)) {
      continue;
    }
    seenSignatures.add(sig);

    journeys.push({
      lineId: row.lineId,
      lineCode: row.code || catalogLine?.code || row.lineId,
      displayCode,
      lineName: catalogLine?.name ?? '',
      lineColor,
      mode,
      originBlock: depBlock,
      destinationBlock: arrBlock,
      departureTime: depTime,
      arrivalTime: arrTime,
      departureSeconds: depSec,
      arrivalSeconds: arrSec,
      durationSeconds,
      frequencyAcronym: row.frequencyAcronym,
      frequencyDescription: freqDesc ?? '',
      observations: row.observations,
      originCheckpoints,
      destinationCheckpoints,
    });
  }

  if (options.sortByDuration) {
    journeys.sort(
      (a, b) =>
        a.durationSeconds - b.durationSeconds ||
        a.departureSeconds - b.departureSeconds ||
        a.displayCode.localeCompare(b.displayCode),
    );
  } else {
    journeys.sort(
      (a, b) =>
        a.departureSeconds - b.departureSeconds ||
        a.durationSeconds - b.durationSeconds ||
        a.displayCode.localeCompare(b.displayCode),
    );
  }

  return {
    journeys,
    originBlocks,
    destinationBlocks,
    frequencies: raw.frequencies,
  };
}
