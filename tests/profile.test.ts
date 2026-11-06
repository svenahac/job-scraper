import { describe, it, expect } from 'vitest';
import * as profile from '../src/profile.js';
import { AREAS, CONTEXTUAL, SEARCH_TERMS_EN, SEARCH_TERMS_SL } from '../src/profile.js';
import { termRegex } from '../src/match.js';

const lists = Object.entries(profile).flatMap(([name, value]): Array<[string, string]> => {
  if (!Array.isArray(value)) return [];
  return value.flatMap((v: unknown): Array<[string, string]> => {
    if (typeof v === 'string') return [[name, v]];
    if (v && typeof v === 'object' && 'terms' in v) {
      return (v as { terms: string[] }).terms.map((t) => [name, t] as [string, string]);
    }
    if (v && typeof v === 'object' && 'title' in v) {
      const a = v as { title: string[]; body: string[] };
      return [...a.title, ...a.body].map((t) => [name, t] as [string, string]);
    }
    return [];
  });
});

describe('profile', () => {
  it('has the role families from the brief', () => {
    expect(AREAS.map((a) => a.key)).toEqual([
      'ld', 'projects', 'education', 'digital', 'counselling', 'institutions', 'related',
    ]);
    for (const a of AREAS) {
      expect(a.label.length).toBeGreaterThan(3);
      expect(a.title.length).toBeGreaterThan(5);
      expect(a.body.length).toBeGreaterThan(5);
    }
  });

  it('writes every term in lowercase', () => {
    for (const [name, term] of lists) {
      if (['SEARCH_TERMS_EN', 'SEARCH_TERMS_SL'].includes(name)) continue;
      expect(term, `${name}: ${term}`).toBe(term.toLowerCase());
    }
  });

  it('compiles every term', () => {
    for (const [, term] of lists) expect(() => termRegex(term)).not.toThrow();
  });

  it('lists every contextual term in some area title list', () => {
    const titles = new Set(AREAS.flatMap((a) => a.title));
    for (const t of CONTEXTUAL) expect(titles.has(t), t).toBe(true);
  });

  it('has search terms for keyword-driven sources', () => {
    expect(SEARCH_TERMS_EN.length).toBeGreaterThan(5);
    expect(SEARCH_TERMS_SL.length).toBeGreaterThan(5);
  });
});
