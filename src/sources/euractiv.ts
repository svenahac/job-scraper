import * as cheerio from 'cheerio';
import type { RawJob, Source } from '../types.js';
import { fetchJson, fetchText, sleep, stripHtml, REQUEST_DELAY_MS } from '../http.js';
import {
  countryFromLocation, isoDateOrNull, rfc822Date, stillOpen, todayInBrussels,
} from './intl-boards.js';

/**
 * Euractiv Jobs. jobs.euractiv.com now redirects to jobs.rapporteur.com, the
 * same WordPress board under Euractiv's Rapporteur brand (its REST namespace
 * is still `euractiv/v1`). robots.txt disallows only wp-admin and cart URLs.
 *
 * The board is small (about 20 live ads), so it is read whole rather than by
 * category, from two public, machine-readable endpoints and no detail pages:
 *  - the WordPress REST API: body, publish date and the structured
 *    taxonomies (experience, languages, salary band, work arrangement, job
 *    type, category, industry);
 *  - the site's own RSS job feed: company, location and deadline, which the
 *    API does not expose.
 * One API request plus two or three feed pages per run.
 */

const SITE = 'https://jobs.rapporteur.com';

export const API_URL =
  `${SITE}/wp-json/wp/v2/jobs?per_page=100&_embed=wp:term` +
  '&_fields=id,date_gmt,link,title,content,_links,_embedded';

const FEED_URL = `${SITE}/jobs/feed/`;

/** The feed serves 10 ads per page; this bounds the paging loop. */
const MAX_FEED_PAGES = 10;

export interface ApiJob {
  id: string;
  postedAt: string | null;
  url: string;
  title: string;
  /** HTML. */
  content: string;
  /** Taxonomy → term names, e.g. { experience: ['1-3 Years'], language: ['English'] }. */
  terms: Record<string, string[]>;
}

export interface FeedItem {
  id: string;
  url: string;
  title: string;
  company: string | null;
  location: string | null;
  postedAt: string | null;
  deadline: string | null;
  jobType: string | null;
  /** HTML. */
  content: string;
}

const str = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() ? v.trim() : null;

/** WordPress renders titles and term names with HTML entities ("&amp;", "&#8211;"). */
const decode = (s: string): string => stripHtml(s);

const rendered = (v: unknown): string =>
  str((v as { rendered?: unknown } | null)?.rendered) ?? '';

export function parseApiJobs(json: unknown): ApiJob[] {
  if (!Array.isArray(json)) return [];
  const out: ApiJob[] = [];
  for (const raw of json) {
    const j = (raw ?? {}) as Record<string, unknown>;
    const id = typeof j['id'] === 'number' ? String(j['id']) : str(j['id']);
    const url = str(j['link']);
    if (!id || !url) continue;

    const terms: Record<string, string[]> = {};
    const groups = (j['_embedded'] as Record<string, unknown> | undefined)?.['wp:term'];
    if (Array.isArray(groups)) {
      for (const group of groups) {
        if (!Array.isArray(group)) continue;
        for (const t of group) {
          const taxonomy = str((t as Record<string, unknown>)?.['taxonomy']);
          const name = str((t as Record<string, unknown>)?.['name']);
          if (taxonomy && name) (terms[taxonomy] ??= []).push(decode(name));
        }
      }
    }

    const date = str(j['date_gmt']);
    out.push({
      id,
      postedAt: date ? isoDateOrNull(date.slice(0, 10)) : null,
      url,
      title: decode(rendered(j['title'])),
      content: rendered(j['content']),
      terms,
    });
  }
  return out;
}

export function parseFeed(xml: string): FeedItem[] {
  if (!xml.trim()) return [];
  const $ = cheerio.load(xml, { xmlMode: true });
  const out: FeedItem[] = [];
  $('item').each((_, el) => {
    const $item = $(el);
    const field = (tag: string): string | null => str($item.children(tag).first().text());
    // <guid isPermaLink="false">https://jobs.rapporteur.com/?post_type=jobs&p=6555</guid>
    const id = /[?&]p=(\d+)/.exec(field('guid') ?? '')?.[1];
    const url = field('link');
    if (!id || !url) return;
    out.push({
      id,
      url,
      title: field('title') ?? '',
      company: field('job\\:company') ?? field('dc\\:creator'),
      location: field('job\\:location'),
      postedAt: rfc822Date(field('pubDate')),
      deadline: isoDateOrNull(field('job\\:deadline')),
      jobType: field('job\\:type'),
      content: field('content\\:encoded') ?? '',
    });
  });
  return out;
}

