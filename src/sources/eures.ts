import type { FetchContext, RawJob, Source } from '../types.js';
import { fetchJson, postJson, sleep, stripHtml } from '../http.js';
import { worthDetail } from '../classify.js';

/**
 * EURES, the EU job-mobility portal (europa.eu/eures), through the public JSON
 * API its own Angular frontend calls: no login, no key, no CAPTCHA.
 *  - robots.txt (europa.eu) disallows nothing under /eures/, but its
 *    `User-agent: *` group carries `Crawl-delay: 10`, honoured below.
 *  - The legal notice authorises re-use provided the European Labour
 *    Authority (ELA) is acknowledged as the source.
 *
 * Scope. Nearly every Slovenian vacancy on EURES is ZRSZ's own, mirrored
 * through connection point 14 under ZRSZ's idDelovnoMesto (3,562 of 3,566 on
 * 2026-11-02), and the zrsz source already has those with richer data. They
 * are dropped here. What EURES adds on top:
 *  - vacancies anywhere in the EU whose title offers remote work or telework
 *    and also names one of the seeker's topics;
 *  - Slovenian vacancies published by other countries' services (Croatia's
 *    HZZ, Germany's BA…) on that same topic filter.
 */

const API = 'https://europa.eu/eures/api/jv-searchengine/public';
const SEARCH_URL = `${API}/jv-search/search`;
const PORTAL = 'https://europa.eu/eures/portal';

/** robots.txt Crawl-delay for europa.eu, applied between every two requests. */
export const EURES_DELAY_MS = 10_000;
/** The API's maximum; it answers 400 to anything larger. */
export const PAGE_SIZE = 50;
/** Per query. A week of either query is one or two pages. */
export const MAX_PAGES = 3;
/**
 * Detail requests per run. Only titles worthDetail() accepts are fetched
 * (about one a night), each once; the cap bounds the first run.
 */
export const MAX_DETAILS_PER_RUN = 8;
/** ZRSZ's connection point. Its postings are already covered by the zrsz source. */
export const ZRSZ_CONNECTION_POINT = 14;

/**
 * The search matches every keyword entry (AND), but the words inside one
 * entry fuzzily and independently (OR), in the vacancy's own language. Hence
 * single words, not phrases, and one entry per concept.
 */
export const REMOTE_TERMS: readonly string[] = [
  'remote', 'telework', 'teleworking', 'homeoffice', 'télétravail', 'thuiswerken',
  'teletrabajo', 'telelavoro',
];

export const TOPIC_TERMS_EN: readonly string[] = [
  'learning', 'training', 'trainer', 'education', 'educational', 'teaching', 'teacher',
  'instructional', 'curriculum', 'didactic', 'e-learning', 'elearning', 'edtech', 'lms',
  'course', 'programme', 'program', 'coordinator', 'project', 'projects',
];

export const TOPIC_TERMS_SL: readonly string[] = [
  'izobraževanje', 'izobraževanj', 'usposabljanje', 'andragog', 'koordinator',
  'koordinatorica', 'projektni', 'projektov', 'programov', 'trener', 'predavatelj',
  'e-izobraževanje',
];

interface Keyword {
  keyword: string;
  specificSearchCode: 'TITLE' | 'EVERYWHERE';
}

export interface SearchQuery {
  name: string;
  keywords: Keyword[];
  /** Lower-case country codes; empty for all of EURES. */
  locationCodes: string[];
}

const inTitle = (terms: readonly string[]): Keyword =>
  ({ keyword: terms.join(' '), specificSearchCode: 'TITLE' });

export const QUERIES: readonly SearchQuery[] = [
  {
    name: 'slovenia',
    keywords: [inTitle([...TOPIC_TERMS_EN, ...TOPIC_TERMS_SL])],
    locationCodes: ['si'],
  },
  {
    name: 'remote',
    keywords: [inTitle(REMOTE_TERMS), inTitle(TOPIC_TERMS_EN)],
    locationCodes: [],
  },
];

