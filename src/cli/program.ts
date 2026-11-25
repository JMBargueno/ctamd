import { Command, CommanderError } from 'commander';
import pkg from '../../package.json' with { type: 'json' };
import { CtamdApiError, CtamdError, CtamdValidationError } from '../api/errors.js';
import { FavoritesStore } from '../config/favorites.js';
import { DEFAULT_CONSORCIO_ENV_VAR } from '../config/paths.js';
import { UserConfigStore } from '../config/settings.js';
import { CONSORTIUMS, getConsortiumById, resolveConsortium } from '../consortiums.js';
import { Ctamd } from '../ctamd.js';
import {
  formatAlerts,
  formatCacheStatus,
  formatConsortiumsTable,
  formatFaresTable,
  formatFavoritesTable,
  formatLineRoute,
  formatLinesTable,
  formatNearbyTable,
  formatOdTimetable,
  formatSalesPointsTable,
  formatStopScheduleTable,
  formatStopServicesTable,
  formatTimetable,
  formatTownsTable,
  formatWalkSuggestion,
} from '../format/tables.js';
import { DEFAULT_DEST_WALK_METERS, DEFAULT_ORIGIN_WALK_METERS } from '../routing/transfers.js';
import type {
  ApiLang,
  ConsortiumId,
  ConsortiumInfo,
  FavoriteItem,
  Nucleo,
  Stop,
} from '../types.js';
import { normalizeSearchText } from '../utils/text.js';
import {
  formatDateKey,
  isSameLocalDay,
  parseAfterOption,
  resolveQueryDate,
} from '../utils/time.js';
import { generateCompletionScript } from './completions.js';
import { runInteractivePrompt } from './interactive.js';
import { selectConsortiumFrom, selectNucleoFrom, selectStopFrom } from './selectEntity.js';
import { watchStopServices } from './watch.js';

export interface CliContext {
  createCtamd?: () => Ctamd;
  favoritesStore?: FavoritesStore;
  configStore?: UserConfigStore;
  stdin?: NodeJS.ReadableStream;
  stdout?: NodeJS.WritableStream;
  stderr?: NodeJS.WritableStream;
  nowFn?: () => Date;
  env?: NodeJS.ProcessEnv;
  configureExitOverride?: boolean;
  manageProcessExitCode?: boolean;
}

function parseIntegerOption(value: string, label: string): number {
  if (!/^-?\d+$/.test(value.trim())) {
    throw new CtamdValidationError(`Invalid ${label} '${value}'. Expected an integer.`);
  }
  return Number.parseInt(value.trim(), 10);
}

function parseNumberArg(value: string, label: string): number {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    throw new CtamdValidationError(`Invalid ${label} '${value}'. Expected a number.`);
  }
  return num;
}

function parseLangOption(raw: string | undefined): ApiLang {
  if (!raw) {
    return 'ES';
  }
  const upper = raw.trim().toUpperCase();
  if (upper === 'ES' || upper === 'EN') {
    return upper;
  }
  throw new CtamdValidationError(`Invalid language '${raw}'. Expected 'es' or 'en'.`);
}

function parseNearOption(raw: string): { lat: number; lon: number } {
  const parts = raw.split(',').map((p) => p.trim());
  if (parts.length !== 2) {
    throw new CtamdValidationError(
      `Invalid --near coordinates '${raw}'. Expected 'lat,lon' (e.g. 36.623,-4.501).`,
    );
  }
  return {
    lat: parseNumberArg(parts[0]!, 'latitude'),
    lon: parseNumberArg(parts[1]!, 'longitude'),
  };
}

const ROOT_VALUE_OPTIONS = new Set([
  '-c',
  '--consorcio',
  '-f',
  '--from',
  '-t',
  '--to',
  '--by',
  '-d',
  '--day',
  '-m',
  '--month',
  '-y',
  '--year',
  '--after',
  '--limit',
  '--freq',
  '--max-transfers',
  '--walk',
  '--origin-walk',
  '--dest-walk',
  '--lang',
]);

/**
 * Normalizes `nearby` arguments so negative coordinates like `-6.003` are treated as
 * positionals rather than option flags, even when `-c` or `-r` are also supplied.
 */
export function normalizeNearbyArgv(argv: string[]): string[] {
  let nearbyIdx = -1;
  for (let i = 2; i < argv.length; i++) {
    const token = argv[i]!;
    if (token === '--') {
      break;
    }
    if (ROOT_VALUE_OPTIONS.has(token)) {
      i += 1;
      continue;
    }
    if (token.startsWith('-')) {
      continue;
    }
    if (token === 'nearby') {
      nearbyIdx = i;
    }
    break;
  }

  if (nearbyIdx === -1) {
    return argv;
  }
  const rest = argv.slice(nearbyIdx + 1);
  if (rest.includes('--')) {
    return argv;
  }

  const valueFlags = new Set(['-c', '--consorcio', '-r', '--radius', '-n', '--limit', '--lang']);
  const flags: string[] = [];
  const positionals: string[] = [];

  for (let i = 0; i < rest.length; i++) {
    const token = rest[i]!;
    if (valueFlags.has(token)) {
      flags.push(token);
      if (i + 1 < rest.length) {
        flags.push(rest[i + 1]!);
        i += 1;
      }
      continue;
    }
    if (
      token.startsWith('--consorcio=') ||
      token.startsWith('--radius=') ||
      token.startsWith('--limit=') ||
      token.startsWith('--lang=') ||
      token.startsWith('-c=') ||
      token.startsWith('-r=') ||
      token.startsWith('-n=')
    ) {
      flags.push(token);
      continue;
    }
    if (/^-(\d+(\.\d+)?|\.\d+)$/.test(token) || !token.startsWith('-')) {
      positionals.push(token);
      continue;
    }
    flags.push(token);
  }

  if (positionals.length === 0) {
    return argv;
  }
  return [...argv.slice(0, nearbyIdx + 1), ...flags, '--', ...positionals];
}

function isInteractiveTty(stream: NodeJS.WritableStream): boolean {
  return Boolean((stream as { isTTY?: boolean }).isTTY);
}

function writeSyncProgress(
  stderr: NodeJS.WritableStream,
  prefix: string,
  done: number,
  total: number,
  label: string,
): void {
  if (isInteractiveTty(stderr)) {
    stderr.write(`\r${prefix} (${done}/${total}): ${label.padEnd(28)}`);
    if (done === total) {
      stderr.write('\n');
    }
  } else if (done === 1) {
    stderr.write(`${prefix} (${total} steps)...\n`);
  }
}

async function resolveTargetConsortium(
  explicitConsorcio: string | undefined,
  configStore: UserConfigStore,
  env: NodeJS.ProcessEnv,
  stdin: NodeJS.ReadableStream,
  stdout: NodeJS.WritableStream,
  fallbackId?: ConsortiumId,
): Promise<ConsortiumInfo> {
  if (explicitConsorcio?.trim()) {
    return resolveConsortium(explicitConsorcio);
  }
  if (fallbackId !== undefined) {
    const byFav = getConsortiumById(fallbackId);
    if (byFav) {
      return byFav;
    }
  }
  const fromEnv = env[DEFAULT_CONSORCIO_ENV_VAR]?.trim();
  if (fromEnv) {
    return resolveConsortium(fromEnv);
  }
  const savedDefault = await configStore.getDefaultConsortiumId();
  if (savedDefault !== undefined) {
    const info = getConsortiumById(savedDefault);
    if (info) {
      return info;
    }
  }
  if ((stdin as { isTTY?: boolean }).isTTY && isInteractiveTty(stdout)) {
    return selectConsortiumFrom(CONSORTIUMS, stdin, stdout);
  }
  throw new CtamdValidationError(
    "No consortium specified. Pass -c <area> (e.g. -c sevilla, -c ctagr.es, -c malaga), set CTAMD_CONSORCIO, or run 'ctamd use <area>'. Run 'ctamd consortiums' to list all 9 areas.",
  );
}

