import type { RawJob, Source } from '../types.js';
import {
  fetchText, fetchJson, postJson, sleep, stripHtml, REQUEST_DELAY_MS,
} from '../http.js';
import { inLjubljanaArea, matchAreas } from '../classify.js';

const SITE = 'https://www.ess.gov.si';
const ENTRY = `${SITE}/iskalci-zaposlitve/`;
const SEARCH_PATH = '/iskalnik-po-pdm/v1/delovno-mesto/prosta-delovna-mesta-filtri';
const DETAIL_PATH = '/iskalnik-po-pdm/v1/delovno-mesto/podrobnosti-prosto-delovno-mesto';

/** The API accepts 500; all of Slovenia is then about nine requests. */
const PAGE_SIZE = 500;

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

/** The compressed TYPO3 bundles, in page order. One of them holds the config. */
export function parseBundleUrls(html: string): string[] {
  return [...html.matchAll(/src="(\/typo3temp\/assets\/compressed\/[^"]+?\.js[^"]*)"/g)]
    .map((m) => m[1]!);
}

/**
 * The gateway host and its public user_key are published in the site's own
 * bundle, so they are read at runtime rather than hardcoded — a rotation on
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
  if (bundles.length === 0) throw new Error('zrsz: no bundles found on the entry page');

  for (const path of bundles) {
    const js = await fetchText(`${SITE}${path}`);
    if (js.includes('F_dataFor3ScaleApi_keyValue')) return parseApiConfig(js);
    await sleep(REQUEST_DELAY_MS);
  }
  throw new Error('zrsz: no bundle carried the API config');
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

/** The advert body plus the two free-text condition fields, as plain text. */
export function parseDetail(json: unknown): { description: string } {
  const d = (json ?? {}) as Record<string, unknown>;
  const parts = [d['opisDelInNalog'], d['drugiPogoji'], d['ostalo'],
                 d['delovneIzkusnje']].filter(Boolean).map(String);
  return { description: stripHtml(parts.join(' ')) };
}

/**
 * The list response has no body, and one detail request per vacancy would
 * outrun the nightly job's 30-minute timeout. The body is worth fetching
 * for Ljubljana-area ads whose title or occupation already matches an area —
 * there it adds work mode, warnings and contract detail. Everything else
 * keeps '', and classify.ts drops the out-of-area ones.
 */
export function needsDetail(item: ZrszItem): boolean {
  const tags = item.occupation ? [item.occupation] : [];
  return inLjubljanaArea(item.location) && matchAreas(item.title, tags, '').length > 0;
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
  async fetchJobs(): Promise<RawJob[]> {
    const { baseUrl, userKey } = await loadApiConfig();
    const url = `${baseUrl}${SEARCH_PATH}?user_key=${userKey}`;

    // Every vacancy in Slovenia is nine requests at this page size, so the
    // adapter fetches broadly and lets classify.ts apply the location policy.
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

    // The search API exposes no description body. Fetching a detail page per
    // vacancy for all ~4,400 postings would outrun the nightly job's timeout,
    // so the body is only fetched for ads that already look relevant.
    const jobs: RawJob[] = [];
    for (const i of items) {
      if (i.sourceId.length === 0) continue;
      let description = '';
      if (needsDetail(i)) {
        await sleep(REQUEST_DELAY_MS);
        const detailUrl = `${baseUrl}${DETAIL_PATH}?idDelovnoMesto=${i.sourceId}&user_key=${userKey}`;
        const detail = await fetchJson<unknown>(detailUrl);
        description = parseDetail(detail).description;
      }
      jobs.push({
        source: 'zrsz',
        sourceId: i.sourceId,
        url: buildJobUrl(i.sourceId),
        title: i.title,
        company: i.company,
        location: i.location,
        postedAt: i.postedAt,
        description,
        tags: i.occupation ? [i.occupation] : [],
        employmentRaw: i.employmentRaw,
        workTimeRaw: i.workTimeRaw,
        occupation: i.occupation,
      });
    }

    return jobs;
  },
};
