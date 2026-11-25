import pc from 'picocolors';
import { getConsortiumById } from '../consortiums.js';
import type { LineRoute, StopScheduleEntry } from '../ctamd.js';
import type {
  CacheStatus,
  ConsortiumId,
  ConsortiumInfo,
  FaresSummary,
  FavoriteItem,
  Journey,
  Line,
  NearbyStop,
  Nucleo,
  OdScheduleResult,
  RouteWalkSuggestion,
  SalesPoint,
  ServiceAlert,
  StopServicesResult,
} from '../types.js';
import { matchesFrequencyOnDate } from '../utils/frequency.js';
import { formatDurationHHMM, formatSecondsToHHMM } from '../utils/time.js';
import { colorizeLineLabel, padRightVisible } from './colors.js';

function padRight(value: string, width: number): string {
  return value.length >= width ? value : value + ' '.repeat(width - value.length);
}

function padLeft(value: string, width: number): string {
  return value.length >= width ? value : ' '.repeat(width - value.length) + value;
}

function centerText(value: string, width: number): string {
  if (value.length >= width) {
    return value;
  }
  const totalPad = width - value.length;
  const left = Math.floor(totalPad / 2);
  const right = totalPad - left;
  return ' '.repeat(left) + value + ' '.repeat(right);
}

function formatEur(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return '-';
  }
  return `${value.toFixed(2)} €`;
}

export function formatConsortiumsTable(
  consortiums: readonly ConsortiumInfo[],
  defaultId?: ConsortiumId,
): string {
  const nameWidth = Math.max(18, ...consortiums.map((c) => c.name.length));
  const domainWidth = Math.max(12, ...consortiums.map((c) => c.domain.length));
  const provWidth = Math.max(8, ...consortiums.map((c) => c.province.length));
  const bar = '-'.repeat(4 + 3 + 7 + 3 + domainWidth + 3 + provWidth + 3 + nameWidth + 12);

  const out: string[] = [
    '',
    pc.bold('Andalusian Metropolitan Transport Consortia (CTAN)'),
    bar,
    `  ${padRight('ID', 2)} | ${padRight('Code', 6)} | ${padRight('Domain', domainWidth)} | ${padRight('Province', provWidth)} | Area Name`,
    bar,
  ];

  for (const c of consortiums) {
    const marker = c.id === defaultId ? pc.green(' (default)') : '';
    out.push(
      `  ${padRight(String(c.id), 2)} | ${pc.cyan(padRight(c.shortCode, 6))} | ${padRight(c.domain, domainWidth)} | ${padRight(c.province, provWidth)} | ${c.name}${marker}`,
    );
  }
  out.push(bar);
  return out.join('\n');
}

export interface OdTimetableFormatOptions {
  totalCount?: number;
  limited?: boolean;
  showCheckpoints?: boolean;
}

