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

  it('extracts a company for every card', () => {
    expect(cards.length).toBeGreaterThan(0);
    for (const c of cards) expect(c.company).toMatch(/\S/);
  });

  it('extracts a location for every card', () => {
    for (const c of cards) expect(c.location).toMatch(/\S/);
  });

  it('deduplicates cards repeated within one response', () => {
    const ids = cards.map((c) => c.sourceId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('deduplicates a card repeated within one response', () => {
    const card = (id: string) => `
      <div class="base-card">
        <a class="base-card__full-link"
           href="https://si.linkedin.com/jobs/view/web-developer-at-acme-${id}?trackingId=abc">
          <span class="sr-only">Web Developer</span>
        </a>
        <h4 class="base-search-card__subtitle"><a>Acme d.o.o.</a></h4>
        <span class="job-search-card__location">Ljubljana</span>
      </div>`;

    const cards = parseGuestCards(card('4455728200') + card('4455728200') + card('4455728201'));
    expect(cards.map((c) => c.sourceId)).toEqual(['4455728200', '4455728201']);
  });

  it('returns an empty array for an empty response body', () => {
    expect(parseGuestCards('')).toEqual([]);
  });
});
