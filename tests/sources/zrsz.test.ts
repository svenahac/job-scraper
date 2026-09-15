import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  parseBundleUrls, parseApiConfig, parseSearchPage, totalFrom, buildJobUrl,
  parseDetail, needsDetail,
} from '../../src/sources/zrsz.js';
import type { ZrszItem } from '../../src/sources/zrsz.js';

const search = JSON.parse(readFileSync('tests/fixtures/zrsz-search.json', 'utf8'));

describe('parseBundleUrls', () => {
  it('finds the compressed TYPO3 bundles in the page', () => {
    const html = `<html><script src="/typo3temp/assets/compressed/merged-abc.js?123"></script>
      <script src="/_assets/x/jquery.min.js"></script></html>`;
    expect(parseBundleUrls(html)).toEqual(['/typo3temp/assets/compressed/merged-abc.js?123']);
  });

  it('returns empty when the page has no bundles', () => {
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

describe('needsDetail', () => {
  const item = (over: Partial<ZrszItem>): ZrszItem => ({
    sourceId: '1', title: 'HIŠNIK IV - M/Ž', company: 'OŠ', location: 'LJUBLJANA',
    postedAt: null, employmentRaw: null, workTimeRaw: null, occupation: null, ...over,
  });

  it('fetches the body when the title matches an area', () => {
    expect(needsDetail(item({ title: 'KOORDINATOR IZOBRAŽEVANJ - M/Ž' }))).toBe(true);
  });

  it('fetches the body when the occupation matches an area', () => {
    expect(needsDetail(item({ occupation: 'Andragog' }))).toBe(true);
  });

  it('skips an unrelated ad, whatever its location', () => {
    expect(needsDetail(item({ title: 'HIŠNIK IV - M/Ž', location: 'LJUBLJANA' }))).toBe(false);
  });
});