export function formatOdTimetable(
  result: OdScheduleResult,
  options: OdTimetableFormatOptions = {},
): string {
  const consortium = getConsortiumById(result.consorcioId);
  const out: string[] = [
    '',
    `Consortium: ${consortium ? `${consortium.name} (${consortium.shortCode})` : result.consorcioId}`,
    `Route:      ${result.originNucleo.name} (Zone ${result.originNucleo.zoneId || '?'}) → ${result.destinationNucleo.name} (Zone ${result.destinationNucleo.zoneId || '?'})`,
    `Date:       ${result.date}`,
  ];

  if (result.fare) {
    if (result.fare.jumps !== null) {
      const jumpLabel = `${result.fare.jumps} ${result.fare.jumps === 1 ? 'jump' : 'jumps'}`;
      out.push(
        `Fare:       ${jumpLabel} | Single: ${formatEur(result.fare.singleTicketEur)} | Card: ${formatEur(result.fare.cardEur)}`,
      );
    } else if (result.fare.error) {
      out.push(pc.dim(`Fare:       ${result.fare.error}`));
    }
  }

  if (result.journeys.length === 0) {
    out.push('');
    out.push('No direct interurban schedules found for this date/filter.');
    out.push(
      pc.dim(
        'Tip: Pass --freq all to see other days of the week, or --by stop for multi-transfer stop routing.',
      ),
    );
    return out.join('\n');
  }

  const lineWidth = Math.max(8, ...result.journeys.map((j) => j.displayCode.length));
  const originWidth = Math.max(16, ...result.journeys.map((j) => j.originBlock.length));
  const destWidth = Math.max(16, ...result.journeys.map((j) => j.destinationBlock.length));
  const freqWidth = Math.max(8, ...result.journeys.map((j) => j.frequencyAcronym.length));

  const totalWidth =
    2 + lineWidth + 3 + 9 + 3 + 7 + 3 + 8 + 3 + originWidth + 3 + destWidth + 3 + freqWidth;
  const eqBar = '='.repeat(Math.max(80, totalWidth));
  const dashBar = '-'.repeat(Math.max(80, totalWidth));
  const titleBar = (() => {
    const title = 'TIMETABLE';
    const side = Math.max(10, Math.floor((eqBar.length - title.length) / 2));
    const rem = Math.max(10, eqBar.length - title.length - side);
    return `${'='.repeat(side)}${title}${'='.repeat(rem)}`;
  })();

  out.push('');
  out.push(pc.bold(titleBar));
  out.push(
    `  ${padRight('Line', lineWidth)} | Departure | Arrival | Duration | ${padRight('Origin Stop/Area', originWidth)} | ${padRight('Destination Area', destWidth)} | ${padRight('Freq', freqWidth)}`,
  );

  for (const j of result.journeys) {
    out.push(dashBar);
    const lineCell = padRightVisible(colorizeLineLabel(j.displayCode, j.lineColor), lineWidth);
    const durText = formatDurationHHMM(j.durationSeconds);
    out.push(
      `  ${lineCell} | ${centerText(j.departureTime, 9)} | ${centerText(j.arrivalTime, 7)} | ${centerText(durText, 8)} | ${padRight(j.originBlock, originWidth)} | ${padRight(j.destinationBlock, destWidth)} | ${padRight(j.frequencyAcronym, freqWidth)}`,
    );

    if (
      options.showCheckpoints !== false &&
      (j.originCheckpoints.length > 1 || j.destinationCheckpoints.length > 1)
    ) {
      const origPath = j.originCheckpoints.map((c) => `${c.blockName} (${c.time})`).join(' · ');
      const destPath = j.destinationCheckpoints
        .map((c) => `${c.blockName} (${c.time})`)
        .join(' · ');
      out.push(pc.dim(`      Checkpoints: ${origPath} → ${destPath}`));
    }
    if (j.observations) {
      out.push(pc.dim(`      Note: ${j.observations}`));
    }
  }

  out.push(pc.bold(eqBar));

  if (
    options.limited &&
    options.totalCount !== undefined &&
    options.totalCount > result.journeys.length
  ) {
    out.push(
      pc.dim(
        `Showing ${result.journeys.length} of ${options.totalCount} departures. Pass --all to view the full day timetable.`,
      ),
    );
  }

  return out.join('\n');
}

export interface TimetableFormatOptions {
  totalCount?: number;
  limited?: boolean;
  estimatedFallback?: boolean;
}

