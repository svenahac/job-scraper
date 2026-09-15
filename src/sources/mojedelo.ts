import type { RawJob, Source } from '../types.js';
import { fetchJson, fetchText, sleep, stripHtml, REQUEST_DELAY_MS } from '../http.js';
import { matchAreas } from '../classify.js';
import { PRIMARY_LOCATIONS } from '../profile.js';

const API = 'https://api.mojedelo.com';
const CONFIG_URL = `${API}/uploaded-files/config/www.mojedelo.com/jb.globals.js`;
const SITE = 'https://www.mojedelo.com';

/**
 * The categories where L&D, HR, project-coordination, adult-education and
 * communications roles are actually filed. IT is deliberately gone.
 */
export const CATEGORY_IDS: readonly string[] = [
  'e917f193-c49f-4e28-85ab-5c0746f1df19', // Kadri, HR
  '5022c5c2-029d-4949-a69a-9e156f82747d', // Izobraževanje, Prevajanje, Coaching
  '26bed8a9-3863-40a2-a38f-ee74d2097d72', // Upravljanje, Svetovanje, Vodenje
  '307d6e8a-29c6-4950-a13d-8d1a3078a2d9', // Javni sektor, NVO, Kultura
  'c5af8f46-57bb-45e9-9e66-9cd0ebd562a0', // Marketing, Kreativa, PR, Mediji
  'c9749e1f-8619-40e6-85dd-1a091ef54730', // Administracija
  'd25129f2-66b9-4a57-a7e1-3b7c956a2ba9', // Znanost, Raziskave, Razvoj
];

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

/**
 * Search pages are cheap; the per-ad detail fetch is not. The body is worth
 * fetching for anything in the Ljubljana region, and for out-of-region ads
 * whose title already looks relevant — which is where a remote posting shows
 * itself. Everything else is skipped.
 */
export function needsDetail(item: SearchItem): boolean {
  const loc = (item.location ?? '').toLowerCase();
  if (loc && PRIMARY_LOCATIONS.some((t) => loc.includes(t))) return true;
  return matchAreas(item.title, [], '').length > 0;
}

export const mojeDeloSource: Source = {
  name: 'mojedelo',
  async fetchJobs(): Promise<RawJob[]> {
    const headers = await loadApiHeaders();

    // No region filter: the location policy is applied locally, so a remote
    // ad posted from another region is not lost at the API boundary.
    const byId = new Map<string, SearchItem>();
    for (const categoryId of CATEGORY_IDS) {
      let startFrom = 0;
      let total = Infinity;

      while (startFrom < total) {
        const page = await fetchJson<unknown>(
          `${API}/job-ads-search?jobCategoryIds=${categoryId}` +
          `&pageSize=${PAGE_SIZE}&startFrom=${startFrom}`,
          headers,
        );
        total = totalFrom(page);
        const batch = parseSearchPage(page);
        if (batch.length === 0) break;
        for (const item of batch) if (!byId.has(item.id)) byId.set(item.id, item);
        startFrom += batch.length;
        await sleep(REQUEST_DELAY_MS);
      }
    }

    const jobs: RawJob[] = [];
    for (const item of byId.values()) {
      const base = {
        source: 'mojedelo',
        sourceId: item.id,
        url: buildJobUrl(item.title, item.id),
        title: item.title,
        company: item.company,
        location: item.location,
        postedAt: item.postedAt,
        tags: [] as string[],
        employmentRaw: null,
        workTimeRaw: null,
        occupation: null,
      };

      if (!needsDetail(item)) {
        jobs.push({ ...base, description: '' });
        continue;
      }

      await sleep(REQUEST_DELAY_MS);
      const detail = await fetchJson<unknown>(`${API}/job-ads/${item.id}`, headers);
      jobs.push({ ...base, description: parseDetail(detail).description });
    }

    return jobs;
  },
};
