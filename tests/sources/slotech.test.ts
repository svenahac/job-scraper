import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseListing, parseDetail } from '../../src/sources/slotech.js';

const listing = readFileSync('tests/fixtures/slotech-listing.html', 'utf8');
const detail = readFileSync('tests/fixtures/slotech-detail.html', 'utf8');

describe('parseListing', () => {
  const rows = parseListing(listing);

  it('finds job rows', () => {
    expect(rows.length).toBeGreaterThan(5);
  });

  it('extracts a numeric source id from the href', () => {
    expect(rows[0]!.sourceId).toMatch(/^\d+$/);
  });

  it('extracts a non-empty title', () => {
    expect(rows[0]!.title.length).toBeGreaterThan(3);
  });

  it('decodes Slovenian diacritics rather than leaving entities', () => {
    const joined = rows.map((r) => r.title).join(' ');
    expect(joined).not.toContain('&#');
  });

  it('extracts the company', () => {
    expect(rows.some((r) => r.company !== null && r.company.length > 1)).toBe(true);
  });

  it('extracts technology tags for at least one row', () => {
    expect(rows.some((r) => r.tags.length > 0)).toBe(true);
  });

  it('does not treat tag-cloud links as job rows', () => {
    expect(rows.every((r) => !r.sourceId.includes('tagi'))).toBe(true);
  });
});

describe('parseDetail', () => {
  const parsed = parseDetail(detail);

  it('extracts substantial body text', () => {
    expect(parsed.description.length).toBeGreaterThan(200);
  });

  it('strips HTML tags from the body', () => {
    expect(parsed.description).not.toContain('<');
  });

  it('extracts the posted date as an ISO date', () => {
    expect(parsed.postedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
