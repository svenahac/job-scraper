import * as cheerio from 'cheerio';
import type { RawJob, Source } from '../types.js';
import { fetchText, sleep, REQUEST_DELAY_MS } from '../http.js';
import { leadQueryTerms } from '../profile.js';

const GUEST_API =
  'https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search';

/** LinkedIn blocks the scraper User-Agent; the guest endpoint needs a browser one. */
const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/126.0 Safari/537.36';

export interface GuestQuery {
  keywords: string;
  location: string;
}

/**
 * Every area against Ljubljana, whose search radius takes in the surrounding
 * towns. Eight requests: LinkedIn rate-limits datacenter IPs hard, so this is
 * deliberately not one query per keyword.
 */
export function buildQueries(): GuestQuery[] {
  return leadQueryTerms().map((keywords) => ({ keywords, location: 'Ljubljana, Slovenia' }));
}

export function buildQueryUrl(q: GuestQuery): string {
  const params = `keywords=${encodeURIComponent(q.keywords)}` +
    `&location=${encodeURIComponent(q.location)}&start=0`;
  return `${GUEST_API}?${params}`;
}

export interface GuestCard {
  sourceId: string;
  title: string;
  company: string | null;
  location: string | null;
  url: string;
  postedAt: string | null;
}

export function parseGuestCards(html: string): GuestCard[] {
  if (!html.trim()) return [];
  const $ = cheerio.load(html);
  const byId = new Map<string, GuestCard>();

  $('a.base-card__full-link').each((_, a) => {
    const $a = $(a);
    const href = $a.attr('href');
    if (!href) return;

    // https://si.linkedin.com/jobs/view/web-developer-at-tasty-dose-4455728200?…
    const clean = href.split('?')[0]!;
    const idMatch = /-(\d{6,})$/.exec(clean);
    if (!idMatch) return;
    const sourceId = idMatch[1]!;
    if (byId.has(sourceId)) return;

    const $card = $a.closest('.base-card, li');
    const text = (sel: string): string | null => {
      const t = $card.find(sel).first().text().trim();
      return t.length > 0 ? t : null;
    };

    byId.set(sourceId, {
      sourceId,
      title: $a.text().trim() || text('.base-search-card__title') || '',
      company: text('.base-search-card__subtitle'),
      location: text('.job-search-card__location'),
      url: clean,
      postedAt: $card.find('time').first().attr('datetime') ?? null,
    });
  });

  return [...byId.values()];
}

export const linkedInSource: Source = {
  name: 'linkedin',
  async fetchJobs(): Promise<RawJob[]> {
    const byId = new Map<string, GuestCard>();

    for (const q of buildQueries()) {
      await sleep(REQUEST_DELAY_MS);
      const url = buildQueryUrl(q);
      // A non-2xx here throws, which is correct: the orchestrator records
      // this source as failed rather than reporting zero jobs found.
      const html = await fetchText(url, { headers: { 'User-Agent': BROWSER_UA } });
      for (const card of parseGuestCards(html)) {
        if (!byId.has(card.sourceId)) byId.set(card.sourceId, card);
      }
    }

    // The guest card carries no body text, so classification gets the title,
    // the company and the location string — which is where LinkedIn states
    // remote.
    return [...byId.values()].map((c) => ({
      source: 'linkedin',
      sourceId: c.sourceId,
      url: c.url,
      title: c.title,
      company: c.company,
      location: c.location,
      postedAt: c.postedAt,
      description: '',
      tags: [],
      employmentRaw: null,
      workTimeRaw: null,
      occupation: null,
    }));
  },
};
