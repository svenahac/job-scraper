import * as cheerio from 'cheerio';
import type { RawJob, Source } from '../types.js';
import { fetchText, sleep, stripHtml, REQUEST_DELAY_MS } from '../http.js';

const BASE = 'https://slo-tech.com';
const LISTING_URL = `${BASE}/delo`;
const ENCODING = 'iso-8859-2';

export interface ListingRow {
  sourceId: string;
  title: string;
  company: string | null;
  tags: string[];
}

export function parseListing(html: string): ListingRow[] {
  const $ = cheerio.load(html);
  const rows: ListingRow[] = [];

  $('tr').each((_, tr) => {
    const $tr = $(tr);
    const link = $tr.find('td.name h3 a[href^="/delo/"]').first();
    const href = link.attr('href');
    if (!href) return;

    // Only numeric ids are postings. /delo/tagi/... and /delo/podjetje/... are not.
    const match = /^\/delo\/(\d+)$/.exec(href);
    if (!match) return;

    rows.push({
      sourceId: match[1]!,
      title: link.text().trim(),
      company: $tr.find('td.company a').first().text().trim() || null,
      tags: $tr.find('td.name span.oddelek a').map((_i, a) => $(a).text().trim()).get(),
    });
  });

  return rows;
}

const MONTHS: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', maj: '05', jun: '06',
  jul: '07', avg: '08', sep: '09', okt: '10', nov: '11', dec: '12',
};

export function parseDetail(html: string): { description: string; postedAt: string | null } {
  const $ = cheerio.load(html);
  // Remove page chrome so the body text is the advert, not the login form.
  // noscript is included because htmlparser2 treats its contents as raw
  // text (like script/style), so a tracking-pixel snippet inside it would
  // otherwise survive stripHtml verbatim, tags and all.
  $('script, style, form, nav, header, footer, noscript').remove();
  const description = stripHtml($.root().html() ?? '');

  // "objavljeno :: 18. avg 2026 ob 10:14:43"
  const m = /objavljeno\s*::\s*(\d{1,2})\.\s*([a-zščž]{3})\s*(\d{4})/i.exec(description);
  let postedAt: string | null = null;
  if (m) {
    const month = MONTHS[m[2]!.toLowerCase()];
    if (month) postedAt = `${m[3]}-${month}-${m[1]!.padStart(2, '0')}`;
  }

  return { description, postedAt };
}

export const sloTechSource: Source = {
  name: 'slotech',
  async fetchJobs(): Promise<RawJob[]> {
    const listing = await fetchText(LISTING_URL, { encoding: ENCODING });
    const rows = parseListing(listing);
    const jobs: RawJob[] = [];

    for (const row of rows) {
      await sleep(REQUEST_DELAY_MS);
      const url = `${BASE}/delo/${row.sourceId}`;
      const detail = await fetchText(url, { encoding: ENCODING });
      const { description, postedAt } = parseDetail(detail);
      jobs.push({
        source: 'slotech',
        sourceId: row.sourceId,
        url,
        title: row.title,
        company: row.company,
        location: null, // slo-tech does not expose a structured location
        postedAt,
        description,
        tags: row.tags,
      });
    }

    return jobs;
  },
};