async function resolveStopEntity(
  ctamd: Ctamd,
  consorcioId: ConsortiumId,
  query: string,
  fav: FavoriteItem | null,
  stdin: NodeJS.ReadableStream,
  stdout: NodeJS.WritableStream,
  options: { lang?: ApiLang; refresh?: boolean } = {},
): Promise<Stop> {
  if (fav && fav.kind === 'stop' && fav.consorcioId === consorcioId) {
    const matches = await ctamd.matchStops(consorcioId, fav.id, options);
    if (matches.length > 0) {
      return matches[0]!;
    }
    return {
      id: fav.id,
      code: fav.id,
      name: fav.name,
      nucleoId: '',
      nucleoName: '',
      municipioId: '',
      municipioName: '',
      zoneId: '',
      lat: null,
      lon: null,
      modes: 'Bus',
      lines: [],
    };
  }

  const matches = await ctamd.matchStops(consorcioId, query, options);
  return selectStopFrom(query, matches, stdin, stdout);
}

async function resolveNucleoEntity(
  ctamd: Ctamd,
  consorcioId: ConsortiumId,
  query: string,
  fav: FavoriteItem | null,
  stdin: NodeJS.ReadableStream,
  stdout: NodeJS.WritableStream,
  options: { lang?: ApiLang; refresh?: boolean } = {},
): Promise<Nucleo> {
  if (fav && fav.kind === 'nucleo' && fav.consorcioId === consorcioId) {
    const matches = await ctamd.matchNucleos(consorcioId, fav.id, options);
    if (matches.length > 0) {
      return matches[0]!;
    }
    return { id: fav.id, municipioId: '', zoneId: '', name: fav.name };
  }

  const matches = await ctamd.matchNucleos(consorcioId, query, options);
  return selectNucleoFrom(query, matches, stdin, stdout);
}

interface RouteCommandOptions {
  consorcio?: string;
  from?: string;
  to?: string;
  by?: string;
  day?: string;
  month?: string;
  year?: string;
  sort?: boolean;
  after?: string;
  limit?: string;
  all?: boolean;
  holiday?: boolean;
  freq?: string;
  maxTransfers?: string;
  walk?: string;
  originWalk?: string;
  destWalk?: string;
  live?: boolean;
  refresh?: boolean;
  estimate?: boolean;
  lang?: string;
  interactive?: boolean;
  json?: boolean;
}

function parseValidatedRouteParams(opts: RouteCommandOptions, now: Date) {
  const byMode = (opts.by ?? 'auto').trim().toLowerCase();
  if (byMode !== 'auto' && byMode !== 'nucleo' && byMode !== 'stop') {
    throw new CtamdValidationError(
      `Invalid --by mode '${opts.by}'. Expected auto, nucleo, or stop.`,
    );
  }

  const maxTransfers =
    opts.maxTransfers !== undefined ? parseIntegerOption(opts.maxTransfers, 'max-transfers') : 2;
  if (maxTransfers < 0 || maxTransfers > 3) {
    throw new CtamdValidationError('max-transfers must be between 0 and 3.');
  }

  const maxWalkMeters = opts.walk !== undefined ? parseIntegerOption(opts.walk, 'walk') : 300;
  if (maxWalkMeters < 0) {
    throw new CtamdValidationError('walk distance must be non-negative.');
  }

  const maxOriginWalkMeters =
    opts.originWalk !== undefined
      ? parseIntegerOption(opts.originWalk, 'origin-walk')
      : DEFAULT_ORIGIN_WALK_METERS;
  if (maxOriginWalkMeters < 0) {
    throw new CtamdValidationError('origin-walk distance must be non-negative.');
  }

  const maxDestWalkMeters =
    opts.destWalk !== undefined
      ? parseIntegerOption(opts.destWalk, 'dest-walk')
      : DEFAULT_DEST_WALK_METERS;
  if (maxDestWalkMeters < 0) {
    throw new CtamdValidationError('dest-walk distance must be non-negative.');
  }

  const limit = opts.limit !== undefined ? parseIntegerOption(opts.limit, 'limit') : 15;
  if (limit < 1) {
    throw new CtamdValidationError('limit must be at least 1.');
  }

  const date = resolveQueryDate(
    {
      day: opts.day !== undefined ? parseIntegerOption(opts.day, 'day') : undefined,
      month: opts.month !== undefined ? parseIntegerOption(opts.month, 'month') : undefined,
      year: opts.year !== undefined ? parseIntegerOption(opts.year, 'year') : undefined,
    },
    now,
  );

  const afterSeconds = opts.after
    ? parseAfterOption(opts.after)
    : isSameLocalDay(date, now)
      ? now.getHours() * 3600 + now.getMinutes() * 60
      : undefined;

  return {
    byMode: byMode as 'auto' | 'nucleo' | 'stop',
    maxTransfers,
    maxWalkMeters,
    maxOriginWalkMeters,
    maxDestWalkMeters,
    limit,
    date,
    afterSeconds,
    lang: parseLangOption(opts.lang),
  };
}

async function executeOdRouteSearch(
  ctamd: Ctamd,
  consorcioId: ConsortiumId,
  originNucleo: Nucleo,
  destNucleo: Nucleo,
  params: {
    date: Date;
    sortByDuration: boolean;
    afterSeconds?: number;
    limit: number;
    all: boolean;
    holiday: boolean;
    freq?: string;
    lang: ApiLang;
    refresh: boolean;
    json: boolean;
  },
  stdout: NodeJS.WritableStream,
): Promise<void> {
  const result = await ctamd.findOdSchedules(consorcioId, originNucleo.id, destNucleo.id, {
    date: params.date,
    isHoliday: params.holiday,
    afterSeconds: params.afterSeconds,
    freqFilter: params.freq,
    sortByDuration: params.sortByDuration,
    lang: params.lang,
    refresh: params.refresh,
  });

  const displayed = params.all ? result.journeys : result.journeys.slice(0, params.limit);
  const slicedResult = { ...result, journeys: displayed };

  if (params.json) {
    stdout.write(`${JSON.stringify(slicedResult, null, 2)}\n`);
    return;
  }

  stdout.write(
    `${formatOdTimetable(slicedResult, {
      totalCount: result.totalAvailable,
      limited: !params.all && result.totalAvailable > displayed.length,
    })}\n`,
  );
}

