import { createHash } from 'node:crypto';
import { join } from 'node:path';
import type { FetchContext, Job, RawJob, Source } from './types.js';
import * as profile from './profile.js';
import { classify, isWanted } from './classify.js';
import { makeId, toJob } from './normalize.js';
import {
  openDb, upsertJobs, allJobs, deleteJobs, checkedIds, markChecked, pruneChecked,
  recordSourceRun, sourceRuns,
} from './store.js';
import { buildExport, writeExport, SOURCE_LABELS } from './export.js';
import type { SourceStatus } from './export.js';
import { zrszSource } from './sources/zrsz.js';
import { mojeDeloSource } from './sources/mojedelo.js';
import { linkedInSource } from './sources/linkedin.js';
import { himalayasSource } from './sources/himalayas.js';
import { optiusSource } from './sources/optius.js';
import { euroBrusselsSource } from './sources/eurobrussels.js';
import { euractivSource } from './sources/euractiv.js';
import { euCareersSource } from './sources/eucareers.js';
import { euresSource } from './sources/eures.js';

/** Bump when classify.ts changes meaning, so cached "not a fit" verdicts expire. */
const CLASSIFIER_VERSION = 4;

/** A cached "not a fit" verdict is trusted this long before the detail is refetched. */
const CHECKED_TTL_DAYS = 30;

/** Stored postings no source has listed for this long are assumed taken down. */
const STALE_DAYS = 14;

/** Stored postings older than this are dropped regardless. */
const RETENTION_DAYS = 90;

export interface RunResult {
  succeeded: string[];
  failed: Array<{ source: string; error: string }>;
  kept: number;
  newCount: number;
  exported: number;
}

export interface RunOptions {
  sources: Source[];
  now: string;
  dbPath: string;
  jsonPath: string;
}

const daysBefore = (iso: string, days: number): string =>
  new Date(new Date(iso).getTime() - days * 86_400_000).toISOString();

/** Fingerprint of the profile and classifier: a change re-opens cached verdicts. */
export const profileHash = (): string =>
  createHash('sha256').update(JSON.stringify({ profile, CLASSIFIER_VERSION }))
    .digest('hex').slice(0, 12);

/**
 * A source that skipped a detail request (ctx.hasDetail) returns the posting
 * with an empty body; the stored copy supplies everything the detail held.
 */
function restoreDetail(raw: RawJob, stored: Job): RawJob {
  return {
    ...raw,
    description: stored.description,
    postedAt: raw.postedAt ?? stored.postedAt,
    tags: raw.tags.length > 0 ? raw.tags : stored.tags,
    employmentRaw: raw.employmentRaw ?? stored.employmentRaw,
    workTimeRaw: raw.workTimeRaw ?? stored.workTimeRaw,
    occupation: raw.occupation ?? stored.occupation,
    deadline: raw.deadline ?? stored.deadline,
    salary: raw.salary ?? stored.salary,
    experienceRaw: raw.experienceRaw ?? stored.experienceRaw,
    languagesRaw: raw.languagesRaw ?? stored.languagesRaw,
    workModeRaw: raw.workModeRaw ?? stored.workModeRaw,
  };
}

