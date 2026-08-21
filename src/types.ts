export type Seniority = 'junior' | 'mid' | 'senior' | 'unknown';

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
  /** Technology tags when the source exposes them, else empty. */
  tags: string[];
}

/** A classified posting as stored and exported. */
export interface Job extends RawJob {
  id: string;
  /** Comma-joined role/technology keywords that matched. */
  roleMatch: string;
  seniority: Seniority;
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface Source {
  name: string;
  fetchJobs(): Promise<RawJob[]>;
}
