import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  parseSearchPage, parseDetail, buildJobUrl, CATEGORY_IDS, needsDetail, workModeLabel, salaryText,
  toLocalDate,
} from '../../src/sources/mojedelo.js';
import type { SearchItem } from '../../src/sources/mojedelo.js';

const search = JSON.parse(readFileSync('tests/fixtures/mojedelo-search.json', 'utf8'));
const detail = JSON.parse(readFileSync('tests/fixtures/mojedelo-detail.json', 'utf8'));

describe('parseSearchPage', () => {
  const items = parseSearchPage(search);

  it('extracts every item', () => {
    expect(items.length).toBeGreaterThan(0);
  });

  it('extracts a UUID id', () => {
    expect(items[0]!.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('extracts a title', () => {
    expect(items[0]!.title.length).toBeGreaterThan(3);
  });

  it('extracts the company name', () => {
    expect(items[0]!.company).toBeTruthy();
  });

  it('extracts the town as the location', () => {
    expect(items[0]!.location).toBeTruthy();
  });

  it('extracts the posted date as an ISO date', () => {
    expect(items[0]!.postedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('returns an empty array when the payload has no items', () => {
    expect(parseSearchPage({ data: { items: [], total: 0 } })).toEqual([]);
  });
});

describe('parseDetail', () => {
  it('concatenates jobDescription and weExpect into plain text', () => {
    const { description } = parseDetail(detail);
    expect(description.length).toBeGreaterThan(200);
    expect(description).not.toContain('<');
  });

  it('tolerates a payload missing weExpect', () => {
    const { description } = parseDetail({ data: { jobDescription: '<p>Samo opis.</p>' } });
    expect(description).toBe('Samo opis.');
  });
});

describe('buildJobUrl', () => {
  it('slugifies the title into the public URL', () => {
    expect(buildJobUrl('Software Engineer (m/ž)', 'abc-123'))
      .toBe('https://www.mojedelo.com/job-ad/software-engineer-m-z/abc-123');
  });
});

describe('CATEGORY_IDS', () => {
  it('targets HR, education and project-shaped categories, not IT', () => {
    expect(CATEGORY_IDS).toContain('e917f193-c49f-4e28-85ab-5c0746f1df19'); // Kadri, HR
    expect(CATEGORY_IDS).toContain('5022c5c2-029d-4949-a69a-9e156f82747d'); // Izobraževanje
    expect(CATEGORY_IDS).not.toContain('64f003ff-6d8b-4be0-b58c-4580e4eeeb8a'); // IT
  });

  it('lists every id once', () => {
    expect(new Set(CATEGORY_IDS).size).toBe(CATEGORY_IDS.length);
  });
});

describe('needsDetail', () => {
  const item = (over: Partial<SearchItem>): SearchItem => ({
    id: 'x', title: 'Prodajalec (m/ž)', company: 'Acme', location: 'Maribor', postedAt: null,
    country: 'SI', workModes: [], ...over,
  });

  it('fetches the body for on-topic and generic titles anywhere in Slovenia', () => {
    expect(needsDetail(item({ title: 'Koordinator izobraževanj (m/ž)' }))).toBe(true);
    expect(needsDetail(item({ title: 'Strokovni sodelavec (m/ž)' }))).toBe(true);
  });

  it('fetches the body for a remote or hybrid role whatever its title', () => {
    expect(needsDetail(item({ workModes: ['Hibridno (delno od doma)'] }))).toBe(true);
  });

  it('skips an off-target title, and anything already stored', () => {
    expect(needsDetail(item({}))).toBe(false);
    expect(needsDetail(item({ title: 'Koordinator izobraževanj' }), { hasDetail: () => true })).toBe(false);
  });
});

describe('workModeLabel and salaryText', () => {
  it('reads home plus on-site as hybrid', () => {
    expect(workModeLabel(['Od doma', 'Na delovnem mestu'])).toBe('Hibridno (delno od doma)');
    expect(workModeLabel([])).toBeNull();
  });

  it('treats a negotiable salary as unpublished', () => {
    expect(salaryText({ translation: 'po dogovoru' })).toBeNull();
    expect(salaryText({ translation: '1.800 – 2.200 € bruto' })).toBe('1.800 – 2.200 € bruto');
  });
});

describe('toLocalDate', () => {
  it('takes the calendar date in Ljubljana time', () => {
    expect(toLocalDate('2026-08-20T22:00:00.000Z')).toBe('2026-08-21');
  });
});
