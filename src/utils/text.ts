/**
 * Cleans raw CTAN API text (strips null bytes, converts NBSP to spaces, trims whitespace).
 * Safely handles unexpected numeric or non-string API field values.
 */
export function cleanApiText(text: unknown): string {
  if (text === null || text === undefined) {
    return '';
  }
  const str =
    typeof text === 'string'
      ? text
      : typeof text === 'number' || typeof text === 'boolean'
        ? String(text)
        : '';
  if (!str) {
    return '';
  }
  let out = '';
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if (code === 0) {
      continue;
    }
    out += code === 0xa0 ? ' ' : str[i]!;
  }
  return out.replace(/\s+/g, ' ').trim();
}

/**
 * Normalizes text for accent- and case-insensitive search matching.
 */
export function normalizeSearchText(text: string): string {
  return cleanApiText(text)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/**
 * Splits a comma-separated API list while discarding empty entries from trailing commas.
 */
export function splitCommaList(raw: string | null | undefined): string[] {
  const cleaned = cleanApiText(raw);
  if (!cleaned) {
    return [];
  }
  return cleaned
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}
