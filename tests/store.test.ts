import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import {
  openDb, upsertJobs, allJobs, jobsFirstSeenAt, deleteJobs, checkedIds, markChecked,
  pruneChecked, recordSourceRun, sourceRuns,
} from '../src/store.js';
import type { Job } from '../src/types.js';

const job = (over: Partial<Job> = {}): Job => ({
  source: 'zrsz', sourceId: '8052', url: 'https://example.test/8052',
  title: 'Koordinator izobraževanj', company: 'Acme', location: 'Ljubljana',
  postedAt: '2026-10-18', description: 'Organizacija izobraževanj.', tags: ['Andragog'],
  employmentRaw: 'Nedoločen čas', workTimeRaw: '40 ur/teden', occupation: 'Andragog',
  deadline: '2026-11-20', salary: '2.000 € bruto', experienceRaw: '1 leto',
  languagesRaw: 'angleški jezik', workModeRaw: 'Hibridno', country: 'SI', international: false,
  id: 'aaaa000000000001', area: 'ld', areas: 'ld,education', workMode: 'hybrid',
  employmentType: 'permanent', locationClass: 'ljubljana', flags: '', seniority: 'junior',
  minYears: 1, score: 72, reasons: '[{"kind":"fit","text":"x"}]', scoreParts: '{"relevance":35}',
  firstSeenAt: '2026-10-21T17:00:00.000Z', lastSeenAt: '2026-10-21T17:00:00.000Z',
  ...over,
});

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'store-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe('jobs', () => {
  it('round-trips every field', () => {
    const db = openDb(join(dir, 'jobs.db'));
    upsertJobs(db, [job()]);
    expect(allJobs(db)).toEqual([job()]);
    db.close();
  });

  it('never overwrites first_seen_at, and updates the rest', () => {
    const db = openDb(join(dir, 'jobs.db'));
    upsertJobs(db, [job()]);
    upsertJobs(db, [job({ firstSeenAt: '2026-10-22T17:00:00.000Z', lastSeenAt: '2026-10-22T17:00:00.000Z', score: 50 })]);
    const [stored] = allJobs(db);
    expect(stored!.firstSeenAt).toBe('2026-10-21T17:00:00.000Z');
    expect(stored!.lastSeenAt).toBe('2026-10-22T17:00:00.000Z');
    expect(stored!.score).toBe(50);
    db.close();
  });

  it('reports jobs first seen at a run, and deletes by id', () => {
    const db = openDb(join(dir, 'jobs.db'));
    upsertJobs(db, [job(), job({ id: 'b', sourceId: '2', firstSeenAt: '2026-10-22T17:00:00.000Z' })]);
    expect(jobsFirstSeenAt(db, '2026-10-22T17:00:00.000Z').map((j) => j.id)).toEqual(['b']);
    deleteJobs(db, ['b']);
    expect(allJobs(db).map((j) => j.id)).toEqual(['aaaa000000000001']);
    db.close();
  });

  it('drops a table written by the CSV-era scraper', () => {
    const path = join(dir, 'old.db');
    const old = new Database(path);
    old.exec(`CREATE TABLE jobs (id TEXT PRIMARY KEY, area_rank INTEGER NOT NULL)`);
    old.exec(`INSERT INTO jobs VALUES ('x', 1)`);
    old.close();
    const db = openDb(path);
    expect(allJobs(db)).toEqual([]);
    upsertJobs(db, [job()]);
    expect(allJobs(db)).toHaveLength(1);
    db.close();
  });
});

describe('checked', () => {
  it('remembers a verdict only for the same profile and within its lifetime', () => {
    const db = openDb(join(dir, 'jobs.db'));
    markChecked(db, ['a', 'b'], 'p1', '2026-10-20T00:00:00.000Z');
    expect(checkedIds(db, 'p1', '2026-10-01T00:00:00.000Z')).toEqual(new Set(['a', 'b']));
    expect(checkedIds(db, 'p2', '2026-10-01T00:00:00.000Z').size).toBe(0);
    expect(checkedIds(db, 'p1', '2026-10-25T00:00:00.000Z').size).toBe(0);
    pruneChecked(db, '2026-10-25T00:00:00.000Z');
    expect(checkedIds(db, 'p1', '2000-01-01T00:00:00.000Z').size).toBe(0);
    db.close();
  });
});

describe('source runs', () => {
  it('keeps the last success through a later failure', () => {
    const db = openDb(join(dir, 'jobs.db'));
    recordSourceRun(db, 'linkedin', true, 30, '2026-10-20T17:00:00.000Z');
    recordSourceRun(db, 'linkedin', false, 0, '2026-10-21T17:00:00.000Z');
    expect(sourceRuns(db).get('linkedin')).toEqual({
      name: 'linkedin', lastOkAt: '2026-10-20T17:00:00.000Z', lastCount: 30,
    });
    db.close();
  });
});
