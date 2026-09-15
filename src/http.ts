import iconv from 'iconv-lite';
import * as cheerio from 'cheerio';

export const USER_AGENT =
  'job-scraper/1.0 (personal job search bot; +https://github.com/svenahac/job-scraper)';

/** Delay between sequential requests to the same host. */
export const REQUEST_DELAY_MS = 600;

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

interface FetchTextOptions {
  /** e.g. 'iso-8859-2'. Omit for UTF-8. */
  encoding?: string;
  headers?: Record<string, string>;
}

async function request(url: string, headers: Record<string, string>): Promise<Response> {
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, ...headers },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`GET ${url} failed: ${res.status} ${res.statusText}`);
  return res;
}

export async function fetchText(url: string, opts: FetchTextOptions = {}): Promise<string> {
  const res = await request(url, opts.headers ?? {});
  if (!opts.encoding) return res.text();
  // slo-tech serves iso-8859-2; decoding it as UTF-8 destroys every diacritic.
  const buf = Buffer.from(await res.arrayBuffer());
  return iconv.decode(buf, opts.encoding);
}

export async function fetchJson<T>(url: string, headers: Record<string, string> = {}): Promise<T> {
  const res = await request(url, { Accept: 'application/json', ...headers });
  return (await res.json()) as T;
}

export async function postJson<T>(
  url: string, body: unknown, headers: Record<string, string> = {},
): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`POST ${url} failed: ${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}

/** HTML fragment to plain text, entities decoded, whitespace collapsed. */
export function stripHtml(html: string): string {
  if (!html) return '';
  // Pad block-closing tags first. cheerio's .text() concatenates adjacent
  // blocks with no separator, so "<p>Zahtevamo</p><p>3+ let</p>" would other-
  // wise collapse to "Zahtevamo3+ let" and break keyword matching.
  const spaced = html.replace(/<\/(?:p|li|div|tr|td|th|dd|dt|h[1-6])>|<br\s*\/?>/gi, ' $& ');
  const $ = cheerio.load(`<div id="__root">${spaced}</div>`);
  return $('#__root').text().replace(/\s+/g, ' ').trim();
}
