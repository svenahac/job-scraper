import * as cheerio from 'cheerio';
import type { FetchContext, RawJob, Source } from '../types.js';
import { fetchText, sleep, stripHtml, REQUEST_DELAY_MS } from '../http.js';
import {
  addDays, countryFromSlugTail, monthNumber, stillOpen, todayInBrussels,
} from './intl-boards.js';

/**
 * EuroBrussels (www.eurobrussels.com), EU-affairs jobs, mostly in Brussels.
 * robots.txt allows every crawler except a list of AI-training bots
 * (ClaudeBot, GPTBot, Bytespider, meta-externalagent); this scraper identifies
 * as its own user agent and falls under `User-agent: *`, which disallows
 * nothing. No published terms of use restrict automated access. Pages are
 * server-rendered, and every category page lists all its ads, unpaginated.
 *
 * The whole board is about 50 live ads. Each ad is filed under exactly one
 * workplace (on-site / hybrid / remote) and at least one experience band, so:
 *  - the three workplace pages list every ad and tag it with its work mode;
 *  - the four experience pages tag it with its experience band.
 * Seven list requests per run. The list card has title, company, city,
 * salary, a teaser, policy tags, a relative posting date and the deadline.
 *
 * Detail pages (the full ad) are fetched only for the 0–4-year bands, the
 * seeker's range — internships and 5+-year roles keep their teaser — and only
 * once per ad, at most MAX_DETAILS_PER_RUN per run.
 */

const SITE = 'https://www.eurobrussels.com';

export interface ListPage {
  path: string;
  kind: 'workplace' | 'experience';
  /** How the board labels this page, used as workModeRaw / experienceRaw. */
  label: string;
}

export const LIST_PAGES: readonly ListPage[] = [
  { path: '/jobs/on-site', kind: 'workplace', label: 'On-site' },
  { path: '/jobs/hybrid', kind: 'workplace', label: 'Hybrid' },
  { path: '/jobs/remote', kind: 'workplace', label: 'Remote' },
  { path: '/jobs/internship', kind: 'experience', label: 'Internship' },
  { path: '/jobs/0_-_2_years_experience', kind: 'experience', label: '0 - 2 Years Experience' },
  { path: '/jobs/3_-_4_years_experience', kind: 'experience', label: '3 - 4 Years Experience' },
  { path: '/jobs/5_years+_experience', kind: 'experience', label: '5 Years+ Experience' },
];

/** The experience bands worth a detail request: the seeker has 0–5 years. */
const DETAIL_BANDS: ReadonlySet<string> = new Set(['0 - 2 Years Experience', '3 - 4 Years Experience']);

export const MAX_DETAILS_PER_RUN = 25;

export interface ListCard {
  id: string;
  url: string;
  title: string;
  company: string | null;
  /** City plus country, e.g. "Brussels, Belgium". */
  location: string | null;
  country: string | null;
  salary: string | null;
  /** The card's one-paragraph summary; basic ads have none. */
  teaser: string;
  tags: string[];
  postedAt: string | null;
  deadline: string | null;
}

