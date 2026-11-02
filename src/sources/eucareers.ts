import * as cheerio from 'cheerio';
import type { FetchContext, RawJob, Source } from '../types.js';
import { fetchText, sleep, stripHtml, REQUEST_DELAY_MS } from '../http.js';
import {
  countryFromLocation, dayMonthYear, rfc822Date, stillOpen, todayInBrussels,
} from './intl-boards.js';

/**
 * EU Careers (eu-careers.europa.eu), the EPSO-run portal for vacancies at the
 * EU institutions and agencies — including ACER, which sits in Ljubljana.
 * robots.txt disallows only Drupal internals and /search/, none of which is
 * used here. All open vacancies (about 120) are read, since a programme or
 * project officer can sit under any career domain:
 *  - the server-rendered list /jobs_en, 20 per page, about seven pages: title,
 *    institution, deadline, contract type, grade and location;
 *  - the official RSS feed of the 30 newest vacancies: publication date,
 *    career domain, reference, standard job title and a short summary;
 *  - detail pages, only for vacancies the feed does not cover and only once
 *    each: career domain, reference, unit, summary and the vacancy-notice
 *    date. The full text is a PDF or an agency site, so it is not fetched.
 * About eight requests on a normal night; the first run also spends up to
 * MAX_DETAILS_PER_RUN detail requests on the backlog.
 */

const SITE = 'https://eu-careers.europa.eu';
const LIST_URL = `${SITE}/jobs_en`;
export const FEED_URL = `${SITE}/node/244/rss_en`;

/** Bounds the paging loop; the board has needed seven pages. */
const MAX_LIST_PAGES = 15;

export const MAX_DETAILS_PER_RUN = 25;

export interface ListItem {
  /** The URL slug without its language suffix, e.g. "hr-officer". */
  id: string;
  url: string;
  title: string;
  institution: string | null;
  deadline: string | null;
  contractType: string | null;
  grade: string | null;
  location: string | null;
}

export interface FeedItem {
  id: string;
  reference: string | null;
  postedAt: string | null;
  summary: string;
  domain: string | null;
  grades: string[];
  contractType: string | null;
  /** The portal's standard job title, e.g. "HR Officer". */
  occupation: string | null;
}

export interface Detail {
  reference: string | null;
  domain: string | null;
  unit: string | null;
  department: string | null;
  summary: string;
  /** Date of the vacancy-notice PDF, the closest thing to a publication date. */
  noticeDate: string | null;
}

