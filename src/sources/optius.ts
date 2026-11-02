import * as cheerio from 'cheerio';
import type { FetchContext, RawJob, Source } from '../types.js';
import { fetchText, sleep, stripHtml, REQUEST_DELAY_MS } from '../http.js';

const SITE = 'https://www.optius.com';
const LIST_PATH = '/iskalci/prosta-delovna-mesta/';
const RSS_PATH = '/rss/';

/** The site paginates its search results 20 at a time via `s=<offset>`. */
const PAGE_SIZE = 20;
/** Safety stop: the chosen categories hold ~190 ads, i.e. ten pages. */
const MAX_LIST_PAGES = 20;
/**
 * Optius answers 429 Too Many Requests at about one request per second
 * (observed after ~30 requests at the shared 600 ms pace). Two seconds
 * between requests keeps well under that.
 */
const DELAY_MS = Math.max(REQUEST_DELAY_MS, 2000);
/**
 * Detail pages are fetched once per ad and skipped afterwards via
 * ctx.hasDetail, so a normal night needs only ~10. The cap keeps the first
 * run (empty store, ~190 ads) inside the request and time budget; the
 * remainder is picked up on the following nights.
 */
export const MAX_DETAILS_PER_RUN = 25;

/** http.ts reports the status only in the message: "GET … failed: 429 …". */
const isRateLimited = (err: unknown): boolean =>
  /failed: 429\b/.test(err instanceof Error ? err.message : String(err));

/**
 * Optius files L&D, HR, project-coordination, adult-education and EU-project
 * roles in these categories. The search form and the RSS feed number them
 * differently, so both ids are kept. Production, trade, IT and similar
 * categories are deliberately left out.
 */
export interface OptiusCategory {
  searchId: number;
  rssId: number;
  name: string;
}

export const CATEGORIES: readonly OptiusCategory[] = [
  { searchId: 38, rssId: 8, name: 'Kadrovanje' },
  { searchId: 52, rssId: 22, name: 'Poučevanje, Prevajanje, Kultura, Šport' },
  { searchId: 50, rssId: 20, name: 'Socialno in Prostovoljno delo' },
  { searchId: 46, rssId: 16, name: 'Pravo, Družboslovje' },
  { searchId: 58, rssId: 28, name: 'Znanost, Tehnologija, Raziskave in razvoj' },
  { searchId: 42, rssId: 12, name: 'Management, Poslovno svetovanje, Organizacija' },
  { searchId: 31, rssId: 1, name: 'Administracija' },
  { searchId: 43, rssId: 13, name: 'Marketing, Oglaševanje, PR' },
  { searchId: 44, rssId: 14, name: 'Novinarstvo, Mediji, Založništvo' },
];

/** One card on the server-rendered search results page. */
export interface OptiusListItem {
  sourceId: string;
  url: string;
  title: string;
  company: string | null;
  location: string | null;
  deadline: string | null;
}

/** One item of the official per-category RSS feed. */
export interface OptiusRssItem {
  sourceId: string;
  url: string;
  title: string;
  company: string | null;
  postedAt: string | null;
  deadline: string | null;
  tags: string[];
}

/** What a detail page adds on top of the list card. */
export interface OptiusDetail {
  description: string;
  postedAt: string | null;
  deadline: string | null;
  location: string | null;
  company: string | null;
  salary: string | null;
  experienceRaw: string | null;
  employmentRaw: string | null;
  workTimeRaw: string | null;
}

// ---------------------------------------------------------------- helpers --

/** Collapse whitespace and drop the zero-width/word-joiner characters some
 *  employers paste into titles ("m⁠/⁠ž"). */
const clean = (s: string | null | undefined): string =>
  (s ?? '').replace(/[​-‍⁠﻿]/g, '').replace(/\s+/g, ' ').trim();

const orNull = (s: string): string | null => (s.length > 0 ? s : null);

/** Lower-case and strip diacritics, so č/š/ž match c/s/z. */
const fold = (s: string): string =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const pad2 = (n: string): string => n.padStart(2, '0');

