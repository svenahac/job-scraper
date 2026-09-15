import Database from 'better-sqlite3';
import type {
  EmploymentType, Job, LocationTier, Seniority, WorkMode,
} from './types.js';

export type Db = Database.Database;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS jobs (
  id              TEXT PRIMARY KEY,
  source          TEXT NOT NULL,
  source_id       TEXT NOT NULL,
  url             TEXT NOT NULL,
  title           TEXT NOT NULL,
  company         TEXT,
  location        TEXT,
  posted_at       TEXT,
  description     TEXT NOT NULL,
  tags            TEXT NOT NULL,
  employment_raw  TEXT,
  work_time_raw   TEXT,
  occupation      TEXT,
  area            TEXT NOT NULL,
  area_rank       INTEGER NOT NULL,
  areas           TEXT NOT NULL,
  work_mode       TEXT NOT NULL,
  employment_type TEXT NOT NULL,
  location_tier   TEXT NOT NULL,
  flags           TEXT NOT NULL,
  seniority       TEXT NOT NULL,
  score           INTEGER NOT NULL,
  first_seen_at   TEXT NOT NULL,
  last_seen_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_jobs_first_seen ON jobs(first_seen_at);
CREATE INDEX IF NOT EXISTS idx_jobs_score ON jobs(score DESC);
`;

export function openDb(path: string): Db {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.exec(SCHEMA);
  return db;
}

interface Row {
  id: string; source: string; source_id: string; url: string; title: string;
  company: string | null; location: string | null; posted_at: string | null;
  description: string; tags: string;
  employment_raw: string | null; work_time_raw: string | null;
  occupation: string | null;
  area: string; area_rank: number; areas: string; work_mode: string;
  employment_type: string; location_tier: string; flags: string;
  seniority: string; score: number;
  first_seen_at: string; last_seen_at: string;
}

const toJobRow = (r: Row): Job => ({
  id: r.id, source: r.source, sourceId: r.source_id, url: r.url, title: r.title,
  company: r.company, location: r.location, postedAt: r.posted_at,
  description: r.description, tags: JSON.parse(r.tags) as string[],
  employmentRaw: r.employment_raw, workTimeRaw: r.work_time_raw,
  occupation: r.occupation,
  area: r.area, areaRank: r.area_rank, areas: r.areas,
  workMode: r.work_mode as WorkMode,
  employmentType: r.employment_type as EmploymentType,
  locationTier: r.location_tier as LocationTier,
  flags: r.flags, seniority: r.seniority as Seniority, score: r.score,
  firstSeenAt: r.first_seen_at, lastSeenAt: r.last_seen_at,
});

/**
 * Insert new jobs, update existing ones. first_seen_at is excluded from the
 * update set on purpose — it is the basis of new-job detection.
 */
export function upsertJobs(db: Db, jobs: Job[]): void {
  const stmt = db.prepare(`
    INSERT INTO jobs (id, source, source_id, url, title, company, location,
                      posted_at, description, tags, employment_raw,
                      work_time_raw, occupation, area, area_rank, areas,
                      work_mode, employment_type, location_tier, flags,
                      seniority, score, first_seen_at, last_seen_at)
    VALUES (@id, @source, @sourceId, @url, @title, @company, @location,
            @postedAt, @description, @tags, @employmentRaw,
            @workTimeRaw, @occupation, @area, @areaRank, @areas,
            @workMode, @employmentType, @locationTier, @flags,
            @seniority, @score, @firstSeenAt, @lastSeenAt)
    ON CONFLICT(id) DO UPDATE SET
      url = excluded.url,
      title = excluded.title,
      company = excluded.company,
      location = excluded.location,
      posted_at = excluded.posted_at,
      description = excluded.description,
      tags = excluded.tags,
      employment_raw = excluded.employment_raw,
      work_time_raw = excluded.work_time_raw,
      occupation = excluded.occupation,
      area = excluded.area,
      area_rank = excluded.area_rank,
      areas = excluded.areas,
      work_mode = excluded.work_mode,
      employment_type = excluded.employment_type,
      location_tier = excluded.location_tier,
      flags = excluded.flags,
      seniority = excluded.seniority,
      score = excluded.score,
      last_seen_at = excluded.last_seen_at
  `);
  const run = db.transaction((batch: Job[]) => {
    for (const j of batch) {
      stmt.run({
        ...j,
        tags: JSON.stringify(j.tags),
        employmentRaw: j.employmentRaw ?? null,
        workTimeRaw: j.workTimeRaw ?? null,
        occupation: j.occupation ?? null,
      });
    }
  });
  run(jobs);
}

export function allJobs(db: Db): Job[] {
  return (db.prepare('SELECT * FROM jobs ORDER BY score DESC, title ASC')
    .all() as Row[]).map(toJobRow);
}

export function jobsFirstSeenAt(db: Db, timestamp: string): Job[] {
  return (db.prepare(
    'SELECT * FROM jobs WHERE first_seen_at = ? ORDER BY score DESC, title ASC')
    .all(timestamp) as Row[]).map(toJobRow);
}