const clean = (s: string | undefined | null): string | null => {
  const t = (s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > 0 ? t : null;
};

/**
 * "/jobs/hr-officer_en" or "/jobs/administrative-agent-16_fr?prefLang=en"
 * → { id: 'hr-officer', url: 'https://eu-careers.europa.eu/jobs/hr-officer_en' }.
 * Some vacancies exist only in French, so the language suffix is kept in the
 * URL but not in the id.
 */
export function parseJobHref(href: string): { id: string; url: string } | null {
  const m = /\/jobs\/([^/?#"]+?)_([a-z]{2})(?:[?#].*)?$/.exec(href.trim());
  if (!m) return null;
  return { id: m[1]!, url: `${SITE}/jobs/${m[1]}_${m[2]}` };
}

/**
 * The list shows "<standard title> - <ad title>", and the ad title often
 * starts with the standard title again: "IT Officer - IT Officer - Access
 * Management" → "IT Officer - Access Management".
 */
export function tidyTitle(title: string): string {
  const parts = title.split(' - ');
  if (parts.length > 1 && parts[0]!.trim().toLowerCase() === parts[1]!.trim().toLowerCase()) {
    return parts.slice(1).join(' - ');
  }
  return title;
}

/** One list page: its vacancies and the highest page number it links to (0-based). */
export function parseListPage(html: string): { items: ListItem[]; lastPage: number } {
  if (!html.trim()) return { items: [], lastPage: 0 };
  const $ = cheerio.load(html);
  const items: ListItem[] = [];
  const seen = new Set<string>();

  $('.eujmp-vacancy-result').each((_, el) => {
    const $card = $(el);
    const $a = $card.find('a.eujmp-vacancy-result__title').first();
    const ref = parseJobHref($a.attr('href') ?? '');
    if (!ref || seen.has(ref.id)) return;
    seen.add(ref.id);

    const $time = $card.find('.eujmp-vacancy-result__top-meta time').first();
    const deadline = dayMonthYear($time.text())
      ?? (/^\d{4}-\d{2}-\d{2}/.exec($time.attr('datetime') ?? '')?.[0] ?? null);

    // Bottom row: contract type, grade(s) when stated, and the location,
    // which is the item carrying the location icon.
    let location: string | null = null;
    const rest: string[] = [];
    $card.find('.eujmp-vacancy-result__bottom-meta > li').each((_, li) => {
      const $li = $(li);
      const text = clean($li.text());
      if (!text) return;
      if ($li.find('.eujmp-vacancy-result__location-icon').length > 0) location = text;
      else rest.push(text);
    });

    items.push({
      ...ref,
      title: tidyTitle(clean($a.text()) ?? ''),
      institution: clean($card.find('.eujmp-vacancy-result__top-meta > li').first().text()),
      deadline,
      contractType: rest[0] ?? null,
      grade: rest.length > 1 ? rest.slice(1).join(', ') : null,
      location,
    });
  });

  const pages = [...html.matchAll(/href="\?page=(\d+)"/g)].map((m) => Number(m[1]));
  return { items, lastPage: pages.length > 0 ? Math.max(...pages) : 0 };
}

/** A summary that is only a link to the agency's own vacancy page says nothing. */
const meaningful = (s: string): string => (/^https?:\/\/\S+$/.test(s.trim()) ? '' : s);

export function parseFeed(xml: string): FeedItem[] {
  if (!xml.trim()) return [];
  const $ = cheerio.load(xml, { xmlMode: true });
  const out: FeedItem[] = [];
  $('item').each((_, el) => {
    const $item = $(el);
    const ref = parseJobHref($item.children('link').first().text());
    if (!ref) return;
    const cats = (domain: string): string[] =>
      $item.children('category')
        .filter((_, c) => $(c).attr('domain') === domain)
        .map((_, c) => clean($(c).text())).get()
        .filter((t): t is string => t !== null);
    out.push({
      id: ref.id,
      reference: clean($item.children('title').first().text()),
      postedAt: rfc822Date($item.children('pubDate').first().text()),
      // The description is entity-encoded HTML.
      summary: meaningful(stripHtml($item.children('description').first().text())),
      domain: cats('Career Domain')[0] ?? null,
      grades: cats('Grade'),
      contractType: cats('Contract type')[0] ?? null,
      occupation: cats('Job title - standard')[0] ?? null,
    });
  });
  return out;
}

export function parseDetail(html: string): Detail {
  const $ = cheerio.load(html);
  const fields = new Map<string, string>();
  $('.eujmp-vacancy__details p').each((_, p) => {
    const $p = $(p);
    const label = clean($p.find('strong').first().text())?.replace(/:$/, '');
    if (!label) return;
    const value = clean($p.text().replace($p.find('strong').first().text(), ''));
    if (value) fields.set(label.toLowerCase(), value);
  });

  // Without a summary of its own the page falls back to "<title> - <agency>".
  const title = clean($('meta[property="og:title"]').attr('content'));
  const meta = clean($('meta[name="description"]').attr('content')) ?? '';
  const summary = title && meta.startsWith(`${title} - `) ? '' : meta;

  const notice = $('.ecl-file').filter((_, f) =>
    /vacancy notice/i.test($(f).find('.ecl-file__title').text())).first();

  return {
    reference: fields.get('reference') ?? null,
    domain: fields.get('domain') ?? null,
    unit: fields.get('unit') ?? null,
    department: fields.get('directorate-general or department') ?? null,
    summary,
    noticeDate: dayMonthYear(notice.find('.ecl-file__primary-meta-item').first().text()),
  };
}

/**
 * The portal has no body text of its own, so the description is the summary
 * plus the structured lines a reader (and the classifier) would look for.
 * Never empty once the feed or a detail page has been read.
 */
export function composeDescription(
  item: ListItem, feed: FeedItem | undefined, detail: Detail | undefined,
): string {
  if (!feed && !detail) return '';
  const domain = feed?.domain ?? detail?.domain;
  const reference = feed?.reference ?? detail?.reference;
  const lines = [
    feed?.summary || detail?.summary || '',
    domain ? `Domain: ${domain}.` : '',
    item.contractType ? `Contract type: ${item.contractType}.` : '',
    item.grade ? `Grade: ${item.grade}.` : '',
    detail?.unit ? `Unit: ${detail.unit}.` : '',
    detail?.department ? `Directorate-General or Department: ${detail.department}.` : '',
    reference ? `Reference: ${reference}.` : '',
  ];
  return lines.filter(Boolean).join(' ');
}

export function buildJob(item: ListItem, feed?: FeedItem, detail?: Detail): RawJob {
  const domain = feed?.domain ?? detail?.domain ?? null;
  const grade = item.grade ?? (feed && feed.grades.length > 0 ? feed.grades.join(' - ') : null);
  const contractType = item.contractType ?? feed?.contractType ?? null;
  return {
    source: 'eucareers',
    sourceId: item.id,
    url: item.url,
    title: item.title,
    company: item.institution,
    location: item.location,
    postedAt: feed?.postedAt ?? detail?.noticeDate ?? null,
    description: composeDescription(item, feed, detail),
    tags: [domain, contractType].filter((t): t is string => t !== null),
    employmentRaw: contractType,
    workTimeRaw: null,
    occupation: feed?.occupation ?? null,
    deadline: item.deadline,
    // EU pay is set by grade; the portal states no amount.
    salary: grade ? `EU grade ${grade}` : null,
    experienceRaw: null,
    languagesRaw: null,
    workModeRaw: null,
    country: countryFromLocation(item.location),
    international: true,
  };
}

/**
 * Seconded-national-expert calls are open only to staff of a national
 * administration, and run for years (deadlines into the 2030s), so they go
 * last. Otherwise latest deadline first: a spent budget then defers the
 * vacancies closing soonest.
 */
export function orderForDetail(items: ListItem[]): ListItem[] {
  const sne = (it: ListItem): number => (/seconded national expert/i.test(it.contractType ?? '') ? 1 : 0);
  return [...items].sort((a, b) =>
    sne(a) - sne(b) || (b.deadline ?? '').localeCompare(a.deadline ?? ''));
}

export const euCareersSource: Source = {
  name: 'eucareers',
  async fetchJobs(ctx?: FetchContext): Promise<RawJob[]> {
    const today = todayInBrussels();

    // 1. Every open vacancy. A failed list page throws: a partial list would
    //    silently drop vacancies.
    const items = new Map<string, ListItem>();
    let lastPage = 0;
    for (let page = 0; page <= lastPage && page < MAX_LIST_PAGES; page++) {
      if (page > 0) await sleep(REQUEST_DELAY_MS);
      const parsed = parseListPage(await fetchText(page === 0 ? LIST_URL : `${LIST_URL}?page=${page}`));
      lastPage = Math.max(lastPage, parsed.lastPage);
      if (parsed.items.length === 0) break;
      for (const it of parsed.items) if (!items.has(it.id)) items.set(it.id, it);
    }
    const open = [...items.values()].filter((it) => stillOpen(it.deadline, today));

    // 2. The feed: optional, a failure only costs its fields.
    const feed = new Map<string, FeedItem>();
    await sleep(REQUEST_DELAY_MS);
    try {
      for (const f of parseFeed(await fetchText(FEED_URL))) feed.set(f.id, f);
    } catch (err) {
      console.warn(`[eucareers] feed: ${(err as Error).message}`);
    }

    // 3. Detail pages for what the feed does not cover, once per vacancy.
    const candidates = orderForDetail(
      open.filter((it) => !feed.has(it.id) && !ctx?.hasDetail(it.id)));
    const details = new Map<string, Detail>();
    for (const it of candidates.slice(0, MAX_DETAILS_PER_RUN)) {
      await sleep(REQUEST_DELAY_MS);
      try {
        details.set(it.id, parseDetail(await fetchText(it.url)));
      } catch (err) {
        console.warn(`[eucareers] detail ${it.id}: ${(err as Error).message}`);
      }
    }
    const deferred = candidates.length - Math.min(candidates.length, MAX_DETAILS_PER_RUN);
    if (deferred > 0) {
      console.warn(`[eucareers] detail budget spent; ${deferred} vacancies deferred to the next run`);
    }

    return open.map((it) => buildJob(it, feed.get(it.id), details.get(it.id)));
  },
};
