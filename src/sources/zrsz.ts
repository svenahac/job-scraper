import type { FetchContext, RawJob, Source } from '../types.js';
import {
  fetchText, fetchJson, postJson, sleep, stripHtml, REQUEST_DELAY_MS,
} from '../http.js';
import { worthDetail } from '../classify.js';

const SITE = 'https://www.ess.gov.si';
const ENTRY = `${SITE}/iskalci-zaposlitve/`;
const SEARCH_PATH = '/iskalnik-po-pdm/v1/delovno-mesto/prosta-delovna-mesta-filtri';
const DETAIL_PATH = '/iskalnik-po-pdm/v1/delovno-mesto/podrobnosti-prosto-delovno-mesto';

/** The API accepts 500; all of Slovenia is then about nine requests. */
const PAGE_SIZE = 500;

/** Only postings this recent get a detail request; older ones are kept as listed. */
const DETAIL_MAX_AGE_DAYS = 45;

export interface ApiConfig {
  baseUrl: string;
  userKey: string;
}

export interface ZrszItem {
  sourceId: string;
  title: string;
  company: string | null;
  location: string | null;
  postedAt: string | null;
  employmentRaw: string | null;
  workTimeRaw: string | null;
  occupation: string | null;
}

export interface ZrszDetail {
  description: string;
  deadline: string | null;
  salary: string | null;
  experienceRaw: string | null;
  languagesRaw: string | null;
}

/**
 * Every script on the entry page, most likely config carrier first: the job
 * search dashboard, then TYPO3's compressed bundles, then the rest. The
 * config moved from a compressed TYPO3 bundle to an absolute-URL dashboard
 * script in October 2026, so neither location is assumed.
 */
export function parseBundleUrls(html: string): string[] {
  const urls = [...html.matchAll(/<script[^>]+src="([^"]+?\.js[^"]*)"/g)].map((m) => m[1]!);
  const rank = (u: string): number =>
    /iskalnik|dashboard/i.test(u) ? 0 : /typo3temp\/assets\/compressed/.test(u) ? 1
      : /jquery|bootstrap|cookieconsent|photoswipe|mdb\.min/i.test(u) ? 3 : 2;
  return [...new Set(urls)].sort((a, b) => rank(a) - rank(b));
}

/**
 * The gateway host and its public user_key are published in the site's own
 * script, so they are read at runtime rather than hardcoded — a rotation on
 * their side then does not break the scraper.
 */
export function parseApiConfig(js: string): ApiConfig {
  const url = /F_dataFor3ScaleApi_url\s*=\s*"([^"]+)"/.exec(js);
  const key = /F_dataFor3ScaleApi_keyValue\s*=\s*"([^"]+)"/.exec(js);
  if (!url?.[1] || !key?.[1]) throw new Error('zrsz: bundle carries no API config');
  return { baseUrl: url[1], userKey: key[1] };
}

export async function loadApiConfig(): Promise<ApiConfig> {
  const html = await fetchText(ENTRY);
  const bundles = parseBundleUrls(html);
  if (bundles.length === 0) throw new Error('zrsz: no scripts found on the entry page');

  for (const src of bundles) {
    const js = await fetchText(new URL(src, SITE).toString());
    if (js.includes('F_dataFor3ScaleApi_keyValue')) return parseApiConfig(js);
    await sleep(REQUEST_DELAY_MS);
  }
  throw new Error('zrsz: no script carried the API config');
}

interface RawResponse {
  steviloDelovnihMest?: number;
  seznamDelovnihMest?: unknown[];
}

const text = (v: unknown): string | null => {
  const s = v == null ? '' : String(v).trim();
  return s.length > 0 ? s : null;
};

export function parseSearchPage(json: unknown): ZrszItem[] {
  const items = (json as RawResponse)?.seznamDelovnihMest ?? [];
  return items.map((rawItem) => {
    const it = rawItem as Record<string, unknown>;
    const posted = text(it['datumObjave']);
    return {
      sourceId: String(it['idDelovnoMesto'] ?? ''),
      title: String(it['nazivDelovnegaMesta'] ?? '').trim(),
      company: text(it['delodajalec']),
      location: text(it['krajDM']),
      postedAt: posted ? posted.slice(0, 10) : null,
      employmentRaw: text(it['trajanjeZaposlitve']),
      workTimeRaw: text(it['delovniCas']),
      occupation: text(it['poklic']),
    };
  });
}

/** "18. 9. 2026" → "2026-09-18"; anything else → null. */
export function parseSlovenianDate(s: string | null | undefined): string | null {
  const m = /(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})/.exec(s ?? '');
  if (!m) return null;
  return `${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}`;
}