/** The request body the portal itself sends; a week back covers missed nights. */
export function buildSearchBody(q: SearchQuery, page: number): Record<string, unknown> {
  return {
    resultsPerPage: PAGE_SIZE,
    page,
    sortSearch: 'MOST_RECENT',
    keywords: q.keywords,
    publicationPeriod: 'LAST_WEEK',
    occupationUris: [],
    skillUris: [],
    requiredExperienceCodes: [],
    positionScheduleCodes: [],
    sectorCodes: [],
    educationAndQualificationLevelCodes: [],
    positionOfferingCodes: [],
    locationCodes: q.locationCodes,
    euresFlagCodes: [],
    otherBenefitsCodes: [],
    requiredLanguages: [],
    minNumberPost: null,
  };
}

export function buildDetailUrl(id: string): string {
  return `${API}/jv/id/${encodeURIComponent(id)}?requestLang=en&preferredLang=en`;
}

/** The portal's own job page. */
export function buildJobUrl(id: string): string {
  return `${PORTAL}/jv-se/jv-details/${encodeURIComponent(id)}?lang=en`;
}

/** One vacancy of a search page. */
export interface EuresItem {
  sourceId: string;
  title: string;
  company: string | null;
  location: string | null;
  country: string | null;
  postedAt: string | null;
  /** The list already carries the advert body, as HTML. */
  description: string;
  employmentRaw: string | null;
  workTimeRaw: string | null;
  connectionPoint: number | null;
}

/** Fields only the detail endpoint has. */
export interface EuresDetail {
  description: string;
  deadline: string | null;
  salary: string | null;
  experienceRaw: string | null;
  languagesRaw: string | null;
  workModeRaw: string | null;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** Trimmed text with control characters (stray C1 bytes in some feeds) and runs of space collapsed. */
const clean = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const s =v.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim();
  return s.length > 0 ? s : null;
};

/** Placeholders some services put where the employer's name should be. */
const NO_EMPLOYER = new Set(['non renseigné', 'siehe beschreibung', 'not specified', 'n/a']);

const isoDate = (ms: unknown): string | null =>
  typeof ms === 'number' && Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 10) : null;

/**
 * The vacancy id is the base64 of "<reference> <connection point>", e.g.
 * "MjkyOTIzNCAxOQ" → "2929234 19" (Croatia's HZZ).
 */
export function connectionPointOf(id: string): number | null {
  const decoded = Buffer.from(id, 'base64').toString('utf8');
  const m = / (\d{1,4})$/.exec(decoded);
  return m ? Number(m[1]) : null;
}

/** NUTS codes EURES uses where ISO 3166-1 differs. */
const NUTS_TO_ISO: Record<string, string> = { EL: 'GR', UK: 'GB' };

const SLOVENIAN_REGIONS: Record<string, string> = {
  SI03: 'Vzhodna Slovenija', SI04: 'Zahodna Slovenija',
  SI031: 'Pomurska', SI032: 'Podravska', SI033: 'Koroška', SI034: 'Savinjska',
  SI035: 'Zasavska', SI036: 'Posavska', SI037: 'Jugovzhodna Slovenija',
  SI038: 'Primorsko-notranjska', SI041: 'Osrednjeslovenska', SI042: 'Gorenjska',
  SI043: 'Goriška', SI044: 'Obalno-kraška',
};

const regionNames = new Intl.DisplayNames(['en'], { type: 'region' });
const languageNames = new Intl.DisplayNames(['en'], { type: 'language' });

const countryName = (iso: string): string => {
  try {
    return regionNames.of(iso) ?? iso;
  } catch {
    return iso;
  }
};

/**
 * From the list's `locationMap`, {"SI": ["SI041"]} → "Osrednjeslovenska,
 * Slovenia". Only Slovenian regions are named (they decide Ljubljana or not);
 * elsewhere the country is enough. Taken from the list rather than the
 * detail so it is the same every night, detail fetched or not.
 */
