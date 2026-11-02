export type Seniority = 'junior' | 'mid' | 'senior' | 'unknown';
export type WorkMode = 'remote' | 'hybrid' | 'onsite' | 'unknown';
export type EmploymentType = 'permanent' | 'fixed-term' | 'part-time' | 'unknown';

/**
 * Where a posting sits relative to the seeker, who lives in Ljubljana.
 * - ljubljana: Ljubljana or a municipality of the Osrednjeslovenska region
 * - slovenia:  elsewhere in Slovenia
 * - remote:    outside Slovenia, but remote work from Slovenia is possible
 * - abroad:    outside Slovenia and on-site (kept only from international-
 *              organisation boards, where relocation is the norm)
 */
export type LocationClass = 'ljubljana' | 'slovenia' | 'remote' | 'abroad';

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
  /** ISO date (YYYY-MM-DD) of the application deadline, when stated. */
  deadline?: string | null;
  /** Salary as the source words it, e.g. "2.100 € bruto/mesec", when published. */
  salary?: string | null;
  /** Required experience as the source words it, e.g. "1 leto", "3+ do 5 let". */
  experienceRaw?: string | null;
  /** Language requirements as the source words them. */
  languagesRaw?: string | null;
  /** Work arrangement as the source's structured field words it, e.g. "Remote". */
  workModeRaw?: string | null;
  /** ISO 3166-1 alpha-2 country code of the workplace, when known. */
  country?: string | null;
  /**
   * True when the posting comes from an international-organisation board
   * (EU institutions, UN, EuroBrussels…). On-site abroad is then still in scope.
   */
  international?: boolean;
}

/** Per-run hints a source may use to skip work it has already done. */
export interface FetchContext {
  /**
   * True when the store already holds this posting's detail page, so the
   * adapter may skip re-fetching it and return description '' instead.
   * The pipeline then restores the stored detail fields.
   */
  hasDetail(sourceId: string): boolean;
}

/** A classified posting as stored and exported. */
export interface Job extends RawJob {
  id: string;
  /** Best matching area key. */
  area: string;
  /** Comma-joined keys of every matching area. */
  areas: string;
  workMode: WorkMode;
  employmentType: EmploymentType;
  locationClass: LocationClass;
  /** Comma-joined warnings. Informational — never a reason to exclude. */
  flags: string;
  seniority: Seniority;
  /** Required years of experience (the larger bound), when stated. */
  minYears: number | null;
  /** 0-100 match against the seeker's profile. */
  score: number;
  /** JSON array of Reason: short Slovenian notes on why it fits (or not). */
  reasons: string;
  /** JSON object of ScoreParts: how the score adds up. */
  scoreParts: string;
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface Reason {
  kind: 'fit' | 'warn';
  text: string;
}

/** Each criterion from the seeker's brief, as points earned of its maximum. */
export interface ScoreParts {
  /** Relation to learning, education, development or project work. Max 35. */
  relevance: number;
  /** Overlap with the seeker's own experience, tools and education. Max 15. */
  experience: number;
  /** Remote or hybrid work. Max 15. */
  workMode: number;
  /** Required level of experience. Max 15. */
  level: number;
  /** Location and language requirements. Max 10. */
  location: number;
  /** Kind of organisation and content of the work. Max 10. */
  organisation: number;
  /** Deductions for HR-admin or sales duties found in the ad. */
  penalty: number;
}

export interface Source {
  name: string;
  /**
   * True when every successful run returns every live posting in scope, so a
   * stored posting missing from one has been taken down and can be dropped.
   */
  complete?: boolean;
  /**
   * When the source only lists postings up to this many days old, a stored
   * posting older than that is expected to be missing and is not stale.
   */
  listingDays?: number;
  fetchJobs(ctx?: FetchContext): Promise<RawJob[]>;
}