const clean = (s: string | undefined | null): string | null => {
  const t = (s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > 0 ? t : null;
};

/** "Posted 4 days ago", "Posted today", "Posted yesterday", "Posted 2 weeks ago". */
export function parsePosted(text: string, today: string): string | null {
  const t = text.toLowerCase();
  if (/posted\s+today/.test(t)) return today;
  if (/posted\s+yesterday/.test(t)) return addDays(today, -1);
  const m = /posted\s+(\d+)\s+(day|week|month)s?\s+ago/.exec(t);
  if (!m) return null;
  const unit = m[2] === 'week' ? 7 : m[2] === 'month' ? 30 : 1;
  return addDays(today, -Number(m[1]) * unit);
}

/**
 * The deadline as the card states it: "Deadline 19 November" (no year),
 * "3 days left", "1 day left" or "Expiring today". A yearless date takes the
 * first year in which it is no more than a week past — ads are removed once
 * they expire, so a listed deadline is never far behind today.
 */
export function parseDeadline(text: string, today: string): string | null {
  const t = text.toLowerCase();
  if (/expiring\s+today/.test(t)) return today;
  const left = /(\d+)\s+days?\s+left/.exec(t);
  if (left) return addDays(today, Number(left[1]));
  const m = /deadline\s+(\d{1,2})\s+([a-z]+)(?:\s+(\d{4}))?/.exec(t);
  if (!m) return null;
  const month = monthNumber(m[2]!);
  if (!month) return null;
  const mmdd = `${String(month).padStart(2, '0')}-${m[1]!.padStart(2, '0')}`;
  if (m[3]) return `${m[3]}-${mmdd}`;
  const year = Number(today.slice(0, 4));
  const floor = addDays(today, -7);
  for (const y of [year - 1, year, year + 1]) {
    if (`${y}-${mmdd}` >= floor) return `${y}-${mmdd}`;
  }
  return null;
}

/** Every job card on a list page, in page order, each id once. */
export function parseListPage(html: string, today: string): ListCard[] {
  if (!html.trim()) return [];
  const $ = cheerio.load(html);
  const byId = new Map<string, ListCard>();

  $('ul.searchList > li').each((_, li) => {
    const $li = $(li);
    const $a = $li.find('h3 a[href*="/job_display/"]').first();
    // /job_display/298360/Secretary_General_Caritas_Europa_Brussels_Belgium
    const m = /\/job_display\/(\d+)\/([^/?#"]*)/.exec($a.attr('href') ?? '');
    if (!m) return; // the job-alert sign-up row, ads, etc.
    const id = m[1]!;
    if (byId.has(id)) return;
    const slug = m[2]!;

    const tail = /(?:^|_)multiple_countries$/i.test(slug) ? null : countryFromSlugTail(slug);
    const city = clean($li.find('.location').first().text());
    const countryLabel = tail?.name ?? (/(?:^|_)multiple_countries$/i.test(slug) ? 'Multiple Countries' : null);
    const location = city && countryLabel && !city.toLowerCase().includes(countryLabel.toLowerCase())
      ? `${city}, ${countryLabel}`
      : city ?? countryLabel;

    const dates = clean($li.find('.postedDate').first().text()) ?? '';
    byId.set(id, {
      id,
      url: `${SITE}/job_display/${id}/${slug}`,
      title: clean($a.text()) ?? '',
      company: clean($li.find('.companyName').first().text()),
      location,
      country: tail?.code ?? null,
      salary: clean($li.find('.salary').first().text()),
      teaser: clean($li.find('p').first().text()) ?? '',
      tags: $li.find('.badge.bg-job-tag').map((_, b) => clean($(b).text())).get()
        .filter((t): t is string => t !== null),
      postedAt: parsePosted(dates, today),
      deadline: parseDeadline(dates, today),
    });
  });

  return [...byId.values()];
}

/** The ad body as plain text: everything between the page's description markers. */
export function parseDetail(html: string): { description: string } {
  const marked = /<!--\s*Job Description start\s*-->([\s\S]*?)<!--\s*Job Description end\s*-->/i
    .exec(html);
  if (marked) return { description: stripHtml(marked[1]!) };
  const $ = cheerio.load(html);
  return { description: stripHtml($('.jobDisplay').first().html() ?? '') };
}

export interface Annotated {
  card: ListCard;
  workModes: string[];
  experience: string[];
}

/** Ads with no band at all are fetched too: their level is unknown. */
export function needsDetail(experience: readonly string[]): boolean {
  return experience.length === 0 || experience.some((e) => DETAIL_BANDS.has(e));
}

export function buildJob(a: Annotated, detail: { description: string } | undefined): RawJob {
  const { card } = a;
  const bands = a.experience.filter((e) => e !== 'Internship');
  const internship = a.experience.includes('Internship');
  return {
    source: 'eurobrussels',
    sourceId: card.id,
    url: card.url,
    title: card.title,
    company: card.company,
    location: card.location,
    postedAt: card.postedAt,
    // Without a detail page the teaser stands in, except where a detail page
    // is still owed (stored already, or deferred): then '' as FetchContext asks.
    description: detail?.description ?? (needsDetail(a.experience) ? '' : card.teaser),
    tags: card.tags,
    employmentRaw: internship ? 'Internship' : null,
    workTimeRaw: null,
    occupation: null,
    deadline: card.deadline,
    salary: card.salary,
    experienceRaw: bands.length > 0 ? bands.join(', ') : internship ? 'Internship' : null,
    languagesRaw: null,
    workModeRaw: a.workModes.length > 0 ? a.workModes.join(', ') : null,
    country: card.country,
    international: true,
  };
}

/** Collects the cards of all list pages, each ad once, with its page labels. */
export function annotate(pages: ReadonlyArray<{ page: ListPage; cards: ListCard[] }>): Annotated[] {
  const byId = new Map<string, Annotated>();
  for (const { page, cards } of pages) {
    for (const card of cards) {
      let a = byId.get(card.id);
      if (!a) {
        a = { card, workModes: [], experience: [] };
        byId.set(card.id, a);
      }
      const list = page.kind === 'workplace' ? a.workModes : a.experience;
      if (!list.includes(page.label)) list.push(page.label);
    }
  }
  return [...byId.values()];
}

export const euroBrusselsSource: Source = {
  name: 'eurobrussels',
  async fetchJobs(ctx?: FetchContext): Promise<RawJob[]> {
    const today = todayInBrussels();

    // A failed list page throws: a partial board would silently drop ads.
    const pages: Array<{ page: ListPage; cards: ListCard[] }> = [];
    for (const page of LIST_PAGES) {
      if (pages.length > 0) await sleep(REQUEST_DELAY_MS);
      pages.push({ page, cards: parseListPage(await fetchText(`${SITE}${page.path}`), today) });
    }
    const ads = annotate(pages).filter((a) => stillOpen(a.card.deadline, today));

    // Newest first, so a spent budget defers the oldest ads.
    const candidates = ads
      .filter((a) => needsDetail(a.experience) && !ctx?.hasDetail(a.card.id))
      .sort((x, y) => (y.card.postedAt ?? '').localeCompare(x.card.postedAt ?? ''));

    const details = new Map<string, { description: string }>();
    for (const a of candidates.slice(0, MAX_DETAILS_PER_RUN)) {
      await sleep(REQUEST_DELAY_MS);
      try {
        details.set(a.card.id, parseDetail(await fetchText(a.card.url)));
      } catch (err) {
        // An ad withdrawn between list and detail fetch is not worth failing
        // the whole source over.
        console.warn(`[eurobrussels] detail ${a.card.id}: ${(err as Error).message}`);
      }
    }
    const deferred = candidates.length - Math.min(candidates.length, MAX_DETAILS_PER_RUN);
    if (deferred > 0) {
      console.warn(`[eurobrussels] detail budget spent; ${deferred} ads deferred to the next run`);
    }

    return ads.map((a) => buildJob(a, details.get(a.card.id)));
  },
};
