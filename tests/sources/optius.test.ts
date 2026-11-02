import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';

vi.mock('../../src/http.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/http.js')>();
  return { ...actual, sleep: vi.fn(async () => {}), fetchText: vi.fn() };
});

import { fetchText } from '../../src/http.js';
import {
  parseListPage, parseRss, parseDetail, parseJobPostingLd, toRawJob, orderForDetail,
  slDateToIso, rssDateToIso, canonicalUrl, sourceIdFromUrl, workModeFromLocation,
  countryFromLocation, buildSearchUrl, buildRssUrl, CATEGORIES, MAX_DETAILS_PER_RUN,
  optiusSource,
} from '../../src/sources/optius.js';
import type { OptiusListItem } from '../../src/sources/optius.js';

const listHtml = readFileSync('tests/fixtures/optius-list.html', 'utf8');
const rssXml = readFileSync('tests/fixtures/optius-rss.xml', 'utf8');
const detailHtml = readFileSync('tests/fixtures/optius-detail.html', 'utf8');

describe('parseListPage', () => {
  const { total, items } = parseListPage(listHtml);

  it('reads the result count', () => {
    expect(total).toBe(189);
  });

  it('extracts every card with its numeric id', () => {
    expect(items.map((i) => i.sourceId)).toEqual(['962719', '965258', '964454', '963600']);
  });

  it('extracts title, company, location and deadline', () => {
    expect(items[0]).toEqual({
      sourceId: '962719',
      url: 'https://www.optius.com/iskalci/prosta-delovna-mesta/kadrovnik-kadrovnica-mz-962719-962719/',
      title: 'Kadrovnik / Kadrovnica (m/ž)',
      company: 'KO-TRANS prevozno in trgovsko podjetje d.o.o.',
      location: 'Muretinci',
      deadline: '2026-11-04',
    });
  });

  it('keeps the location as worded, work-mode hints included', () => {
    expect(items[2]!.location)
      .toBe('Maribor ali Ljubljana, v kombinaciji z delom od doma (hibridno)');
  });

  it('returns no items and no total for an empty page', () => {
    expect(parseListPage('<html><body></body></html>')).toEqual({ total: null, items: [] });
  });
});

describe('parseRss', () => {
  const items = parseRss(rssXml);

  it('extracts every item', () => {
    expect(items).toHaveLength(3);
  });

  it('extracts id, dates, employer and fields of work', () => {
    expect(items[0]).toEqual({
      sourceId: '965358',
      url: 'https://www.optius.com/iskalci/prosta-delovna-mesta/sodelavec-za-iskanje-in-selekcijo-kadra-mz-965358-965358/',
      title: 'Sodelavec za iskanje in selekcijo kadra (m/ž)',
      company: 'WHC d.o.o.',
      postedAt: '2026-11-01',
      deadline: '2026-12-01',
      tags: ['Administracija', 'Kadrovanje', 'Management, Poslovno svetovanje, Organizacija'],
    });
  });

  it('decodes entities in titles', () => {
    expect(items[2]!.title).toBe('Svetovalec za iskanje& selekcijo IT kadrov (m/ž)');
  });

  it('never carries the recruiter e-mail from <author>', () => {
    expect(JSON.stringify(items)).not.toContain('@');
  });
});

describe('parseDetail', () => {
  const d = parseDetail(detailHtml);

  it('takes the dates from JSON-LD', () => {
    expect(d.postedAt).toBe('2026-10-29');
    expect(d.deadline).toBe('2026-11-06');
  });

  it('fills the structured fields', () => {
    expect(d.salary).toBe('Mesečno plačilo: 1.800 – 2.200 € bruto');
    expect(d.experienceRaw).toBe('1 - 3 let');
    expect(d.employmentRaw).toBe('zaposlitev za določen čas');
    expect(d.workTimeRaw).toBe('polni delovni čas');
    expect(d.location).toBe('Ljubljana');
    expect(d.company).toBe('Javni štipendijski, razvojni, invalidski in preživninski sklad Republike Slovenije');
  });

  it('builds a plain-text description from intro, sections and leftover rows', () => {
    expect(d.description).toContain('V oddelku za štipendije in programe Ad Futura');
    expect(d.description).toContain('Opis delovnega mesta: Področni svetovalec I');
    expect(d.description).toContain('vodenje in odločanje v zahtevnih upravnih postopkih');
    expect(d.description).toContain('Pričakujemo: Pričakovanja: računalniška pismenost');
    expect(d.description).toContain('Zahtevana izobrazba: VI/2.');
    expect(d.description).toContain('Poskusno delo: 3 mesece');
    expect(d.description).not.toContain('<');
  });

  it('leaves out the application box with its contact details', () => {
    expect(d.description).not.toContain('VLOGE SE POŠLJEJO');
    expect(d.description).not.toContain('@');
  });

  it('falls back to the visible header when JSON-LD is missing', () => {
    const html = `<ul class="job-info">
      <li><strong>Datum objave:</strong> <div class="inline-right"> 2. 11. 2026</div></li>
      <li><strong>Prijave do:</strong> <div class="inline-right"><span class="date"> 2. 12. 2026</span>
        <span class="job-countdown">Še 30 dni</span></div></li>
      <li><strong>Kraj dela</strong><div class="inline-right">Logatec</div></li></ul>`;
    const f = parseDetail(html);
    expect(f.postedAt).toBe('2026-11-02');
    expect(f.deadline).toBe('2026-12-02');
    expect(f.location).toBe('Logatec');
    expect(f.description).toBe('');
  });
});