export function formatTimetable(
  journeys: readonly Journey[],
  options: TimetableFormatOptions = {},
): string {
  if (journeys.length === 0) {
    return '\nNo schedules available for this route.';
  }

  const plainLinesLabels = journeys.map((j) =>
    [
      ...(j.originWalk ? ['Walk'] : []),
      ...j.legs.map((l) => l.lineLabel),
      ...(j.destinationWalk ? ['Walk'] : []),
    ].join(' → '),
  );
  const coloredLinesLabels = journeys.map((j) =>
    [
      ...(j.originWalk ? ['Walk'] : []),
      ...j.legs.map((l) => colorizeLineLabel(l.lineLabel, l.lineColor)),
      ...(j.destinationWalk ? ['Walk'] : []),
    ].join(' → '),
  );
  const linesWidth = Math.max(22, ...plainLinesLabels.map((s) => s.length));
  const totalWidth = 2 + linesWidth + 3 + 9 + 3 + 7 + 3 + 8 + 3 + 9;
  const eqBar = '='.repeat(Math.max(73, totalWidth));
  const dashBar = '-'.repeat(Math.max(73, totalWidth));
  const titleBar = (() => {
    const title = 'TIMETABLE';
    const side = Math.max(10, Math.floor((eqBar.length - title.length) / 2));
    const rem = Math.max(10, eqBar.length - title.length - side);
    return `${'='.repeat(side)}${title}${'='.repeat(rem)}`;
  })();

  const out: string[] = [
    '',
    pc.bold(titleBar),
    `  ${padRight('Lines', linesWidth)} | Departure | Arrival | Duration | Transfers`,
  ];

  journeys.forEach((journey, index) => {
    out.push(dashBar);
    const linesDisplay = padRightVisible(coloredLinesLabels[index]!, linesWidth);
    const depText = formatSecondsToHHMM(journey.departureSeconds);
    const arrText = `${journey.estimated ? '~' : ''}${formatSecondsToHHMM(journey.arrivalSeconds)}`;
    const durText = `${journey.estimated ? '~' : ''}${formatDurationHHMM(journey.durationSeconds)}`;
    const trText = String(journey.transferCount);

    out.push(
      `  ${linesDisplay} | ${centerText(depText, 9)} | ${centerText(arrText, 7)} | ${centerText(durText, 8)} | ${centerText(trText, 9)}`,
    );

    if (journey.originWalk) {
      const w = journey.originWalk;
      const walkMin = Math.max(1, Math.ceil(w.walkSeconds / 60));
      const firstLeg = journey.legs[0]!;
      out.push(
        pc.dim(
          `      Start walk: ${w.fromStopName} (#${w.fromStopCode}) → ${w.toStopName} (#${w.toStopCode}): walk ${w.walkMeters}m (${walkMin} min), board ${firstLeg.lineLabel} at ${formatSecondsToHHMM(firstLeg.departureSeconds)}`,
        ),
      );
    }

    journey.transfers.forEach((transfer, trIdx) => {
      const arr = formatSecondsToHHMM(transfer.arrivalSeconds);
      const dep = formatSecondsToHHMM(transfer.departureSeconds);
      const wait = formatDurationHHMM(transfer.waitSeconds);
      if (transfer.walkMeters > 0) {
        const walkMin = Math.max(1, Math.ceil(transfer.walkSeconds / 60));
        out.push(
          pc.dim(
            `      Transfer ${trIdx + 1} at ${transfer.fromStopName} (#${transfer.fromStopCode}) → ${transfer.toStopName} (#${transfer.toStopCode}): walk ${transfer.walkMeters}m (${walkMin} min), arrive ${arr}, depart ${dep} (${wait})`,
          ),
        );
      } else {
        out.push(
          pc.dim(
            `      Transfer ${trIdx + 1} at ${transfer.fromStopName} (#${transfer.fromStopCode}): arrive ${arr}, depart ${dep} (${wait})`,
          ),
        );
      }
    });

    if (journey.destinationWalk) {
      const w = journey.destinationWalk;
      const walkMin = Math.max(1, Math.ceil(w.walkSeconds / 60));
      const lastLeg = journey.legs[journey.legs.length - 1]!;
      out.push(
        pc.dim(
          `      End walk: ${w.fromStopName} (#${w.fromStopCode}) → ${w.toStopName} (#${w.toStopCode}): alight at ${formatSecondsToHHMM(lastLeg.arrivalSeconds)}, walk ${w.walkMeters}m (${walkMin} min)`,
        ),
      );
    }
  });

  out.push(pc.bold(eqBar));

  if (options.estimatedFallback) {
    out.push(
      pc.dim(
        '~ Offline estimates computed from cached CTAN network topology (live schedules not queried).',
      ),
    );
  } else if (journeys.some((j) => j.estimated)) {
    out.push(pc.dim('~ Estimated arrival time interpolated from route distance.'));
  }

  if (options.limited && options.totalCount !== undefined && options.totalCount > journeys.length) {
    out.push(
      pc.dim(
        `Showing ${journeys.length} of ${options.totalCount} journeys. Pass --all to view the full day timetable.`,
      ),
    );
  }

  return out.join('\n');
}

