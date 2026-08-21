import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseSearchPage, parseDetail, buildJobUrl } from '../../src/sources/mojedelo.js';

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
