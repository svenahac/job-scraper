import type { FetchContext, RawJob, Source } from '../types.js';
import { fetchJson, fetchText, sleep, stripHtml, REQUEST_DELAY_MS } from '../http.js';
import { worthDetail } from '../classify.js';

const API = 'https://api.mojedelo.com';
const CONFIG_URL = `${API}/uploaded-files/config/www.mojedelo.com/jb.globals.js`;
const SITE = 'https://www.mojedelo.com';

/**
 * The categories where L&D, project-coordination, adult-education and
 * programme roles are actually filed. IT is deliberately absent.
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
  country: string | null;
  /** The site's work-mode labels, e.g. ["Hibridno (delno od doma)"]. */
  workModes: string[];
}

export interface Detail {
  description: string;
  deadline: string | null;
  salary: string | null;
  experienceRaw: string | null;
  languagesRaw: string | null;
  employmentRaw: string | null;
  workTimeRaw: string | null;
  occupation: string | null;
  tags: string[];
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

const translations = (v: unknown): string[] =>
  Array.isArray(v)
    ? v.map((x) => (x as Record<string, unknown>)?.['translation']).filter(Boolean).map(String)
    : [];

const translation = (v: unknown): string | null => {
  const t = (v as Record<string, unknown> | null)?.['translation'];
  return t ? String(t).trim() || null : null;
};

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
      postedAt: startDate ? toLocalDate(startDate) : null,
      country: it['country']?.countryCode ? String(it['country'].countryCode) : null,
      workModes: translations(it['workModes']),
    };
  });
}

/**
 * The API stores dates as UTC instants of Ljubljana midnights or end-of-days
 * ("2026-08-20T22:00:00.000Z" is 21 August), so the calendar date is taken in
 * Ljubljana time.
 */
export function toLocalDate(iso: string): string {
  return new Date(iso).toLocaleDateString('sv-SE', { timeZone: 'Europe/Ljubljana' });
}

/**
 * "Od doma" alongside an on-site label is a hybrid arrangement, not a remote
 * one; the site has no single label for that combination.
 */
export function workModeLabel(modes: string[]): string | null {
  if (modes.length === 0) return null;
  const home = modes.some((m) => /od doma/i.test(m) && !/delno/i.test(m));
  const onsite = modes.some((m) => /delovnem mestu|terenu/i.test(m));
  if (home && onsite) return 'Hibridno (delno od doma)';
  return modes.join(', ');
}

/** A published salary, or null when the ad only says it is negotiable. */
export function salaryText(v: unknown): string | null {
  const t = translation(v);
  if (!t || /dogovor|negotiable/i.test(t)) return null;
  return t;
}

export function parseDetail(json: unknown): Detail {
  const d = ((json as Record<string, any>)?.['data'] ?? json) as Record<string, any>;
  // weExpect holds the requirements, which is where years-of-experience lives.
  const html = [d?.['jobDescription'], d?.['weExpect'], d?.['weOffer']].filter(Boolean).join(' ');
  const endDate: string | undefined = d?.['endDate'];
  const language = translation(d?.['languageRequired']);
  return {
    description: stripHtml(String(html)),
    deadline: endDate ? toLocalDate(endDate) : null,
    salary: salaryText(d?.['salary']),
    experienceRaw: translation(d?.['totalWorkExperience']),
    // Slovene is the default and says nothing about the seeker's fit.
    languagesRaw: language && !/sloven/i.test(language) ? language : null,
    employmentRaw: translations(d?.['employmentTypes']).join(', ') || null,
    workTimeRaw: translation(d?.['workTime']),
    occupation: translation(d?.['occupation']),
    tags: translations(d?.['jobCategories']),
  };
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
 * The per-ad detail fetch is the expensive part. It is worth it for titles
 * that are on-topic or generic enough that the body decides, and for remote
 * or hybrid roles; and only once — postings already stored are skipped.
 */
export function needsDetail(item: SearchItem, ctx?: FetchContext): boolean {
  const flexible = item.workModes.some((m) => /doma|hibrid/i.test(m));
  if (!worthDetail(item.title) && !flexible) return false;
  return !ctx?.hasDetail(item.id);
}

export const mojeDeloSource: Source = {
  name: 'mojedelo',
  complete: true,
  async fetchJobs(ctx?: FetchContext): Promise<RawJob[]> {
    const headers = await loadApiHeaders();

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
      let detail: Detail | null = null;
      if (needsDetail(item, ctx)) {
        await sleep(REQUEST_DELAY_MS);
        detail = parseDetail(await fetchJson<unknown>(`${API}/job-ads/${item.id}`, headers));
      }
      jobs.push({
        source: 'mojedelo',
        sourceId: item.id,
        url: buildJobUrl(item.title, item.id),
        title: item.title,
        company: item.company,
        location: item.location,
        postedAt: item.postedAt,
        description: detail?.description ?? '',
        tags: detail?.tags ?? [],
        employmentRaw: detail?.employmentRaw ?? null,
        workTimeRaw: detail?.workTimeRaw ?? null,
        occupation: detail?.occupation ?? null,
        deadline: detail?.deadline ?? null,
        salary: detail?.salary ?? null,
        experienceRaw: detail?.experienceRaw ?? null,
        languagesRaw: detail?.languagesRaw ?? null,
        workModeRaw: workModeLabel(item.workModes),
        country: item.country ?? 'SI',
      });
    }

    return jobs;
  },
};