function validIso(y: string, m: string, d: string): string | null {
  const mi = Number(m);
  const di = Number(d);
  if (mi < 1 || mi > 12 || di < 1 || di > 31) return null;
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

/** "2. 12. 2026" (the site's display format) to "2026-12-02". */
export function slDateToIso(s: string | null | undefined): string | null {
  const m = /(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})/.exec(s ?? '');
  return m ? validIso(m[3]!, m[2]!, m[1]!) : null;
}

const MONTHS: Record<string, string> = {
  jan: '1', feb: '2', mar: '3', apr: '4', may: '5', jun: '6',
  jul: '7', aug: '8', sep: '9', oct: '10', nov: '11', dec: '12',
};

/**
 * "Mon, 02 Nov 2026 09:26:00 +0100" to "2026-11-02". The calendar date is
 * taken as written: converting to UTC first would move ads posted just
 * after local midnight to the previous day.
 */
export function rssDateToIso(s: string | null | undefined): string | null {
  const m = /(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{4})/.exec(s ?? '');
  const month = m ? MONTHS[m[2]!.toLowerCase()] : undefined;
  return m && month ? validIso(m[3]!, month, m[1]!) : null;
}

/** "2026-11-02" or "2026-11-02T10:00:00+01:00" to "2026-11-02". */
const isoPrefix = (s: unknown): string | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(typeof s === 'string' ? s : '');
  return m ? validIso(m[1]!, m[2]!, m[3]!) : null;
};

/** Absolute job URL without query string or fragment. */
export function canonicalUrl(href: string): string {
  const u = new URL(href, SITE);
  u.search = '';
  u.hash = '';
  return u.toString();
}

/** Job URLs end in "<slug>-<id>-<id>/"; the id survives title edits. */
export function sourceIdFromUrl(url: string): string | null {
  const m = /-(\d+)-(\d+)\/?$/.exec(new URL(url, SITE).pathname);
  return m ? m[2]! : null;
}

const WORK_MODE_RE = /hibridn|hybrid|od doma|na domu|na daljavo|remote/;

/**
 * Optius has no work-arrangement field, but employers often write it into
 * "Kraj dela": "Ljubljana, Osrednjeslovenska - Hibridno", "delo od doma".
 * Returns just that fragment, as worded.
 */
export function workModeFromLocation(location: string | null): string | null {
  if (!location) return null;
  const hits = location.split(/,|;|\s+-\s+/)
    .map((p) => p.trim())
    .filter((p) => WORK_MODE_RE.test(fold(p)));
  return hits.length > 0 ? hits.join(', ') : null;
}

/** Country names only — city names collide with Slovenian places too often. */
const FOREIGN: ReadonlyArray<readonly [RegExp, string]> = [
  [/avstrij|austria/, 'AT'], [/nemcij|germany|deutschland/, 'DE'],
  [/hrvask|croatia/, 'HR'], [/italij|italy/, 'IT'], [/svic|switzerland/, 'CH'],
  [/madzarsk|hungary/, 'HU'], [/belgij|belgium/, 'BE'],
  [/nizozemsk|netherlands/, 'NL'], [/francij|france/, 'FR'],
  [/srbij|serbia/, 'RS'], [/bosn|bosnia/, 'BA'], [/luksembur|luxembourg/, 'LU'],
  [/irsk|ireland/, 'IE'], [/cesk|czech/, 'CZ'], [/slovask|slovakia/, 'SK'],
  [/poljsk|poland/, 'PL'], [/spanij|spain/, 'ES'],
  [/zdruzeno kraljestvo|united kingdom/, 'GB'],
];

/**
 * Optius is a Slovenian board and its workplaces are Slovenian unless the
 * location names a foreign country. "Tujina" (abroad) alone, or no location
 * at all, is unknown.
 */
export function countryFromLocation(location: string | null): string | null {
  if (!location) return null;
  const f = fold(location);
  for (const [re, code] of FOREIGN) if (re.test(f)) return code;
  return /^tujin/.test(f) ? null : 'SI';
}