export async function runScrape(opts: RunOptions): Promise<RunResult> {
  const db = openDb(opts.dbPath);
  try {
    const hash = profileHash();
    const stored = new Map(allJobs(db).map((j) => [j.id, j]));
    const previousRuns = sourceRuns(db);
    const checked = checkedIds(db, hash, daysBefore(opts.now, CHECKED_TTL_DAYS));

    const succeeded: string[] = [];
    const failed: Array<{ source: string; error: string }> = [];
    const statuses: SourceStatus[] = [];
    const fetchedBy = new Map<string, Set<string>>();
    const raws: RawJob[] = [];

    for (const source of opts.sources) {
      const ctx: FetchContext = {
        hasDetail: (sourceId) => {
          const id = makeId(source.name, sourceId);
          return (stored.get(id)?.description ?? '') !== '' || checked.has(id);
        },
      };
      try {
        const jobs = await source.fetchJobs(ctx);
        raws.push(...jobs);
        succeeded.push(source.name);
        fetchedBy.set(source.name, new Set(jobs.map((j) => makeId(source.name, j.sourceId))));
        recordSourceRun(db, source.name, true, jobs.length, opts.now);
        statuses.push({ name: source.name, label: SOURCE_LABELS[source.name] ?? source.name,
          ok: true, count: jobs.length, lastOkAt: opts.now, error: null });
        console.log(`[${source.name}] fetched ${jobs.length} postings`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        failed.push({ source: source.name, error: message });
        recordSourceRun(db, source.name, false, 0, opts.now);
        statuses.push({ name: source.name, label: SOURCE_LABELS[source.name] ?? source.name,
          ok: false, count: 0, lastOkAt: sourceRuns(db).get(source.name)?.lastOkAt ?? null,
          error: message.slice(0, 200) });
        console.error(`[${source.name}] FAILED: ${message}`);
      }
    }

    const kept: Job[] = [];
    const notAFit: string[] = [];
    /** Every posting this run judged, kept or not: its verdict is current. */
    const judged = new Set<string>();
    for (let raw of raws) {
      const id = makeId(raw.source, raw.sourceId);
      judged.add(id);
      let fetchedDetail = raw.description !== '';
      const prior = stored.get(id);
      if (prior) {
        // Some sources only state the date or deadline while an ad is fresh
        // (an RSS window, a "new" listing); the stored copy remembers it.
        raw = {
          ...raw,
          postedAt: raw.postedAt ?? prior.postedAt,
          deadline: raw.deadline ?? prior.deadline,
          salary: raw.salary ?? prior.salary,
        };
      }
      if (raw.description === '') {
        if (prior && prior.description !== '') {
          raw = restoreDetail(raw, prior);
        } else if (checked.has(id)) {
          continue; // its detail was read before and did not fit
        }
      } else if (stored.get(id)?.description === raw.description) {
        fetchedDetail = false;
      }
      const c = classify(raw);
      if (isWanted(c)) kept.push(toJob(raw, c, opts.now));
      else if (fetchedDetail) notAFit.push(id);
    }
    console.log(`kept ${kept.length} of ${raws.length} postings after filtering`);

    upsertJobs(db, kept);
    markChecked(db, notAFit, hash, opts.now);
    pruneChecked(db, daysBefore(opts.now, CHECKED_TTL_DAYS));

    // Re-file every stored posting under the current profile, and let go of
    // what no longer fits, has been taken down, or has aged out.
    const keptIds = new Set(kept.map((j) => j.id));
    const staleBefore = daysBefore(opts.now, STALE_DAYS);
    const retainAfter = daysBefore(opts.now, RETENTION_DAYS).slice(0, 10);
    const bySource = new Map(opts.sources.map((s) => [s.name, s]));
    // A complete source's listing proves a missing posting was taken down —
    // unless the listing itself came back short (paging cut off, an empty
    // page), which would otherwise wipe and later re-add its postings.
    const trustListing = (name: string): boolean => {
      const listed = fetchedBy.get(name);
      if (!bySource.get(name)?.complete || listed === undefined) return false;
      const before = previousRuns.get(name)?.lastCount ?? 0;
      return listed.size >= 0.8 * before;
    };
    const drop: string[] = [];
    const refiled: Job[] = [];
    for (const j of allJobs(db)) {
      const posted = j.postedAt ?? j.firstSeenAt.slice(0, 10);
      const takenDown = trustListing(j.source) && !fetchedBy.get(j.source)!.has(j.id);
      const listingDays = bySource.get(j.source)?.listingDays;
      const shouldBeListed = listingDays === undefined
        || posted >= daysBefore(opts.now, listingDays).slice(0, 10);
      const stale = j.lastSeenAt < staleBefore && shouldBeListed;
      if (posted < retainAfter || stale || takenDown) {
        drop.push(j.id);
        continue;
      }
      if (keptIds.has(j.id)) continue;
      // Judged this run on fresh data and not kept: the stored copy is stale.
      if (judged.has(j.id)) { drop.push(j.id); continue; }
      const c = classify(j);
      if (!isWanted(c)) { drop.push(j.id); continue; }
      refiled.push({ ...toJob(j, c, j.firstSeenAt), lastSeenAt: j.lastSeenAt });
    }
    deleteJobs(db, drop);
    upsertJobs(db, refiled);

    const all = allJobs(db);
    const newCount = all.filter((j) => j.firstSeenAt === opts.now).length;
    const file = buildExport(all, statuses, opts.now);
    writeExport(opts.jsonPath, file);
    console.log(`${newCount} new postings this run; ${file.jobs.length} in the app after de-duplication`);
    return { succeeded, failed, kept: kept.length, newCount, exported: file.jobs.length };
  } finally {
    db.close();
  }
}

export const SOURCES: Source[] = [
  zrszSource, mojeDeloSource, optiusSource, linkedInSource, himalayasSource,
  euCareersSource, euroBrusselsSource, euractivSource, euresSource,
];

async function main(): Promise<void> {
  const dataDir = join(process.cwd(), 'data');
  const result = await runScrape({
    sources: SOURCES,
    now: new Date().toISOString(),
    dbPath: join(dataDir, 'jobs.db'),
    jsonPath: join(dataDir, 'jobs.json'),
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