export function formatStopServicesTable(result: StopServicesResult, filterLine?: string): string {
  const normalizedFilter = filterLine?.trim().toUpperCase();
  const normalizedFilterNoDash = normalizedFilter?.replace(/-/g, '');
  const filtered = normalizedFilter
    ? result.services.filter((s) => {
        const disp = s.displayCode.toUpperCase();
        const code = s.lineCode.toUpperCase();
        return (
          disp === normalizedFilter ||
          disp.replace(/-/g, '') === normalizedFilterNoDash ||
          code === normalizedFilter ||
          code.replace(/-/g, '') === normalizedFilterNoDash ||
          s.lineId === normalizedFilter
        );
      })
    : result.services;

  const consortium = getConsortiumById(result.consorcioId);
  const areaTag = consortium ? `[${consortium.shortCode}] ` : '';
  const townTag = result.nucleoName ? ` (${result.nucleoName})` : '';
  const title = result.stopName
    ? `${areaTag}Stop #${result.stopId} — ${result.stopName}${townTag}`
    : `${areaTag}Stop #${result.stopId}`;

  const out: string[] = ['', pc.bold(title)];
  const sourceDesc =
    result.source === 'realtime'
      ? `Source: Live SAE (${result.providerName})`
      : `Source: CTAN Official Schedule (${result.windowStart || 'now'} → ${result.windowEnd || '+1h'})`;
  out.push(pc.dim(sourceDesc));

  if (result.stale) {
    out.push(pc.yellow('[WARN] Showing cached stop times (CTAN upstream unavailable).'));
  }

  if (filtered.length === 0) {
    out.push('No upcoming departures reported in this window.');
    return out.join('\n');
  }

  const hasRealtimeTelemetry = filtered.some(
    (s) => s.distanceMeters !== null || s.vehicle !== null,
  );
  const lineWidth = Math.max(7, ...filtered.map((s) => s.displayCode.length));
  const destWidth = Math.max(18, ...filtered.map((s) => s.destination.length));
  const extraWidth = hasRealtimeTelemetry ? 3 + 9 + 3 + 8 : 0;
  const bar = '-'.repeat(2 + lineWidth + 3 + destWidth + 3 + 7 + 3 + 7 + 3 + 10 + extraWidth);

  out.push(bar);
  const baseHeader = `  ${padRight('Line', lineWidth)} | ${padRight('Destination', destWidth)} | ${centerText('Departs', 7)} | ${padLeft('ETA', 7)} | ${padRight('Boarding', 10)}`;
  out.push(
    hasRealtimeTelemetry
      ? `${baseHeader} | ${padLeft('Distance', 9)} | ${padLeft('Vehicle', 8)}`
      : baseHeader,
  );
  out.push(bar);

  for (const svc of filtered) {
    const lineCell = padRightVisible(colorizeLineLabel(svc.displayCode, svc.lineColor), lineWidth);
    const eta = svc.etaMinutes <= 0 ? pc.green('Now') : `${svc.etaMinutes} min`;
    const etaPlainLen = svc.etaMinutes <= 0 ? 3 : `${svc.etaMinutes} min`.length;
    const etaPadded = ' '.repeat(Math.max(0, 7 - etaPlainLen)) + eta;
    const boarding =
      svc.stopType === 'board_only'
        ? 'Board only'
        : svc.stopType === 'alight_only'
          ? 'Alight only'
          : 'Normal';

    const rowBase = `  ${lineCell} | ${padRight(svc.destination, destWidth)} | ${centerText(svc.departureTime, 7)} | ${etaPadded} | ${padRight(boarding, 10)}`;
    if (hasRealtimeTelemetry) {
      const dist =
        svc.distanceMeters !== null ? `${svc.distanceMeters.toLocaleString('en-US')} m` : '-';
      const veh = svc.vehicle ?? '-';
      out.push(`${rowBase} | ${padLeft(dist, 9)} | ${padLeft(veh, 8)}`);
    } else {
      out.push(rowBase);
    }
  }
  out.push(bar);

  return out.join('\n');
}

export function formatStopScheduleTable(
  consorcioId: ConsortiumId,
  stopId: string,
  stopName: string,
  entries: readonly StopScheduleEntry[],
  dateLabel: string,
): string {
  const consortium = getConsortiumById(consorcioId);
  const areaTag = consortium ? `[${consortium.shortCode}] ` : '';
  const title = stopName ? `${areaTag}Stop #${stopId} — ${stopName}` : `${areaTag}Stop #${stopId}`;
  const out: string[] = ['', pc.bold(`${title} (Scheduled departures for ${dateLabel})`)];

  if (entries.length === 0) {
    out.push('No scheduled departures found for this stop.');
    return out.join('\n');
  }

  for (const entry of entries) {
    out.push('');
    const label = entry.lineName
      ? `${entry.displayCode} — ${entry.lineName}`
      : `Line ${entry.displayCode}`;
    out.push(
      pc.bold(colorizeLineLabel(`${label} (${entry.times.length} departures)`, entry.lineColor)),
    );
    if (entry.times.length === 0) {
      out.push('  No scheduled passing times.');
      continue;
    }

    const formatted = entry.times.map((t) => t.slice(0, 5));
    const perRow = 8;
    for (let i = 0; i < formatted.length; i += perRow) {
      out.push(`  ${formatted.slice(i, i + perRow).join('  ')}`);
    }
  }

  return out.join('\n');
}

export function formatLinesTable(lines: readonly Line[], consorcioId?: ConsortiumId): string {
  if (lines.length === 0) {
    return '\nNo lines matched the requested filters.';
  }

  const consortium = consorcioId ? getConsortiumById(consorcioId) : undefined;
  const codeWidth = Math.max(7, ...lines.map((l) => l.displayCode.length));
  const modeWidth = Math.max(6, ...lines.map((l) => l.mode.length));
  const nameWidth = Math.max(24, ...lines.map((l) => l.name.length));
  const bar = '-'.repeat(2 + codeWidth + 3 + modeWidth + 3 + 5 + 3 + nameWidth + 2);

  const out: string[] = [''];
  if (consortium) {
    out.push(pc.bold(`${consortium.name} (${consortium.shortCode}) — Lines`));
  }
  out.push(bar);
  out.push(
    `  ${padRight('Line', codeWidth)} | ${padRight('Mode', modeWidth)} | ${padRight('ID', 5)} | Description`,
  );
  out.push(bar);

  for (const line of lines) {
    const lineCell = padRightVisible(colorizeLineLabel(line.displayCode, line.color), codeWidth);
    const newsBadge = line.hasNews ? pc.yellow(' [!]') : '';
    out.push(
      `  ${lineCell} | ${padRight(line.mode, modeWidth)} | ${padRight(line.id, 5)} | ${line.name}${newsBadge}`,
    );
  }
  out.push(bar);
  out.push(pc.dim(`Total: ${lines.length} lines`));

  return out.join('\n');
}

