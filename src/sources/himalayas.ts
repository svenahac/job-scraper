import type { RawJob, Source } from '../types.js';
import { fetchJson, sleep, stripHtml, REQUEST_DELAY_MS } from '../http.js';
import { SEARCH_TERMS_EN } from '../profile.js';

/**
 * Himalayas (himalayas.app), a remote-only board with an official public jobs
 * API. Its terms (himalayas.app/terms, clause 113) allow personal use on
 * condition that:
 *  - every Apply link is the API's `applicationLink`, unchanged, so `url` is
 *    exactly that (a himalayas.app job page, which also names Himalayas as the
 *    source);
 *  - jobs are shown only on sites and apps the user operates, never passed on
 *    to other job boards, aggregators or search engines;
 *  - job data is cached, request limits are respected, and expired jobs are
 *    removed.
 *
 * Without a key, every caller shares one public allowance. A free key (set
 * HIMALAYAS_API_KEY) raises it to 60 requests a minute and 10,000 a day.
 */

const SEARCH_API = 'https://himalayas.app/jobs/api/search';

/** Postings last updated longer ago than this are dropped. */
export const MAX_AGE_DAYS = 30;

/** Hard cap on requests per run, however long SEARCH_TERMS_EN grows. */
export const MAX_QUERIES = 20;

/**
 * Slovenia is UTC+1 in winter and UTC+2 in summer. A timezone restriction is
 * workable when it allows an offset within three hours of either.
 */
const TZ_MIN = -2;
const TZ_MAX = 5;

export interface Country {
  name: string;
  /** ISO 3166-1 alpha-2, when the API supplies it. */
  alpha2: string | null;
}

/** One job from the search API, normalised to the fields the adapter uses. */
export interface HimalayasJob {
  guid: string;
  title: string;
  companyName: string | null;
  employmentType: string | null;
  seniority: string[];
  minSalary: number | null;
  maxSalary: number | null;
  currency: string | null;
  salaryPeriod: string | null;
  /** Empty means open worldwide. */
  locationRestrictions: Country[];
  /** UTC offsets in hours. Empty means no timezone requirement. */
  timezoneRestrictions: number[];
  categories: string[];
  parentCategories: string[];
  /** HTML. */
  description: string;
  /** Unix seconds of the last update, which is not always the first posting. */
  pubDate: number | null;
  /** Unix seconds of the latest the job stays listed. */
  expiryDate: number | null;
  applicationLink: string;
}

/**
 * The topic queries for one run: SEARCH_TERMS_EN, de-duplicated without regard
 * to case and capped at MAX_QUERIES.
 */
export function searchTerms(terms: readonly string[] = SEARCH_TERMS_EN): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of terms) {
    const term = raw.trim();
    const key = term.toLowerCase();
    if (!term || seen.has(key)) continue;
    seen.add(key);
    out.push(term);
  }
  return out.slice(0, MAX_QUERIES);
}

/**
 * The country filter keeps jobs open to candidates in Slovenia, worldwide ones
 * included. The default `relevant` sort puts title matches first; `recent` adds
 * nothing because Himalayas bumps pubDate on every daily refresh.
 */
export function buildSearchUrl(term: string): string {
  const params = new URLSearchParams({ q: term, country: 'Slovenia', sort: 'relevant' });
  return `${SEARCH_API}?${params.toString()}`;
}

const str = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() ? v.trim() : null;

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.map(str).filter((s): s is string => s !== null) : [];

/**
 * The documented schema has {alpha2, name, slug} objects; the live API sends
 * plain country names. Both are accepted.
 */
function toCountry(v: unknown): Country | null {
  if (typeof v === 'string') return v.trim() ? { name: v.trim(), alpha2: null } : null;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    const name = str(o['name']) ?? str(o['slug']) ?? str(o['alpha2']);
    return name ? { name, alpha2: str(o['alpha2'])?.toUpperCase() ?? null } : null;
  }
  return null;
}

/** Accepts 1, -3.5, "UTC+1", "UTC-5", "UTC+05:30" and "+5:45". */
export function parseUtcOffset(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const m = /^\s*(?:UTC|GMT)?\s*([+-]?)(\d{1,2})(?::(\d{2}))?\s*$/i.exec(v);
  if (!m) return null;
  const hours = Number(m[2]) + Number(m[3] ?? 0) / 60;
  return m[1] === '-' ? -hours : hours;
}