export function describeLocation(locationMap: unknown): { location: string | null; country: string | null } {
  if (!isObj(locationMap)) return { location: null, country: null };
  const parts: string[] = [];
  let country: string | null = null;
  for (const [code, regions] of Object.entries(locationMap)) {
    const iso = NUTS_TO_ISO[code.toUpperCase()] ?? code.toUpperCase();
    if (!/^[A-Z]{2}$/.test(iso)) continue;
    country ??= iso;
    const name = countryName(iso);
    const named = iso === 'SI'
      ? [...new Set(arr(regions)
        .map((r) => (typeof r === 'string' ? SLOVENIAN_REGIONS[r.toUpperCase()] : undefined))
        .filter((r): r is string => r !== undefined))]
      : [];
    parts.push(named.length > 0 ? `${named.join(', ')}, ${name}` : name);
  }
  return { location: parts.length > 0 ? parts.join('; ') : null, country };
}

const SCHEDULE: Record<string, string> = {
  fulltime: 'Full-time', parttime: 'Part-time', flextime: 'Flexible',
};

const OFFERING: Record<string, string> = {
  apprenticeship: 'Apprenticeship', contract: 'Contract', contracttohire: 'Contract to hire',
  directhire: 'Direct hire', internship: 'Internship', oncall: 'On call',
  recruitmentreserve: 'Recruitment reserve', seasonal: 'Seasonal', selfemployed: 'Self-employed',
  temporary: 'Temporary', temporarytohire: 'Temporary to hire', volunteer: 'Volunteer',
};

/** Work schedule in EURES's own English labels; "any" says nothing and is left out. */
export function describeSchedule(codes: unknown): string | null {
  const labels = arr(codes)
    .filter((c): c is string => typeof c === 'string' && c !== 'any')
    .map((c) => SCHEDULE[c] ?? c);
  return labels.length > 0 ? labels.join(', ') : null;
}

export function describeOffering(code: unknown): string | null {
  return typeof code === 'string' && code.length > 0 ? OFFERING[code] ?? code : null;
}

export function parseSearchPage(json: unknown): { total: number; items: EuresItem[] } {
  const body = isObj(json) ? json : {};
  const total = typeof body['numberRecords'] === 'number' ? body['numberRecords'] : 0;
  const items: EuresItem[] = [];
  for (const raw of arr(body['jvs'])) {
    if (!isObj(raw) || typeof raw['id'] !== 'string' || raw['id'].length === 0) continue;
    const id = raw['id'];
    const employer = isObj(raw['employer']) ? clean(raw['employer']['name']) : null;
    const { location, country } = describeLocation(raw['locationMap']);
    items.push({
      sourceId: id,
      title: clean(raw['title']) ?? '',
      company: employer && !NO_EMPLOYER.has(employer.toLowerCase()) ? employer : null,
      location,
      country,
      postedAt: isoDate(raw['creationDate']),
      description: typeof raw['description'] === 'string' ? raw['description'] : '',
      employmentRaw: describeOffering(raw['positionOfferingCode']),
      workTimeRaw: describeSchedule(raw['positionScheduleCodes']),
      connectionPoint: connectionPointOf(id),
    });
  }
  return { total, items };
}

/** ZRSZ's mirror is covered by the zrsz source; a vacancy found by both queries is kept once. */
export function selectItems(items: Iterable<EuresItem>): EuresItem[] {
  const byId = new Map<string, EuresItem>();
  for (const it of items) {
    if (it.connectionPoint === ZRSZ_CONNECTION_POINT || byId.has(it.sourceId)) continue;
    byId.set(it.sourceId, it);
  }
  return [...byId.values()];
}

const INTERVAL: Record<string, string> = {
  hour: 'per hour', day: 'per day', week: 'per week', twoweeks: 'per 2 weeks',
  halfmonth: 'per half month', month: 'per month', twomonths: 'per 2 months',
  quarter: 'per quarter', halfyear: 'per half year', year: 'per year', once: 'one time',
};

const amount = (v: unknown): string | null =>
  typeof v === 'number' && Number.isFinite(v) && v > 0
    ? v.toLocaleString('en-US', { maximumFractionDigits: 2 })
    : null;