export function formatLineRoute(
  route: LineRoute,
  directionFilter: '1' | '2' | 'both' = 'both',
  scheduleOptions?: { date: Date; isHoliday?: boolean; freqFilter?: string },
): string {
  const consortium = getConsortiumById(route.consorcioId);
  const areaTag = consortium ? `[${consortium.shortCode}] ` : '';
  const out: string[] = [
    '',
    pc.bold(
      `${areaTag}${colorizeLineLabel(`Line ${route.line.displayCode}`, route.line.color)} — ${route.line.name}`,
    ),
    pc.dim(
      `Mode: ${route.line.mode} | Code: ${route.line.code} (ID: ${route.line.id})${route.line.operators.length > 0 ? ` | Operators: ${route.line.operators.join(', ')}` : ''}`,
    ),
  ];

  if (route.line.pmr) {
    out.push(pc.dim(`Accessibility: ${route.line.pmr}`));
  }
  if (route.line.observations) {
    out.push(pc.dim(`Notes: ${route.line.observations}`));
  }

  const selectedDirections = route.directions.filter((d) => {
    if (directionFilter === 'both' || route.line.isCircular) {
      return true;
    }
    return String(d.info.direction) === directionFilter;
  });

  if (selectedDirections.length === 0) {
    out.push('No route directions matched the requested filter.');
  } else {
    for (const dir of selectedDirections) {
      out.push('');
      out.push(
        pc.bold(
          colorizeLineLabel(
            `Direction ${dir.info.direction}: ${dir.info.destination} (${dir.stops.length} stops)`,
            route.line.color,
          ),
        ),
      );

      const nameWidth = Math.max(24, ...dir.stops.map((s) => s.name.length));
      const bar = '-'.repeat(2 + 6 + 3 + nameWidth + 3 + 8 + 3 + 6 + 3 + 10);
      out.push(bar);
      out.push(
        `  ${padRight('ID', 6)} | ${padRight('Stop Name', nameWidth)} | ${padLeft('Dist', 8)} | ${padRight('Zone', 6)} | Modes`,
      );
      out.push(bar);

      for (const stop of dir.stops) {
        const dist = `${stop.distanceMeters} m`;
        out.push(
          `  ${padRight(stop.id, 6)} | ${padRight(stop.name, nameWidth)} | ${padLeft(dist, 8)} | ${padRight(stop.zoneId || '-', 6)} | ${stop.modes}`,
        );
      }
      out.push(bar);
    }
  }

  if (route.schedule) {
    out.push(formatLineScheduleTable(route, directionFilter, scheduleOptions));
  }

  return out.join('\n');
}

export function formatLineScheduleTable(
  route: LineRoute,
  directionFilter: '1' | '2' | 'both' = 'both',
  options?: { date: Date; isHoliday?: boolean; freqFilter?: string },
): string {
  const sched = route.schedule;
  if (!sched || sched.planners.length === 0) {
    return '\nNo line timetable planners available.';
  }

  const date = options?.date ?? new Date();
  const freqMap = new Map(sched.frequencies.map((f) => [f.acronym.toLowerCase(), f.name]));
  const freqFilterNorm = options?.freqFilter?.trim().toLowerCase();
  const showAll = freqFilterNorm === 'all';

  const out: string[] = [''];
  for (const planner of sched.planners) {
    out.push(
      pc.bold(`Planner #${planner.id} (${planner.startDate || '?'} → ${planner.endDate || '?'})`),
    );

    const sections: Array<{
      label: string;
      blocks: typeof planner.outboundBlocks;
      trips: typeof planner.outboundTrips;
    }> = [];
    if (directionFilter === 'both' || directionFilter === '1') {
      sections.push({
        label: 'Outbound (Ida)',
        blocks: planner.outboundBlocks,
        trips: planner.outboundTrips,
      });
    }
    if (directionFilter === 'both' || directionFilter === '2') {
      sections.push({
        label: 'Inbound (Vuelta)',
        blocks: planner.inboundBlocks,
        trips: planner.inboundTrips,
      });
    }

    for (const section of sections) {
      if (section.trips.length === 0) {
        continue;
      }
      const timeBlocks = section.blocks.filter((b) => b.type === '0');
      const filteredTrips = section.trips.filter((trip) => {
        if (showAll) {
          return true;
        }
        if (freqFilterNorm) {
          return trip.frequencyAcronym.toLowerCase() === freqFilterNorm;
        }
        const desc = freqMap.get(trip.frequencyAcronym.toLowerCase());
        return matchesFrequencyOnDate(trip.frequencyAcronym, desc, date, {
          isHoliday: options?.isHoliday,
        });
      });

      out.push('');
      out.push(pc.bold(`  ${section.label} (${filteredTrips.length} trips)`));
      if (timeBlocks.length > 0) {
        out.push(pc.dim(`  Blocks: ${timeBlocks.map((b) => b.name).join(' → ')}`));
      }
      if (filteredTrips.length === 0) {
        out.push('    No trips match this date/frequency (pass --freq all to view all).');
        continue;
      }
      for (const trip of filteredTrips) {
        const timesStr = trip.times.join('  ');
        const obsStr = trip.observations ? ` [${trip.observations}]` : '';
        out.push(`    ${padRight(trip.frequencyAcronym, 8)} | ${timesStr}${obsStr}`);
      }
    }
  }

  return out.join('\n');
}

