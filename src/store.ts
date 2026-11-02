import Database from 'better-sqlite3';
import type {
  EmploymentType, Job, LocationClass, Seniority, WorkMode,
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
  deadline        TEXT,
  salary          TEXT,
  experience_raw  TEXT,
  languages_raw   TEXT,
  work_mode_raw   TEXT,
  country         TEXT,
  international   INTEGER NOT NULL DEFAULT 0,
  area            TEXT NOT NULL,
  areas           TEXT NOT NULL,
  work_mode       TEXT NOT NULL,
  employment_type TEXT NOT NULL,
  location_class  TEXT NOT NULL,
  flags           TEXT NOT NULL,
  seniority       TEXT NOT NULL,
  min_years       INTEGER,
  score           INTEGER NOT NULL,
  reasons         TEXT NOT NULL,
  score_parts     TEXT NOT NULL,
  first_seen_at   TEXT NOT NULL,
  last_seen_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_jobs_first_seen ON jobs(first_seen_at);
CREATE INDEX IF NOT EXISTS idx_jobs_source ON jobs(source);

-- Postings whose detail page was fetched and found not to fit, so the next
-- run need not fetch it again. Keyed to the profile that judged them: a
-- profile change re-opens every verdict.
CREATE TABLE IF NOT EXISTS checked (
  id          TEXT PRIMARY KEY,
  profile     TEXT NOT NULL,
  checked_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS source_runs (
  name        TEXT PRIMARY KEY,
  last_ok_at  TEXT,
  last_count  INTEGER
);
`;

export function openDb(path: string): Db {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  // Databases from the CSV era were classified against a different profile
  // and lack the detail columns. Their rows are cheaper to refetch than to
  // migrate, so the old table is dropped.
  const cols = db.pragma('table_info(jobs)') as Array<{ name: string }>;
  if (cols.length > 0 && !cols.some((c) => c.name === 'score_parts')) {
    db.exec('DROP TABLE jobs');
  }
  db.exec(SCHEMA);
  return db;
}

interface Row {
  id: string; source: string; source_id: string; url: string; title: string;
  company: string | null; location: string | null; posted_at: string | null;
  description: string; tags: string;
  employment_raw: string | null; work_time_raw: string | null; occupation: string | null;
  deadline: string | null; salary: string | null; experience_raw: string | null;
  languages_raw: string | null; work_mode_raw: string | null; country: string | null;
  international: number;
  area: string; areas: string; work_mode: string; employment_type: string;
  location_class: string; flags: string; seniority: string; min_years: number | null;
  score: number; reasons: string; score_parts: string;
  first_seen_at: string; last_seen_at: string;
}

const toJob = (r: Row): Job => ({
  id: r.id, source: r.source, sourceId: r.source_id, url: r.url, title: r.title,
  company: r.company, location: r.location, postedAt: r.posted_at,
  description: r.description, tags: JSON.parse(r.tags) as string[],
  employmentRaw: r.employment_raw, workTimeRaw: r.work_time_raw, occupation: r.occupation,
  deadline: r.deadline, salary: r.salary, experienceRaw: r.experience_raw,
  languagesRaw: r.languages_raw, workModeRaw: r.work_mode_raw, country: r.country,
  international: r.international === 1,
  area: r.area, areas: r.areas,
  workMode: r.work_mode as WorkMode,
  employmentType: r.employment_type as EmploymentType,
  locationClass: r.location_class as LocationClass,
  flags: r.flags, seniority: r.seniority as Seniority, minYears: r.min_years,
  score: r.score, reasons: r.reasons, scoreParts: r.score_parts,
  firstSeenAt: r.first_seen_at, lastSeenAt: r.last_seen_at,
});

/**
 * Insert new jobs, update existing ones. first_seen_at is excluded from the
 * update set on purpose — it is the basis of new-job detection.
 */
export function upsertJobs(db: Db, jobs: Job[]): void {
  const stmt = db.prepare(`
    INSERT INTO jobs (id, source, source_id, url, title, company, location, posted_at,
                      description, tags, employment_raw, work_time_raw, occupation,
                      deadline, salary, experience_raw, languages_raw, work_mode_raw,
                      country, international, area, areas, work_mode, employment_type,
                      location_class, flags, seniority, min_years, score, reasons,
                      score_parts, first_seen_at, last_seen_at)
    VALUES (@id, @source, @sourceId, @url, @title, @company, @location, @postedAt,
            @description, @tags, @employmentRaw, @workTimeRaw, @occupation,
            @deadline, @salary, @experienceRaw, @languagesRaw, @workModeRaw,
            @country, @international, @area, @areas, @workMode, @employmentType,
            @locationClass, @flags, @seniority, @minYears, @score, @reasons,
            @scoreParts, @firstSeenAt, @lastSeenAt)
    ON CONFLICT(id) DO UPDATE SET
      url = excluded.url, title = excluded.title, company = excluded.company,
      location = excluded.location, posted_at = excluded.posted_at,
      description = excluded.description, tags = excluded.tags,
      employment_raw = excluded.employment_raw, work_time_raw = excluded.work_time_raw,
      occupation = excluded.occupation, deadline = excluded.deadline,
      salary = excluded.salary, experience_raw = excluded.experience_raw,
      languages_raw = excluded.languages_raw, work_mode_raw = excluded.work_mode_raw,
      country = excluded.country, international = excluded.international,
      area = excluded.area, areas = excluded.areas, work_mode = excluded.work_mode,
      employment_type = excluded.employment_type, location_class = excluded.location_class,
      flags = excluded.flags, seniority = excluded.seniority, min_years = excluded.min_years,
      score = excluded.score, reasons = excluded.reasons, score_parts = excluded.score_parts,
      last_seen_at = excluded.last_seen_at
  `);
  db.transaction((batch: Job[]) => {
    for (const j of batch) {
      stmt.run({
        ...j,
        tags: JSON.stringify(j.tags),
        employmentRaw: j.employmentRaw ?? null,
        workTimeRaw: j.workTimeRaw ?? null,
        occupation: j.occupation ?? null,
        deadline: j.deadline ?? null,
        salary: j.salary ?? null,
        experienceRaw: j.experienceRaw ?? null,
        languagesRaw: j.languagesRaw ?? null,
        workModeRaw: j.workModeRaw ?? null,
        country: j.country ?? null,
        international: j.international ? 1 : 0,
      });
    }
  })(jobs);
}

export function allJobs(db: Db): Job[] {
  return (db.prepare('SELECT * FROM jobs ORDER BY posted_at DESC NULLS LAST, score DESC')
    .all() as Row[]).map(toJob);
}

export function jobsFirstSeenAt(db: Db, timestamp: string): Job[] {
  return (db.prepare('SELECT * FROM jobs WHERE first_seen_at = ?')
    .all(timestamp) as Row[]).map(toJob);
}

export function deleteJobs(db: Db, ids: string[]): void {
  const stmt = db.prepare('DELETE FROM jobs WHERE id = ?');
  db.transaction((batch: string[]) => {
    for (const id of batch) stmt.run(id);
  })(ids);
}

/** Ids of postings judged not to fit under `profile` since `since`. */
export function checkedIds(db: Db, profile: string, since: string): Set<string> {
  const rows = db.prepare('SELECT id FROM checked WHERE profile = ? AND checked_at >= ?')
    .all(profile, since) as Array<{ id: string }>;
  return new Set(rows.map((r) => r.id));
}

export function markChecked(db: Db, ids: string[], profile: string, now: string): void {
  const stmt = db.prepare(`INSERT INTO checked (id, profile, checked_at) VALUES (?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET profile = excluded.profile, checked_at = excluded.checked_at`);
  db.transaction((batch: string[]) => {
    for (const id of batch) stmt.run(id, profile, now);
  })(ids);
}

export function pruneChecked(db: Db, before: string): void {
  db.prepare('DELETE FROM checked WHERE checked_at < ?').run(before);
}

export interface SourceRun {
  name: string;
  lastOkAt: string | null;
  lastCount: number | null;
}

export function recordSourceRun(db: Db, name: string, ok: boolean, count: number, now: string): void {
  if (ok) {
    db.prepare(`INSERT INTO source_runs (name, last_ok_at, last_count) VALUES (?, ?, ?)
      ON CONFLICT(name) DO UPDATE SET last_ok_at = excluded.last_ok_at,
        last_count = excluded.last_count`).run(name, now, count);
  } else {
    db.prepare('INSERT INTO source_runs (name) VALUES (?) ON CONFLICT(name) DO NOTHING').run(name);
  }
}

export function sourceRuns(db: Db): Map<string, SourceRun> {
  const rows = db.prepare('SELECT name, last_ok_at, last_count FROM source_runs').all() as
    Array<{ name: string; last_ok_at: string | null; last_count: number | null }>;
  return new Map(rows.map((r) => [r.name, { name: r.name, lastOkAt: r.last_ok_at, lastCount: r.last_count }]));
}