/** "1,473–1,733.33 EUR per month"; falls back to the package's own wording. */
export function formatSalary(pkg: unknown): string | null {
  if (!isObj(pkg)) return null;
  const out: string[] = [];
  for (const s of arr(pkg['salaries'])) {
    if (!isObj(s)) continue;
    const min = amount(s['minimumSalary']);
    const max = amount(s['maximumSalary']);
    const range = min && max ? (min === max ? min : `${min}–${max}`)
      : min ? `from ${min}` : max ? `up to ${max}` : null;
    if (!range) continue;
    const currency = typeof s['currencyCode'] === 'string' ? ` ${s['currencyCode']}` : '';
    const code = typeof s['payingIntervalCode'] === 'string' ? s['payingIntervalCode'] : null;
    const interval = code ? ` ${INTERVAL[code] ?? `per ${code}`}` : '';
    out.push(`${range}${currency}${interval}`);
  }
  if (out.length > 0) return out.join('; ');
  return typeof pkg['description'] === 'string' ? clean(stripHtml(pkg['description'])) : null;
}

const plural = (n: number, unit: string): string => `${n} ${unit}${n === 1 ? '' : 's'}`;

/**
 * Required experience as "1 year" or "6 months". Whole years when a year or
 * more (rounded down: the lower bound), since classify reads "12 months" as
 * under a year.
 */
export function formatExperience(profile: Obj): string | null {
  let months = 0;
  for (const e of arr(profile['requiredExperiences'])) {
    if (!isObj(e) || !isObj(e['measure'])) continue;
    const value = e['measure']['value'];
    const unit = e['measure']['unitCode'];
    if (typeof value !== 'number' || !(value > 0)) continue;
    const m = unit === 'year' ? value * 12 : unit === 'month' ? value : 0;
    months = Math.max(months, m);
  }
  const years = profile['requiredYearsOfExperience'];
  if (typeof years === 'number' && years > 0) months = Math.max(months, years * 12);
  if (months <= 0) return null;
  return months < 12 ? plural(Math.round(months), 'month') : plural(Math.floor(months / 12), 'year');
}

const CEFR = ['a1', 'a2', 'b1', 'b2', 'c1', 'c2'];
const higher = (a: string | null, b: unknown): string | null => {
  if (typeof b !== 'string' || !CEFR.includes(b.toLowerCase())) return a;
  const lb = b.toLowerCase();
  return a === null || CEFR.indexOf(lb) > CEFR.indexOf(a) ? lb : a;
};

/**
 * "English (B1), Dutch". A language with only a desired level is a nice-to-have
 * and kept apart: classify treats every language in languagesRaw as required.
 * One language comes once per skill (listening, reading…); the highest level
 * stated is kept.
 */
export function formatLanguages(list: unknown): { required: string | null; niceToHave: string | null } {
  const langs = new Map<string, { required: string | null; desired: string | null; any: boolean }>();
  for (const l of arr(list)) {
    if (!isObj(l) || typeof l['languageCode'] !== 'string') continue;
    const code = l['languageCode'].toLowerCase();
    const cur = langs.get(code) ?? { required: null, desired: null, any: false };
    cur.required = higher(cur.required, l['requiredSkillLevel']);
    cur.desired = higher(cur.desired, l['desiredSkillLevel']);
    if (l['requiredSkillLevel'] == null && l['desiredSkillLevel'] == null) cur.any = true;
    langs.set(code, cur);
  }
  const name = (code: string): string => {
    try {
      return languageNames.of(code) ?? code;
    } catch {
      return code;
    }
  };
  const label = (code: string, level: string | null): string =>
    level ? `${name(code)} (${level.toUpperCase()})` : name(code);
  const required: string[] = [];
  const niceToHave: string[] = [];
  for (const [code, l] of langs) {
    if (l.required || l.any) required.push(label(code, l.required));
    else niceToHave.push(label(code, l.desired));
  }
  return {
    required: required.length > 0 ? required.join(', ') : null,
    niceToHave: niceToHave.length > 0 ? niceToHave.join(', ') : null,
  };
}

