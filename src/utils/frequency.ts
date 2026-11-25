import { cleanApiText, normalizeSearchText } from './text.js';

// Day index: 0 = Sun, 1 = Mon, 2 = Tue, 3 = Wed, 4 = Thu, 5 = Fri, 6 = Sat
// Granada 8-char mask index: 0=Mon(L), 1=Tue(M), 2=Wed(X), 3=Thu(J), 4=Fri(V), 5=Sat(S), 6=Sun(D), 7=Holiday(F/P)
const GRANADA_MASK_REGEX = /^[L-][M-][X-][J-][V-][S-][D-][FP-]$/i;

const SPECIAL_EVENT_KEYWORDS = [
  'obsoleto',
  'huelga',
  'feria',
  'semana santa',
  'santo',
  'ramos',
  'nochebuena',
  'navidad',
  'nochevieja',
  'ano nuevo',
  'reyes',
  'halloween',
  'procesion',
  'magna',
  'noche celta',
  'noche latina',
  'noche blues',
  'cala mijas',
  'fuensanta',
  'san rafael',
  'san juan',
  'inmaculada',
  'constitucion',
  'puente de diciembre',
  'todos los santos',
  'dia suelto',
  'especial',
  'dia de andalucia',
];

const SPANISH_MONTHS = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];

const WEEKDAY_ORDER = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];

function jsDayToMaskIndex(jsDay: number): number {
  return jsDay === 0 ? 6 : jsDay - 1;
}

function expandWeekdayRange(startDay: number, endDay: number): Set<number> {
  const days = new Set<number>();
  let curr = startDay;
  for (let steps = 0; steps < 7; steps++) {
    days.add(curr);
    if (curr === endDay) {
      break;
    }
    curr = (curr + 1) % 7;
  }
  return days;
}

