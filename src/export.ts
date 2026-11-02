import { writeFileSync } from 'node:fs';
import type {
  EmploymentType, Job, LocationClass, Reason, ScoreParts, Seniority, WorkMode,
} from './types.js';
import { AREAS } from './profile.js';
import { experienceLabel } from './classify.js';
import { fold } from './match.js';

/** Postings older than this are left out of the app's data file. */
export const WINDOW_DAYS = 60;

export const SOURCE_LABELS: Record<string, string> = {
  zrsz: 'Zavod RS za zaposlovanje',
  mojedelo: 'MojeDelo',
  linkedin: 'LinkedIn',
  optius: 'Optius',
  indeed: 'Indeed',
  eures: 'EURES',
  euraxess: 'EURAXESS',
  eurobrussels: 'EuroBrussels',
  euractiv: 'Euractiv Jobs',
  eucareers: 'EU Careers',
  himalayas: 'Himalayas',
};

export interface SourceStatus {
  name: string;
  label: string;
  /** Whether this run reached the source. */
  ok: boolean;
  /** Postings fetched this run. */
  count: number;
  lastOkAt: string | null;
  error: string | null;
}

export interface ExportSource {
  source: string;
  label: string;
  url: string;
}

export interface ExportJob {
  /** Stable across runs: the id of the first-seen copy. */
  id: string;
  /** Ids of every merged copy, so a saved copy is found whichever is primary. */
  ids: string[];
  title: string;
  company: string | null;
  location: string | null;
  locationClass: LocationClass;
  workMode: WorkMode;
  employmentType: EmploymentType;
  postedAt: string | null;
  deadline: string | null;
  experience: string | null;
  minYears: number | null;
  seniority: Seniority;
  salary: string | null;
  area: string;
  areas: string[];
  score: number;
  parts: ScoreParts;
  reasons: Reason[];
  /** Every portal carrying this posting; the first is the most complete. */
  sources: ExportSource[];
  firstSeenAt: string;
}

export interface ExportFile {
  generatedAt: string;
  windowDays: number;
  sources: SourceStatus[];
  areas: Array<{ key: string; label: string }>;
  jobs: ExportJob[];
}

const GENDER = /\(?\b[mfzwd]\s*\/\s*[mfzwd](?:\s*\/\s*[mfzwdx])?\b\)?/g;
const CODES = /\b(?:sifra|st\.?|dm|e\d{6}|[a-z]\d{6})\b[\s\d:,-]*/g;

/** A title reduced to its words: no gender markers, codes or punctuation. */
export function titleKey(title: string): string {
  // LinkedIn appends " | <organisation>" to some titles.
  return fold(title.split(' | ')[0]!).replace(GENDER, ' ').replace(CODES, ' ').replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim().replace(/\s+/g, ' ');
}

const LEGAL = /\b(?:d\s*o\s*o|d\s*d|s\s*p|z\s*o\s*o|gmbh|ltd|inc|llc|plc|ag|sa|bv|srl)\b/g;

/** The first three words of a company name, without legal form or town. */
export function companyKey(company: string | null): string {
  if (!company) return '';
  return fold(company).replace(/[.,]/g, ' ').replace(LEGAL, ' ').replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim().split(/\s+/).slice(0, 3).join(' ');
}

const postedOrSeen = (j: Job): string => j.postedAt ?? j.firstSeenAt.slice(0, 10);

/** Company words too common to identify an employer on their own. */
const GENERIC_COMPANY = new Set([
  'univerza', 'university', 'fakulteta', 'faculty', 'republike', 'slovenije', 'slovenia',
  'ljubljani', 'ljubljana', 'zavod', 'javni', 'javno', 'drustvo', 'center', 'institut', 'skupina',
  'group', 'vlada', 'ministrstvo', 'uprava', 'agencija', 'company', 'podjetje', 'ljudska',
  'obcina', 'mestna', 'osnovna', 'srednja', 'sola', 'solski', 'zveza', 'druzba', 'holding',
  'europe', 'european', 'evropska', 'international', 'slovenija', 'gmbh',
]);

const companyTokens = (company: string | null): Set<string> => new Set(
  fold(company ?? '').replace(/[^\p{L}\p{N}]+/gu, ' ').split(' ')
    .filter((w) => w.length >= 4 && !GENERIC_COMPANY.has(w)));

/** Share of the smaller set's words found in the larger one. */
const contained = (a: Set<string>, b: Set<string>): number => {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let shared = 0;
  for (const x of small) if (large.has(x)) shared += 1;
  return small.size === 0 ? 0 : shared / small.size;
};

const jaccard = (a: Set<string>, b: Set<string>): number => {
  let shared = 0;
  for (const x of a) if (b.has(x)) shared += 1;
  const union = a.size + b.size - shared;
  return union === 0 ? 0 : shared / union;
};

/**
 * Whether two postings are the same ad on different portals. Portals reword
 * titles ("Pedagog andragog VII/2-II (šifra DM 8085) v …" against "Pedagog
 * andragog VII/2 -II v … (šifra DM 8085)") and name the employer differently
 * ("UL, Medicinska fakulteta" against "Medicinska fakulteta"), so titles are
 * compared as word sets and employers by any distinctive shared word. A long,
 * near-identical title is enough on its own.
 */