const RELEVANT_RE = new RegExp([
  'izobraz', 'usposab', 'ucenj', 'andrag', 'kadr', 'talent', 'koordinat',
  'projekt', 'program', 'evrop', '\\beu\\b', 'mentor', 'trener', 'learning',
  'training', 'educat', 'edtech', 'digital', '\\blms\\b', 'coordinat', 'project',
].join('|'));

/** Title looks like the seeker's field. Used only to order detail fetches. */
export function looksRelevant(title: string): boolean {
  return RELEVANT_RE.test(fold(title));
}

/**
 * Order in which detail pages are fetched when the per-run cap bites:
 * relevant-looking titles first, then newest first (ids are sequential).
 */
export function orderForDetail(items: readonly OptiusListItem[]): OptiusListItem[] {
  return [...items].sort((a, b) => {
    const rel = Number(looksRelevant(b.title)) - Number(looksRelevant(a.title));
    return rel !== 0 ? rel : Number(b.sourceId) - Number(a.sourceId);
  });
}

// ----------------------------------------------------------------- search --

export function buildSearchUrl(offset: number): string {
  const params = new URLSearchParams();
  for (const c of CATEGORIES) params.append('Fields[]', String(c.searchId));
  if (offset > 0) params.set('s', String(offset));
  return `${SITE}${LIST_PATH}?${params.toString()}`;
}

export function buildRssUrl(category: OptiusCategory): string {
  return `${SITE}${RSS_PATH}?podrocje=${category.rssId}`;
}

export function parseListPage(html: string): { total: number | null; items: OptiusListItem[] } {
  const $ = cheerio.load(html);

  const count = /(\d[\d.]*)\s*$/.exec(clean($('.result-count').first().text()));
  const total = count ? Number(count[1]!.replace(/\./g, '')) : null;

  const items: OptiusListItem[] = [];
  $('li.item[id^="job"]').each((_, el) => {
    const card = $(el);
    const href = card.find('a.hover-link').attr('href')
      ?? card.find('a[href*="/prosta-delovna-mesta/"]').first().attr('href');
    if (!href) return;
    const url = canonicalUrl(href);
    const sourceId = /^job(\d+)$/.exec(card.attr('id') ?? '')?.[1] ?? sourceIdFromUrl(url);
    const title = clean(card.find('h3').first().text());
    if (!sourceId || !title) return;

    let location: string | null = null;
    let deadline: string | null = null;
    card.find('.job-infos li').each((__, li) => {
      const label = fold(clean($(li).find('.left').first().text()));
      const value = $(li).find('.right').first();
      if (label.startsWith('kraj dela')) location = orNull(clean(value.text()));
      else if (label.startsWith('prijave do')) {
        deadline = slDateToIso(value.find('.date').text() || value.text());
      }
    });

    items.push({
      sourceId,
      url,
      title,
      company: orNull(clean(card.find('.company-name').first().text())),
      location,
      deadline,
    });
  });

  return { total, items };
}

// -------------------------------------------------------------------- RSS --

/**
 * The feed's <author> carries the recruiter's e-mail address, and its
 * <description> only the "we offer" block, so neither is read.
 */
export function parseRss(xml: string): OptiusRssItem[] {
  const $ = cheerio.load(xml, { xmlMode: true });
  const items: OptiusRssItem[] = [];
  $('item').each((_, el) => {
    const it = $(el);
    const link = clean(it.children('link').text()) || clean(it.children('guid').text());
    if (!link) return;
    const url = canonicalUrl(link);
    const sourceId = sourceIdFromUrl(url);
    if (!sourceId) return;
    items.push({
      sourceId,
      url,
      title: clean(it.children('title').text()),
      company: orNull(clean(it.children('employer').text())),
      postedAt: rssDateToIso(it.children('pubDate').text()),
      deadline: rssDateToIso(it.children('validTill').text()),
      tags: it.find('fields_of_work > field').map((__, f) => clean($(f).text())).get()
        .filter((t) => t.length > 0),
    });
  });
  return items;
}

// ----------------------------------------------------------------- detail --

/**
 * Optius emits JSON-LD with raw newlines inside string values, which strict
 * JSON.parse rejects. Control characters are only ever whitespace here, so
 * they are flattened to spaces before parsing.
 */
