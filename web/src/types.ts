// Mirrors src/export.ts in the scraper. Kept as a copy so the site builds on
// its own; the data file is the only contract between the two.

export type WorkMode = 'remote' | 'hybrid' | 'onsite' | 'unknown';
export type LocationClass = 'ljubljana' | 'slovenia' | 'remote' | 'abroad';
export type EmploymentType = 'permanent' | 'fixed-term' | 'part-time' | 'unknown';

export interface Reason {
  kind: 'fit' | 'warn';
  text: string;
}

export interface ScoreParts {
  relevance: number;
  experience: number;
  workMode: number;
  level: number;
  location: number;
  organisation: number;
  penalty: number;
}

export interface JobSource {
  source: string;
  label: string;
  url: string;
}

export interface Job {
  /** Stable across runs: the id of the first-seen copy. */
  id: string;
  /** Ids of every merged copy. */
  ids: string[];
  title: string;
  company: string | null;
  location: string | null;
  locationClass: LocationClass;
  workMode: WorkMode;
  employmentType: EmploymentType;
  postedAt: string | null;
  deadline: string | null;
  experience: string | null;
  minYears: number | null;
  salary: string | null;
  area: string;
  areas: string[];
  score: number;
  parts: ScoreParts;
  reasons: Reason[];
  sources: JobSource[];
  firstSeenAt: string;
}

export interface SourceStatus {
  name: string;
  label: string;
  ok: boolean;
  count: number;
  lastOkAt: string | null;
  error: string | null;
}

export interface DataFile {
  generatedAt: string;
  windowDays: number;
  sources: SourceStatus[];
  areas: Array<{ key: string; label: string }>;
  jobs: Job[];
}
