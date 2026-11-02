import { describe, it, expect } from 'vitest';
import { makeId, toJob } from '../src/normalize.js';
import { classify } from '../src/classify.js';
import type { RawJob } from '../src/types.js';

const raw: RawJob = {
  source: 'zrsz', sourceId: '8052', url: 'https://example.test/8052',
  title: 'Koordinator izobraževanj', company: 'Acme', location: 'Ljubljana',
  postedAt: '2026-10-18', description: 'Organizacija izobraževanj.', tags: [], country: 'SI',
};

describe('makeId', () => {
  it('is stable, source-specific, and 16 hex characters', () => {
    expect(makeId('zrsz', '8052')).toBe(makeId('zrsz', '8052'));
    expect(makeId('zrsz', '8052')).not.toBe(makeId('mojedelo', '8052'));
    expect(makeId('zrsz', '8052')).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('toJob', () => {
  it('stamps both timestamps with the run time and carries the classification', () => {
    const c = classify(raw);
    const job = toJob(raw, c, '2026-10-21T17:00:00.000Z');
    expect(job.firstSeenAt).toBe('2026-10-21T17:00:00.000Z');
    expect(job.lastSeenAt).toBe('2026-10-21T17:00:00.000Z');
    expect(job.area).toBe('ld');
    expect(job.locationClass).toBe('ljubljana');
    expect(job.score).toBe(c.score);
    expect(JSON.parse(job.reasons)).toEqual(c.reasons);
    expect(JSON.parse(job.scoreParts)).toEqual(c.parts);
    expect(job.title).toBe(raw.title);
  });
});
