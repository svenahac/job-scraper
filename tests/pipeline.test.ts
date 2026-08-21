import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runScrape } from '../src/index.js';
import type { RawJob, Source } from '../src/types.js';

const raw = (over: Partial<RawJob>): RawJob => ({
  source: 'stub', sourceId: '1', url: 'https://x/1', title: '', company: 'Acme',
  location: 'Ljubljana', postedAt: '2026-08-18', description: '', tags: [], ...over,
});

const stub = (name: string, jobs: RawJob[]): Source => ({
  name,
  fetchJobs: async () => jobs.map((j) => ({ ...j, source: name })),
});

const exploding = (name: string): Source => ({
  name,
  fetchJobs: async () => { throw new Error('rate limited'); },
});

let dir: string;
const paths = () => ({
  dbPath: join(dir, 'jobs.db'),
  allCsvPath: join(dir, 'jobs-all.csv'),
  newCsvPath: join(dir, 'jobs-new.csv'),
});

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'scraper-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe('runScrape', () => {
  it('keeps a junior web job and drops a senior one', async () => {
    const src = stub('a', [
      raw({ sourceId: '1', title: 'Junior Frontend Developer' }),
      raw({ sourceId: '2', title: 'Senior Frontend Developer' }),
    ]);
    const r = await runScrape({ sources: [src], now: 'T1', ...paths() });
    expect(r.kept).toBe(1);
    const csv = readFileSync(paths().allCsvPath, 'utf8');
    expect(csv).toContain('Junior Frontend Developer');
    expect(csv).not.toContain('Senior Frontend Developer');
  });

  it('drops a non-web job', async () => {
    const src = stub('a', [raw({ sourceId: '1', title: 'Robotics Engineer', description: 'C++' })]);
    const r = await runScrape({ sources: [src], now: 'T1', ...paths() });
    expect(r.kept).toBe(0);
  });

  it('records a failing source and still writes CSVs from the others', async () => {
    const good = stub('good', [raw({ sourceId: '1', title: 'Junior Frontend Developer' })]);
    const r = await runScrape({ sources: [exploding('bad'), good], now: 'T1', ...paths() });
    expect(r.succeeded).toEqual(['good']);
    expect(r.failed[0]!.source).toBe('bad');
    expect(r.kept).toBe(1);
    expect(readFileSync(paths().allCsvPath, 'utf8')).toContain('Junior Frontend Developer');
  });

  it('reports a job as new only on the run that first saw it', async () => {
    const src = stub('a', [raw({ sourceId: '1', title: 'Junior Frontend Developer' })]);
    const first = await runScrape({ sources: [src], now: 'T1', ...paths() });
    expect(first.newCount).toBe(1);
    expect(readFileSync(paths().newCsvPath, 'utf8')).toContain('Junior Frontend Developer');

    const second = await runScrape({ sources: [src], now: 'T2', ...paths() });
    expect(second.newCount).toBe(0);
    expect(readFileSync(paths().newCsvPath, 'utf8')).not.toContain('Junior Frontend Developer');
    // The job is still in the full CSV.
    expect(readFileSync(paths().allCsvPath, 'utf8')).toContain('Junior Frontend Developer');
  });

  it('reports only the genuinely new job on a later run', async () => {
    const one = stub('a', [raw({ sourceId: '1', title: 'Junior Frontend Developer' })]);
    await runScrape({ sources: [one], now: 'T1', ...paths() });
    const two = stub('a', [
      raw({ sourceId: '1', title: 'Junior Frontend Developer' }),
      raw({ sourceId: '2', title: 'Medior Vue Developer' }),
    ]);
    const r = await runScrape({ sources: [two], now: 'T2', ...paths() });
    expect(r.newCount).toBe(1);
    const csv = readFileSync(paths().newCsvPath, 'utf8');
    expect(csv).toContain('Medior Vue Developer');
    expect(csv).not.toContain('Junior Frontend Developer');
  });
});