export function parseJobPostingLd(html: string): Record<string, unknown> | null {
  return jobPostingFrom(cheerio.load(html));
}

function jobPostingFrom($: cheerio.CheerioAPI): Record<string, unknown> | null {
  let found: Record<string, unknown> | null = null;
  $('script[type="application/ld+json"]').each((_, el) => {
    if (found) return;
    const raw = $(el).text();
    if (!raw.includes('JobPosting')) return;
    try {
      const parsed = JSON.parse(raw.replace(/[\u0000-\u001f]+/g, ' ')) as unknown;
      const nodes = Array.isArray(parsed) ? parsed : [parsed];
      found = (nodes.find((n) => (n as Record<string, unknown>)?.['@type'] === 'JobPosting')
        ?? null) as Record<string, unknown> | null;
    } catch {
      // Malformed beyond repair: the visible page still carries every field.
    }
  });
  return found;
}

/** Structured "label: value" rows that map onto RawJob fields. */
const FIELD_LABELS = {
  experience: /^zahtevane delovne izkusnje/,
  employment: /^oblika zaposlitve/,
  workTime: /^delovni cas/,
  salary: /placilo|placa|postavka/,
} as const;

export function parseDetail(html: string): OptiusDetail {
  const $ = cheerio.load(html);
  const ld = jobPostingFrom($) ?? {};
  const str = (v: unknown): string | null =>
    (typeof v === 'string' ? orNull(clean(v)) : null);

  // Header: "Datum objave", "Prijave do", "Kraj dela".
  const header: Record<string, string> = {};
  $('ul.job-info li').each((_, li) => {
    const label = fold(clean($(li).find('strong').first().text())).replace(/:$/, '');
    const value = $(li).find('.inline-right').first();
    if (label) header[label] = clean(value.find('.date').text() || value.text());
  });

  // Body: prose sections ("Opis delovnega mesta", "Pričakujemo", "Ponujamo")
  // carry an <h3>; the other rows are short structured label/value pairs.
  // The application box below (.profile-banner) is deliberately not read: it
  // holds recruiters' names, e-mail addresses and phone numbers.
  const sections: string[] = [];
  const extras: string[] = [];
  let experienceRaw: string | null = null;
  let employmentRaw: string | null = null;
  let workTimeRaw: string | null = null;
  let salary: string | null = null;

  $('.application-content .info-cols').each((_, row) => {
    const left = $(row).children('.col-left').first();
    const right = $(row).children('.col-right').first();
    const label = clean(left.text()).replace(/:$/, '');
    const text = stripHtml(right.html() ?? '');
    if (!label || !text) return;

    if (left.find('h3').length > 0) {
      sections.push(`${label}: ${text}`);
      return;
    }
    const key = fold(label);
    if (FIELD_LABELS.experience.test(key)) experienceRaw = text;
    else if (FIELD_LABELS.employment.test(key)) employmentRaw = text;
    else if (FIELD_LABELS.workTime.test(key)) workTimeRaw = text;
    else if (FIELD_LABELS.salary.test(key)) salary = `${label}: ${text}`;
    else extras.push(`${label}: ${text}`);
  });

  const intro = stripHtml($('.company-header-wrapper p').map((_, p) => $(p).html()).get().join(' '));
  const description = [intro, ...sections, ...extras].filter((s) => s.length > 0).join(' ');

  const place = (ld['jobLocation'] as Record<string, any> | undefined)?.['address']?.['addressLocality'];

  return {
    description,
    postedAt: isoPrefix(ld['datePosted']) ?? slDateToIso(header['datum objave']),
    deadline: isoPrefix(ld['validThrough']) ?? slDateToIso(header['prijave do']),
    location: orNull(clean(header['kraj dela'])) ?? str(place),
    // The visible heading wins: JSON-LD sometimes holds only an acronym.
    company: orNull(clean($('.company-header-wrapper h2').first().text()))
      ?? str((ld['hiringOrganization'] as Record<string, unknown> | undefined)?.['name']),
    salary,
    experienceRaw: experienceRaw ?? str(ld['experienceRequirements']),
    employmentRaw: employmentRaw ?? str(ld['employmentType']),
    workTimeRaw: workTimeRaw ?? str(ld['workHours']),
  };
}

