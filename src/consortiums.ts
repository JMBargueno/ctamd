import { CtamdValidationError } from './api/errors.js';
import type { ConsortiumId, ConsortiumInfo } from './types.js';
import { haversineMeters } from './utils/geo.js';
import { normalizeSearchText } from './utils/text.js';

export const CONSORTIUMS: readonly ConsortiumInfo[] = [
  {
    id: 1,
    shortCode: 'CTAS',
    name: 'Área de Sevilla',
    domain: 'ctas.es',
    province: 'Sevilla',
    aliases: ['1', 'ctas', 'ctmas', 'ctas.es', 'ctas.ctan.es', 'sevilla', 'seville', 'se'],
    centerLat: 37.3891,
    centerLon: -5.9845,
    radiusKm: 45,
  },
  {
    id: 2,
    shortCode: 'CMTBC',
    name: 'Bahía de Cádiz',
    domain: 'cmtbc.es',
    province: 'Cádiz',
    aliases: [
      '2',
      'cmtbc',
      'ctbc',
      'cmtbc.es',
      'cadiz',
      'bahia de cadiz',
      'jerez',
      'san fernando',
      'el puerto',
      'chiclana',
      'ca',
    ],
    centerLat: 36.5271,
    centerLon: -6.2886,
    radiusKm: 40,
  },
  {
    id: 3,
    shortCode: 'CTMGR',
    name: 'Área de Granada',
    domain: 'ctagr.es',
    province: 'Granada',
    aliases: ['3', 'ctmgr', 'ctagr', 'ctagr.es', 'ctmgr.es', 'granada', 'gr'],
    centerLat: 37.1773,
    centerLon: -3.5986,
    radiusKm: 45,
  },
  {
    id: 4,
    shortCode: 'CTMAM',
    name: 'Área de Málaga',
    domain: 'ctmam.es',
    province: 'Málaga',
    aliases: ['4', 'ctmam', 'ctmam.es', 'ctmam.ctan.es', 'malaga', 'ma'],
    centerLat: 36.7213,
    centerLon: -4.4214,
    radiusKm: 45,
  },
  {
    id: 5,
    shortCode: 'CTMCG',
    name: 'Campo de Gibraltar',
    domain: 'ctmcg.es',
    province: 'Cádiz',
    aliases: [
      '5',
      'ctmcg',
      'ctcg',
      'ctmcg.es',
      'campo de gibraltar',
      'gibraltar',
      'algeciras',
      'la linea',
      'san roque',
      'tarifa',
    ],
    centerLat: 36.1408,
    centerLon: -5.4562,
    radiusKm: 35,
  },
  {
    id: 6,
    shortCode: 'CTAL',
    name: 'Área de Almería',
    domain: 'ctal.es',
    province: 'Almería',
    aliases: ['6', 'ctal', 'ctmal', 'ctal.es', 'almeria', 'al'],
    centerLat: 36.834,
    centerLon: -2.4637,
    radiusKm: 45,
  },
  {
    id: 7,
    shortCode: 'CTJA',
    name: 'Área de Jaén',
    domain: 'ctja.es',
    province: 'Jaén',
    aliases: ['7', 'ctja', 'ctmja', 'ctja.es', 'jaen', 'ja'],
    centerLat: 37.7796,
    centerLon: -3.7849,
    radiusKm: 45,
  },
  {
    id: 8,
    shortCode: 'CTCO',
    name: 'Área de Córdoba',
    domain: 'ctco.es',
    province: 'Córdoba',
    aliases: ['8', 'ctco', 'ctmco', 'ctco.es', 'cordoba', 'co'],
    centerLat: 37.8882,
    centerLon: -4.7794,
    radiusKm: 45,
  },
  {
    id: 9,
    shortCode: 'CTHU',
    name: 'Costa de Huelva',
    domain: 'cthu.es',
    province: 'Huelva',
    aliases: ['9', 'cthu', 'ctmhu', 'cthu.es', 'huelva', 'costa de huelva', 'hu'],
    centerLat: 37.2614,
    centerLon: -6.9447,
    radiusKm: 45,
  },
] as const;