async function executeStopRouteSearch(
  ctamd: Ctamd,
  consorcioId: ConsortiumId,
  origin: Stop,
  destination: Stop,
  params: {
    date: Date;
    now: Date;
    sortByDuration: boolean;
    afterSeconds?: number;
    maxTransfers: number;
    maxWalkMeters: number;
    maxOriginWalkMeters: number;
    maxDestWalkMeters: number;
    limit: number;
    all: boolean;
    live: boolean;
    refresh: boolean;
    estimate: boolean;
    lang: ApiLang;
    json: boolean;
  },
  stdout: NodeJS.WritableStream,
  stderr: NodeJS.WritableStream,
): Promise<void> {
  const consortium = getConsortiumById(consorcioId)!;
  const result = await ctamd.findStopSchedules(consorcioId, {
    fromStopCode: origin.code,
    toStopCode: destination.code,
    date: params.date,
    sortByDuration: params.sortByDuration,
    afterSeconds: params.afterSeconds,
    maxTransfers: params.maxTransfers,
    maxWalkMeters: params.maxWalkMeters,
    maxOriginWalkMeters: params.maxOriginWalkMeters,
    maxDestWalkMeters: params.maxDestWalkMeters,
    fullDay: params.all,
    refresh: params.refresh,
    estimate: params.estimate,
    lang: params.lang,
    onSyncProgress: (done, total, label) =>
      writeSyncProgress(stderr, `Syncing ${consortium.shortCode} topology`, done, total, label),
  });

  const displayed = params.all ? result.journeys : result.journeys.slice(0, params.limit);
  const liveServices = params.live
    ? await ctamd.getStopServices(consorcioId, origin.id, { lang: params.lang, now: params.now })
    : undefined;

  if (params.json) {
    stdout.write(
      `${JSON.stringify(
        {
          consorcioId,
          date: formatDateKey(params.date),
          origin,
          destination,
          totalJourneys: result.journeys.length,
          journeys: displayed,
          rateLimited: result.rateLimited,
          partial: result.partial,
          estimatedFallback: result.estimatedFallback,
          warnings: result.warnings,
          ...(result.walkSuggestion ? { walkSuggestion: result.walkSuggestion } : {}),
          ...(liveServices ? { liveServices } : {}),
        },
        null,
        2,
      )}\n`,
    );
    return;
  }

  for (const warning of result.warnings) {
    stderr.write(`[WARN] ${warning}\n`);
  }

  stdout.write(`Consortium: ${consortium.name} (${consortium.shortCode})\n`);
  stdout.write(`Today is: ${formatDateKey(params.now)}\n`);
  stdout.write(`Searching timetable for date: ${formatDateKey(params.date)}\n`);
  stdout.write(`Origin stop: ${origin.name} (#${origin.id})\n`);
  stdout.write(`Destination stop: ${destination.name} (#${destination.id})\n`);
  stdout.write(
    `${formatTimetable(displayed, {
      totalCount: result.journeys.length,
      limited: !params.all && result.journeys.length > displayed.length,
      estimatedFallback: result.estimatedFallback,
    })}\n`,
  );

  if (result.walkSuggestion) {
    stdout.write(`\n${formatWalkSuggestion(result.walkSuggestion)}\n`);
  }

  if (liveServices) {
    stdout.write(`${formatStopServicesTable(liveServices)}\n`);
  }
}

