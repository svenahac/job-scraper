import Database from 'better-sqlite3';
import type { Job, Seniority } from './types.js';

export type Db = Database.Database;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS jobs (
  id            TEXT PRIMARY KEY,
  source        TEXT NOT NULL,
  source_id     TEXT NOT NULL,
  url           TEXT NOT NULL,
  title         TEXT NOT NULL,
  company       TEXT,
  location      TEXT,
  posted_at     TEXT,
  description   TEXT NOT NULL,
  tags          TEXT NOT NULL,
  role_match    TEXT NOT NULL,
  seniority     TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_seen_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_jobs_first_seen ON jobs(first_seen_at);
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
  description: string; tags: string; role_match: string; seniority: string;
  first_seen_at: string; last_seen_at: string;
}

const toJobRow = (r: Row): Job => ({
  id: r.id, source: r.source, sourceId: r.source_id, url: r.url, title: r.title,
  company: r.company, location: r.location, postedAt: r.posted_at,
  description: r.description, tags: JSON.parse(r.tags) as string[],
  roleMatch: r.role_match, seniority: r.seniority as Seniority,
  firstSeenAt: r.first_seen_at, lastSeenAt: r.last_seen_at,
});

/**
 * Insert new jobs, update existing ones. first_seen_at is excluded from the
 * update set on purpose — it is the basis of new-job detection.
 */
export function upsertJobs(db: Db, jobs: Job[]): void {
  const stmt = db.prepare(`
    INSERT INTO jobs (id, source, source_id, url, title, company, location,
                      posted_at, description, tags, role_match, seniority,
                      first_seen_at, last_seen_at)
    VALUES (@id, @source, @sourceId, @url, @title, @company, @location,
            @postedAt, @description, @tags, @roleMatch, @seniority,
            @firstSeenAt, @lastSeenAt)
    ON CONFLICT(id) DO UPDATE SET
      url = excluded.url,
      title = excluded.title,
      company = excluded.company,
      location = excluded.location,
      posted_at = excluded.posted_at,
      description = excluded.description,
      tags = excluded.tags,
      role_match = excluded.role_match,
      seniority = excluded.seniority,
      last_seen_at = excluded.last_seen_at
  `);
  const run = db.transaction((batch: Job[]) => {
    for (const j of batch) stmt.run({ ...j, tags: JSON.stringify(j.tags) });
  });
  run(jobs);
}

export function allJobs(db: Db): Job[] {
  return (db.prepare('SELECT * FROM jobs ORDER BY first_seen_at DESC, title ASC')
    .all() as Row[]).map(toJobRow);
}

export function jobsFirstSeenAt(db: Db, timestamp: string): Job[] {
  return (db.prepare('SELECT * FROM jobs WHERE first_seen_at = ? ORDER BY title ASC')
    .all(timestamp) as Row[]).map(toJobRow);
}
