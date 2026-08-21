import type { RawJob, Seniority } from './types.js';

export interface Classification {
  roleMatch: string[];
  seniority: Seniority;
}

/**
 * Role keywords. Both tiers match anywhere — title, tags, or body.
 * This biases toward recall: Slovenian ads often bury the real stack in the
 * requirements while the title says only "Razvijalec (m/ž)".
 */
const ROLE_KEYWORDS = [
  'frontend', 'front-end', 'front end',
  'fullstack', 'full-stack', 'full stack',
  'spletni razvijalec', 'spletnih aplikacij', 'spletne aplikacije',
  'web developer', 'web development',
] as const;

const TECH_KEYWORDS = [
  'react', 'vue', 'angular', 'next.js', 'nextjs', 'svelte',
  'javascript', 'typescript',
] as const;

/** Seniority markers. Matched against title and tags ONLY — never the body. */
const SENIOR_MARKERS = [
  'senior', 'sr.', 'lead', 'vodja', 'arhitekt', 'architect',
  'principal', 'staff', 'head of',
] as const;

const JUNIOR_MARKERS = [
  'junior', 'mlajši', 'pripravnik', 'praktikant', 'brez izkušenj',
] as const;

const MID_MARKERS = [
  'medior', 'mid-level', 'mid level', 'midlevel', 'intermediate',
] as const;

/**
 * Years of experience, Slovenian and English.
 * Group 1 is the first number, group 2 the upper bound of a range.
 * Matches: "5+ let", "vsaj 3 leta", "1-2 leti", "1 leto", "4 years".
 */
const YEARS_RE = /(\d{1,2})\s*(?:[-–—]\s*(\d{1,2}))?\s*\+?\s*(?:let(?:o|a|i)?|year)/gi;

const norm = (s: string): string => s.toLowerCase();

const containsAny = (haystack: string, needles: readonly string[]): string[] =>
  needles.filter((n) => haystack.includes(n));

export function matchRole(title: string, tags: string[], body: string): string[] {
  const all = norm([title, tags.join(' '), body].join(' \n '));
  return [...containsAny(all, ROLE_KEYWORDS), ...containsAny(all, TECH_KEYWORDS)];
}

/** Largest years figure stated in the body, or null when none is stated. */
function maxYears(body: string): number | null {
  let max: number | null = null;
  for (const m of body.matchAll(YEARS_RE)) {
    const lower = Number(m[1]);
    const upper = m[2] === undefined ? lower : Number(m[2]);
    // A range takes its upper bound; "3+" and "vsaj 3" take the stated number.
    const value = Math.max(lower, upper);
    if (max === null || value > max) max = value;
  }
  return max;
}

export function matchSeniority(title: string, tags: string[], body: string): Seniority {
  // Markers are title/tags only. A body saying "poročal boš senior razvijalcu"
  // must not exclude an otherwise junior role.
  const heading = norm([title, tags.join(' ')].join(' '));

  if (containsAny(heading, SENIOR_MARKERS).length > 0) return 'senior';
  // Junior is checked before mid so "junior/medior" resolves to the more
  // inclusive label.
  if (containsAny(heading, JUNIOR_MARKERS).length > 0) return 'junior';
  if (containsAny(heading, MID_MARKERS).length > 0) return 'mid';

  const years = maxYears(norm(body));
  if (years === null) return 'unknown';
  if (years >= 5) return 'senior';
  if (years >= 3) return 'mid';
  return 'junior';
}

export function classify(job: RawJob): Classification {
  return {
    roleMatch: matchRole(job.title, job.tags, job.description),
    seniority: matchSeniority(job.title, job.tags, job.description),
  };
}

export function isWanted(c: Classification): boolean {
  return c.roleMatch.length > 0 && c.seniority !== 'senior';
}
