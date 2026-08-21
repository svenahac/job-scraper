import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseGuestCards } from '../../src/sources/linkedin.js';

const html = readFileSync('tests/fixtures/linkedin-guest.html', 'utf8');

describe('parseGuestCards', () => {
  const cards = parseGuestCards(html);

  it('finds job cards', () => {
    expect(cards.length).toBeGreaterThan(0);
  });

  it('extracts the numeric job id from the URL tail', () => {
    expect(cards[0]!.sourceId).toMatch(/^\d+$/);
  });

  it('strips tracking parameters from the URL', () => {
    expect(cards[0]!.url).not.toContain('trackingId');
    expect(cards[0]!.url).not.toContain('refId');
  });

  it('extracts a title', () => {
    expect(cards[0]!.title.length).toBeGreaterThan(3);
  });

  it('extracts a company', () => {
    expect(cards.some((c) => c.company !== null)).toBe(true);
  });

  it('deduplicates cards repeated within one response', () => {
    const ids = cards.map((c) => c.sourceId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('returns an empty array for an empty response body', () => {
    expect(parseGuestCards('')).toEqual([]);
  });
});
