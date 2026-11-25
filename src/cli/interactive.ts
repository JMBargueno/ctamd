import readline from 'node:readline';
import { CtamdValidationError } from '../api/errors.js';
import { CONSORTIUMS, getConsortiumById, resolveConsortium } from '../consortiums.js';
import type { ConsortiumId, ConsortiumInfo, FavoriteItem, Nucleo, Stop } from '../types.js';
import { isSameLocalDay, parseAfterOption, resolveQueryDate } from '../utils/time.js';
import {
  selectConsortiumWithReader,
  selectNucleoWithReader,
  selectStopWithReader,
} from './selectEntity.js';

export interface InteractivePromptOptions {
  defaultConsortiumId?: ConsortiumId;
  matchNucleos: (consorcioId: ConsortiumId, query: string) => Promise<Nucleo[]>;
  matchStops: (consorcioId: ConsortiumId, query: string) => Promise<Stop[]>;
  resolveFavorite?: (query: string) => Promise<FavoriteItem | null>;
  listFavorites?: () => Promise<FavoriteItem[]>;
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
  now?: Date;
}

export interface InteractivePromptResult {
  consortium: ConsortiumInfo;
  mode: 'nucleo' | 'stop';
  originId: string;
  originName: string;
  destinationId: string;
  destinationName: string;
  date: Date;
  afterSeconds?: number;
  sortByDuration: boolean;
}

function parseInteractiveDate(raw: string, now: Date): Date {
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed || trimmed === 'today') {
    return new Date(now.getTime());
  }
  if (trimmed === 'tomorrow') {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 8, 0, 0, 0);
  }

  const isoMatch = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(trimmed);
  if (isoMatch) {
    return resolveQueryDate(
      {
        year: Number.parseInt(isoMatch[1]!, 10),
        month: Number.parseInt(isoMatch[2]!, 10),
        day: Number.parseInt(isoMatch[3]!, 10),
      },
      now,
    );
  }

  const dmyMatch = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(trimmed);
  if (dmyMatch) {
    return resolveQueryDate(
      {
        day: Number.parseInt(dmyMatch[1]!, 10),
        month: Number.parseInt(dmyMatch[2]!, 10),
        year: Number.parseInt(dmyMatch[3]!, 10),
      },
      now,
    );
  }

  throw new CtamdValidationError(
    `Invalid date '${raw}'. Use YYYY-MM-DD, DD/MM/YYYY, 'today', or 'tomorrow'.`,
  );
}

/**
 * Runs an interactive step-by-step route search prompt using a single readline interface.
 */
export async function runInteractivePrompt(
  options: InteractivePromptOptions,
): Promise<InteractivePromptResult> {
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;
  const now = options.now ?? new Date();

  const favorites = options.listFavorites ? await options.listFavorites() : [];
  if (favorites.length > 0) {
    const hints = favorites.map((f) => `${f.alias} (${f.kind} #${f.id})`).join(', ');
    output.write(`Saved favorites: ${hints}\n`);
  }

  const rl = readline.createInterface({
    input,
    crlfDelay: Infinity,
  });
  const iterator = rl[Symbol.asyncIterator]();

  const readLine = async (): Promise<string | null> => {
    const next = await iterator.next();
    return next.done ? null : next.value;
  };

  const ask = async (prompt: string): Promise<string> => {
    output.write(prompt);
    const line = await readLine();
    if (line === null) {
      throw new CtamdValidationError('Interactive route search cancelled.');
    }
    return line;
  };

  try {
    let consortium: ConsortiumInfo;
    if (options.defaultConsortiumId) {
      const def = getConsortiumById(options.defaultConsortiumId)!;
      const rawArea = (
        await ask(`Consortium [${def.shortCode} - ${def.name}, Enter for default]: `)
      ).trim();
      consortium = rawArea ? resolveConsortium(rawArea) : def;
    } else {
      consortium = await selectConsortiumWithReader(CONSORTIUMS, readLine, output);
    }

    let mode: 'nucleo' | 'stop' = 'nucleo';
    while (true) {
      const rawMode = (await ask('Search by [1] Town/Núcleo (OD) or [2] Stop [1]: ')).trim();
      if (!rawMode || rawMode === '1' || /^town|nucleo|od$/i.test(rawMode)) {
        mode = 'nucleo';
        break;
      }
      if (rawMode === '2' || /^stop|parada$/i.test(rawMode)) {
        mode = 'stop';
        break;
      }
      output.write("Enter '1' for town/núcleo or '2' for stop.\n");
    }

    const promptEntity = async (label: string): Promise<{ id: string; name: string }> => {
      while (true) {
        const kindLabel = mode === 'nucleo' ? 'town/núcleo' : 'stop';
        const query = (await ask(`${label} ${kindLabel} (name, ID, or favorite): `)).trim();
        if (!query) {
          output.write(`Please enter a ${kindLabel} name, ID, or favorite alias.\n`);
          continue;
        }

        if (options.resolveFavorite) {
          const fav = await options.resolveFavorite(query);
          if (fav && fav.kind === mode && fav.consorcioId === consortium.id) {
            return { id: fav.id, name: fav.name };
          }
        }

        if (mode === 'nucleo') {
          const matches = await options.matchNucleos(consortium.id, query);
          if (matches.length === 0) {
            output.write(`No towns/núcleos matched '${query}'. Try again.\n`);
            continue;
          }
          const picked = await selectNucleoWithReader(query, matches, readLine, output);
          return { id: picked.id, name: picked.name };
        }

        const matches = await options.matchStops(consortium.id, query);
        if (matches.length === 0) {
          output.write(`No stops matched '${query}'. Try again.\n`);
          continue;
        }
        const picked = await selectStopWithReader(query, matches, readLine, output);
        return { id: picked.id, name: picked.name };
      }
    };

    const origin = await promptEntity('Origin');
    const destination = await promptEntity('Destination');

    let date: Date;
    while (true) {
      const rawDate = await ask("Date [YYYY-MM-DD, 'today', 'tomorrow', Enter for today]: ");
      try {
        date = parseInteractiveDate(rawDate, now);
        break;
      } catch (err) {
        output.write(`${err instanceof Error ? err.message : String(err)}\n`);
      }
    }

    let afterSeconds: number | undefined;
    while (true) {
      const rawAfter = (await ask('Depart after [HH:MM, Enter for default]: ')).trim();
      if (!rawAfter) {
        afterSeconds = isSameLocalDay(date, now)
          ? now.getHours() * 3600 + now.getMinutes() * 60
          : undefined;
        break;
      }
      try {
        afterSeconds = parseAfterOption(rawAfter);
        break;
      } catch (err) {
        output.write(`${err instanceof Error ? err.message : String(err)}\n`);
      }
    }

    const rawSort = (await ask('Sort by duration? [y/N]: ')).trim();
    const sortByDuration = /^(y|yes|s|si)$/i.test(rawSort);

    return {
      consortium,
      mode,
      originId: origin.id,
      originName: origin.name,
      destinationId: destination.id,
      destinationName: destination.name,
      date,
      afterSeconds,
      sortByDuration,
    };
  } finally {
    rl.close();
  }
}
