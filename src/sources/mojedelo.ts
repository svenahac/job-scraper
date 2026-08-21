import type { RawJob, Source } from '../types.js';
import { fetchJson, fetchText, sleep, stripHtml, REQUEST_DELAY_MS } from '../http.js';

const API = 'https://api.mojedelo.com';
const CONFIG_URL = `${API}/uploaded-files/config/www.mojedelo.com/jb.globals.js`;
const SITE = 'https://www.mojedelo.com';

/** Programiranje / IT. */
const JOB_CATEGORY_ID = '64f003ff-6d8b-4be0-b58c-4580e4eeeb8a';
/** Osrednjeslovenska. */
const REGION_ID = 'd1dce9b1-9fa4-438b-b582-10d371d442e6';

const PAGE_SIZE = 50;

export interface SearchItem {
  id: string;
  title: string;
  company: string | null;
  location: string | null;
  postedAt: string | null;
}

interface ApiHeaders extends Record<string, string> {
  tenantId: string;
  channelId: string;
  languageId: string;
}

/**
 * The API rejects requests without tenantId/channelId/languageId. All three are
 * published in the site's own config file, so they are read at runtime rather
 * than hardcoded — a rotation on their side then does not break the scraper.
 */
export async function loadApiHeaders(): Promise<ApiHeaders> {
  const js = await fetchText(CONFIG_URL);
  const pick = (re: RegExp, label: string): string => {
    const m = re.exec(js);
    if (!m?.[1]) throw new Error(`mojedelo config: could not read ${label}`);
    return m[1];
  };
  return {
    tenantId: pick(/"tenantId"\s*:\s*"([0-9a-f-]{36})"/, 'tenantId'),
    channelId: pick(/"jbChannelId"\s*:\s*"([0-9a-f-]{36})"/, 'jbChannelId'),
    languageId: pick(/"languages"\s*:\s*\[\s*\{\s*"id"\s*:\s*"([0-9a-f-]{36})"/, 'languageId'),
  };
}

interface RawSearchResponse {
  data?: { items?: unknown[]; total?: number };
}

export function parseSearchPage(json: unknown): SearchItem[] {
  const items = (json as RawSearchResponse)?.data?.items ?? [];
  return items.map((raw) => {
    const it = raw as Record<string, any>;
    const startDate: string | undefined = it['startDate'];
    return {
      id: String(it['id']),
      title: String(it['title'] ?? '').trim(),
      company: it['company']?.name ? String(it['company'].name) : null,
      location: it['town']?.name ? String(it['town'].name) : null,
      postedAt: startDate ? startDate.slice(0, 10) : null,
    };
  });
}

export function parseDetail(json: unknown): { description: string } {
  const d = ((json as Record<string, any>)?.['data'] ?? json) as Record<string, any>;
  // weExpect holds the requirements, which is where years-of-experience lives.
  const html = [d?.['jobDescription'], d?.['weExpect']].filter(Boolean).join(' ');
  return { description: stripHtml(String(html)) };
}

const slugify = (s: string): string =>
  s.toLowerCase()
    .replace(/[čć]/g, 'c').replace(/š/g, 's').replace(/ž/g, 'z').replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

export function buildJobUrl(title: string, id: string): string {
  return `${SITE}/job-ad/${slugify(title)}/${id}`;
}

export function totalFrom(json: unknown): number {
  return (json as RawSearchResponse)?.data?.total ?? 0;
}

export const mojeDeloSource: Source = {
  name: 'mojedelo',
  async fetchJobs(): Promise<RawJob[]> {
    const headers = await loadApiHeaders();
    const query = `jobCategoryIds=${JOB_CATEGORY_ID}&regionIds=${REGION_ID}`;

    const items: SearchItem[] = [];
    let startFrom = 0;
    let total = Infinity;

    while (startFrom < total) {
      const page = await fetchJson<unknown>(
        `${API}/job-ads-search?${query}&pageSize=${PAGE_SIZE}&startFrom=${startFrom}`,
        headers,
      );
      total = totalFrom(page);
      const batch = parseSearchPage(page);
      if (batch.length === 0) break;
      items.push(...batch);
      startFrom += batch.length;
      await sleep(REQUEST_DELAY_MS);
    }

    const jobs: RawJob[] = [];
    for (const item of items) {
      await sleep(REQUEST_DELAY_MS);
      const detail = await fetchJson<unknown>(`${API}/job-ads/${item.id}`, headers);
      jobs.push({
        source: 'mojedelo',
        sourceId: item.id,
        url: buildJobUrl(item.title, item.id),
        title: item.title,
        company: item.company,
        location: item.location,
        postedAt: item.postedAt,
        description: parseDetail(detail).description,
        tags: [],
      });
    }

    return jobs;
  },
};
