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

export function toJob(raw: RawJob, c: Classification, now: string): Job {
  return {
    ...raw,
    id: makeId(raw.source, raw.sourceId),
    area: c.area ?? '',
    areaRank: c.areaRank,
    areas: c.areas.join(','),
    workMode: c.workMode,
    employmentType: c.employmentType,
    flags: c.flags.join(','),
    seniority: c.seniority,
    score: c.score,
    firstSeenAt: now,
    lastSeenAt: now,
  };
}