describe('parseJobPostingLd', () => {
  it('parses the JobPosting despite raw newlines inside its strings', () => {
    expect(parseJobPostingLd(detailHtml)?.['@type']).toBe('JobPosting');
    const html = '<script type="application/ld+json">{"@type": "JobPosting", "title": "A\nB"}</script>';
    expect(parseJobPostingLd(html)?.['title']).toBe('A B');
  });

  it('returns null when there is none', () => {
    expect(parseJobPostingLd('<p>nič</p>')).toBeNull();
  });
});

describe('date helpers', () => {
  it('converts the site display format', () => {
    expect(slDateToIso('2. 12. 2026')).toBe('2026-12-02');
    expect(slDateToIso(' 29. 10. 2026 ')).toBe('2026-10-29');
    expect(slDateToIso('')).toBeNull();
  });

  it('keeps the RSS calendar date as written, without a UTC shift', () => {
    expect(rssDateToIso('Mon, 02 Nov 2026 00:30:00 +0100')).toBe('2026-11-02');
    expect(rssDateToIso('Wed, 02 Dec 2026 23:59:59 +0100')).toBe('2026-12-02');
    expect(rssDateToIso('not a date')).toBeNull();
  });
});

describe('url helpers', () => {
  it('strips query and fragment and makes the url absolute', () => {
    expect(canonicalUrl('/iskalci/prosta-delovna-mesta/x-mz-123-123/?utm_source=rss#top'))
      .toBe('https://www.optius.com/iskalci/prosta-delovna-mesta/x-mz-123-123/');
  });

  it('reads the id from the url', () => {
    expect(sourceIdFromUrl('https://www.optius.com/iskalci/prosta-delovna-mesta/vilicarist-mz-965536-965536/'))
      .toBe('965536');
    expect(sourceIdFromUrl('https://www.optius.com/rss/')).toBeNull();
  });

  it('searches every chosen category at once and pages with s=', () => {
    expect(buildSearchUrl(0)).toContain('Fields%5B%5D=38');
    expect(buildSearchUrl(0)).not.toContain('s=');
    expect(buildSearchUrl(40)).toMatch(/&s=40$/);
    expect(buildRssUrl(CATEGORIES[0]!)).toBe('https://www.optius.com/rss/?podrocje=8');
  });
});

describe('CATEGORIES', () => {
  it('targets HR, education and project-shaped categories, not IT or production', () => {
    const ids = CATEGORIES.map((c) => c.searchId);
    expect(ids).toContain(38); // Kadrovanje
    expect(ids).toContain(52); // Poučevanje, Prevajanje, Kultura, Šport
    expect(ids).not.toContain(37); // Informatika, Programiranje
    expect(ids).not.toContain(48); // Proizvodnja, Steklarstvo
  });

  it('lists every id once', () => {
    expect(new Set(CATEGORIES.map((c) => c.searchId)).size).toBe(CATEGORIES.length);
    expect(new Set(CATEGORIES.map((c) => c.rssId)).size).toBe(CATEGORIES.length);
  });
});

describe('workModeFromLocation', () => {
  it('extracts the work-arrangement fragment of "Kraj dela"', () => {
    expect(workModeFromLocation('Ljubljana, Osrednjeslovenska - Hibridno')).toBe('Hibridno');
    expect(workModeFromLocation('Maribor ali Ljubljana, v kombinaciji z delom od doma (hibridno)'))
      .toBe('v kombinaciji z delom od doma (hibridno)');
    expect(workModeFromLocation('delo od doma')).toBe('delo od doma');
  });

  it('returns null for a plain place', () => {
    expect(workModeFromLocation('Hrastnik - Hrastnik, terensko delo v Sloveniji in tujini')).toBeNull();
    expect(workModeFromLocation(null)).toBeNull();
  });
});