export function formatTownsTable(nucleos: readonly Nucleo[], consorcioId?: ConsortiumId): string {
  if (nucleos.length === 0) {
    return '\nNo towns/núcleos matched the query.';
  }

  const consortium = consorcioId ? getConsortiumById(consorcioId) : undefined;
  const nameWidth = Math.max(20, ...nucleos.map((n) => n.name.length));
  const bar = '-'.repeat(2 + 6 + 3 + 6 + 3 + nameWidth + 2);

  const out: string[] = [''];
  if (consortium) {
    out.push(pc.bold(`${consortium.name} (${consortium.shortCode}) — Towns / Núcleos`));
  }
  out.push(bar);
  out.push(`  ${padRight('ID', 6)} | ${padRight('Zone', 6)} | Town / Núcleo`);
  out.push(bar);

  for (const n of nucleos) {
    out.push(`  ${pc.cyan(padRight(n.id, 6))} | ${padRight(n.zoneId || '-', 6)} | ${n.name}`);
  }
  out.push(bar);
  out.push(pc.dim(`Total: ${nucleos.length} towns/núcleos`));

  return out.join('\n');
}

export function formatFaresTable(summary: FaresSummary): string {
  const consortium = getConsortiumById(summary.consorcioId);
  const out: string[] = [
    '',
    pc.bold(
      `${consortium ? `${consortium.name} (${consortium.shortCode})` : summary.consorcioId} — Fares`,
    ),
  ];

  if (summary.jumpCalculation) {
    const jc = summary.jumpCalculation;
    out.push('');
    out.push(pc.bold(`Route Calculation: ${jc.originNucleoName} → ${jc.destinationNucleoName}`));
    if (jc.jumps !== null) {
      out.push(
        `  Jumps: ${pc.cyan(String(jc.jumps))} | Single Ticket: ${formatEur(jc.singleTicketEur)} | Consortium Card: ${pc.green(formatEur(jc.cardEur))}`,
      );
    } else if (jc.error) {
      out.push(pc.yellow(`  [WARN] ${jc.error}`));
    }
  }

  if (summary.interurban.length > 0) {
    out.push('');
    out.push(pc.bold('Interurban Fares'));
    const bar = '-'.repeat(42);
    out.push(bar);
    out.push(
      `  ${padRight('Jumps', 6)} | ${padLeft('Single Ticket', 13)} | ${padLeft('Card', 12)}`,
    );
    out.push(bar);
    for (const fare of summary.interurban) {
      out.push(
        `  ${padRight(String(fare.jumps), 6)} | ${padLeft(formatEur(fare.singleTicketEur), 13)} | ${padLeft(formatEur(fare.cardEur), 12)}`,
      );
    }
    out.push(bar);
  }

  if (summary.urban.length > 0) {
    const nameWidth = Math.max(20, ...summary.urban.map((u) => u.name.length));
    const bar = '-'.repeat(2 + nameWidth + 3 + 12 + 3 + 12);
    out.push('');
    out.push(pc.bold('Urban Integration Fares'));
    out.push(bar);
    out.push(
      `  ${padRight('Municipality', nameWidth)} | ${padLeft('TU Transfer', 12)} | ${padLeft('User Fare', 12)}`,
    );
    out.push(bar);
    for (const u of summary.urban) {
      out.push(
        `  ${padRight(u.name, nameWidth)} | ${padLeft(formatEur(u.tuEur), 12)} | ${padLeft(formatEur(u.userPriceEur), 12)}`,
      );
    }
    out.push(bar);
  }

  return out.join('\n');
}