/** The advert body and condition fields as plain text, plus the structured extras. */
export function parseDetail(json: unknown): ZrszDetail {
  const d = (json ?? {}) as Record<string, unknown>;
  const parts = [
    d['opisDelInNalog'], d['drugiPogoji'], d['ostalo'], d['ostalaPricakovanja'],
    d['izobrazba'] ? `Izobrazba: ${String(d['izobrazba'])}` : null,
    d['delovneIzkusnje'] ? `Delovne izkušnje: ${String(d['delovneIzkusnje'])}` : null,
    d['znanjeJezikov'] ? `Znanje jezikov: ${String(d['znanjeJezikov'])}` : null,
    d['racunalniskaZnanja'] ? `Računalniška znanja: ${String(d['racunalniskaZnanja'])}` : null,
    d['urnikDela'] ? `Urnik dela: ${String(d['urnikDela'])}` : null,
  ].filter(Boolean).map(String);
  return {
    description: stripHtml(parts.join(' \n ')),
    deadline: parseSlovenianDate(text(d['prijavaDo'])),
    salary: text(d['okvirnaPlaca']),
    experienceRaw: text(d['delovneIzkusnje']),
    languagesRaw: text(d['znanjeJezikov']),
  };
}

const daysAgo = (days: number, now: Date): string =>
  new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10);

/**
 * The list response has no body, and one detail request per vacancy in the
 * country would be ~4,400 requests. The body is fetched for recent postings
 * whose title is either on-topic or generic enough that the body decides
 * ("Strokovni sodelavec VII/2"), and only once: postings already stored with
 * their detail are skipped.
 */
export function needsDetail(item: ZrszItem, now: Date, ctx?: FetchContext): boolean {
  if (!item.postedAt || item.postedAt < daysAgo(DETAIL_MAX_AGE_DAYS, now)) return false;
  if (!worthDetail(item.title, item.occupation)) return false;
  return !ctx?.hasDetail(item.sourceId);
}

export function totalFrom(json: unknown): number {
  return (json as RawResponse)?.steviloDelovnihMest ?? 0;
}

export function buildJobUrl(id: string): string {
  return `${SITE}/iskalci-zaposlitve/iskanje-zaposlitve/iskanje-dela/?idp=${id}/#/pdm/${id}`;
}

const searchBody = (page: number) => ({
  nazivDelovnegaMesta: '',
  lokacija: '',
  drzave: [],
  poklicnaPodrocja: [],
  regije: [],
  stran: page,
  stZadetkov: PAGE_SIZE,
  vrniFiltre: false,
  urejevalniPojem: 0,
});

export const zrszSource: Source = {
  name: 'zrsz',
  complete: true,
  async fetchJobs(ctx?: FetchContext): Promise<RawJob[]> {
    const { baseUrl, userKey } = await loadApiConfig();
    const url = `${baseUrl}${SEARCH_PATH}?user_key=${userKey}`;
    const now = new Date();

    // Every vacancy in Slovenia is nine requests at this page size, so the
    // adapter fetches broadly and lets classify.ts decide what fits.
    const items: ZrszItem[] = [];
    let page = 1;
    let total = Infinity;

    while (items.length < total) {
      const body = await postJson<unknown>(url, searchBody(page));
      total = totalFrom(body);
      const batch = parseSearchPage(body);
      if (batch.length === 0) break;
      items.push(...batch);
      page += 1;
      await sleep(REQUEST_DELAY_MS);
    }

    const jobs: RawJob[] = [];
    for (const i of items) {
      if (i.sourceId.length === 0) continue;
      let detail: ZrszDetail | null = null;
      if (needsDetail(i, now, ctx)) {
        await sleep(REQUEST_DELAY_MS);
        const detailUrl = `${baseUrl}${DETAIL_PATH}?idDelovnoMesto=${i.sourceId}&user_key=${userKey}`;
        detail = parseDetail(await fetchJson<unknown>(detailUrl));
      }
      jobs.push({
        source: 'zrsz',
        sourceId: i.sourceId,
        url: buildJobUrl(i.sourceId),
        title: i.title,
        company: i.company,
        location: i.location,
        postedAt: i.postedAt,
        description: detail?.description ?? '',
        tags: i.occupation ? [i.occupation] : [],
        employmentRaw: i.employmentRaw,
        workTimeRaw: i.workTimeRaw,
        occupation: i.occupation,
        deadline: detail?.deadline ?? null,
        salary: detail?.salary ?? null,
        experienceRaw: detail?.experienceRaw ?? null,
        languagesRaw: detail?.languagesRaw ?? null,
        country: 'SI',
      });
    }

    return jobs;
  },
};
