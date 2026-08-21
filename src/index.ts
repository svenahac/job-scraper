import { join } from 'node:path';
import type { Job, RawJob, Source } from './types.js';
import { classify, isWanted } from './classify.js';
import { toJob } from './normalize.js';
import { openDb, upsertJobs, allJobs, jobsFirstSeenAt } from './store.js';
import { writeCsv } from './csv.js';
import { sloTechSource } from './sources/slotech.js';
import { mojeDeloSource } from './sources/mojedelo.js';
import { linkedInSource } from './sources/linkedin.js';

export interface RunResult {
  succeeded: string[];
  failed: Array<{ source: string; error: string }>;
  kept: number;
  newCount: number;
}

export interface RunOptions {
  sources: Source[];
  now: string;
  dbPath: string;
  allCsvPath: string;
  newCsvPath: string;
}

export async function runScrape(opts: RunOptions): Promise<RunResult> {
  const succeeded: string[] = [];
  const failed: Array<{ source: string; error: string }> = [];
  const raws: RawJob[] = [];

  for (const source of opts.sources) {
    try {
      const jobs = await source.fetchJobs();
      raws.push(...jobs);
      succeeded.push(source.name);
      console.log(`[${source.name}] fetched ${jobs.length} postings`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      failed.push({ source: source.name, error: message });
      console.error(`[${source.name}] FAILED: ${message}`);
    }
  }

  const kept: Job[] = [];
  for (const raw of raws) {
    const c = classify(raw);
    if (isWanted(c)) kept.push(toJob(raw, c, opts.now));
  }
  console.log(`kept ${kept.length} of ${raws.length} postings after filtering`);

  const db = openDb(opts.dbPath);
  try {
    upsertJobs(db, kept);
    const fresh = jobsFirstSeenAt(db, opts.now);
    writeCsv(opts.allCsvPath, allJobs(db));
    writeCsv(opts.newCsvPath, fresh);
    console.log(`${fresh.length} new postings this run`);
    return { succeeded, failed, kept: kept.length, newCount: fresh.length };
  } finally {
    db.close();
  }
}

async function main(): Promise<void> {
  const dataDir = join(process.cwd(), 'data');
  const sources = [sloTechSource, mojeDeloSource, linkedInSource];

  const result = await runScrape({
    sources,
    now: new Date().toISOString(),
    dbPath: join(dataDir, 'jobs.db'),
    allCsvPath: join(dataDir, 'jobs-all.csv'),
    newCsvPath: join(dataDir, 'jobs-new.csv'),
  });

  // Only a total washout is a failure. One or two blocked sources is the
  // expected steady state, especially for LinkedIn from a datacenter IP.
  if (result.succeeded.length === 0) {
    console.error('all sources failed');
    process.exit(1);
  }
}

// Run main only when executed directly, so tests can import runScrape freely.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
