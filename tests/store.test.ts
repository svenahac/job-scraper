import { describe, it, expect } from 'vitest';
import { openDb, upsertJobs, allJobs, jobsFirstSeenAt } from '../src/store.js';
import type { Job } from '../src/types.js';

const job = (over: Partial<Job> = {}): Job => ({
  source: 'slotech', sourceId: '8052', url: 'https://slo-tech.com/delo/8052',
  title: 'Frontend Developer', company: 'Acme', location: 'Ljubljana',
  postedAt: '2026-08-18', description: 'Delo.', tags: ['React'],
  id: 'aaaa000000000001', roleMatch: 'frontend', seniority: 'junior',
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
});
