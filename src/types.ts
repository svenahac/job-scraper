export type Seniority = 'junior' | 'mid' | 'senior' | 'unknown';
export type WorkMode = 'remote' | 'hybrid' | 'onsite' | 'unknown';
export type EmploymentType = 'permanent' | 'fixed-term' | 'part-time' | 'unknown';

/** A posting as returned by a source adapter, before classification. */
export interface RawJob {
  source: string;
  /** Stable identifier within the source. Never a URL with tracking params. */
  sourceId: string;
  url: string;
  title: string;
  company: string | null;
  location: string | null;
  /** ISO date (YYYY-MM-DD) when the source provides one, else null. */
  postedAt: string | null;
  /** Plain text. HTML must already be stripped by the adapter. */
  description: string;
  /** Topic tags when the source exposes them, else empty. */
  tags: string[];
  /** Contract duration as the source words it, e.g. "Nedoločen čas". */
  employmentRaw?: string | null;
  /** Working time as the source words it, e.g. "40 ur/teden". */
  workTimeRaw?: string | null;
  /** Occupation title from the source's own taxonomy, when it has one. */
  occupation?: string | null;
}

/** A classified posting as stored and exported. */
export interface Job extends RawJob {
  id: string;
  /** Best-ranked matching area key, or '' when none. */
  area: string;
  /** Rank of `area`; 0 when none. */
  areaRank: number;
  /** Comma-joined keys of every matching area. */
  areas: string;
  workMode: WorkMode;
  employmentType: EmploymentType;
  /** Comma-joined warnings. Informational — never a reason to exclude. */
  flags: string;
  /** Informational only. Never filters. */
  seniority: Seniority;
  /** 0-100, higher is a better fit. The CSV sorts on this. */
  score: number;
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface Source {
  name: string;
  fetchJobs(): Promise<RawJob[]>;
}
