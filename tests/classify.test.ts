import { describe, it, expect } from 'vitest';
import { matchRole, matchSeniority, classify, isWanted } from '../src/classify.js';
import type { RawJob } from '../src/types.js';

const raw = (over: Partial<RawJob>): RawJob => ({
  source: 'test', sourceId: '1', url: 'https://x', title: '', company: null,
  location: null, postedAt: null, description: '', tags: [], ...over,
});

describe('matchRole', () => {
  it('matches a role keyword in the title', () => {
    expect(matchRole('Frontend Developer', [], '')).toContain('frontend');
  });

  it('matches a Slovenian role keyword in the body', () => {
    expect(matchRole('Razvijalec (m/ž)', [], 'Razvijamo spletne aplikacije.'))
      .toContain('spletne aplikacije');
  });

  it('matches a technology keyword in a tag', () => {
    expect(matchRole('Razvijalec (m/ž)', ['React', 'GIT'], '')).toContain('react');
  });

  it('matches a technology keyword in the body', () => {
    // Deliberate: recall is preferred over precision here.
    expect(matchRole('Razvijalec (m/ž)', [], 'Poznavanje TypeScripta je prednost.'))
      .toContain('typescript');
  });

  it('returns empty for a non-web role', () => {
    expect(matchRole('Software inženir (Robotics / UGV)', ['C++/C'],
      'Razvoj robotske programske opreme v C++ v Linux okolju.')).toEqual([]);
  });

  it('is case insensitive and preserves diacritics', () => {
    expect(matchRole('SPLETNI RAZVIJALEC', [], '')).toContain('spletni razvijalec');
  });
});

describe('matchSeniority', () => {
  it('detects an explicit senior title', () => {
    expect(matchSeniority('Senior Software Engineer (Backend)', [], '')).toBe('senior');
  });

  it('detects a Slovenian lead title', () => {
    expect(matchSeniority('Vodja razvoja', [], '')).toBe('senior');
  });

  it('does NOT mark a job senior because the body mentions a senior colleague', () => {
    expect(matchSeniority('Frontend Developer', [], 'Poročal boš senior razvijalcu.'))
      .toBe('unknown');
  });

  it('detects an explicit junior title', () => {
    expect(matchSeniority('Junior Frontend Developer', [], '')).toBe('junior');
  });

  it('detects the Slovenian junior marker', () => {
    expect(matchSeniority('Mlajši razvijalec (m/ž)', [], '')).toBe('junior');
  });

  it('detects an explicit mid marker', () => {
    expect(matchSeniority('Medior Frontend Developer', [], '')).toBe('mid');
  });

  it('prefers junior when an ad advertises junior/medior', () => {
    expect(matchSeniority('Junior/Medior razvijalec', [], '')).toBe('junior');
  });

  it('reads an open-ended years requirement as its stated number', () => {
    expect(matchSeniority('Razvijalec', [], 'Zahtevamo 3+ let izkušenj.')).toBe('mid');
  });

  it('excludes five or more years', () => {
    expect(matchSeniority('Razvijalec', [], 'Vsaj 5 let izkušenj.')).toBe('senior');
  });

  it('reads a range as its upper bound', () => {
    expect(matchSeniority('Razvijalec', [], 'Potrebujemo 1-2 leti izkušenj.')).toBe('junior');
  });

  it('takes the largest number when several are stated', () => {
    expect(matchSeniority('Razvijalec', [], '2 leti s Reactom, 6 let v razvoju.')).toBe('senior');
  });

  it('handles the singular Slovenian form', () => {
    expect(matchSeniority('Razvijalec', [], 'Vsaj 1 leto izkušenj.')).toBe('junior');
  });

  it('handles English phrasing', () => {
    expect(matchSeniority('Developer', [], 'At least 4 years of experience.')).toBe('mid');
  });

  it('does not read "letters" as a years requirement', () => {
    expect(matchSeniority('Razvijalec', [], '5 letters of code review needed.')).toBe('unknown');
  });

  it('does not read the Slovenian word "letalo" as a years requirement', () => {
    expect(matchSeniority('Razvijalec', [], 'Upravljamo 20 letalo.')).toBe('unknown');
  });

  it('does not read "letakov" as a years requirement', () => {
    expect(matchSeniority('Razvijalec', [], 'Izdelali smo 12 letakov.')).toBe('unknown');
  });

  it('still reads the English plural "years"', () => {
    expect(matchSeniority('Razvijalec', [], 'At least 4 years of experience.')).toBe('mid');
  });

  it('returns unknown when there is no signal at all', () => {
    expect(matchSeniority('Razvijalec programske opreme (m/ž)', [], 'Zanimivo delo.'))
      .toBe('unknown');
  });

  it('lets an explicit title marker win over a body years figure', () => {
    expect(matchSeniority('Junior Developer', [], 'Ekipa ima 10 let izkušenj.')).toBe('junior');
  });
});

describe('isWanted', () => {
  it('rejects a job with no role match', () => {
    expect(isWanted({ roleMatch: [], seniority: 'junior' })).toBe(false);
  });

  it('rejects a senior web job', () => {
    expect(isWanted({ roleMatch: ['react'], seniority: 'senior' })).toBe(false);
  });

  it('accepts an unknown-seniority web job', () => {
    expect(isWanted({ roleMatch: ['react'], seniority: 'unknown' })).toBe(true);
  });

  it('accepts a mid web job', () => {
    expect(isWanted({ roleMatch: ['fullstack'], seniority: 'mid' })).toBe(true);
  });
});

describe('classify', () => {
  it('classifies a full raw job', () => {
    const c = classify(raw({
      title: 'Junior Frontend Developer',
      tags: ['React'],
      description: 'Delo na spletnih aplikacijah.',
    }));
    expect(c.seniority).toBe('junior');
    expect(c.roleMatch).toContain('frontend');
    expect(isWanted(c)).toBe(true);
  });
});