export function formatNearbyTable(stops: readonly NearbyStop[]): string {
  if (stops.length === 0) {
    return '\nNo CTAN stops found within the requested radius.';
  }

  const nameWidth = Math.max(20, ...stops.map((s) => s.name.length));
  const townWidth = Math.max(14, ...stops.map((s) => s.nucleoName.length));
  const bar = '-'.repeat(2 + 6 + 3 + 6 + 3 + 8 + 3 + nameWidth + 3 + townWidth + 3 + 8);
  const out: string[] = [
    '',
    bar,
    `  ${padRight('Area', 6)} | ${padRight('ID', 6)} | ${padLeft('Distance', 8)} | ${padRight('Stop Name', nameWidth)} | ${padRight('Town', townWidth)} | Zone`,
    bar,
  ];

  for (const stop of stops) {
    const area = getConsortiumById(stop.consorcioId)?.shortCode ?? String(stop.consorcioId);
    const dist = `${stop.distanceMeters} m`;
    out.push(
      `  ${padRight(area, 6)} | ${pc.cyan(padRight(stop.id, 6))} | ${padLeft(dist, 8)} | ${padRight(stop.name, nameWidth)} | ${padRight(stop.nucleoName || '-', townWidth)} | ${stop.zoneId || '-'}`,
    );

    if (stop.services && stop.services.services.length > 0) {
      const top = stop.services.services
        .slice(0, 3)
        .map(
          (s) =>
            `${colorizeLineLabel(s.displayCode, s.lineColor)}: ${s.departureTime} (${s.etaMinutes <= 0 ? 'Now' : `${s.etaMinutes}m`})`,
        )
        .join(' · ');
      out.push(pc.dim(`      Next: ${top}`));
    }
  }
  out.push(bar);

  return out.join('\n');
}

export function formatSalesPointsTable(
  points: readonly SalesPoint[],
  consorcioId?: ConsortiumId,
): string {
  if (points.length === 0) {
    return '\nNo sales/recharge points matched the requested criteria.';
  }

  const consortium = consorcioId ? getConsortiumById(consorcioId) : undefined;
  const hasDistance = points.some((p) => p.distanceMeters !== undefined);
  const typeWidth = Math.max(12, ...points.map((p) => p.type.length));
  const townWidth = Math.max(14, ...points.map((p) => p.nucleoName.length));
  const addrWidth = Math.max(22, ...points.map((p) => p.address.length));
  const bar = '-'.repeat(
    2 + typeWidth + 3 + townWidth + 3 + addrWidth + (hasDistance ? 3 + 9 : 0) + 2,
  );

  const out: string[] = [''];
  if (consortium) {
    out.push(pc.bold(`${consortium.name} (${consortium.shortCode}) — Sales & Recharge Points`));
  }
  out.push(bar);
  const hdr = `  ${padRight('Type', typeWidth)} | ${padRight('Town', townWidth)} | ${padRight('Address', addrWidth)}`;
  out.push(hasDistance ? `${hdr} | ${padLeft('Distance', 9)}` : hdr);
  out.push(bar);

  for (const p of points) {
    const base = `  ${padRight(p.type || '-', typeWidth)} | ${padRight(p.nucleoName || '-', townWidth)} | ${padRight(p.address || '-', addrWidth)}`;
    if (hasDistance) {
      const dist = p.distanceMeters !== undefined ? `${p.distanceMeters} m` : '-';
      out.push(`${base} | ${padLeft(dist, 9)}`);
    } else {
      out.push(base);
    }
  }
  out.push(bar);
  out.push(pc.dim(`Showing ${points.length} sales points`));

  return out.join('\n');
}

export function formatAlerts(alerts: readonly ServiceAlert[], consorcioId?: ConsortiumId): string {
  const consortium = consorcioId ? getConsortiumById(consorcioId) : undefined;
  const scopeLabel = consortium ? `${consortium.shortCode} ` : 'Andalusia ';
  if (alerts.length === 0) {
    return `\nNo active ${scopeLabel}service alerts or notices.`;
  }

  const out: string[] = ['', pc.bold(`Active ${scopeLabel}Service Alerts (${alerts.length}):`)];
  for (const alert of alerts) {
    const area = getConsortiumById(alert.consorcioId)?.shortCode ?? String(alert.consorcioId);
    const lines = alert.lines.length > 0 ? ` | Lines: ${alert.lines.join(', ')}` : '';
    const cat = alert.category ? ` | ${alert.category}` : '';
    out.push('');
    out.push(`  ${pc.yellow(`[${area}${cat}${lines}]`)} ${pc.bold(alert.title)}`);
    if (alert.subtitle) {
      out.push(`  ${alert.subtitle}`);
    }
    if (alert.summary || alert.body) {
      out.push(`  ${alert.summary || alert.body}`);
    }
    if (alert.startDate || alert.endDate) {
      out.push(pc.dim(`  Window: ${alert.startDate || '?'} → ${alert.endDate || '?'}`));
    }
  }
  return out.join('\n');
}

