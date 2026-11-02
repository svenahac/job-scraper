import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runScrape } from '../src/index.js';
import type { ExportFile } from '../src/export.js';
import type { FetchContext, RawJob, Source } from '../src/types.js';

const NOW = '2026-11-02T17:00:00.000Z';
const LATER = '2026-11-03T17:00:00.000Z';

const raw = (over: Partial<RawJob>): RawJob => ({
  source: 'stub', sourceId: '1', url: 'https://x/1', title: '', company: 'Acme',
  location: 'Ljubljana', postedAt: '2026-10-30', description: '', tags: [],
  employmentRaw: null, workTimeRaw: null, occupation: null, country: 'SI', ...over,
});

const stub = (name: string, jobs: RawJob[], extra: Partial<Source> = {}): Source => ({
  name,
  fetchJobs: async () => jobs.map((j) => ({ ...j, source: name })),
  ...extra,
});

let dir: string;
const paths = () => ({ dbPath: join(dir, 'jobs.db'), jsonPath: join(dir, 'jobs.json') });
const exported = (): ExportFile => JSON.parse(readFileSync(paths().jsonPath, 'utf8')) as ExportFile;

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'pipeline-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe('runScrape', () => {
  it('keeps a matching job, drops an unrelated one, and writes the app data file', async () => {
    const src = stub('a', [
      raw({ sourceId: '1', title: 'Koordinator izobraževanj (m/ž)' }),
      raw({ sourceId: '2', title: 'CNC operater (m/ž)' }),
    ]);
    const result = await runScrape({ sources: [src], now: NOW, ...paths() });
    expect(result.kept).toBe(1);
    const file = exported();
    expect(file.jobs.map((j) => j.title)).toEqual(['Koordinator izobraževanj (m/ž)']);
    expect(file.jobs[0]!.reasons.length).toBeGreaterThan(0);
    expect(file.sources).toEqual([expect.objectContaining({ name: 'a', ok: true, count: 2 })]);
  });

  it('records a failed source and still exports the others', async () => {
    const broken: Source = { name: 'linkedin', fetchJobs: async () => { throw new Error('429'); } };
    const result = await runScrape({
      sources: [stub('a', [raw({ title: 'Training Coordinator' })]), broken], now: NOW, ...paths(),
    });
    expect(result.failed).toEqual([{ source: 'linkedin', error: '429' }]);
    expect(exported().sources.find((s) => s.name === 'linkedin')).toMatchObject({ ok: false });
    expect(exported().jobs).toHaveLength(1);
  });

  it('merges one ad found on two portals', async () => {
    await runScrape({
      sources: [
        stub('zrsz', [raw({ title: 'KOORDINATOR IZOBRAŽEVANJ - M/Ž', company: 'ACME D.O.O.' })]),
        stub('mojedelo', [raw({ title: 'Koordinator izobraževanj (m/ž)', company: 'Acme d.o.o.' })]),
      ],
      now: NOW, ...paths(),
    });
    const jobs = exported().jobs;
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.sources.map((s) => s.source).sort()).toEqual(['mojedelo', 'zrsz']);
  });

  it('lets a source skip a detail it already fetched, and restores it', async () => {
    const body = 'Organizacija izobraževanj. Rok za prijavo do 20. 11. 2026.';
    const seen: boolean[] = [];
    const source = (withBody: boolean): Source => ({
      name: 'a',
      fetchJobs: async (ctx?: FetchContext) => {
        seen.push(ctx?.hasDetail('1') ?? false);
        const skip = !withBody || (ctx?.hasDetail('1') ?? false);
        return [raw({ source: 'a', title: 'Training Coordinator', description: skip ? '' : body, deadline: skip ? null : '2026-11-20' })];
      },
    });
    await runScrape({ sources: [source(true)], now: NOW, ...paths() });
    await runScrape({ sources: [source(false)], now: LATER, ...paths() });
    expect(seen).toEqual([false, true]);
    expect(exported().jobs[0]!.deadline).toBe('2026-11-20');
  });

  it('does not refetch a detail that was read and found not to fit', async () => {
    const asked: boolean[] = [];
    const source: Source = {
      name: 'a',
      fetchJobs: async (ctx?: FetchContext) => {
        const known = ctx?.hasDetail('9') ?? false;
        asked.push(known);
        return [raw({ source: 'a', sourceId: '9', title: 'Strokovni sodelavec', description: known ? '' : 'Vzdrževanje stavbe.' })];
      },
    };
    await runScrape({ sources: [source], now: NOW, ...paths() });
    await runScrape({ sources: [source], now: LATER, ...paths() });
    expect(asked).toEqual([false, true]);
    expect(exported().jobs).toHaveLength(0);
  });

  const listing = (n: number) => Array.from({ length: n }, (_, i) =>
    raw({ sourceId: String(i), title: i === 0 ? 'Learning Specialist' : `Hišnik ${i}` }));

  it('drops a stored ad that a complete source no longer lists', async () => {
    await runScrape({ sources: [stub('zrsz', listing(10), { complete: true })], now: NOW, ...paths() });
    await runScrape({ sources: [stub('zrsz', listing(10).slice(1), { complete: true })], now: LATER, ...paths() });
    expect(exported().jobs).toHaveLength(0);
  });

  it('distrusts a complete source whose listing came back far shorter than last time', async () => {
    await runScrape({ sources: [stub('zrsz', listing(10), { complete: true })], now: NOW, ...paths() });
    await runScrape({ sources: [stub('zrsz', listing(3).slice(1), { complete: true })], now: LATER, ...paths() });
    expect(exported().jobs.map((j) => j.title)).toEqual(['Learning Specialist']);
  });

  it('drops a stored posting that this run rejected on fresh detail', async () => {
    const body = (text: string): Source => ({
      name: 'a',
      fetchJobs: async () => [raw({ source: 'a', title: 'Learning and Development Specialist', description: text })],
    });
    await runScrape({ sources: [body('')], now: NOW, ...paths() });
    expect(exported().jobs).toHaveLength(1);
    await runScrape({ sources: [body('Zahtevamo najmanj 10 let delovnih izkušenj.')], now: LATER, ...paths() });
    expect(exported().jobs).toHaveLength(0);
  });

  it('does not count an old posting as stale on a source that only lists recent ones', async () => {
    const recentOnly = (jobs: RawJob[]): Source => stub('eures', jobs, { listingDays: 7 });
    const job = raw({ title: 'Training Coordinator', postedAt: '2026-10-01' });
    await runScrape({ sources: [recentOnly([job])], now: '2026-10-02T17:00:00.000Z', ...paths() });
    await runScrape({ sources: [recentOnly([])], now: '2026-10-25T17:00:00.000Z', ...paths() });
    expect(exported().jobs).toHaveLength(1);
  });

  it('keeps a stored ad from an incomplete source that was merely not returned', async () => {
    await runScrape({ sources: [stub('linkedin', [raw({ title: 'Training Coordinator' })])], now: NOW, ...paths() });
    await runScrape({ sources: [stub('linkedin', [])], now: LATER, ...paths() });
    expect(exported().jobs).toHaveLength(1);
  });

  it('remembers the first-seen time across runs', async () => {
    const src = stub('a', [raw({ title: 'Training Coordinator' })]);
    await runScrape({ sources: [src], now: NOW, ...paths() });
    const second = await runScrape({ sources: [src], now: LATER, ...paths() });
    expect(second.newCount).toBe(0);
    expect(exported().jobs[0]!.firstSeenAt).toBe(NOW);
  });
});