export function parseSearchPage(json: unknown): HimalayasJob[] {
  const jobs = (json as { jobs?: unknown })?.jobs;
  if (!Array.isArray(jobs)) return [];
  const out: HimalayasJob[] = [];
  for (const raw of jobs) {
    const j = (raw ?? {}) as Record<string, unknown>;
    const guid = str(j['guid']);
    const title = str(j['title']);
    if (!guid || !title) continue;
    out.push({
      guid,
      title,
      companyName: str(j['companyName']),
      employmentType: str(j['employmentType']),
      seniority: strings(j['seniority']),
      minSalary: num(j['minSalary']),
      maxSalary: num(j['maxSalary']),
      currency: str(j['currency']),
      salaryPeriod: str(j['salaryPeriod']),
      locationRestrictions: Array.isArray(j['locationRestrictions'])
        ? j['locationRestrictions'].map(toCountry).filter((c): c is Country => c !== null)
        : [],
      timezoneRestrictions: Array.isArray(j['timezoneRestrictions'])
        ? j['timezoneRestrictions'].map(parseUtcOffset).filter((n): n is number => n !== null)
        : [],
      categories: strings(j['categories']),
      parentCategories: strings(j['parentCategories']),
      description: typeof j['description'] === 'string' ? j['description'] : '',
      pubDate: num(j['pubDate']),
      expiryDate: num(j['expiryDate']),
      applicationLink: str(j['applicationLink']) ?? guid,
    });
  }
  return out;
}

const isSlovenia = (c: Country): boolean =>
  c.alpha2 === 'SI' || /^(slovenia|slovenija|si)$/i.test(c.name);

/** Used only to word the location; eligibility never depends on it. */
const EUROPE: ReadonlySet<string> = new Set([
  'albania', 'andorra', 'armenia', 'austria', 'azerbaijan', 'belarus', 'belgium',
  'bosnia and herzegovina', 'bulgaria', 'croatia', 'cyprus', 'czechia', 'czech republic',
  'denmark', 'estonia', 'faroe islands', 'finland', 'france', 'georgia', 'germany',
  'gibraltar', 'greece', 'guernsey', 'holy see (vatican city state)', 'vatican city',
  'hungary', 'iceland', 'ireland', 'isle of man', 'italy', 'jersey', 'kosovo', 'latvia',
  'liechtenstein', 'lithuania', 'luxembourg', 'malta', 'moldova', 'monaco', 'montenegro',
  'netherlands', 'north macedonia', 'norway', 'poland', 'portugal', 'romania', 'russia',
  'san marino', 'serbia', 'slovakia', 'slovenia', 'spain', 'svalbard and jan mayen',
  'sweden', 'switzerland', 'turkey', 'türkiye', 'ukraine', 'united kingdom', 'åland islands',
]);

/**
 * The candidate-location restriction as a short phrase for the classifier:
 * "Worldwide", "Europe", a short country list, or "148 countries incl. Slovenia".
 * The word "Slovenia" appears only when Slovenia really is allowed.
 */
export function describeLocation(countries: readonly Country[]): string {
  if (countries.length === 0) return 'Worldwide';
  const names = countries.map((c) => c.name);
  if (names.length <= 5) return names.join(', ');
  const n = names.length;
  if (!countries.some(isSlovenia)) return `${n} countries: ${names.slice(0, 3).join(', ')}, …`;
  if (names.every((name) => EUROPE.has(name.toLowerCase()))) {
    return n >= 40 ? 'Europe' : `Europe (${n} countries incl. Slovenia)`;
  }
  return `${n} countries incl. Slovenia`;
}

/** Open to a candidate living in Slovenia, by country and by timezone. */
export function isOpenToSlovenia(job: HimalayasJob): boolean {
  const byCountry =
    job.locationRestrictions.length === 0 || job.locationRestrictions.some(isSlovenia);
  const byTimezone =
    job.timezoneRestrictions.length === 0 ||
    job.timezoneRestrictions.some((tz) => tz >= TZ_MIN && tz <= TZ_MAX);
  return byCountry && byTimezone;
}

/** Updated within maxAgeDays and not yet past its listing expiry. */
export function isFresh(job: HimalayasJob, now: Date, maxAgeDays = MAX_AGE_DAYS): boolean {
  const nowSec = now.getTime() / 1000;
  if (job.expiryDate !== null && job.expiryDate < nowSec) return false;
  if (job.pubDate === null) return false;
  return nowSec - job.pubDate <= maxAgeDays * 86_400;
}

const PERIODS: Readonly<Record<string, string>> = {
  annual: 'year', yearly: 'year', monthly: 'month', weekly: 'week', daily: 'day', hourly: 'hour',
};

const amount = (n: number): string => n.toLocaleString('en-US', { maximumFractionDigits: 2 });

