import { describe, it, expect } from 'vitest';
import { stripHtml, sleep, USER_AGENT } from '../src/http.js';

describe('stripHtml', () => {
  it('removes tags and keeps the text', () => {
    expect(stripHtml('<ul><li><p>Razvoj v C++</p></li></ul>')).toBe('Razvoj v C++');
  });

  it('inserts a space between adjacent blocks so words do not fuse', () => {
    expect(stripHtml('<p>Zahtevamo</p><p>3+ let</p>')).toBe('Zahtevamo 3+ let');
  });

  it('decodes numeric and named entities', () => {
    expect(stripHtml('Programski in&#382;enir &amp; razvijalec')).toBe('Programski inženir & razvijalec');
  });

  it('collapses runs of whitespace', () => {
    expect(stripHtml('a   \n\n  b')).toBe('a b');
  });

  it('returns an empty string for empty input', () => {
    expect(stripHtml('')).toBe('');
  });
});

describe('sleep', () => {
  it('resolves', async () => {
    await expect(sleep(1)).resolves.toBeUndefined();
  });
});

describe('USER_AGENT', () => {
  it('identifies the scraper and links to the repo', () => {
    expect(USER_AGENT).toMatch(/job-scraper/);
  });
});