const NOT_APPLICABLE = /^not applicable$/i;

const termList = (terms: Record<string, string[]>, taxonomy: string): string[] =>
  (terms[taxonomy] ?? []).filter((t) => !NOT_APPLICABLE.test(t));

const joined = (values: string[]): string | null =>
  values.length > 0 ? values.join(', ') : null;

/** "Full Time" / "Part Time" describe working time; "Internship", "Freelancer" the contract. */
const WORK_TIME = /^(full|part)[\s-]?time$/i;

/**
 * One RawJob from the API record and its feed item. Either may be missing:
 * the API is authoritative for the body and taxonomies, the feed for company,
 * location and deadline.
 */
export function buildJob(api: ApiJob | null, feed: FeedItem | null): RawJob | null {
  const id = api?.id ?? feed?.id;
  const url = api?.url ?? feed?.url;
  if (!id || !url) return null;
  const terms = api?.terms ?? {};

  const jobType = termList(terms, 'job-type')[0] ?? feed?.jobType ?? null;
  const rawLocation = feed?.location ?? joined(termList(terms, 'location'));
  // "Other" is the board's placeholder for anywhere it has no city for.
  const location = rawLocation && !/^other$/i.test(rawLocation) ? rawLocation : null;

  return {
    source: 'euractiv',
    sourceId: id,
    url,
    title: api?.title || feed?.title || '',
    company: feed?.company ?? null,
    location,
    postedAt: api?.postedAt ?? feed?.postedAt ?? null,
    description: stripHtml(api?.content || feed?.content || ''),
    tags: [...termList(terms, 'job-category'), ...termList(terms, 'industries')],
    employmentRaw: jobType && !WORK_TIME.test(jobType) && !/^other$/i.test(jobType) ? jobType : null,
    workTimeRaw: jobType && WORK_TIME.test(jobType) ? jobType : null,
    occupation: null,
    deadline: feed?.deadline ?? null,
    salary: joined(termList(terms, 'salary')),
    experienceRaw: joined(termList(terms, 'experience')),
    languagesRaw: joined(termList(terms, 'language')),
    workModeRaw: joined(termList(terms, 'work-arrangement')),
    country: countryFromLocation(location),
    international: true,
  };
}

/**
 * Merges the two endpoints by WordPress post id and drops ads whose deadline
 * has passed (the board normally unpublishes those itself).
 */
export function mergeJobs(api: ApiJob[], feed: FeedItem[], today: string): RawJob[] {
  const feedById = new Map(feed.map((f) => [f.id, f]));
  const ids = [...new Set([...api.map((a) => a.id), ...feed.map((f) => f.id)])];
  const apiById = new Map(api.map((a) => [a.id, a]));
  return ids
    .map((id) => buildJob(apiById.get(id) ?? null, feedById.get(id) ?? null))
    .filter((j): j is RawJob => j !== null && stillOpen(j.deadline, today));
}

const isNotFound = (err: unknown): boolean =>
  err instanceof Error && /failed: 404\b/.test(err.message);

export const euractivSource: Source = {
  name: 'euractiv',
  async fetchJobs(): Promise<RawJob[]> {
    // A failure here throws, so the orchestrator records the source as failed
    // rather than reporting zero jobs.
    const api = parseApiJobs(await fetchJson<unknown>(API_URL));
    const wanted = new Set(api.map((a) => a.id));

    const feed: FeedItem[] = [];
    for (let page = 1; page <= MAX_FEED_PAGES; page++) {
      await sleep(REQUEST_DELAY_MS);
      let xml: string;
      try {
        xml = await fetchText(page === 1 ? FEED_URL : `${FEED_URL}?paged=${page}`);
      } catch (err) {
        // WordPress answers 404 one page past the end of a feed.
        if (page > 1 && isNotFound(err)) break;
        throw err;
      }
      const items = parseFeed(xml);
      if (items.length === 0) break;
      feed.push(...items);
      for (const it of items) wanted.delete(it.id);
      if (wanted.size === 0) break;
    }

    return mergeJobs(api, feed, todayInBrussels());
  },
};
