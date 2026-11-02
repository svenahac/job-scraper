import { describe, it, expect } from 'vitest';
import { fold, hits, hasAny, positions } from '../src/match.js';

describe('fold', () => {
  it('lowercases and drops diacritics', () => {
    expect(fold('Izobraževanje Odraslih ČŠŽ')).toBe('izobrazevanje odraslih csz');
  });
});

describe('hits', () => {
  it('matches a term as a word prefix, so inflections are found', () => {
    expect(hits(fold('Koordinatorka izobraževanja'), ['izobraževanj'])).toEqual(['izobraževanj']);
  });

  it('does not match in the middle of a word', () => {
    expect(hits(fold('preizobraževanje'), ['izobraževanj'])).toEqual([]);
  });

  it("expands '*' to any run of letters", () => {
    expect(hasAny(fold('koordinatorka izobraževanj'), ['koordinator* izobraževanj'])).toBe(true);
    expect(hasAny(fold('koordinator izobraževanj'), ['koordinator* izobraževanj'])).toBe(true);
  });

  it('matches terms shorter than four characters as whole words only', () => {
    expect(hasAny(fold('HR specialist'), ['hr'])).toBe(true);
    expect(hasAny(fold('znanje hrvaščine'), ['hr'])).toBe(false);
    expect(hasAny(fold('LMS-ja'), ['lms'])).toBe(true);
  });

  it("honours a trailing '$' as a word end", () => {
    expect(hasAny('programme director', ['director$'])).toBe(true);
    expect(hasAny('directorate-general for education', ['director$'])).toBe(false);
  });

  it('treats a hyphen as part of the word on the left', () => {
    expect(hasAny(fold('podpora e-mobilnosti'), ['mobilnost'])).toBe(false);
    expect(hasAny(fold('erasmus+ mobilnost'), ['mobilnost'])).toBe(true);
  });

  it('returns nothing for empty text', () => {
    expect(hits('', ['anything'])).toEqual([]);
  });
});

describe('positions', () => {
  it('finds every occurrence', () => {
    expect(positions('german and german', 'german$')).toEqual([0, 11]);
  });
});