function matchesExplicitEventDate(normalizedDesc: string, date: Date): boolean {
  const day = date.getDate();
  const monthIdx = date.getMonth();
  const monthName = SPANISH_MONTHS[monthIdx]!;

  const dmyMatch =
    /\b(\d{1,2})\s*(?:de\s+)?(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\b/.exec(
      normalizedDesc,
    );
  if (dmyMatch) {
    return Number(dmyMatch[1]) === day && dmyMatch[2] === monthName;
  }

  const slashMatch = /\b(\d{1,2})\/(\d{1,2})\b/.exec(normalizedDesc);
  if (slashMatch) {
    return Number(slashMatch[1]) === day && Number(slashMatch[2]) === monthIdx + 1;
  }

  return false;
}

interface ParsedDayRule {
  weekdays: Set<number>;
  includesHoliday: boolean;
  isSpecialOnly: boolean;
}

function parseSpanishDescription(normalizedDesc: string, date: Date): ParsedDayRule | null {
  if (!normalizedDesc) {
    return null;
  }

  if (SPECIAL_EVENT_KEYWORDS.some((kw) => normalizedDesc.includes(kw))) {
    if (matchesExplicitEventDate(normalizedDesc, date)) {
      return {
        weekdays: new Set([date.getDay()]),
        includesHoliday: true,
        isSpecialOnly: false,
      };
    }
    return {
      weekdays: new Set(),
      includesHoliday: false,
      isSpecialOnly: true,
    };
  }

  const weekdays = new Set<number>();
  let includesHoliday =
    /\bfestiv[oa]s?\b/.test(normalizedDesc) || /\bdiari[oa]?\b/.test(normalizedDesc);

  if (/\btodos los dias\b|\bdiario\b|\bdiaria\b/.test(normalizedDesc)) {
    for (let d = 0; d < 7; d++) {
      weekdays.add(d);
    }
    if (!/\bexcepto\s+festiv/.test(normalizedDesc) && !/\blaborables\b/.test(normalizedDesc)) {
      includesHoliday = true;
    }
  }

  if (/\bfin de semana\b/.test(normalizedDesc)) {
    weekdays.add(6);
    weekdays.add(0);
  }

  // Match ranges like "lunes a viernes", "martes a sabados", "domingo a jueves"
  const rangeRegex =
    /\b(domingos?|lunes|martes|miercoles|jueves|viernes|sabados?)\s+(?:a|hasta)\s+(domingos?|lunes|martes|miercoles|jueves|viernes|sabados?)\b/g;
  let rangeMatch: RegExpExecArray | null;
  let foundRange = false;
  while (true) {
    rangeMatch = rangeRegex.exec(normalizedDesc);
    if (!rangeMatch) {
      break;
    }
    foundRange = true;
    const startName = rangeMatch[1]!.replace(/s$/, '');
    const endName = rangeMatch[2]!.replace(/s$/, '');
    const startIdx = WEEKDAY_ORDER.findIndex((w) => w.startsWith(startName));
    const endIdx = WEEKDAY_ORDER.findIndex((w) => w.startsWith(endName));
    if (startIdx !== -1 && endIdx !== -1) {
      for (const d of expandWeekdayRange(startIdx, endIdx)) {
        weekdays.add(d);
      }
    }
  }

  // Also check explicit weekday mentions when not solely matched via ranges (or mixed like "lunes a viernes y domingos")
  const tokenRegex = /\b(domingos?|lunes|martes|miercoles|jueves|viernes|sabados?)\b/g;
  let tokenMatch: RegExpExecArray | null;
  while (true) {
    tokenMatch = tokenRegex.exec(normalizedDesc);
    if (!tokenMatch) {
      break;
    }
    if (
      !foundRange ||
      normalizedDesc.slice(0, tokenMatch.index).includes(' y ') ||
      normalizedDesc.slice(0, tokenMatch.index).includes(',')
    ) {
      const base = tokenMatch[1]!.replace(/s$/, '');
      const idx = WEEKDAY_ORDER.findIndex((w) => w.startsWith(base));
      if (idx !== -1) {
        weekdays.add(idx);
      }
    }
  }

  // "laborable(s)" without explicit weekdays usually means Mon-Fri or Mon-Sat; in Andalusia Mon-Fri unless specified
  if (weekdays.size === 0 && /\blaborable\b/.test(normalizedDesc)) {
    for (const d of [1, 2, 3, 4, 5]) {
      weekdays.add(d);
    }
  }

  if (weekdays.size === 0 && !includesHoliday) {
    return null;
  }

  // "de lunes a viernes laborables" -> does NOT run on public holidays unless "y festivos" is stated
  if (/\blaborables?\b/.test(normalizedDesc) && !/\b(?:y|e|,)\s*festiv/.test(normalizedDesc)) {
    includesHoliday = false;
  }

  return { weekdays, includesHoliday, isSpecialOnly: false };
}

const KNOWN_ACRONYM_MAP: Record<string, { days: number[]; holiday: boolean }> = {
  lv: { days: [1, 2, 3, 4, 5], holiday: false },
  'l-v': { days: [1, 2, 3, 4, 5], holiday: false },
  lvl: { days: [1, 2, 3, 4, 5], holiday: false },
  lab: { days: [1, 2, 3, 4, 5], holiday: false },
  lecti: { days: [1, 2, 3, 4, 5], holiday: false },
  lvfes: { days: [1, 2, 3, 4, 5], holiday: true },
  'l-vdf': { days: [1, 2, 3, 4, 5, 0], holiday: true },
  'l-v,d': { days: [1, 2, 3, 4, 5, 0], holiday: true },
  lj: { days: [1, 2, 3, 4], holiday: false },
  'l-j': { days: [1, 2, 3, 4], holiday: false },
  ljl: { days: [1, 2, 3, 4], holiday: false },
  mv: { days: [2, 3, 4, 5], holiday: false },
  'm-v': { days: [2, 3, 4, 5], holiday: false },
  mmijv: { days: [2, 3, 4, 5], holiday: false },
  mj: { days: [2, 3, 4], holiday: false },
  'm-j': { days: [2, 3, 4], holiday: false },
  myjla: { days: [2, 4], holiday: false },
  miyju: { days: [3, 4], holiday: false },
  'l-s': { days: [1, 2, 3, 4, 5, 6], holiday: false },
  lvsa: { days: [1, 2, 3, 4, 5, 6], holiday: false },
  lslab: { days: [1, 2, 3, 4, 5, 6], holiday: false },
  lslf: { days: [1, 2, 3, 4, 5, 6], holiday: true },
  'l-d': { days: [0, 1, 2, 3, 4, 5, 6], holiday: true },
  lvsdf: { days: [0, 1, 2, 3, 4, 5, 6], holiday: true },
  ldom: { days: [0, 1, 2, 3, 4, 5, 6], holiday: false },
  diari: { days: [0, 1, 2, 3, 4, 5, 6], holiday: true },
  'diar.': { days: [0, 1, 2, 3, 4, 5, 6], holiday: true },
  sa: { days: [6], holiday: false },
  s: { days: [6], holiday: false },
  sab: { days: [6], holiday: false },
  'sab.': { days: [6], holiday: false },
  slab: { days: [6], holiday: false },
  df: { days: [0], holiday: true },
  dofe: { days: [0], holiday: true },
  'do fe': { days: [0], holiday: true },
  d: { days: [0], holiday: false },
  do: { days: [0], holiday: false },
  dom: { days: [0], holiday: false },
  f: { days: [], holiday: true },
  fe: { days: [], holiday: true },
  fest: { days: [], holiday: true },
  sadf: { days: [6, 0], holiday: true },
  's-d-f': { days: [6, 0], holiday: true },
  sdf: { days: [6, 0], holiday: true },
  's-d': { days: [6, 0], holiday: false },
  syd: { days: [6, 0], holiday: false },
  's y d': { days: [6, 0], holiday: false },
  'd y f': { days: [0], holiday: true },
  dyf: { days: [0], holiday: true },
  v: { days: [5], holiday: false },
  vlab: { days: [5], holiday: false },
  vier: { days: [5], holiday: false },
  l: { days: [1], holiday: false },
  lunes: { days: [1], holiday: false },
  m: { days: [2], holiday: false },
  marte: { days: [2], holiday: false },
  x: { days: [3], holiday: false },
  mierc: { days: [3], holiday: false },
  j: { days: [4], holiday: false },
  jueve: { days: [4], holiday: false },
  vsfes: { days: [5, 6], holiday: true },
  vslab: { days: [5, 6], holiday: false },
  'v-s': { days: [5, 6], holiday: false },
  vys: { days: [5, 6], holiday: false },
  'v-d': { days: [5, 6, 0], holiday: false },
  jvs: { days: [4, 5, 6], holiday: false },
  jvsl: { days: [4, 5, 6], holiday: false },
  jvsdf: { days: [4, 5, 6, 0], holiday: true },
  vd: { days: [5, 0], holiday: false },
  jdyf: { days: [4, 0], holiday: true },
  'l-x-v': { days: [1, 3, 5], holiday: false },
  lxv: { days: [1, 3, 5], holiday: false },
  lmx: { days: [1, 2, 3], holiday: false },
  'l-x-j': { days: [1, 3, 4], holiday: false },
  lx: { days: [1, 3], holiday: false },
  'l y v': { days: [1, 5], holiday: false },
  lmvs: { days: [1, 3, 5, 6], holiday: false },
  dlm: { days: [0, 1, 2], holiday: false },
  'd a j': { days: [0, 1, 2, 3, 4], holiday: false },
  'ma-d': { days: [2, 3, 4, 5, 6, 0], holiday: false },
  jvlu: { days: [4, 5, 1], holiday: false },
  jv: { days: [4, 5], holiday: false },
};

/**
 * Evaluates whether a CTAN trip frequency code/description runs on the given calendar date.
 * Handles all 9 Andalusian consortium conventions (Sevilla LV/SA/DF, Granada 8-char bitmasks,
 * Málaga custom lowercase codes, Cádiz/Almería/Jaén/Córdoba/Huelva variants).
 */
export function matchesFrequencyOnDate(
  acronym: string,
  description: string | undefined,
  date: Date,
  options: { isHoliday?: boolean } = {},
): boolean {
  const cleanAcronym = cleanApiText(acronym);
  const cleanDesc = cleanApiText(description);
  const normAcronym = normalizeSearchText(cleanAcronym);
  const normDesc = normalizeSearchText(cleanDesc);

  const isHoliday = Boolean(options.isHoliday);
  const jsDay = date.getDay();

  // 1. Granada 8-char bitmask: e.g. LMXJV---, -----S--, ------D-, LMXJVSDF
  if (GRANADA_MASK_REGEX.test(cleanAcronym)) {
    const mask = cleanAcronym.toUpperCase();
    if (isHoliday) {
      return mask[7] === 'F' || mask[6] === 'D';
    }
    const idx = jsDayToMaskIndex(jsDay);
    return mask[idx] !== '-';
  }

  // 2. Semantic Spanish description check (disambiguates consortium-specific acronyms like "1", "M", "D")
  const parsedDesc = parseSpanishDescription(normDesc, date);
  if (parsedDesc) {
    if (parsedDesc.isSpecialOnly) {
      return false;
    }
    if (isHoliday) {
      return parsedDesc.includesHoliday || parsedDesc.weekdays.has(0);
    }
    return parsedDesc.weekdays.has(jsDay);
  }

  // 3. Normalized acronym dictionary fallback
  const entry = KNOWN_ACRONYM_MAP[normAcronym];
  if (entry) {
    if (isHoliday) {
      return entry.holiday || entry.days.includes(0);
    }
    return entry.days.includes(jsDay);
  }

  // 4. Generic letter-set fallback for unseen multi-day combinations like "LMXJV" or "M,X,J"
  const compact = normAcronym.replace(/[,.\s-]+/g, '');
  if (/^[lmxjvdfsu]+$/.test(compact) && compact.length <= 7) {
    const letterMap: Record<string, number> = {
      l: 1,
      m: 2,
      x: 3,
      j: 4,
      v: 5,
      s: 6,
      d: 0,
    };
    const days = new Set<number>();
    let hasF = false;
    for (const ch of compact) {
      if (ch === 'f') {
        hasF = true;
      } else if (letterMap[ch] !== undefined) {
        days.add(letterMap[ch]!);
      }
    }
    if (isHoliday) {
      return hasF || days.has(0);
    }
    return days.has(jsDay);
  }

  // Unknown single-day / special token should not silently pollute normal day searches
  return false;
}

/**
 * Checks whether `date` falls within a `horarios_lineas` planner validity window (`YYYY-MM-DD`).
 */
export function isDateInPlannerRange(
  startDateStr: string | null | undefined,
  endDateStr: string | null | undefined,
  date: Date,
): boolean {
  const toYmd = (d: Date): string =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const target = toYmd(date);

  const start = cleanApiText(startDateStr).slice(0, 10);
  const end = cleanApiText(endDateStr).slice(0, 10);

  if (/^\d{4}-\d{2}-\d{2}$/.test(start) && target < start) {
    return false;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(end) && target > end) {
    return false;
  }
  return true;
}
