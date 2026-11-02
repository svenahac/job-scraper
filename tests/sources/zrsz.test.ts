import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  parseBundleUrls, parseApiConfig, parseSearchPage, totalFrom, buildJobUrl,
  parseDetail, needsDetail, parseSlovenianDate,
} from '../../src/sources/zrsz.js';
import type { ZrszItem } from '../../src/sources/zrsz.js';

const search = JSON.parse(readFileSync('tests/fixtures/zrsz-search.json', 'utf8'));

describe('parseBundleUrls', () => {
  it('puts the job-search dashboard script first, then TYPO3 bundles, libraries last', () => {
    const html = `<html><script src="/_assets/x/jquery.min.js"></script>
      <script src="/typo3temp/assets/compressed/merged-abc.js?123"></script>
      <script src="https://nad-plo.apps.ess.gov.si/zrsz-iskalnik-dashboard.js?v12"></script></html>`;
    expect(parseBundleUrls(html)).toEqual([
      'https://nad-plo.apps.ess.gov.si/zrsz-iskalnik-dashboard.js?v12',
      '/typo3temp/assets/compressed/merged-abc.js?123',
      '/_assets/x/jquery.min.js',
    ]);
  });

  it('returns empty when the page has no scripts', () => {
    expect(parseBundleUrls('<html></html>')).toEqual([]);
  });
});

describe('parseApiConfig', () => {
  it('reads the gateway host and user key from the bundle', () => {
    const js = 'const F_dataFor3ScaleApi_url="https://gw.example",' +
      'F_dataFor3ScaleApi_keyName="user_key",F_dataFor3ScaleApi_keyValue="deadbeef";';
    expect(parseApiConfig(js)).toEqual({
      baseUrl: 'https://gw.example', userKey: 'deadbeef',
    });
  });

  it('throws when the bundle does not carry the config', () => {
    expect(() => parseApiConfig('var x = 1;')).toThrow(/API config/);
  });
});

describe('parseSearchPage', () => {
  const items = parseSearchPage(search);

  it('extracts every item', () => {
    expect(items.length).toBeGreaterThan(10);
  });

  it('extracts a numeric source id', () => {
    expect(items[0]!.sourceId).toMatch(/^\d+$/);
  });

  it('extracts a title and an employer', () => {
    expect(items[0]!.title.length).toBeGreaterThan(3);
    expect(items[0]!.company).toBeTruthy();
  });

  it('extracts the posted date as an ISO date', () => {
    expect(items[0]!.postedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('carries the structured contract and working-time fields through', () => {
    expect(items.some((i) => i.employmentRaw && i.employmentRaw.length > 0)).toBe(true);
    expect(items.some((i) => i.workTimeRaw && i.workTimeRaw.includes('ur'))).toBe(true);
  });

  it('carries the occupation through', () => {
    expect(items.some((i) => i.occupation && i.occupation.length > 0)).toBe(true);
  });

  it('returns an empty array when the payload has no items', () => {
    expect(parseSearchPage({ steviloDelovnihMest: 0, seznamDelovnihMest: [] })).toEqual([]);
  });
});

describe('totalFrom', () => {
  it('reads the total', () => {
    expect(totalFrom(search)).toBeGreaterThan(100);
  });

  it('returns zero for an unexpected payload', () => {
    expect(totalFrom({})).toBe(0);
  });
});

describe('buildJobUrl', () => {
  it('builds the exact verified ess.gov.si template for a known id', () => {
    const url = buildJobUrl('3471197');
    expect(url).toBe(
      'https://www.ess.gov.si/iskalci-zaposlitve/iskanje-zaposlitve/iskanje-dela/?idp=3471197/#/pdm/3471197',
    );
  });
});

describe('parseDetail', () => {
  const detail = JSON.parse(readFileSync('tests/fixtures/zrsz-detail.json', 'utf8'));

  it('extracts the advert body as plain text', () => {
    const { description } = parseDetail(detail);
    expect(description.length).toBeGreaterThan(20);
    expect(description).not.toContain('<');
  });

  it('returns an empty description for an empty payload', () => {
    expect(parseDetail({}).description).toBe('');
  });
});

describe('parseSlovenianDate', () => {
  it('reads D. M. YYYY', () => {
    expect(parseSlovenianDate('18. 9. 2026')).toBe('2026-09-18');
    expect(parseSlovenianDate('')).toBeNull();
  });
});

describe('needsDetail', () => {
  const now = new Date('2026-11-02T12:00:00Z');
  const item = (over: Partial<ZrszItem>): ZrszItem => ({
    sourceId: '1', title: 'HIŠNIK IV - M/Ž', company: 'OŠ', location: 'MARIBOR',
    postedAt: '2026-10-30', employmentRaw: null, workTimeRaw: null, occupation: null, ...over,
  });

  it('fetches recent on-topic and generic titles anywhere in Slovenia', () => {
    expect(needsDetail(item({ title: 'KOORDINATOR IZOBRAŽEVANJ - M/Ž' }), now)).toBe(true);
    expect(needsDetail(item({ title: 'STROKOVNI SODELAVEC VII/2 - M/Ž' }), now)).toBe(true);
    expect(needsDetail(item({ occupation: 'Andragog' }), now)).toBe(true);
  });

  it('skips unrelated, old, and already-stored postings', () => {
    expect(needsDetail(item({}), now)).toBe(false);
    expect(needsDetail(item({ title: 'KOORDINATOR IZOBRAŽEVANJ - M/Ž', postedAt: '2026-08-01' }), now)).toBe(false);
    expect(needsDetail(item({ title: 'KOORDINATOR IZOBRAŽEVANJ - M/Ž' }), now, { hasDetail: () => true })).toBe(false);
  });
});

describe('parseDetail extras', () => {
  it('reads deadline, salary, experience and languages', () => {
    const d = parseDetail({
      opisDelInNalog: 'Organizacija izobraževanj', prijavaDo: '20. 11. 2026', okvirnaPlaca: '2.000 EUR',
      delovneIzkusnje: '1 leto', znanjeJezikov: 'angleški jezik: tekoče',
    });
    expect(d).toMatchObject({
      deadline: '2026-11-20', salary: '2.000 EUR', experienceRaw: '1 leto', languagesRaw: 'angleški jezik: tekoče',
    });
    expect(d.description).toContain('Organizacija izobraževanj');
  });
});