/** e.g. "54,500–62,000 USD/year". Null when no amount is published. */
export function formatSalary(job: HimalayasJob): string | null {
  const { minSalary: min, maxSalary: max } = job;
  if (min === null && max === null) return null;
  let range: string;
  if (min !== null && max !== null) range = min === max ? amount(min) : `${amount(min)}–${amount(max)}`;
  else if (min !== null) range = `from ${amount(min)}`;
  else range = `up to ${amount(max!)}`;
  const currency = job.currency ? ` ${job.currency}` : '';
  const period = job.salaryPeriod ? `/${PERIODS[job.salaryPeriod.toLowerCase()] ?? job.salaryPeriod}` : '';
  return `${range}${currency}${period}`;
}

/**
 * The guid is the job's canonical Himalayas URL,
 * https://himalayas.app/companies/<company>/jobs/<slug>; its path is the id.
 */
export function sourceIdFromGuid(guid: string): string {
  const m = /\/companies\/([^/?#]+)\/jobs\/([^/?#]+)/.exec(guid);
  return m ? `${m[1]}/${m[2]}` : guid;
}

const humanise = (category: string): string => category.replace(/-/g, ' ').trim();

export function toRawJob(job: HimalayasJob): RawJob {
  const onlySlovenia =
    job.locationRestrictions.length === 1 && isSlovenia(job.locationRestrictions[0]!);
  const isWorkTime = job.employmentType !== null && /^(full|part)[ -]?time$/i.test(job.employmentType);
  return {
    source: 'himalayas',
    sourceId: sourceIdFromGuid(job.guid),
    // Required unchanged by the API terms: it is the Himalayas job page.
    url: job.applicationLink,
    title: job.title,
    company: job.companyName,
    location: describeLocation(job.locationRestrictions),
    postedAt: job.pubDate !== null ? new Date(job.pubDate * 1000).toISOString().slice(0, 10) : null,
    description: stripHtml(job.description),
    // Only the broad functions. `categories` are machine-made lists of related
    // job titles ("Learning-And-Development-Manager" on a mid-level role) that
    // would mislead seniority and area matching on tags.
    tags: [...job.parentCategories],
    employmentRaw: isWorkTime ? null : job.employmentType,
    workTimeRaw: isWorkTime ? job.employmentType : null,
    // The first category is the board's own job-title classification.
    occupation: job.categories[0] ? humanise(job.categories[0]) : null,
    // expiryDate is when the listing lapses, not an employer deadline.
    deadline: null,
    salary: formatSalary(job),
    // The board's own level, e.g. "Mid-level" or "Entry-level, Mid-level".
    experienceRaw: job.seniority.length > 0 ? job.seniority.join(', ') : null,
    languagesRaw: null,
    workModeRaw: 'Remote',
    country: onlySlovenia ? 'SI' : null,
  };
}

/** Keeps postings open to Slovenia and fresh, mapped to RawJob. */
export function selectJobs(jobs: Iterable<HimalayasJob>, now: Date): RawJob[] {
  const out: RawJob[] = [];
  for (const job of jobs) {
    if (isOpenToSlovenia(job) && isFresh(job, now)) out.push(toRawJob(job));
  }
  return out;
}

function authHeaders(): Record<string, string> {
  const key = process.env['HIMALAYAS_API_KEY']?.trim();
  return key ? { Authorization: `Bearer ${key}` } : {};
}

export const himalayasSource: Source = {
  name: 'himalayas',
  async fetchJobs(): Promise<RawJob[]> {
    const headers = authHeaders();
    const byGuid = new Map<string, HimalayasJob>();
    let succeeded = 0;
    let lastError: unknown = null;

    // First page only, one request per term: with nightly runs the newest
    // matches always land on it, and deeper pages are mostly body-only hits.
    for (const [i, term] of searchTerms().entries()) {
      if (i > 0) await sleep(REQUEST_DELAY_MS);
      try {
        const page = await fetchJson<unknown>(buildSearchUrl(term), headers);
        succeeded++;
        for (const job of parseSearchPage(page)) if (!byGuid.has(job.guid)) byGuid.set(job.guid, job);
      } catch (err) {
        lastError = err;
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`[himalayas] query "${term}" failed: ${message}`);
        // Rate-limited: the rest would fail too, and retrying only digs deeper.
        if (/\b429\b/.test(message)) break;
      }
    }

    if (succeeded === 0) {
      throw lastError instanceof Error ? lastError : new Error('himalayas: every query failed');
    }
    return selectJobs(byGuid.values(), new Date());
  },
};
