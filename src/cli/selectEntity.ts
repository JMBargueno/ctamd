import readline from 'node:readline';
import { CtamdValidationError } from '../api/errors.js';
import type { ConsortiumInfo, Nucleo, Stop } from '../types.js';
import { normalizeSearchText } from '../utils/text.js';

async function promptChoiceIndex(
  count: number,
  label: string,
  emptyError: string,
  readLine: () => Promise<string | null>,
  output: NodeJS.WritableStream,
): Promise<number> {
  while (true) {
    output.write(`Select ${label} [1-${count}]: `);
    const answer = await readLine();
    if (answer === null) {
      throw new CtamdValidationError(emptyError);
    }

    const trimmed = answer.trim();
    if (/^\d+$/.test(trimmed)) {
      const index = Number.parseInt(trimmed, 10);
      if (index >= 1 && index <= count) {
        return index - 1;
      }
    }

    output.write(`Please enter a number between 1 and ${count}.\n`);
  }
}

export async function selectStopWithReader(
  query: string,
  matches: readonly Stop[],
  readLine: () => Promise<string | null>,
  output: NodeJS.WritableStream = process.stdout,
): Promise<Stop> {
  const sorted = [...matches].sort(
    (a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
  );

  if (sorted.length === 0) {
    throw new CtamdValidationError(`Provided input '${query}' does not match any stop.`);
  }
  if (sorted.length === 1) {
    return sorted[0]!;
  }

  output.write(`Multiple stops match '${query}':\n`);
  sorted.forEach((stop, index) => {
    const town = stop.nucleoName ? ` (${stop.nucleoName})` : '';
    const zone = stop.zoneId ? ` [Zone ${stop.zoneId}]` : '';
    output.write(`  ${index + 1}. ${stop.name} [#${stop.id}]${town}${zone}\n`);
  });

  const idx = await promptChoiceIndex(
    sorted.length,
    'a stop',
    `No stop was selected for '${query}'.`,
    readLine,
    output,
  );
  return sorted[idx]!;
}

export async function selectStopFrom(
  query: string,
  matches: readonly Stop[],
  input: NodeJS.ReadableStream = process.stdin,
  output: NodeJS.WritableStream = process.stdout,
): Promise<Stop> {
  if (matches.length === 0) {
    throw new CtamdValidationError(`Provided input '${query}' does not match any stop.`);
  }
  if (matches.length === 1) {
    return matches[0]!;
  }

  const rl = readline.createInterface({ input, crlfDelay: Infinity });
  const iterator = rl[Symbol.asyncIterator]();

  try {
    return await selectStopWithReader(
      query,
      matches,
      async () => {
        const next = await iterator.next();
        return next.done ? null : next.value;
      },
      output,
    );
  } finally {
    rl.close();
  }
}

export async function selectNucleoWithReader(
  query: string,
  matches: readonly Nucleo[],
  readLine: () => Promise<string | null>,
  output: NodeJS.WritableStream = process.stdout,
): Promise<Nucleo> {
  if (matches.length === 0) {
    throw new CtamdValidationError(`Provided input '${query}' does not match any town/núcleo.`);
  }
  if (matches.length === 1) {
    return matches[0]!;
  }

  const normQuery = normalizeSearchText(query);
  const exact = matches.filter((m) => normalizeSearchText(m.name) === normQuery);
  if (exact.length === 1) {
    return exact[0]!;
  }

  const sorted = [...matches].sort(
    (a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
  );

  output.write(`Multiple towns/núcleos match '${query}':\n`);
  sorted.forEach((n, index) => {
    const zone = n.zoneId ? ` (Zone ${n.zoneId})` : '';
    output.write(`  ${index + 1}. ${n.name} [#${n.id}]${zone}\n`);
  });

  const idx = await promptChoiceIndex(
    sorted.length,
    'a town',
    `No town/núcleo was selected for '${query}'.`,
    readLine,
    output,
  );
  return sorted[idx]!;
}

export async function selectNucleoFrom(
  query: string,
  matches: readonly Nucleo[],
  input: NodeJS.ReadableStream = process.stdin,
  output: NodeJS.WritableStream = process.stdout,
): Promise<Nucleo> {
  if (matches.length === 0) {
    throw new CtamdValidationError(`Provided input '${query}' does not match any town/núcleo.`);
  }
  if (matches.length === 1) {
    return matches[0]!;
  }

  const normQuery = normalizeSearchText(query);
  const exact = matches.filter((m) => normalizeSearchText(m.name) === normQuery);
  if (exact.length === 1) {
    return exact[0]!;
  }

  const rl = readline.createInterface({ input, crlfDelay: Infinity });
  const iterator = rl[Symbol.asyncIterator]();

  try {
    return await selectNucleoWithReader(
      query,
      matches,
      async () => {
        const next = await iterator.next();
        return next.done ? null : next.value;
      },
      output,
    );
  } finally {
    rl.close();
  }
}

export async function selectConsortiumWithReader(
  consortiums: readonly ConsortiumInfo[],
  readLine: () => Promise<string | null>,
  output: NodeJS.WritableStream = process.stdout,
): Promise<ConsortiumInfo> {
  output.write('Select an Andalusian Transport Consortium:\n');
  consortiums.forEach((c, index) => {
    output.write(`  ${index + 1}. ${c.name} (${c.shortCode} · ${c.domain})\n`);
  });

  const idx = await promptChoiceIndex(
    consortiums.length,
    'a consortium',
    'No consortium was selected.',
    readLine,
    output,
  );
  return consortiums[idx]!;
}

export async function selectConsortiumFrom(
  consortiums: readonly ConsortiumInfo[],
  input: NodeJS.ReadableStream = process.stdin,
  output: NodeJS.WritableStream = process.stdout,
): Promise<ConsortiumInfo> {
  const rl = readline.createInterface({ input, crlfDelay: Infinity });
  const iterator = rl[Symbol.asyncIterator]();

  try {
    return await selectConsortiumWithReader(
      consortiums,
      async () => {
        const next = await iterator.next();
        return next.done ? null : next.value;
      },
      output,
    );
  } finally {
    rl.close();
  }
}