const CONSORTIUM_BY_ID = new Map<number, ConsortiumInfo>(
  CONSORTIUMS.map((consortium) => [consortium.id, consortium]),
);

function cleanConsortiumToken(input: string): string {
  const strippedUrl = input
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .split('/')[0]!;
  return normalizeSearchText(strippedUrl);
}

export function getConsortiumById(id: number): ConsortiumInfo | undefined {
  return CONSORTIUM_BY_ID.get(id);
}

export function isValidConsortiumId(id: number): id is ConsortiumId {
  return CONSORTIUM_BY_ID.has(id);
}

/**
 * Resolves a consortium by ID (`1`-`9`), short code (`CTAS`), domain (`ctas.es`),
 * city/area name (`sevilla`, `granada`, `malaga`), or substring match.
 */
export function resolveConsortium(input: string | number): ConsortiumInfo {
  if (typeof input === 'number') {
    const byId = CONSORTIUM_BY_ID.get(input);
    if (!byId) {
      throw new CtamdValidationError(
        `Unknown consortium ID '${input}'. Valid IDs are 1-9 (${CONSORTIUMS.map((c) => `${c.id}:${c.shortCode}`).join(', ')}).`,
      );
    }
    return byId;
  }

  const raw = String(input).trim();
  if (!raw) {
    throw new CtamdValidationError('Consortium identifier cannot be empty.');
  }

  if (/^\d+$/.test(raw)) {
    const id = Number.parseInt(raw, 10);
    const byId = CONSORTIUM_BY_ID.get(id);
    if (byId) {
      return byId;
    }
  }

  const token = cleanConsortiumToken(raw);
  const withoutTld = token.replace(/\.(ctan\.)?es$/, '');

  for (const consortium of CONSORTIUMS) {
    const normalizedName = normalizeSearchText(consortium.name);
    const normalizedShort = normalizeSearchText(consortium.shortCode);
    const normalizedDomain = normalizeSearchText(consortium.domain);
    const domainBase = normalizedDomain.replace(/\.es$/, '');

    if (
      token === normalizedShort ||
      token === normalizedName ||
      token === normalizedDomain ||
      withoutTld === domainBase ||
      consortium.aliases.some((alias) => normalizeSearchText(alias) === token) ||
      consortium.aliases.some((alias) => normalizeSearchText(alias) === withoutTld)
    ) {
      return consortium;
    }
  }

  const partialMatches = CONSORTIUMS.filter((consortium) => {
    const normalizedName = normalizeSearchText(consortium.name);
    const normalizedShort = normalizeSearchText(consortium.shortCode);
    return (
      normalizedName.includes(token) ||
      normalizedShort.includes(token) ||
      consortium.aliases.some((a) => normalizeSearchText(a).includes(token))
    );
  });

  if (partialMatches.length === 1) {
    return partialMatches[0]!;
  }

  const validSummary = CONSORTIUMS.map((c) => `${c.id}:${c.shortCode.toLowerCase()}`).join(', ');
  if (partialMatches.length > 1) {
    throw new CtamdValidationError(
      `Ambiguous consortium '${input}'. Matched: ${partialMatches.map((c) => `${c.name} (${c.shortCode})`).join(', ')}.`,
    );
  }

  throw new CtamdValidationError(
    `Unknown consortium '${input}'. Valid consortia: ${validSummary} (or domains like ctas.es, ctagr.es, ctmam.es).`,
  );
}

/**
 * Finds the nearest Andalusian transport consortia to a WGS84 coordinate.
 */
export function findNearestConsortiums(
  lat: number,
  lon: number,
  maxCount = 2,
): Array<{ consortium: ConsortiumInfo; distanceKm: number; withinRadius: boolean }> {
  const ranked = CONSORTIUMS.map((consortium) => {
    const distanceKm = haversineMeters(lat, lon, consortium.centerLat, consortium.centerLon) / 1000;
    return {
      consortium,
      distanceKm,
      withinRadius: distanceKm <= consortium.radiusKm,
    };
  }).sort((a, b) => a.distanceKm - b.distanceKm || a.consortium.id - b.consortium.id);

  return ranked.slice(0, Math.max(1, maxCount));
}
