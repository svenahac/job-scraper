import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runScrape } from '../src/index.js';
import type { RawJob, Source } from '../src/types.js';

const raw = (over: Partial<RawJob>): RawJob => ({
  source: 'stub', sourceId: '1', url: 'https://x/1', title: '', company: 'Acme',
  location: 'Ljubljana', postedAt: '2026-08-18', description: '', tags: [],
  employmentRaw: null, workTimeRaw: null, occupation: null, ...over,
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
  it('keeps a matching job and drops one that matches no area', async () => {
    const src = stub('a', [
      raw({ sourceId: '1', title: 'Specialist za razvoj kadrov (m/ž)' }),
      raw({ sourceId: '2', title: 'CNC operater (m/ž)' }),
    ]);
    const result = await runScrape({ sources: [src], now: '2026-08-21T00:00:00.000Z', ...paths() });
    expect(result.kept).toBe(1);
    const csv = readFileSync(paths().allCsvPath, 'utf8');
    expect(csv).toContain('Specialist za razvoj kadrov (m/ž)');
    expect(csv).not.toContain('CNC operater (m/ž)');
  });

  it('keeps a senior job, because seniority never excludes', async () => {
    const src = stub('a', [raw({
      sourceId: '1', title: 'Vodja za razvoj kadrov (m/ž)',
      description: 'Zahtevamo vsaj 8 let izkušenj.',
    })]);
    const result = await runScrape({ sources: [src], now: '2026-08-21T00:00:00.000Z', ...paths() });
    expect(result.kept).toBe(1);
    const csv = readFileSync(paths().allCsvPath, 'utf8');
    expect(csv).toContain('Vodja za razvoj kadrov (m/ž)');
  });

  it('writes the CSV ordered by score, best fit first', async () => {
    const src = stub('a', [
      raw({ sourceId: '1', title: 'Koordinator dogodkov (m/ž)', location: 'Maribor' }),
      raw({ sourceId: '2', title: 'Specialist za razvoj kadrov (m/ž)', location: 'Ljubljana' }),
    ]);
    await runScrape({ sources: [src], now: 'T1', ...paths() });
    const csv = readFileSync(paths().allCsvPath, 'utf8');
    const lines = csv.trim().split('\n');
    expect(lines[1]).toContain('razvoj kadrov');
  });

  it('drops a non-web job', async () => {
    const src = stub('a', [raw({ sourceId: '1', title: 'Robotics Engineer', description: 'C++' })]);
    const r = await runScrape({ sources: [src], now: 'T1', ...paths() });
    expect(r.kept).toBe(0);
  });

  it('records a failing source and still writes CSVs from the others', async () => {
    const good = stub('good', [raw({ sourceId: '1', title: 'Specialist za razvoj kadrov (m/ž)' })]);
    const r = await runScrape({ sources: [exploding('bad'), good], now: 'T1', ...paths() });
    expect(r.succeeded).toEqual(['good']);
    expect(r.failed[0]!.source).toBe('bad');
    expect(r.kept).toBe(1);
    expect(readFileSync(paths().allCsvPath, 'utf8')).toContain('Specialist za razvoj kadrov (m/ž)');
  });

  it('reports a job as new only on the run that first saw it', async () => {
    const src = stub('a', [raw({ sourceId: '1', title: 'Specialist za razvoj kadrov (m/ž)' })]);
    const first = await runScrape({ sources: [src], now: 'T1', ...paths() });
    expect(first.newCount).toBe(1);
    expect(readFileSync(paths().newCsvPath, 'utf8')).toContain('Specialist za razvoj kadrov (m/ž)');

    const second = await runScrape({ sources: [src], now: 'T2', ...paths() });
    expect(second.newCount).toBe(0);
    expect(readFileSync(paths().newCsvPath, 'utf8')).not.toContain('Specialist za razvoj kadrov (m/ž)');
    // The job is still in the full CSV.
    expect(readFileSync(paths().allCsvPath, 'utf8')).toContain('Specialist za razvoj kadrov (m/ž)');
  });

  it('reports only the genuinely new job on a later run', async () => {
    const one = stub('a', [raw({ sourceId: '1', title: 'Specialist za razvoj kadrov (m/ž)' })]);
    await runScrape({ sources: [one], now: 'T1', ...paths() });
    const two = stub('a', [
      raw({ sourceId: '1', title: 'Specialist za razvoj kadrov (m/ž)' }),
      raw({ sourceId: '2', title: 'Projektni koordinator (m/ž)' }),
    ]);
    const r = await runScrape({ sources: [two], now: 'T2', ...paths() });
    expect(r.newCount).toBe(1);
    const csv = readFileSync(paths().newCsvPath, 'utf8');
    expect(csv).toContain('Projektni koordinator (m/ž)');
    expect(csv).not.toContain('Specialist za razvoj kadrov (m/ž)');
  });
});
