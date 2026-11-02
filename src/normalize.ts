import { createHash } from 'node:crypto';
import type { Job, RawJob } from './types.js';
import type { Classification } from './classify.js';

/**
 * Stable id for a posting. Derived from source and source id only, so the
 * same posting keeps its id across runs even if its title or body is edited.
 */
export function makeId(source: string, sourceId: string): string {
  return createHash('sha256').update(`${source}:${sourceId}`).digest('hex').slice(0, 16);
}

/** Only call for a kept posting: a rejected one may have no location class. */
export function toJob(raw: RawJob, c: Classification, now: string): Job {
  return {
    ...raw,
    id: makeId(raw.source, raw.sourceId),
    area: c.area ?? '',
    areas: c.areas.map((a) => a.key).join(','),
    workMode: c.workMode,
    employmentType: c.employmentType,
    locationClass: c.locationClass ?? 'slovenia',
    flags: c.flags.join(','),
    seniority: c.seniority,
    minYears: c.minYears,
    score: c.score,
    reasons: JSON.stringify(c.reasons),
    scoreParts: JSON.stringify(c.parts),
    firstSeenAt: now,
    lastSeenAt: now,
  };
}
