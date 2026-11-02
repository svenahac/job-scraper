/**
 * Term matching for the profile lists. See the header of profile.ts for the
 * term syntax: prefix match from a word start, '*' for any letters, a trailing
 * '$' for a word end, and whole words for terms shorter than four characters.
 */

/** Lowercase with diacritics dropped, so "Domzale" matches "domžale". */
export const fold = (s: string): string =>
  s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');

const escapeRe = (s: string): string => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');

// A hyphen counts as a word character on the left, so 'mobilnost' does not
// fire inside "e-mobilnosti".
const START = '(?<![\\p{L}\\p{N}-])';
const END = '(?![\\p{L}\\p{N}])';

const cache = new Map<string, RegExp>();

export function termRegex(term: string): RegExp {
  let re = cache.get(term);
  if (re) return re;
  let t = fold(term.trim());
  let whole = false;
  if (t.endsWith('$')) { whole = true; t = t.slice(0, -1); }
  if (t.replace(/\*/g, '').length < 4) whole = true;
  const body = t.split('*').map(escapeRe).join('\\p{L}*');
  re = new RegExp(`${START}${body}${whole ? END : ''}`, 'u');
  cache.set(term, re);
  return re;
}

/** The terms from `terms` found in `folded`, which must already be folded. */
export function hits(folded: string, terms: readonly string[]): string[] {
  if (!folded) return [];
  return terms.filter((t) => termRegex(t).test(folded));
}

export const hasAny = (folded: string, terms: readonly string[]): boolean =>
  !!folded && terms.some((t) => termRegex(t).test(folded));

/** Every match position of `term` in `folded`. */
export function positions(folded: string, term: string): number[] {
  const re = new RegExp(termRegex(term).source, 'gu');
  return [...folded.matchAll(re)].map((m) => m.index ?? 0);
}