/** The vacancy in its original language, plus the fields the list lacks. */
export function parseDetail(json: unknown): EuresDetail {
  const d = isObj(json) ? json : {};
  const profiles = isObj(d['jvProfiles']) ? d['jvProfiles'] : {};
  const preferred = typeof d['preferredLanguage'] === 'string' ? profiles[d['preferredLanguage']] : undefined;
  const p = isObj(preferred) ? preferred : (Object.values(profiles).find(isObj) ?? {});

  const languages = formatLanguages(p['positionLanguages']);
  const body = typeof p['description'] === 'string' ? stripHtml(p['description']) : '';
  const extra = languages.niceToHave ? `Languages (nice to have): ${languages.niceToHave}.` : '';
  return {
    description: [body, extra].filter((s) => s.length > 0).join(' '),
    deadline: isoDate(p['lastApplicationDate']),
    salary: formatSalary(p['offeredRemunerationPackage']),
    experienceRaw: formatExperience(p),
    languagesRaw: languages.required,
    // Mostly absent. A `false` is not passed on as on-site: it would override
    // a title that says "2 jours de télétravail".
    workModeRaw: p['remoteWorkAllowed'] === true ? 'Remote work possible' : null,
  };
}

/**
 * `description` follows the FetchContext contract: '' when the store already
 * has this vacancy's detail (the pipeline restores it) or when the detail is
 * still wanted but not fetched this run (so a later run fetches it).
 */
export function toRawJob(item: EuresItem, detail: EuresDetail | null, description: string): RawJob {
  return {
    source: 'eures',
    sourceId: item.sourceId,
    url: buildJobUrl(item.sourceId),
    title: item.title,
    company: item.company,
    location: item.location,
    postedAt: item.postedAt,
    description: detail?.description ?? description,
    tags: [],
    employmentRaw: item.employmentRaw,
    workTimeRaw: item.workTimeRaw,
    occupation: null,
    deadline: detail?.deadline ?? null,
    salary: detail?.salary ?? null,
    experienceRaw: detail?.experienceRaw ?? null,
    languagesRaw: detail?.languagesRaw ?? null,
    workModeRaw: detail?.workModeRaw ?? null,
    country: item.country,
  };
}

export const euresSource: Source = {
  name: 'eures',
  // Queried with publicationPeriod LAST_WEEK.
  listingDays: 7,
  async fetchJobs(ctx?: FetchContext): Promise<RawJob[]> {
    let requests = 0;
    const pause = async (): Promise<void> => {
      if (requests++ > 0) await sleep(EURES_DELAY_MS);
    };

    // 1. A week of each query, most recent first: one or two pages each.
    const found: EuresItem[] = [];
    for (const q of QUERIES) {
      for (let page = 1; page <= MAX_PAGES; page++) {
        await pause();
        const { total, items } = parseSearchPage(
          await postJson<unknown>(SEARCH_URL, buildSearchBody(q, page)));
        found.push(...items);
        if (items.length < PAGE_SIZE || page * PAGE_SIZE >= total) break;
      }
    }

    // 2. Details for the titles worth one, once each. The list body stands in
    //    for the rest, which no later run would fetch either.
    const jobs: RawJob[] = [];
    let attempted = 0;
    let deferred = 0;
    for (const item of selectItems(found)) {
      if (ctx?.hasDetail(item.sourceId)) {
        jobs.push(toRawJob(item, null, ''));
        continue;
      }
      if (!worthDetail(item.title)) {
        jobs.push(toRawJob(item, null, stripHtml(item.description)));
        continue;
      }
      if (attempted >= MAX_DETAILS_PER_RUN) {
        deferred++;
        jobs.push(toRawJob(item, null, ''));
        continue;
      }
      attempted++;
      await pause();
      let detail: EuresDetail | null = null;
      try {
        detail = parseDetail(await fetchJson<unknown>(buildDetailUrl(item.sourceId)));
      } catch (err) {
        // A vacancy withdrawn between search and detail is not worth failing
        // the source over; '' makes the next run try again.
        console.warn(`[eures] detail ${item.sourceId}: ${(err as Error).message}`);
      }
      jobs.push(toRawJob(item, detail, ''));
    }
    if (deferred > 0) {
      console.warn(`[eures] detail budget spent; ${deferred} vacancies deferred to the next run`);
    }
    return jobs;
  },
};
