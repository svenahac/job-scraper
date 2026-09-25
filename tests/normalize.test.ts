import { describe, it, expect } from 'vitest';
import { makeId, toJob } from '../src/normalize.js';
import type { RawJob } from '../src/types.js';
import type { Classification } from '../src/classify.js';

const raw: RawJob = {
  source: 'zrsz', sourceId: '8052', url: 'https://www.ess.gov.si/iskalci-zaposlitve/iskanje-zaposlitve/iskanje-dela/?idp=8052/#/pdm/8052',
  title: 'Frontend Developer', company: 'Acme', location: 'Ljubljana',
  postedAt: '2026-08-18', description: 'Delo.', tags: ['React'],
};

const classification = (over: Partial<Classification> = {}): Classification => ({
  areas: [], area: null, areaRank: 0, workMode: 'unknown', employmentType: 'unknown',
  flags: [], seniority: 'junior', score: 0, rejected: false,
  ...over,
});

describe('makeId', () => {
  it('is stable across calls', () => {
    expect(makeId('zrsz', '8052')).toBe(makeId('zrsz', '8052'));
  });

  it('differs between sources sharing an id', () => {
    expect(makeId('zrsz', '8052')).not.toBe(makeId('mojedelo', '8052'));
  });

  it('is 16 hex characters', () => {
    expect(makeId('zrsz', '8052')).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('toJob', () => {
  it('sets both timestamps to the run time', () => {
    const now = '2026-08-21T17:00:00.000Z';
    const job = toJob(raw, classification(), now);
    expect(job.firstSeenAt).toBe(now);
    expect(job.lastSeenAt).toBe(now);
  });

  it('carries classification fields onto the job', () => {
    const job = toJob(raw, classification({ area: 'ld', areaRank: 1, score: 75 }), 'T');
    expect(job.area).toBe('ld');
    expect(job.score).toBe(75);
  });

  it('carries the source fields through unchanged', () => {
    const job = toJob(raw, classification({ seniority: 'mid' }), 'T');
    expect(job.title).toBe('Frontend Developer');
    expect(job.url).toBe('https://www.ess.gov.si/iskalci-zaposlitve/iskanje-zaposlitve/iskanje-dela/?idp=8052/#/pdm/8052');
    expect(job.seniority).toBe('mid');
  });
});