export function sameAd(a: Job, b: Job): boolean {
  if (a.source === b.source) return false;
  // Portals post the same ad within days of each other; the same title a
  // month apart is a new round of hiring.
  if (a.postedAt && b.postedAt && Math.abs(Date.parse(a.postedAt) - Date.parse(b.postedAt)) > 14 * 86_400_000) {
    return false;
  }
  const ta = new Set(titleKey(a.title).split(' ').filter(Boolean));
  const tb = new Set(titleKey(b.title).split(' ').filter(Boolean));
  // A long title wholly inside the other is the same ad with a department
  // added ("…v Prevzgojnem domu Radeče, Sektorju za tretma, Oddelku za …").
  const shorter = Math.min(ta.size, tb.size);
  if (shorter >= 7 && contained(ta, tb) >= 0.9) return true;
  return jaccard(ta, tb) >= 0.75 && sameEmployer(a.company, b.company);
}

/**
 * Whether two employer names denote the same organisation: the distinctive
 * words of the shorter name ("Medicinska fakulteta" → medicinska) all appear
 * in the longer ("UL, Medicinska fakulteta"). Two ljudske univerze in
 * different towns share only generic words, so they stay apart.
 */
export function sameEmployer(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  if (companyKey(a) === companyKey(b)) return true;
  const ta = companyTokens(a);
  const tb = companyTokens(b);
  const [small, large] = ta.size <= tb.size ? [ta, tb] : [tb, ta];
  if (small.size === 0) return false;
  for (const w of small) if (!large.has(w)) return false;
  return true;
}

const parse = <T>(json: string, fallback: T): T => {
  try { return JSON.parse(json) as T; } catch { return fallback; }
};

const EMPTY_PARTS: ScoreParts = {
  relevance: 0, experience: 0, workMode: 0, level: 0, location: 0, organisation: 0, penalty: 0,
};

/**
 * One entry per posting, however many portals carry it. The same ad on
 * ZRSZ and MojeDelo becomes one entry naming both; the richest copy (the one
 * with the longest body) supplies the details, and any copy may fill a gap.
 */
export function dedupe(jobs: Job[]): ExportJob[] {
  // Union-find over every pair: a few hundred postings, so O(n²) is fine.
  // A group holds at most one posting per portal, so two different ZRSZ ads
  // can never be chained together through one MojeDelo copy.
  const parent = jobs.map((_, i) => i);
  const sources = jobs.map((j) => new Set([j.source]));
  const root = (i: number): number => (parent[i] === i ? i : (parent[i] = root(parent[i]!)));
  for (let i = 0; i < jobs.length; i += 1) {
    for (let k = i + 1; k < jobs.length; k += 1) {
      const ri = root(i);
      const rk = root(k);
      if (ri === rk || !sameAd(jobs[i]!, jobs[k]!)) continue;
      if ([...sources[rk]!].some((s) => sources[ri]!.has(s))) continue;
      parent[rk] = ri;
      for (const s of sources[rk]!) sources[ri]!.add(s);
    }
  }
  const groups = new Map<number, Job[]>();
  jobs.forEach((j, i) => {
    const g = groups.get(root(i));
    if (g) g.push(j); else groups.set(root(i), [j]);
  });

  const out: ExportJob[] = [];
  for (const group of groups.values()) {
    const sorted = [...group].sort((a, b) =>
      b.description.length - a.description.length || b.score - a.score);
    const p = sorted[0]!;
    const pick = <K extends keyof Job>(k: K): Job[K] | null =>
      (sorted.find((j) => j[k] !== null && j[k] !== undefined && j[k] !== '')?.[k] ?? null);
    const sources: ExportSource[] = [];
    for (const j of sorted) {
      if (sources.some((s) => s.source === j.source)) continue;
      sources.push({ source: j.source, label: SOURCE_LABELS[j.source] ?? j.source, url: j.url });
    }
    const posted = sorted.map((j) => j.postedAt).filter((d): d is string => !!d).sort()[0] ?? null;
    const experienceRaw = pick('experienceRaw') as string | null;
    // The id saved and hidden postings are keyed by must not change when a
    // richer copy joins later, so it is the first-seen copy's, not the richest.
    const first = [...group].sort((a, b) =>
      a.firstSeenAt.localeCompare(b.firstSeenAt) || a.id.localeCompare(b.id))[0]!;
    out.push({
      id: first.id,
      ids: group.map((j) => j.id),
      title: p.title,
      company: p.company,
      location: p.location,
      locationClass: p.locationClass,
      workMode: p.workMode,
      employmentType: p.employmentType,
      postedAt: posted,
      deadline: pick('deadline') as string | null,
      experience: experienceLabel(experienceRaw, p.minYears),
      minYears: p.minYears,
      seniority: p.seniority,
      salary: pick('salary') as string | null,
      area: p.area,
      areas: p.areas ? p.areas.split(',') : [],
      score: Math.max(...group.map((j) => j.score)),
      parts: parse(p.scoreParts, EMPTY_PARTS),
      reasons: parse(p.reasons, [] as Reason[]),
      sources,
      firstSeenAt: sorted.map((j) => j.firstSeenAt).sort()[0]!,
    });
  }
  return out;
}

export function buildExport(jobs: Job[], sources: SourceStatus[], now: string): ExportFile {
  const cutoff = new Date(new Date(now).getTime() - WINDOW_DAYS * 86_400_000)
    .toISOString().slice(0, 10);
  const recent = jobs.filter((j) => postedOrSeen(j) >= cutoff);
  const merged = dedupe(recent).sort((a, b) =>
    b.score - a.score || (b.postedAt ?? '').localeCompare(a.postedAt ?? ''));
  return {
    generatedAt: now,
    windowDays: WINDOW_DAYS,
    sources,
    areas: AREAS.map((a) => ({ key: a.key, label: a.label })),
    jobs: merged,
  };
}

export function writeExport(path: string, file: ExportFile): void {
  writeFileSync(path, `${JSON.stringify(file, null, 1)}\n`, 'utf8');
}
