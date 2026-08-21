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

  it('extracts only numeric posting ids, filtering out tag and company links', () => {
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.sourceId).toMatch(/^\d+$/);
    const allDeloLinks = (listing.match(/href="\/delo\//g) ?? []).length;
    expect(rows.length).toBeLessThan(allDeloLinks);
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
    expect(parsed.postedAt).toBe('2026-08-18');
  });

  it('extracts the location', () => {
    expect(parsed.location).toBe('Ljubljana');
  });
});