describe('countryFromLocation', () => {
  it('defaults to Slovenia and recognises named foreign countries', () => {
    expect(countryFromLocation('Ljubljana')).toBe('SI');
    expect(countryFromLocation('Nova Gorica')).toBe('SI');
    expect(countryFromLocation('Gradec, Avstrija')).toBe('AT');
  });

  it('is unknown for a bare "Tujina" or no location', () => {
    expect(countryFromLocation('Tujina')).toBeNull();
    expect(countryFromLocation(null)).toBeNull();
  });
});

describe('orderForDetail', () => {
  const item = (sourceId: string, title: string): OptiusListItem => ({
    sourceId, title, url: `https://www.optius.com/x-${sourceId}-${sourceId}/`,
    company: null, location: null, deadline: null,
  });

  it('puts relevant-looking titles first, then the newest', () => {
    const ordered = orderForDetail([
      item('100', 'Viličarist (m/ž)'),
      item('200', 'Poslovni sekretar (m/ž)'),
      item('50', 'Koordinator izobraževanj (m/ž)'),
      item('60', 'Projektni sodelavec (m/ž)'),
    ]);
    expect(ordered.map((i) => i.sourceId)).toEqual(['60', '50', '200', '100']);
  });
});

describe('toRawJob', () => {
  const [card] = parseListPage(listHtml).items;
  const rss = parseRss(rssXml)[0]!;

  it('assembles a list-only job with description "" and RSS dates', () => {
    const job = toRawJob(card!, rss, undefined);
    expect(job).toMatchObject({
      source: 'optius', sourceId: '962719', description: '', postedAt: '2026-11-01',
      deadline: '2026-11-04', country: 'SI', workModeRaw: null, languagesRaw: null,
      tags: rss.tags,
    });
  });

  it('prefers the detail page for dates and fills the detail fields', () => {
    const job = toRawJob(card!, undefined, parseDetail(detailHtml));
    expect(job.postedAt).toBe('2026-10-29');
    expect(job.salary).toBe('Mesečno plačilo: 1.800 – 2.200 € bruto');
    expect(job.experienceRaw).toBe('1 - 3 let');
    expect(job.description.length).toBeGreaterThan(200);
    expect(job.location).toBe('Muretinci'); // the list card wins
  });
});

describe('optiusSource.fetchJobs', () => {
  const mocked = vi.mocked(fetchText);

  beforeEach(() => {
    mocked.mockReset();
    mocked.mockImplementation(async (url: string) => {
      if (url.includes('/rss/')) return rssXml;
      if (url.includes('Fields')) return url.includes('s=') ? '<html></html>' : listHtml;
      return detailHtml;
    });
  });

  it('skips detail pages the store already holds', async () => {
    const jobs = await optiusSource.fetchJobs({ hasDetail: (id) => id === '965258' });
    expect(jobs).toHaveLength(4);
    expect(jobs.find((j) => j.sourceId === '965258')!.description).toBe('');
    expect(jobs.find((j) => j.sourceId === '962719')!.description.length).toBeGreaterThan(0);

    const urls = mocked.mock.calls.map(([u]) => u);
    expect(urls.filter((u) => u.includes('965258'))).toEqual([]);
    expect(urls.filter((u) => u.includes('/rss/'))).toHaveLength(CATEGORIES.length);
  });

  it('stops fetching details at the first 429 and still returns every posting', async () => {
    mocked.mockImplementation(async (url: string) => {
      if (url.includes('/rss/')) return rssXml;
      if (url.includes('Fields')) return url.includes('s=') ? '<html></html>' : listHtml;
      throw new Error(`GET ${url} failed: 429 Too Many Requests`);
    });
    const jobs = await optiusSource.fetchJobs();
    expect(jobs).toHaveLength(4);
    expect(jobs.every((j) => j.description === '')).toBe(true);
    const details = mocked.mock.calls.filter(([u]) => !u.includes('/rss/') && !u.includes('Fields'));
    expect(details).toHaveLength(1);
  });

  it('never fetches more than the per-run detail budget', async () => {
    await optiusSource.fetchJobs();
    const details = mocked.mock.calls.filter(([u]) => !u.includes('/rss/') && !u.includes('Fields'));
    expect(details.length).toBeLessThanOrEqual(MAX_DETAILS_PER_RUN);
  });
});
