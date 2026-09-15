import type {
  EmploymentType, LocationTier, RawJob, Seniority, WorkMode,
} from './types.js';
import type { AreaKey } from './profile.js';
import {
  AREAS, BODY_WARN, CONTRACT_REJECT, HYBRID_MARKERS, PRIMARY_LOCATIONS,
  REMOTE_MARKERS, TITLE_REJECT,
} from './profile.js';

export interface Classification {
  areas: AreaKey[];
  area: AreaKey | null;
  areaRank: number;
  workMode: WorkMode;
  employmentType: EmploymentType;
  locationTier: LocationTier;
  flags: string[];
  seniority: Seniority;
  score: number;
  rejected: boolean;
}

const norm = (s: string): string => s.toLowerCase();

const containsAny = (haystack: string, needles: readonly string[]): string[] =>
  needles.filter((n) => haystack.includes(n));

/** Every area whose keywords appear in the title, tags or body. */
export function matchAreas(title: string, tags: string[], body: string): AreaKey[] {
  const all = norm([title, tags.join(' '), body].join(' \n '));
  return AREAS.filter((a) => a.keywords.some((k) => all.includes(k))).map((a) => a.key);
}

export function detectWorkMode(
  title: string, location: string | null, body: string,
): WorkMode {
  const all = norm([title, location ?? '', body].join(' '));
  // Hybrid wins: an ad naming both is almost always hybrid.
  if (containsAny(all, HYBRID_MARKERS).length > 0) return 'hybrid';
  if (containsAny(all, REMOTE_MARKERS).length > 0) return 'remote';
  return 'unknown';
}

export function detectLocationTier(
  location: string | null, workMode: WorkMode,
): LocationTier {
  const loc = norm(location ?? '');
  if (loc && containsAny(loc, PRIMARY_LOCATIONS).length > 0) return 'ljubljana';
  if (workMode === 'remote') return 'remote';
  return 'other';
}

/** "20 ur/teden", "30 hours/week". Below 35 is part-time. */
const HOURS_RE = /(\d{1,2})\s*(?:ur|hours?|h)\b/i;

export function detectEmploymentType(
  employmentRaw: string | null, workTimeRaw: string | null,
  title: string, body: string,
): EmploymentType {
  const structured = norm([employmentRaw ?? '', workTimeRaw ?? ''].join(' '));
  const all = `${structured} ${norm(title)} ${norm(body)}`;

  // Part-time is decided first: a 20 h/week permanent role still ranks as
  // part-time for this search.
  const hours = HOURS_RE.exec(structured) ?? HOURS_RE.exec(norm(body));
  if (hours && Number(hours[1]) < 35) return 'part-time';
  if (all.includes('krajši delovni čas') || all.includes('part-time') ||
      all.includes('part time')) return 'part-time';

  if (all.includes('nedoločen čas') || all.includes('permanent')) return 'permanent';
  if (all.includes('določen čas') || all.includes('fixed term') ||
      all.includes('fixed-term')) return 'fixed-term';
  return 'unknown';
}

/** Points by area rank. Index 0 is unused; rank 1 scores 40. */
const AREA_POINTS = [0, 40, 36, 32, 28, 24, 20, 16, 12] as const;

const EMPLOYMENT_POINTS: Record<EmploymentType, number> = {
  permanent: 15, 'fixed-term': 8, 'part-time': 4, unknown: 0,
};

export function scoreFor(p: {
  areaRank: number; locationTier: LocationTier; workMode: WorkMode;
  employmentType: EmploymentType; flags: string[];
}): number {
  let score = AREA_POINTS[p.areaRank] ?? 0;
  if (p.locationTier === 'ljubljana' || p.locationTier === 'remote') score += 20;
  else if (p.workMode === 'hybrid') score += 18;
  score += EMPLOYMENT_POINTS[p.employmentType];
  score -= 8 * p.flags.length;
  return Math.max(0, Math.min(100, score));
}

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

const YEARS_RE = /(\d{1,2})\s*(?:[-–—]\s*(\d{1,2}))?\s*\+?\s*(?:let(?:o|a|i)?|years?)(?![a-zščž])/gi;

function maxYears(body: string): number | null {
  let max: number | null = null;
  for (const m of body.matchAll(YEARS_RE)) {
    const lower = Number(m[1]);
    const upper = m[2] === undefined ? lower : Number(m[2]);
    const value = Math.max(lower, upper);
    if (max === null || value > max) max = value;
  }
  return max;
}

/** Informational only. Never excludes — the seeker applies regardless. */
export function matchSeniority(title: string, tags: string[], body: string): Seniority {
  const heading = norm([title, tags.join(' ')].join(' '));
  if (containsAny(heading, SENIOR_MARKERS).length > 0) return 'senior';
  if (containsAny(heading, JUNIOR_MARKERS).length > 0) return 'junior';
  if (containsAny(heading, MID_MARKERS).length > 0) return 'mid';

  const years = maxYears(norm(body));
  if (years === null) return 'unknown';
  if (years >= 5) return 'senior';
  if (years >= 3) return 'mid';
  return 'junior';
}

export function classify(job: RawJob): Classification {
  const title = norm(job.title);
  const body = job.description;

  const areas = matchAreas(job.title, job.tags, body);
  const best = AREAS.filter((a) => areas.includes(a.key))
    .sort((a, b) => a.rank - b.rank)[0];

  const flags: string[] = [];

  // A title reject loses to an area keyword in the same title: "Vodja
  // projektov prodaje" keeps its project match and carries a warning instead.
  const titleHits = containsAny(title, TITLE_REJECT);
  const titleAreaHit = matchAreas(job.title, [], '').length > 0;
  const hardTitleReject = titleHits.length > 0 && !titleAreaHit;
  if (titleHits.length > 0 && titleAreaHit) {
    flags.push(...titleHits.map((t) => `title-reject:${t}`));
  }

  // Contract rejects never read the body: "dobra praksa" is ordinary prose.
  const contractHay = norm([job.title, job.employmentRaw ?? ''].join(' '));
  const contractReject = containsAny(contractHay, CONTRACT_REJECT).length > 0;

  flags.push(...containsAny(norm(body), BODY_WARN).map((w) => `body:${w}`));

  const workMode = detectWorkMode(job.title, job.location, body);
  const locationTier = detectLocationTier(job.location, workMode);
  const employmentType = detectEmploymentType(
    job.employmentRaw ?? null, job.workTimeRaw ?? null, job.title, body,
  );
  const areaRank = best?.rank ?? 0;

  return {
    areas,
    area: best?.key ?? null,
    areaRank,
    workMode,
    employmentType,
    locationTier,
    flags,
    seniority: matchSeniority(job.title, job.tags, body),
    score: scoreFor({ areaRank, locationTier, workMode, employmentType, flags }),
    rejected: hardTitleReject || contractReject,
  };
}

export function isWanted(c: Classification): boolean {
  return c.areas.length > 0 && !c.rejected;
}
