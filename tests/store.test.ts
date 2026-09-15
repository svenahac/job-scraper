import { describe, it, expect } from 'vitest';
import { openDb, upsertJobs, allJobs, jobsFirstSeenAt } from '../src/store.js';
import type { Job } from '../src/types.js';

const job = (over: Partial<Job> = {}): Job => ({
  source: 'zrsz', sourceId: '8052', url: 'https://www.ess.gov.si/iskalci-zaposlitve/iskanje-zaposlitve/iskanje-dela/?idp=8052/#/pdm/8052',
  title: 'Frontend Developer', company: 'Acme', location: 'Ljubljana',
  postedAt: '2026-08-18', description: 'Delo.', tags: ['React'],
  id: 'aaaa000000000001', area: '', areaRank: 0, areas: '', workMode: 'unknown',
  employmentType: 'unknown', locationTier: 'other', flags: '', score: 0,
  seniority: 'junior',
  firstSeenAt: '2026-08-21T17:00:00.000Z', lastSeenAt: '2026-08-21T17:00:00.000Z',
  ...over,
});

describe('store', () => {
  it('round-trips a job', () => {
    const db = openDb(':memory:');
    upsertJobs(db, [job()]);
    const rows = allJobs(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.title).toBe('Frontend Developer');
    expect(rows[0]!.tags).toEqual(['React']);
  });

  it('does not duplicate a job seen twice', () => {
    const db = openDb(':memory:');
    upsertJobs(db, [job()]);
    upsertJobs(db, [job({ lastSeenAt: '2026-08-22T17:00:00.000Z' })]);
    expect(allJobs(db)).toHaveLength(1);
  });

  it('never overwrites first_seen_at', () => {
    const db = openDb(':memory:');
    upsertJobs(db, [job()]);
    upsertJobs(db, [job({
      firstSeenAt: '2026-08-22T17:00:00.000Z',
      lastSeenAt: '2026-08-22T17:00:00.000Z',
    })]);
    expect(allJobs(db)[0]!.firstSeenAt).toBe('2026-08-21T17:00:00.000Z');
  });

  it('updates last_seen_at and mutable fields on re-ingest', () => {
    const db = openDb(':memory:');
    upsertJobs(db, [job()]);
    upsertJobs(db, [job({ title: 'Frontend Developer (m/ž)', lastSeenAt: 'T2' })]);
    const row = allJobs(db)[0]!;
    expect(row.title).toBe('Frontend Developer (m/ž)');
    expect(row.lastSeenAt).toBe('T2');
  });

  it('reports only jobs first seen at the given run timestamp', () => {
    const db = openDb(':memory:');
    const run1 = '2026-08-21T17:00:00.000Z';
    const run2 = '2026-08-22T17:00:00.000Z';
    upsertJobs(db, [job({ id: 'a1', firstSeenAt: run1, lastSeenAt: run1 })]);
    upsertJobs(db, [
      job({ id: 'a1', firstSeenAt: run2, lastSeenAt: run2 }),
      job({ id: 'b2', sourceId: '9000', firstSeenAt: run2, lastSeenAt: run2 }),
    ]);
    const fresh = jobsFirstSeenAt(db, run2);
    expect(fresh.map((j) => j.id)).toEqual(['b2']);
  });

  it('round-trips the new classification fields', () => {
    const db = openDb(':memory:');
    upsertJobs(db, [job({ area: 'ld', areaRank: 1, areas: 'ld,hr', score: 75,
      workMode: 'hybrid', employmentType: 'permanent', locationTier: 'ljubljana',
      flags: 'body:payroll', employmentRaw: 'Nedoločen čas',
      workTimeRaw: '40 ur/teden', occupation: 'Kadrovnik' })]);
    const [back] = allJobs(db);
    expect(back!.area).toBe('ld');
    expect(back!.areaRank).toBe(1);
    expect(back!.areas).toBe('ld,hr');
    expect(back!.score).toBe(75);
    expect(back!.workMode).toBe('hybrid');
    expect(back!.employmentType).toBe('permanent');
    expect(back!.locationTier).toBe('ljubljana');
    expect(back!.flags).toBe('body:payroll');
    expect(back!.employmentRaw).toBe('Nedoločen čas');
    expect(back!.occupation).toBe('Kadrovnik');
    db.close();
  });

  it('orders jobs by score descending', () => {
    const db = openDb(':memory:');
    upsertJobs(db, [
      job({ id: 'low', sourceId: 'low', score: 20 }),
      job({ id: 'high', sourceId: 'high', score: 80 }),
    ]);
    expect(allJobs(db).map((j) => j.id)).toEqual(['high', 'low']);
    db.close();
  });
});