export function formatCacheStatus(status: CacheStatus): string {
  const totalKb = (status.totalBytes / 1024).toFixed(1);
  const out: string[] = [
    '',
    pc.bold('ctamd Cache Status'),
    `  Directory:   ${status.cacheDir}`,
    `  Total size:  ${totalKb} KB`,
  ];

  if (status.consortiums.length === 0) {
    out.push('  No consortium data cached yet.');
    return out.join('\n');
  }

  for (const c of status.consortiums) {
    const cKb = (c.totalBytes / 1024).toFixed(1);
    out.push('');
    out.push(pc.bold(`  [${c.shortCode}] ${c.name} (${cKb} KB)`));
    out.push(
      `    Catalog:   ${c.catalog.present ? `${c.catalog.linesCount} lines, ${c.catalog.stopsCount} stops, ${c.catalog.nucleosCount} towns (${c.catalog.fresh ? 'fresh' : 'expired'})` : 'not cached'}`,
    );
    out.push(
      `    Topology:  ${c.topology.present ? `${c.topology.linesCount} lines, ${c.topology.stopsCount} stops (${c.topology.fresh ? 'fresh' : 'expired'})` : 'not cached'}`,
    );
    out.push(
      `    Schedules: ${c.schedulesCount} files | Services: ${c.servicesCount} files | Points: ${c.pointsPresent ? 'cached' : 'no'}`,
    );
  }

  return out.join('\n');
}

export function formatFavoritesTable(favorites: readonly FavoriteItem[]): string {
  if (favorites.length === 0) {
    return '\nNo favorites saved. Add one with: ctamd fav add <alias> <stop-or-town> -c <area>';
  }

  const aliasWidth = Math.max(10, ...favorites.map((f) => f.alias.length));
  const nameWidth = Math.max(20, ...favorites.map((f) => f.name.length));
  const bar = '-'.repeat(2 + aliasWidth + 3 + 6 + 3 + 6 + 3 + 6 + 3 + nameWidth + 2);

  const out: string[] = [
    '',
    bar,
    `  ${padRight('Alias', aliasWidth)} | ${padRight('Area', 6)} | ${padRight('Type', 6)} | ${padRight('ID', 6)} | Name`,
    bar,
  ];

  for (const fav of favorites) {
    const area = getConsortiumById(fav.consorcioId)?.shortCode ?? String(fav.consorcioId);
    out.push(
      `  ${pc.cyan(padRight(fav.alias, aliasWidth))} | ${padRight(area, 6)} | ${padRight(fav.kind, 6)} | ${padRight(fav.id, 6)} | ${fav.name}`,
    );
  }
  out.push(bar);

  return out.join('\n');
}

export function formatWalkSuggestion(suggestion: RouteWalkSuggestion): string {
  const walkMin = Math.max(1, Math.ceil(suggestion.walkSeconds / 60));
  const durMin = Math.max(1, Math.round(suggestion.estimatedDurationSeconds / 60));
  const routeDesc = `${suggestion.lineLabels.join(' → ')} (~${durMin} min, ${suggestion.transfers} transfer${suggestion.transfers === 1 ? '' : 's'})`;

  if (suggestion.type === 'origin' && suggestion.suggestedOriginStopCode) {
    return pc.yellow(
      `Tip: Walking ${suggestion.walkMeters}m (~${walkMin} min) to ${suggestion.suggestedOriginStopName ?? suggestion.suggestedOriginStopCode} (#${suggestion.suggestedOriginStopCode}) offers Line ${routeDesc}.`,
    );
  }
  if (suggestion.type === 'destination' && suggestion.suggestedDestStopCode) {
    return pc.yellow(
      `Tip: Alighting at ${suggestion.suggestedDestStopName ?? suggestion.suggestedDestStopCode} (#${suggestion.suggestedDestStopCode}) and walking ${suggestion.walkMeters}m (~${walkMin} min) offers Line ${routeDesc}.`,
    );
  }
  const originPart = suggestion.suggestedOriginStopCode
    ? `to ${suggestion.suggestedOriginStopName ?? suggestion.suggestedOriginStopCode} (#${suggestion.suggestedOriginStopCode})`
    : '';
  const destPart = suggestion.suggestedDestStopCode
    ? `and alighting at ${suggestion.suggestedDestStopName ?? suggestion.suggestedDestStopCode} (#${suggestion.suggestedDestStopCode})`
    : '';
  const prefix =
    `Tip: Walking ${suggestion.walkMeters}m (~${walkMin} min) ${originPart} ${destPart}`
      .replace(/\s+/g, ' ')
      .trim();
  return pc.yellow(`${prefix} offers Line ${routeDesc}.`);
}