// --------------------------------------------------------------- assembly --

/**
 * One RawJob from the list card (always present), the RSS item (present for
 * the newest 50 ads of each category) and the detail page (absent when the
 * store already holds it, or when this run's detail budget is spent).
 */
export function toRawJob(
  item: OptiusListItem, rss: OptiusRssItem | undefined, detail: OptiusDetail | undefined,
): RawJob {
  const location = item.location ?? detail?.location ?? null;
  return {
    source: 'optius',
    sourceId: item.sourceId,
    url: item.url,
    title: item.title,
    company: item.company ?? rss?.company ?? detail?.company ?? null,
    location,
    postedAt: detail?.postedAt ?? rss?.postedAt ?? null,
    description: detail?.description ?? '',
    tags: rss?.tags ?? [],
    employmentRaw: detail?.employmentRaw ?? null,
    workTimeRaw: detail?.workTimeRaw ?? null,
    occupation: null,
    deadline: item.deadline ?? detail?.deadline ?? rss?.deadline ?? null,
    salary: detail?.salary ?? null,
    experienceRaw: detail?.experienceRaw ?? null,
    languagesRaw: null,
    workModeRaw: workModeFromLocation(location),
    country: countryFromLocation(location),
  };
}

export const optiusSource: Source = {
  name: 'optius',
  async fetchJobs(ctx?: FetchContext): Promise<RawJob[]> {
    // 1. Every active ad in the chosen categories, all of Slovenia. The list
    //    cards carry title, company, location and deadline.
    const items = new Map<string, OptiusListItem>();
    let total = Infinity;
    for (let page = 0; page < MAX_LIST_PAGES && page * PAGE_SIZE < total; page++) {
      if (page > 0) await sleep(DELAY_MS);
      const parsed = parseListPage(await fetchText(buildSearchUrl(page * PAGE_SIZE)));
      if (parsed.total !== null) total = parsed.total;
      if (parsed.items.length === 0) break;
      for (const it of parsed.items) if (!items.has(it.sourceId)) items.set(it.sourceId, it);
    }

    // 2. The cards have no posting date; the official RSS feed has it (and
    //    the category tags). Optional: a failed feed only costs those fields.
    // A 429 anywhere below ends that stage for the night instead of pressing on.
    const feed = new Map<string, OptiusRssItem>();
    for (const category of CATEGORIES) {
      await sleep(DELAY_MS);
      try {
        for (const r of parseRss(await fetchText(buildRssUrl(category)))) {
          const seen = feed.get(r.sourceId);
          if (seen) seen.tags = [...new Set([...seen.tags, ...r.tags])];
          else feed.set(r.sourceId, r);
        }
      } catch (err) {
        console.warn(`[optius] RSS ${category.name}: ${(err as Error).message}`);
        if (isRateLimited(err)) break;
      }
    }

    // 3. Detail pages, once per ad. Those already stored are skipped.
    const details = new Map<string, OptiusDetail>();
    let attempted = 0;
    let deferred = 0;
    let rateLimited = false;
    for (const item of orderForDetail([...items.values()])) {
      if (ctx?.hasDetail(item.sourceId)) continue;
      if (rateLimited || attempted >= MAX_DETAILS_PER_RUN) { deferred++; continue; }
      attempted++;
      await sleep(DELAY_MS);
      try {
        details.set(item.sourceId, parseDetail(await fetchText(item.url)));
      } catch (err) {
        // An ad withdrawn between list and detail fetch is not worth failing
        // the whole source over.
        console.warn(`[optius] detail ${item.sourceId}: ${(err as Error).message}`);
        if (isRateLimited(err)) { rateLimited = true; deferred++; }
      }
    }
    if (deferred > 0) {
      console.warn(`[optius] ${deferred} detail pages deferred to the next run`
        + (rateLimited ? ' (rate-limited)' : ''));
    }

    return [...items.values()].map((it) =>
      toRawJob(it, feed.get(it.sourceId), details.get(it.sourceId)));
  },
};
