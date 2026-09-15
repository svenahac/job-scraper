import { describe, it, expect } from 'vitest';
import {
  AREAS, TITLE_REJECT, BODY_WARN, CONTRACT_REJECT,
  REMOTE_MARKERS, HYBRID_MARKERS, PRIMARY_LOCATIONS, leadQueryTerms,
} from '../src/profile.js';

describe('AREAS', () => {
  it('has eight areas ranked 1 to 8 with no gaps or duplicates', () => {
    expect(AREAS).toHaveLength(8);
    expect(AREAS.map((a) => a.rank).sort((x, y) => x - y)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('ranks learning and development first', () => {
    expect(AREAS.find((a) => a.rank === 1)!.key).toBe('ld');
  });

  it('gives every area a unique key, a label, keywords and query terms', () => {
    expect(new Set(AREAS.map((a) => a.key)).size).toBe(8);
    for (const a of AREAS) {
      expect(a.label.length).toBeGreaterThan(3);
      expect(a.keywords.length).toBeGreaterThan(0);
      expect(a.queryTerms.length).toBeGreaterThan(0);
    }
  });

  it('stores every keyword lowercase, so matching never has to case-fold the profile', () => {
    for (const a of AREAS) {
      for (const k of a.keywords) expect(k).toBe(k.toLowerCase());
    }
  });

  it('draws every query term from its own keyword list', () => {
    for (const a of AREAS) {
      for (const q of a.queryTerms) expect(a.keywords).toContain(q);
    }
  });
});

describe('rejection lists', () => {
  it('never rejects a title phrase that is also an area keyword', () => {
    const keywords = new Set(AREAS.flatMap((a) => [...a.keywords]));
    for (const r of TITLE_REJECT) expect(keywords.has(r)).toBe(false);
  });

  it('does not list "referent za", which would drop adult-education roles', () => {
    expect(TITLE_REJECT).not.toContain('referent za');
  });

  it('rejects the unambiguous non-starters by title', () => {
    for (const t of ['računovodja', 'komercialist', 'klicni center', 'payroll']) {
      expect(TITLE_REJECT).toContain(t);
    }
  });

  it('warns on administrative HR duties without rejecting them', () => {
    expect(BODY_WARN).toContain('kadrovska administracija');
    expect(TITLE_REJECT).not.toContain('kadrovska administracija');
  });

  it('rejects student work and internships by contract', () => {
    for (const c of ['študentsko delo', 'praksa', 'pripravnik']) {
      expect(CONTRACT_REJECT).toContain(c);
    }
  });

  it('keeps all list entries lowercase', () => {
    for (const list of [TITLE_REJECT, BODY_WARN, CONTRACT_REJECT,
                        REMOTE_MARKERS, HYBRID_MARKERS, PRIMARY_LOCATIONS]) {
      for (const e of list) expect(e).toBe(e.toLowerCase());
    }
  });
});

describe('leadQueryTerms', () => {
  it('returns one term per area, best rank first', () => {
    const terms = leadQueryTerms();
    expect(terms).toHaveLength(8);
    expect(terms[0]).toBe(AREAS.find((a) => a.rank === 1)!.queryTerms[0]);
  });
});