export function createProgram(ctx: CliContext = {}): Command {
  const createCtamd = ctx.createCtamd ?? (() => new Ctamd());
  const favorites = ctx.favoritesStore ?? new FavoritesStore();
  const configStore = ctx.configStore ?? new UserConfigStore();
  const stdin = ctx.stdin ?? process.stdin;
  const stdout = ctx.stdout ?? process.stdout;
  const stderr = ctx.stderr ?? process.stderr;
  const nowFn = ctx.nowFn ?? (() => new Date());
  const env = ctx.env ?? process.env;

  const program = new Command();

  program
    .name('ctamd')
    .description(
      'Fast CLI and TypeScript library for all 9 Andalusian Metropolitan Transport Consortia (CTAN)',
    )
    .version(pkg.version, '-V, --version', 'Print version information')
    .enablePositionalOptions()
    .option(
      '-c, --consorcio <area>',
      'Target consortium (ID 1-9, short code, domain like ctas.es/ctagr.es/ctmam.es, or city)',
    )
    .option('-f, --from <origin>', 'Set origin town/núcleo, stop (ID/name), or favorite alias')
    .option(
      '-t, --to <destination>',
      'Set destination town/núcleo, stop (ID/name), or favorite alias',
    )
    .option('--by <mode>', 'Routing mode: auto, nucleo, or stop', 'auto')
    .option('-d, --day <day>', 'Set the day (default: today)')
    .option('-m, --month <month>', 'Set the month (default: today)')
    .option('-y, --year <year>', 'Set the year (default: today)')
    .option('-s, --sort', 'Sort timetable by duration')
    .option('--after <HH:MM>', 'Show departures at or after HH:MM')
    .option('--limit <n>', 'Maximum journeys to display', '15')
    .option('--all', 'Show all journeys for the full day')
    .option('--holiday', 'Evaluate public holiday schedules')
    .option('--freq <code|all>', 'Filter by specific CTAN frequency acronym or "all"')
    .option('--max-transfers <n>', 'Maximum number of transfers for stop routing (0-3)', '2')
    .option('--walk <meters>', 'Maximum walking distance for transfers in meters', '300')
    .option(
      '--origin-walk <meters>',
      'Maximum initial walking distance to a nearby stop in meters',
      String(DEFAULT_ORIGIN_WALK_METERS),
    )
    .option(
      '--dest-walk <meters>',
      'Maximum final walking distance from a nearby stop in meters',
      String(DEFAULT_DEST_WALK_METERS),
    )
    .option('--live', 'Also display upcoming departures at the origin stop (stop mode)')
    .option('--refresh', 'Force refresh of cached consortium data and schedules')
    .option(
      '--estimate',
      'Use offline topology-based stop route estimates without querying departure schedules',
    )
    .option('--lang <es|en>', 'CTAN API language (es or en)', 'es')
    .option('-i, --interactive', 'Launch interactive step-by-step route search')
    .option('--json', 'Output machine-readable JSON')
    .action(async (opts: RouteCommandOptions) => {
      const now = nowFn();

      if (opts.interactive) {
        const parsed = parseValidatedRouteParams(opts, now);
        const ctamd = createCtamd();
        const explicitConsortium = opts.consorcio
          ? resolveConsortium(opts.consorcio).id
          : undefined;
        const defaultId =
          explicitConsortium ??
          (env[DEFAULT_CONSORCIO_ENV_VAR]
            ? resolveConsortium(env[DEFAULT_CONSORCIO_ENV_VAR]!).id
            : await configStore.getDefaultConsortiumId());

        const promptResult = await runInteractivePrompt({
          defaultConsortiumId: defaultId,
          matchNucleos: (cId, q) => ctamd.matchNucleos(cId, q, { lang: parsed.lang }),
          matchStops: (cId, q) => ctamd.matchStops(cId, q, { lang: parsed.lang }),
          resolveFavorite: (q) => favorites.resolveAlias(q),
          listFavorites: () => favorites.list(),
          input: stdin,
          output: stdout,
          now,
        });

        if (promptResult.mode === 'nucleo') {
          await executeOdRouteSearch(
            ctamd,
            promptResult.consortium.id,
            {
              id: promptResult.originId,
              municipioId: '',
              zoneId: '',
              name: promptResult.originName,
            },
            {
              id: promptResult.destinationId,
              municipioId: '',
              zoneId: '',
              name: promptResult.destinationName,
            },
            {
              date: promptResult.date,
              sortByDuration: Boolean(opts.sort ?? promptResult.sortByDuration),
              afterSeconds: opts.after ? parsed.afterSeconds : promptResult.afterSeconds,
              limit: parsed.limit,
              all: Boolean(opts.all),
              holiday: Boolean(opts.holiday),
              freq: opts.freq,
              lang: parsed.lang,
              refresh: Boolean(opts.refresh),
              json: Boolean(opts.json),
            },
            stdout,
          );
          return;
        }

        const originStop = await resolveStopEntity(
          ctamd,
          promptResult.consortium.id,
          promptResult.originId,
          null,
          stdin,
          stdout,
          { lang: parsed.lang },
        );
        const destStop = await resolveStopEntity(
          ctamd,
          promptResult.consortium.id,
          promptResult.destinationId,
          null,
          stdin,
          stdout,
          { lang: parsed.lang },
        );

        await executeStopRouteSearch(
          ctamd,
          promptResult.consortium.id,
          originStop,
          destStop,
          {
            date: promptResult.date,
            now,
            sortByDuration: Boolean(opts.sort ?? promptResult.sortByDuration),
            afterSeconds: opts.after ? parsed.afterSeconds : promptResult.afterSeconds,
            maxTransfers: parsed.maxTransfers,
            maxWalkMeters: parsed.maxWalkMeters,
            maxOriginWalkMeters: parsed.maxOriginWalkMeters,
            maxDestWalkMeters: parsed.maxDestWalkMeters,
            limit: parsed.limit,
            all: Boolean(opts.all),
            live: Boolean(opts.live),
            refresh: Boolean(opts.refresh),
            estimate: Boolean(opts.estimate),
            lang: parsed.lang,
            json: Boolean(opts.json),
          },
          stdout,
          stderr,
        );
        return;
      }

      if (!opts.from && !opts.to) {
        program.outputHelp();
        return;
      }
      if (!opts.from || !opts.to) {
        throw new CtamdValidationError(
          'Both -f <origin> and -t <destination> are required for timetable search.',
        );
      }

      const parsed = parseValidatedRouteParams(opts, now);
      const ctamd = createCtamd();
      const fromFav = await favorites.resolveAlias(opts.from);
      const toFav = await favorites.resolveAlias(opts.to);

      if (!opts.consorcio && fromFav && toFav && fromFav.consorcioId !== toFav.consorcioId) {
        throw new CtamdValidationError(
          `Favorites '${fromFav.alias}' (${getConsortiumById(fromFav.consorcioId)?.shortCode}) and '${toFav.alias}' (${getConsortiumById(toFav.consorcioId)?.shortCode}) belong to different consortia.`,
        );
      }

      const consortium = await resolveTargetConsortium(
        opts.consorcio,
        configStore,
        env,
        stdin,
        stdout,
        fromFav?.consorcioId ?? toFav?.consorcioId,
      );

      let mode = parsed.byMode;
      if (mode === 'auto') {
        if (fromFav?.kind === 'stop' || toFav?.kind === 'stop') {
          mode = 'stop';
        } else if (fromFav?.kind === 'nucleo' || toFav?.kind === 'nucleo') {
          mode = 'nucleo';
        } else if (
          opts.estimate ||
          opts.live ||
          program.getOptionValueSource('maxTransfers') === 'cli'
        ) {
          mode = 'stop';
        } else {
          const [fromNucleos, toNucleos] = await Promise.all([
            ctamd.matchNucleos(consortium.id, opts.from, {
              lang: parsed.lang,
              refresh: Boolean(opts.refresh),
            }),
            ctamd.matchNucleos(consortium.id, opts.to, {
              lang: parsed.lang,
              refresh: Boolean(opts.refresh),
            }),
          ]);
          mode = fromNucleos.length > 0 && toNucleos.length > 0 ? 'nucleo' : 'stop';
        }
      }

      if (mode === 'nucleo') {
        const originNucleo = await resolveNucleoEntity(
          ctamd,
          consortium.id,
          opts.from,
          fromFav,
          stdin,
          stdout,
          { lang: parsed.lang, refresh: Boolean(opts.refresh) },
        );
        const destNucleo = await resolveNucleoEntity(
          ctamd,
          consortium.id,
          opts.to,
          toFav,
          stdin,
          stdout,
          { lang: parsed.lang },
        );

        await executeOdRouteSearch(
          ctamd,
          consortium.id,
          originNucleo,
          destNucleo,
          {
            date: parsed.date,
            sortByDuration: Boolean(opts.sort),
            afterSeconds: parsed.afterSeconds,
            limit: parsed.limit,
            all: Boolean(opts.all),
            holiday: Boolean(opts.holiday),
            freq: opts.freq,
            lang: parsed.lang,
            refresh: Boolean(opts.refresh),
            json: Boolean(opts.json),
          },
          stdout,
        );
        return;
      }

      const originStop = await resolveStopEntity(
        ctamd,
        consortium.id,
        opts.from,
        fromFav,
        stdin,
        stdout,
        { lang: parsed.lang, refresh: Boolean(opts.refresh) },
      );
      const destStop = await resolveStopEntity(
        ctamd,
        consortium.id,
        opts.to,
        toFav,
        stdin,
        stdout,
        { lang: parsed.lang },
      );

      await executeStopRouteSearch(
        ctamd,
        consortium.id,
        originStop,
        destStop,
        {
          date: parsed.date,
          now,
          sortByDuration: Boolean(opts.sort),
          afterSeconds: parsed.afterSeconds,
          maxTransfers: parsed.maxTransfers,
          maxWalkMeters: parsed.maxWalkMeters,
          maxOriginWalkMeters: parsed.maxOriginWalkMeters,
          maxDestWalkMeters: parsed.maxDestWalkMeters,
          limit: parsed.limit,
          all: Boolean(opts.all),
          live: Boolean(opts.live),
          refresh: Boolean(opts.refresh),
          estimate: Boolean(opts.estimate),
          lang: parsed.lang,
          json: Boolean(opts.json),
        },
        stdout,
        stderr,
      );
    });

  program
    .command('consortiums')
    .aliases(['areas'])
    .description('List all 9 Andalusian metropolitan transport consortia')
    .option('--json', 'Output JSON')
    .action(async (opts) => {
      const rootOpts = program.opts<{ json?: boolean }>();
      const useJson = Boolean(opts.json ?? rootOpts.json);
      const defaultId = await configStore.getDefaultConsortiumId();
      if (useJson) {
        stdout.write(
          `${JSON.stringify({ defaultConsortiumId: defaultId ?? null, consortiums: CONSORTIUMS }, null, 2)}\n`,
        );
        return;
      }
      stdout.write(`${formatConsortiumsTable(CONSORTIUMS, defaultId)}\n`);
    });

  program
    .command('use [area]')
    .description('Set or clear the default consortium for CLI commands')
    .option('--clear', 'Clear the saved default consortium')
    .option('--json', 'Output JSON')
    .action(async (area: string | undefined, opts) => {
      const rootOpts = program.opts<{ json?: boolean }>();
      const useJson = Boolean(opts.json ?? rootOpts.json);

      if (opts.clear) {
        await configStore.clearDefaultConsortiumId();
        if (useJson) {
          stdout.write(`${JSON.stringify({ cleared: true })}\n`);
          return;
        }
        stdout.write('Cleared default consortium.\n');
        return;
      }

      if (!area) {
        const currentId = await configStore.getDefaultConsortiumId();
        const current = currentId ? getConsortiumById(currentId) : undefined;
        if (useJson) {
          stdout.write(`${JSON.stringify({ defaultConsortium: current ?? null }, null, 2)}\n`);
          return;
        }
        if (current) {
          stdout.write(
            `Default consortium: ${current.name} (${current.shortCode} · ${current.domain})\n`,
          );
        } else {
          stdout.write(
            "No default consortium set. Run 'ctamd use <area>' (e.g. ctamd use sevilla).\n",
          );
        }
        return;
      }

      const info = resolveConsortium(area);
      await configStore.setDefaultConsortiumId(info.id);
      if (useJson) {
        stdout.write(`${JSON.stringify(info, null, 2)}\n`);
        return;
      }
      stdout.write(
        `Default consortium set to ${info.name} (${info.shortCode} · ${info.domain}).\n`,
      );
    });

  program
    .command('interactive')
    .description('Launch interactive step-by-step route search')
    .option('-c, --consorcio <area>', 'Pre-select consortium')
    .option('--limit <n>', 'Maximum journeys to display', '15')
    .option('--all', 'Show all journeys for the full day')
    .option('--holiday', 'Evaluate public holiday schedules')
    .option('--max-transfers <n>', 'Maximum transfers for stop routing (0-3)', '2')
    .option('--walk <meters>', 'Maximum walking distance for transfers in meters', '300')
    .option(
      '--origin-walk <meters>',
      'Maximum initial walking distance to a nearby stop in meters',
      String(DEFAULT_ORIGIN_WALK_METERS),
    )
    .option(
      '--dest-walk <meters>',
      'Maximum final walking distance from a nearby stop in meters',
      String(DEFAULT_DEST_WALK_METERS),
    )
    .option('--live', 'Also display upcoming departures at origin stop')
    .option('--refresh', 'Force refresh of cached data')
    .option('--estimate', 'Offline topology-based route estimates')
    .option('--lang <es|en>', 'CTAN API language', 'es')
    .option('--json', 'Output JSON')
    .action(async (opts: RouteCommandOptions) => {
      const rootOpts = program.opts<{
        consorcio?: string;
        json?: boolean;
        estimate?: boolean;
        lang?: string;
      }>();
      const now = nowFn();
      const parsed = parseValidatedRouteParams({ ...opts, lang: opts.lang ?? rootOpts.lang }, now);
      const ctamd = createCtamd();
      const explicitConsortium = opts.consorcio ?? rootOpts.consorcio;
      const defaultId = explicitConsortium
        ? resolveConsortium(explicitConsortium).id
        : env[DEFAULT_CONSORCIO_ENV_VAR]
          ? resolveConsortium(env[DEFAULT_CONSORCIO_ENV_VAR]!).id
          : await configStore.getDefaultConsortiumId();

      const promptResult = await runInteractivePrompt({
        defaultConsortiumId: defaultId,
        matchNucleos: (cId, q) => ctamd.matchNucleos(cId, q, { lang: parsed.lang }),
        matchStops: (cId, q) => ctamd.matchStops(cId, q, { lang: parsed.lang }),
        resolveFavorite: (q) => favorites.resolveAlias(q),
        listFavorites: () => favorites.list(),
        input: stdin,
        output: stdout,
        now,
      });

      const useJson = Boolean(opts.json ?? rootOpts.json);
      if (promptResult.mode === 'nucleo') {
        await executeOdRouteSearch(
          ctamd,
          promptResult.consortium.id,
          { id: promptResult.originId, municipioId: '', zoneId: '', name: promptResult.originName },
          {
            id: promptResult.destinationId,
            municipioId: '',
            zoneId: '',
            name: promptResult.destinationName,
          },
          {
            date: promptResult.date,
            sortByDuration: promptResult.sortByDuration,
            afterSeconds: promptResult.afterSeconds,
            limit: parsed.limit,
            all: Boolean(opts.all),
            holiday: Boolean(opts.holiday),
            lang: parsed.lang,
            refresh: Boolean(opts.refresh),
            json: useJson,
          },
          stdout,
        );
        return;
      }

      const originStop = await resolveStopEntity(
        ctamd,
        promptResult.consortium.id,
        promptResult.originId,
        null,
        stdin,
        stdout,
        { lang: parsed.lang },
      );
      const destStop = await resolveStopEntity(
        ctamd,
        promptResult.consortium.id,
        promptResult.destinationId,
        null,
        stdin,
        stdout,
        { lang: parsed.lang },
      );

      await executeStopRouteSearch(
        ctamd,
        promptResult.consortium.id,
        originStop,
        destStop,
        {
          date: promptResult.date,
          now,
          sortByDuration: promptResult.sortByDuration,
          afterSeconds: promptResult.afterSeconds,
          maxTransfers: parsed.maxTransfers,
          maxWalkMeters: parsed.maxWalkMeters,
          maxOriginWalkMeters: parsed.maxOriginWalkMeters,
          maxDestWalkMeters: parsed.maxDestWalkMeters,
          limit: parsed.limit,
          all: Boolean(opts.all),
          live: Boolean(opts.live),
          refresh: Boolean(opts.refresh),
          estimate: Boolean(opts.estimate ?? rootOpts.estimate),
          lang: parsed.lang,
          json: useJson,
        },
        stdout,
        stderr,
      );
    });

  program
    .command('stop <query>')
    .description('Show upcoming departures (or full day schedule with --schedule) for a stop')
    .option('-c, --consorcio <area>', 'Target consortium')
    .option('-l, --line <label>', 'Filter by line code (e.g. M-175, C-1)')
    .option('-w, --watch [seconds]', 'Refresh departures continuously (min 15s, default 30s)')
    .option('--hours <n>', 'Number of 1-hour windows to aggregate (1-12)', '1')
    .option('--schedule', 'Show full scheduled passing times for the whole day')
    .option('-d, --day <day>', 'Set the day (with --schedule)')
    .option('-m, --month <month>', 'Set the month (with --schedule)')
    .option('-y, --year <year>', 'Set the year (with --schedule)')
    .option('--no-cache', 'Bypass fresh service cache')
    .option('--lang <es|en>', 'CTAN API language')
    .option('--json', 'Output JSON')
    .action(async (query: string, opts) => {
      const rootOpts = program.opts<{
        consorcio?: string;
        day?: string;
        month?: string;
        year?: string;
        lang?: string;
        json?: boolean;
      }>();
      const useJson = Boolean(opts.json ?? rootOpts.json);
      const lang = parseLangOption(opts.lang ?? rootOpts.lang);
      const dayOpt = opts.day ?? rootOpts.day;
      const monthOpt = opts.month ?? rootOpts.month;
      const yearOpt = opts.year ?? rootOpts.year;

      const ctamd = createCtamd();
      const trimmed = query.trim();
      const fav = await favorites.resolveAlias(trimmed);
      if (fav && fav.kind !== 'stop') {
        throw new CtamdValidationError(
          `Favorite '${fav.alias}' is a town/núcleo, not a stop. Use it with '-f ${fav.alias} -t ...'.`,
        );
      }

      const consortium = await resolveTargetConsortium(
        opts.consorcio ?? rootOpts.consorcio,
        configStore,
        env,
        stdin,
        stdout,
        fav?.consorcioId,
      );

      const directStopId = fav ? fav.id : /^\d+$/.test(trimmed) ? trimmed : null;
      const hours = Math.max(
        1,
        Math.min(12, parseIntegerOption(String(opts.hours ?? '1'), 'hours')),
      );

      if (opts.schedule) {
        const stop = directStopId
          ? { id: directStopId, code: directStopId, name: fav?.name ?? '' }
          : await resolveStopEntity(ctamd, consortium.id, query, fav, stdin, stdout, { lang });
        const date = resolveQueryDate(
          {
            day: dayOpt !== undefined ? parseIntegerOption(dayOpt, 'day') : undefined,
            month: monthOpt !== undefined ? parseIntegerOption(monthOpt, 'month') : undefined,
            year: yearOpt !== undefined ? parseIntegerOption(yearOpt, 'year') : undefined,
          },
          nowFn(),
        );
        const schedule = await ctamd.getStopDaySchedule(consortium.id, stop.id, date, {
          lineQuery: opts.line,
          lang,
          refresh: opts.cache === false,
        });
        if (useJson) {
          stdout.write(`${JSON.stringify(schedule, null, 2)}\n`);
          return;
        }
        stdout.write(
          `${formatStopScheduleTable(
            schedule.consorcioId,
            schedule.stop.id,
            schedule.stop.name,
            schedule.entries,
            schedule.date,
          )}\n`,
        );
        return;
      }

      const targetStopId = directStopId
        ? directStopId
        : (await resolveStopEntity(ctamd, consortium.id, query, fav, stdin, stdout, { lang })).id;

      if (opts.watch !== undefined) {
        const intervalSec =
          typeof opts.watch === 'string'
            ? Math.max(15, parseIntegerOption(opts.watch, 'watch'))
            : 30;
        await watchStopServices({
          stopCode: targetStopId,
          fetchServices: () =>
            ctamd.getStopServices(consortium.id, targetStopId, {
              hours,
              noCache: true,
              lang,
              now: nowFn(),
            }),
          intervalSec,
          filterLine: opts.line,
          useJson,
          stdout,
          stderr,
          nowFn,
        });
        return;
      }

      const result = await ctamd.getStopServices(consortium.id, targetStopId, {
        hours,
        noCache: opts.cache === false,
        lang,
        now: nowFn(),
      });
      if (useJson) {
        stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        return;
      }
      for (const w of result.warnings) {
        stderr.write(`[WARN] ${w}\n`);
      }
      stdout.write(`${formatStopServicesTable(result, opts.line)}\n`);
    });

  program
    .command('lines')
    .description('List lines in a consortium')
    .option('-c, --consorcio <area>', 'Target consortium')
    .option('--mode <mode>', 'Filter by transport mode (e.g. bus, metro, barco, tren)')
    .option('--town <name>', 'Filter by town/núcleo')
    .option('--search <text>', 'Search by code or route name')
    .option('--lang <es|en>', 'CTAN API language')
    .option('--json', 'Output JSON')
    .action(async (opts) => {
      const rootOpts = program.opts<{ consorcio?: string; lang?: string; json?: boolean }>();
      const useJson = Boolean(opts.json ?? rootOpts.json);
      const lang = parseLangOption(opts.lang ?? rootOpts.lang);
      const consortium = await resolveTargetConsortium(
        opts.consorcio ?? rootOpts.consorcio,
        configStore,
        env,
        stdin,
        stdout,
      );

      const ctamd = createCtamd();
      const lines = await ctamd.getLines(consortium.id, {
        mode: opts.mode,
        nucleoQuery: opts.town,
        search: opts.search,
        lang,
      });

      if (useJson) {
        stdout.write(`${JSON.stringify(lines, null, 2)}\n`);
        return;
      }
      stdout.write(`${formatLinesTable(lines, consortium.id)}\n`);
    });

  program
    .command('line <query>')
    .description('Show ordered stops and timetables for a line')
    .option('-c, --consorcio <area>', 'Target consortium')
    .option('--direction <dir>', 'Filter direction: 1, 2, or both', 'both')
    .option('--schedule', 'Include full line timetable from horarios_lineas')
    .option('-d, --day <day>', 'Set the day (with --schedule)')
    .option('-m, --month <month>', 'Set the month (with --schedule)')
    .option('-y, --year <year>', 'Set the year (with --schedule)')
    .option('--holiday', 'Evaluate public holiday trips (with --schedule)')
    .option('--freq <code|all>', 'Filter trips by frequency code or "all" (with --schedule)')
    .option('--lang <es|en>', 'CTAN API language')
    .option('--json', 'Output JSON')
    .action(async (query: string, opts) => {
      const rootOpts = program.opts<{
        consorcio?: string;
        day?: string;
        month?: string;
        year?: string;
        lang?: string;
        json?: boolean;
      }>();
      const useJson = Boolean(opts.json ?? rootOpts.json);
      const lang = parseLangOption(opts.lang ?? rootOpts.lang);
      const direction = String(opts.direction ?? 'both');
      if (direction !== '1' && direction !== '2' && direction !== 'both') {
        throw new CtamdValidationError(`Invalid direction '${direction}'. Expected 1, 2, or both.`);
      }

      const dayOpt = opts.day ?? rootOpts.day;
      const monthOpt = opts.month ?? rootOpts.month;
      const yearOpt = opts.year ?? rootOpts.year;
      const date = resolveQueryDate(
        {
          day: dayOpt !== undefined ? parseIntegerOption(dayOpt, 'day') : undefined,
          month: monthOpt !== undefined ? parseIntegerOption(monthOpt, 'month') : undefined,
          year: yearOpt !== undefined ? parseIntegerOption(yearOpt, 'year') : undefined,
        },
        nowFn(),
      );

      const consortium = await resolveTargetConsortium(
        opts.consorcio ?? rootOpts.consorcio,
        configStore,
        env,
        stdin,
        stdout,
      );
      const ctamd = createCtamd();
      const route = await ctamd.getLineRoute(consortium.id, query, {
        lang,
        includeSchedule: Boolean(opts.schedule),
        date,
      });

      if (useJson) {
        stdout.write(`${JSON.stringify(route, null, 2)}\n`);
        return;
      }
      stdout.write(
        `${formatLineRoute(route, direction, {
          date,
          isHoliday: Boolean(opts.holiday),
          freqFilter: opts.freq,
        })}\n`,
      );
    });

  program
    .command('towns [query]')
    .aliases(['nucleos', 'municipios'])
    .description('List or search towns/núcleos and their tariff zones')
    .option('-c, --consorcio <area>', 'Target consortium')
    .option('--limit <n>', 'Maximum towns to show', '100')
    .option('--lang <es|en>', 'CTAN API language')
    .option('--json', 'Output JSON')
    .action(async (query: string | undefined, opts) => {
      const rootOpts = program.opts<{ consorcio?: string; lang?: string; json?: boolean }>();
      const useJson = Boolean(opts.json ?? rootOpts.json);
      const lang = parseLangOption(opts.lang ?? rootOpts.lang);
      const limit = Math.max(1, parseIntegerOption(String(opts.limit ?? '100'), 'limit'));
      const consortium = await resolveTargetConsortium(
        opts.consorcio ?? rootOpts.consorcio,
        configStore,
        env,
        stdin,
        stdout,
      );

      const ctamd = createCtamd();
      let nucleos: Nucleo[];
      if (query?.trim()) {
        nucleos = await ctamd.matchNucleos(consortium.id, query, { lang });
      } else {
        const catalog = await ctamd.getCatalog(consortium.id, { lang });
        nucleos = Object.values(catalog.nucleos).sort((a, b) => a.name.localeCompare(b.name));
      }

      const sliced = nucleos.slice(0, limit);
      if (useJson) {
        stdout.write(`${JSON.stringify(sliced, null, 2)}\n`);
        return;
      }
      stdout.write(`${formatTownsTable(sliced, consortium.id)}\n`);
    });

  program
    .command('fares [from] [to]')
    .aliases(['tarifas'])
    .description(
      'Show interurban/urban fares and optionally calculate zone jumps between two towns',
    )
    .option('-c, --consorcio <area>', 'Target consortium')
    .option('--lang <es|en>', 'CTAN API language')
    .option('--json', 'Output JSON')
    .action(async (from: string | undefined, to: string | undefined, opts) => {
      const rootOpts = program.opts<{ consorcio?: string; lang?: string; json?: boolean }>();
      const useJson = Boolean(opts.json ?? rootOpts.json);
      const lang = parseLangOption(opts.lang ?? rootOpts.lang);

      if ((from && !to) || (!from && to)) {
        throw new CtamdValidationError(
          'Provide both <from> and <to> towns to calculate jumps, or omit both to view fare tables.',
        );
      }

      const ctamd = createCtamd();
      const fromFav = from ? await favorites.resolveAlias(from) : null;
      const toFav = to ? await favorites.resolveAlias(to) : null;
      const consortium = await resolveTargetConsortium(
        opts.consorcio ?? rootOpts.consorcio,
        configStore,
        env,
        stdin,
        stdout,
        fromFav?.consorcioId ?? toFav?.consorcioId,
      );

      let fromNucleoId: string | undefined;
      let toNucleoId: string | undefined;
      if (from && to) {
        const orig = await resolveNucleoEntity(ctamd, consortium.id, from, fromFav, stdin, stdout, {
          lang,
        });
        const dest = await resolveNucleoEntity(ctamd, consortium.id, to, toFav, stdin, stdout, {
          lang,
        });
        fromNucleoId = orig.id;
        toNucleoId = dest.id;
      }

      const summary = await ctamd.getFares(consortium.id, {
        fromNucleoId,
        toNucleoId,
        lang,
      });

      if (useJson) {
        stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
        return;
      }
      stdout.write(`${formatFaresTable(summary)}\n`);
    });

  program
    .command('nearby <lat> <lon>')
    .description('Find CTAN stops near GPS coordinates (auto-detects consortium if -c is omitted)')
    .option('-c, --consorcio <area>', 'Restrict search to a specific consortium')
    .option('--all-areas', 'Search across all 9 Andalusian consortia')
    .option('-r, --radius <meters>', 'Search radius in meters', '500')
    .option('-n, --limit <count>', 'Maximum stops to return', '10')
    .option('--arrivals', 'Fetch upcoming departures for the top 3 closest stops')
    .option('--lang <es|en>', 'CTAN API language')
    .option('--json', 'Output JSON')
    .action(async (latArg: string, lonArg: string, opts) => {
      const rootOpts = program.opts<{ consorcio?: string; lang?: string; json?: boolean }>();
      const useJson = Boolean(opts.json ?? rootOpts.json);
      const lang = parseLangOption(opts.lang ?? rootOpts.lang);
      const lat = parseNumberArg(latArg, 'latitude');
      const lon = parseNumberArg(lonArg, 'longitude');
      const radius = parseIntegerOption(String(opts.radius ?? '500'), 'radius');
      const limit = parseIntegerOption(String(opts.limit ?? '10'), 'limit');

      const ctamd = createCtamd();
      const stops = await ctamd.getNearbyStops(lat, lon, {
        consorcio: opts.consorcio ?? rootOpts.consorcio,
        allAreas: Boolean(opts.allAreas),
        radius,
        limit,
        withServices: Boolean(opts.arrivals),
        lang,
      });

      if (useJson) {
        stdout.write(`${JSON.stringify(stops, null, 2)}\n`);
        return;
      }
      stdout.write(`${formatNearbyTable(stops)}\n`);
    });

  program
    .command('points [query]')
    .aliases(['recharge', 'puntos-venta'])
    .description('Find card sales and recharge points')
    .option('-c, --consorcio <area>', 'Target consortium')
    .option('--town <name>', 'Filter by town/núcleo or municipality')
    .option('--near <lat,lon>', 'Sort and filter by distance from GPS coordinates')
    .option('-r, --radius <meters>', 'Radius in meters when using --near', '1500')
    .option('-n, --limit <count>', 'Maximum points to return', '30')
    .option('--lang <es|en>', 'CTAN API language')
    .option('--json', 'Output JSON')
    .action(async (query: string | undefined, opts) => {
      const rootOpts = program.opts<{ consorcio?: string; lang?: string; json?: boolean }>();
      const useJson = Boolean(opts.json ?? rootOpts.json);
      const lang = parseLangOption(opts.lang ?? rootOpts.lang);
      const radius = parseIntegerOption(String(opts.radius ?? '1500'), 'radius');
      const limit = parseIntegerOption(String(opts.limit ?? '30'), 'limit');
      const near = opts.near ? parseNearOption(opts.near) : undefined;

      const consortium = await resolveTargetConsortium(
        opts.consorcio ?? rootOpts.consorcio,
        configStore,
        env,
        stdin,
        stdout,
      );

      const ctamd = createCtamd();
      const points = await ctamd.getSalesPoints(consortium.id, {
        query,
        nucleoQuery: opts.town,
        lat: near?.lat,
        lon: near?.lon,
        radius,
        limit,
        lang,
      });

      if (useJson) {
        stdout.write(`${JSON.stringify(points, null, 2)}\n`);
        return;
      }
      stdout.write(`${formatSalesPointsTable(points, consortium.id)}\n`);
    });

  program
    .command('alerts')
    .aliases(['news', 'noticias'])
    .description('Show active CTAN service notices and incidents')
    .option('-c, --consorcio <area>', 'Target consortium')
    .option('--all-areas', 'Fetch alerts across all 9 Andalusian consortia')
    .option('-l, --line <label>', 'Filter alerts affecting a specific line')
    .option('--category <name>', 'Filter by category (e.g. Incidencias)')
    .option('--lang <es|en>', 'CTAN API language')
    .option('--json', 'Output JSON')
    .action(async (opts) => {
      const rootOpts = program.opts<{ consorcio?: string; lang?: string; json?: boolean }>();
      const useJson = Boolean(opts.json ?? rootOpts.json);
      const lang = parseLangOption(opts.lang ?? rootOpts.lang);
      const ctamd = createCtamd();

      let consortiumId: ConsortiumId | undefined;
      if (!opts.allAreas) {
        const c = await resolveTargetConsortium(
          opts.consorcio ?? rootOpts.consorcio,
          configStore,
          env,
          stdin,
          stdout,
        );
        consortiumId = c.id;
      }

      const alerts = await ctamd.getAlerts(consortiumId, {
        allAreas: Boolean(opts.allAreas),
        lineQuery: opts.line,
        category: opts.category,
        lang,
      });

      if (useJson) {
        stdout.write(`${JSON.stringify(alerts, null, 2)}\n`);
        return;
      }
      stdout.write(`${formatAlerts(alerts, consortiumId)}\n`);
    });

  program
    .command('fav <action> [alias] [query...]')
    .description('Manage saved favorite stops or towns (add | rm | list)')
    .option('-c, --consorcio <area>', 'Consortium for added favorite')
    .option('--nucleo', 'Save favorite as a town/núcleo instead of a stop')
    .option('--lang <es|en>', 'CTAN API language')
    .option('--json', 'Output JSON')
    .action(async (action: string, alias: string | undefined, queryParts: string[], opts) => {
      const rootOpts = program.opts<{ consorcio?: string; lang?: string; json?: boolean }>();
      const useJson = Boolean(opts.json ?? rootOpts.json);
      const lang = parseLangOption(opts.lang ?? rootOpts.lang);
      const normalizedAction = action.trim().toLowerCase();

      if (normalizedAction === 'list' || normalizedAction === 'ls') {
        const list = await favorites.list();
        if (useJson) {
          stdout.write(`${JSON.stringify(list, null, 2)}\n`);
          return;
        }
        stdout.write(`${formatFavoritesTable(list)}\n`);
        return;
      }

      if (normalizedAction === 'add') {
        if (!alias) {
          throw new CtamdValidationError(
            'Usage: ctamd fav add <alias> <stop-or-town> [-c <area>] [--nucleo]',
          );
        }
        const query = queryParts.join(' ').trim();
        if (!query) {
          throw new CtamdValidationError(
            'Usage: ctamd fav add <alias> <stop-or-town> [-c <area>] [--nucleo]',
          );
        }

        const consortium = await resolveTargetConsortium(
          opts.consorcio ?? rootOpts.consorcio,
          configStore,
          env,
          stdin,
          stdout,
        );
        const ctamd = createCtamd();

        let saved: FavoriteItem;
        if (opts.nucleo) {
          const matches = await ctamd.matchNucleos(consortium.id, query, { lang });
          const nucleo = await selectNucleoFrom(query, matches, stdin, stdout);
          saved = await favorites.add(alias, {
            consorcioId: consortium.id,
            kind: 'nucleo',
            id: nucleo.id,
            name: nucleo.name,
          });
        } else {
          const matches = await ctamd.matchStops(consortium.id, query, { lang });
          const stop = await selectStopFrom(query, matches, stdin, stdout);
          saved = await favorites.add(alias, {
            consorcioId: consortium.id,
            kind: 'stop',
            id: stop.id,
            name: stop.name,
          });
        }

        if (useJson) {
          stdout.write(`${JSON.stringify(saved, null, 2)}\n`);
          return;
        }
        stdout.write(
          `Saved favorite '${saved.alias}' -> [${consortium.shortCode}] ${saved.kind} ${saved.name} (#${saved.id}).\n`,
        );
        return;
      }

      if (normalizedAction === 'rm' || normalizedAction === 'remove') {
        if (!alias) {
          throw new CtamdValidationError('Usage: ctamd fav rm <alias>');
        }
        const removed = await favorites.remove(alias);
        if (!removed) {
          throw new CtamdValidationError(`Favorite '${alias}' does not exist.`);
        }
        if (useJson) {
          stdout.write(`${JSON.stringify({ removed: true, alias: normalizeSearchText(alias) })}\n`);
          return;
        }
        stdout.write(`Removed favorite '${alias.trim().toLowerCase()}'.\n`);
        return;
      }

      throw new CtamdValidationError(`Unknown fav action '${action}'. Expected add, rm, or list.`);
    });

  program
    .command('completion [shell]')
    .aliases(['completions'])
    .description('Generate shell completion script (bash | zsh | fish | powershell)')
    .action((shell?: string) => {
      if (!shell) {
        throw new CtamdValidationError(
          'Missing shell argument. Expected one of: bash, zsh, fish, powershell.',
        );
      }
      stdout.write(generateCompletionScript(shell));
    });

  program
    .command('cache <action>')
    .description('Inspect, sync, or clear the local cache (status | sync | clear)')
    .option('-c, --consorcio <area>', 'Target consortium')
    .option('--catalog-only', 'Sync only metadata catalog without per-line stop sequences')
    .option('--details', 'Also fetch per-line hex colors and metadata during topology sync')
    .option('--lang <es|en>', 'CTAN API language')
    .option('--json', 'Output JSON')
    .action(async (action: string, opts) => {
      const rootOpts = program.opts<{ consorcio?: string; lang?: string; json?: boolean }>();
      const useJson = Boolean(opts.json ?? rootOpts.json);
      const lang = parseLangOption(opts.lang ?? rootOpts.lang);
      const ctamd = createCtamd();
      const normalized = action.trim().toLowerCase();
      const explicitConsorcio = opts.consorcio ?? rootOpts.consorcio;

      if (normalized === 'status') {
        const status = await ctamd.getCacheStatus(explicitConsorcio);
        if (useJson) {
          stdout.write(`${JSON.stringify(status, null, 2)}\n`);
          return;
        }
        stdout.write(`${formatCacheStatus(status)}\n`);
        return;
      }

      if (normalized === 'sync') {
        const consortium = await resolveTargetConsortium(
          explicitConsorcio,
          configStore,
          env,
          stdin,
          stdout,
        );
        const synced = await ctamd.syncCache(consortium.id, {
          lang,
          topology: !opts.catalogOnly,
          enrichLineDetails: Boolean(opts.details),
          force: true,
          onProgress: (done, total, label) =>
            writeSyncProgress(stderr, `Syncing ${consortium.shortCode}`, done, total, label),
        });
        const summary = {
          consorcioId: consortium.id,
          shortCode: consortium.shortCode,
          syncedAt: synced.topology?.syncedAt ?? synced.catalog.syncedAt,
          linesCount: Object.keys(synced.catalog.lines).length,
          stopsCount: Object.keys(synced.catalog.stops).length,
          nucleosCount: Object.keys(synced.catalog.nucleos).length,
          topologySynced: Boolean(synced.topology),
        };
        if (useJson) {
          stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
          return;
        }
        stdout.write(
          `Synced [${summary.shortCode}] ${summary.linesCount} lines, ${summary.stopsCount} stops, and ${summary.nucleosCount} towns to local cache.\n`,
        );
        return;
      }

      if (normalized === 'clear') {
        await ctamd.clearCache(explicitConsorcio);
        if (useJson) {
          stdout.write(
            `${JSON.stringify({ cleared: true, consorcio: explicitConsorcio ?? 'all' })}\n`,
          );
          return;
        }
        stdout.write(
          explicitConsorcio
            ? `Cleared local cache for ${resolveConsortium(explicitConsorcio).shortCode}.\n`
            : 'Cleared all local ctamd cache.\n',
        );
        return;
      }

      throw new CtamdValidationError(
        `Unknown cache action '${action}'. Expected status, sync, or clear.`,
      );
    });

  if (ctx.stdout || ctx.stderr) {
    program.configureOutput({
      writeOut: (str) => {
        stdout.write(str);
      },
      writeErr: (str) => {
        stderr.write(str);
      },
    });
  }

  if (ctx.configureExitOverride) {
    program.exitOverride();
  }

  return program;
}

export async function runCli(argv: string[] = process.argv, ctx: CliContext = {}): Promise<number> {
  const stderr = ctx.stderr ?? process.stderr;
  const manageExitCode = ctx.manageProcessExitCode !== false;
  const program = createProgram(ctx);

  try {
    await program.parseAsync(normalizeNearbyArgv(argv));
    return 0;
  } catch (err) {
    if (err instanceof CommanderError) {
      if (manageExitCode && err.exitCode !== 0) {
        process.exitCode = err.exitCode;
      }
      return err.exitCode;
    }

    if (err instanceof CtamdApiError && err.statusCode === 429) {
      const hint = err.message.includes('--estimate')
        ? ''
        : ' Pass --estimate for offline topology estimates.';
      stderr.write(`Error: ${err.message}${hint}\n`);
    } else if (err instanceof CtamdError) {
      stderr.write(`Error: ${err.message}\n`);
    } else {
      stderr.write(`Unexpected error: ${err instanceof Error ? err.message : String(err)}\n`);
    }

    if (manageExitCode) {
      process.exitCode = 1;
    }
    return 1;
  }
}
