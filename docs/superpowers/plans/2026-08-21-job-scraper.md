# Slovenian Junior/Mid Web Dev Job Scraper — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every evening, scrape junior/mid frontend and fullstack job postings from slo-tech, mojedelo, and LinkedIn into a SQLite database committed to this repo, and emit a CSV of all jobs plus a CSV of jobs first seen in that run.

**Architecture:** Three source adapters behind one `Source` interface produce `RawJob[]`. A shared pipeline normalizes, classifies (keyword role gate + seniority gate), drops seniors and non-web roles, upserts into SQLite, then rewrites both CSVs from the database. A source that throws is logged and skipped; the run fails only if all three fail.

**Tech Stack:** TypeScript on Node 24, `cheerio` (HTML parsing), `iconv-lite` (ISO-8859-2), `better-sqlite3` (storage), `vitest` (tests), `tsx` (running). No framework, no CSV library.

**Spec:** `docs/superpowers/specs/2026-08-21-job-scraper-design.md`

## Global Constraints

- Node 24 LTS. `package.json` sets `"type": "module"`; all imports use ESM syntax with `.js` extensions on relative paths.
- No test performs live network I/O. Every parser test runs against a committed fixture in `tests/fixtures/`.
- slo-tech responses are `charset=iso-8859-2` and MUST be decoded with `iconv-lite` before parsing. Decoding as UTF-8 corrupts every Slovenian diacritic and silently breaks keyword matching.
- All keyword matching is done on lowercased text. Slovenian diacritics are preserved, never stripped — `mlajši` must match `mlajši`.
- Only `seniority === 'senior'` is ever excluded. `junior`, `mid`, and `unknown` all ship to the CSV.
- Role gate keywords match anywhere in title, tags, or body. Seniority *marker* keywords match title and tags only; the years-of-experience regex runs over the body.
- Requests within a source are sequential with a delay between them, under a descriptive User-Agent.
- `first_seen_at` is never overwritten on update. It is what makes new-job detection correct.

---

### Task 1: Project scaffolding and shared types

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `src/types.ts`, `tests/types.test.ts`, `data/.gitkeep`

**Interfaces:**
- Consumes: nothing (first task)
- Produces: `Seniority`, `RawJob`, `Job`, `Source` from `src/types.ts`; a working `npm test`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "job-scraper",
  "version": "1.0.0",
  "type": "module",
  "private": true,
  "engines": { "node": ">=24" },
  "scripts": {
    "scrape": "tsx src/index.ts",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "better-sqlite3": "^12.2.0",
    "cheerio": "^1.0.0",
    "iconv-lite": "^0.6.3"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.11",
    "@types/node": "^24.0.0",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["src/**/*.ts", "tests/**/*.ts"]
}
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
```

- [ ] **Step 4: Install dependencies**

Run: `npm install`
Expected: `node_modules/` created, no peer dependency errors. `better-sqlite3` may compile from source; that is normal and takes up to a minute.

- [ ] **Step 5: Write the failing test for shared types**

This test exists to prove the type module loads and the type contracts compile. It is intentionally small — the value is that `tsc` checks the shapes.

Create `tests/types.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { RawJob, Job, Seniority } from '../src/types.js';

describe('types', () => {
  it('models a raw job from a source', () => {
    const raw: RawJob = {
      source: 'slotech',
      sourceId: '8052',
      url: 'https://slo-tech.com/delo/8052',
      title: 'Frontend Developer',
      company: 'Acme d.o.o.',
      location: 'Ljubljana',
      postedAt: '2026-08-18',
      description: 'Iščemo razvijalca.',
    };
    expect(raw.source).toBe('slotech');
  });

  it('models a classified job with provenance timestamps', () => {
    const seniority: Seniority = 'junior';
    const job: Job = {
      source: 'slotech',
      sourceId: '8052',
      url: 'https://slo-tech.com/delo/8052',
      title: 'Frontend Developer',
      company: 'Acme d.o.o.',
      location: 'Ljubljana',
      postedAt: '2026-08-18',
      description: 'Iščemo razvijalca.',
      id: 'abc123',
      roleMatch: 'frontend',
      seniority,
      firstSeenAt: '2026-08-21T17:00:00.000Z',
      lastSeenAt: '2026-08-21T17:00:00.000Z',
    };
    expect(job.seniority).toBe('junior');
  });
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/types.js'`.

- [ ] **Step 7: Create `src/types.ts`**

```ts
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
```

- [ ] **Step 8: Add `tags` to the test fixtures**

The type now requires `tags`. Update both objects in `tests/types.test.ts` to include `tags: ['react']` on the raw job and `tags: ['react']` on the classified job.

- [ ] **Step 9: Run the test to verify it passes**

Run: `npm test && npm run typecheck`
Expected: PASS, no type errors.

- [ ] **Step 10: Commit**

```bash
mkdir -p data && touch data/.gitkeep
git add package.json package-lock.json tsconfig.json vitest.config.ts src/types.ts tests/types.test.ts data/.gitkeep
git commit -m "chore: scaffold TypeScript project and shared job types"
```

---

### Task 2: Classification rules

The heart of the project. Everything else is plumbing; this decides what lands in the CSV.

**Files:**
- Create: `src/classify.ts`, `tests/classify.test.ts`

**Interfaces:**
- Consumes: `RawJob`, `Seniority` from `src/types.js`
- Produces:
  - `matchRole(title: string, tags: string[], body: string): string[]`
  - `matchSeniority(title: string, tags: string[], body: string): Seniority`
  - `classify(job: RawJob): Classification` where `interface Classification { roleMatch: string[]; seniority: Seniority }`
  - `isWanted(c: Classification): boolean`

- [ ] **Step 1: Write the failing tests**

Create `tests/classify.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { matchRole, matchSeniority, classify, isWanted } from '../src/classify.js';
import type { RawJob } from '../src/types.js';

const raw = (over: Partial<RawJob>): RawJob => ({
  source: 'test', sourceId: '1', url: 'https://x', title: '', company: null,
  location: null, postedAt: null, description: '', tags: [], ...over,
});

describe('matchRole', () => {
  it('matches a role keyword in the title', () => {
    expect(matchRole('Frontend Developer', [], '')).toContain('frontend');
  });

  it('matches a Slovenian role keyword in the body', () => {
    expect(matchRole('Razvijalec (m/ž)', [], 'Razvijamo spletne aplikacije.'))
      .toContain('spletne aplikacije');
  });

  it('matches a technology keyword in a tag', () => {
    expect(matchRole('Razvijalec (m/ž)', ['React', 'GIT'], '')).toContain('react');
  });

  it('matches a technology keyword in the body', () => {
    // Deliberate: recall is preferred over precision here.
    expect(matchRole('Razvijalec (m/ž)', [], 'Poznavanje TypeScripta je prednost.'))
      .toContain('typescript');
  });

  it('returns empty for a non-web role', () => {
    expect(matchRole('Software inženir (Robotics / UGV)', ['C++/C'],
      'Razvoj robotske programske opreme v C++ v Linux okolju.')).toEqual([]);
  });

  it('is case insensitive and preserves diacritics', () => {
    expect(matchRole('SPLETNI RAZVIJALEC', [], '')).toContain('spletni razvijalec');
  });
});

describe('matchSeniority', () => {
  it('detects an explicit senior title', () => {
    expect(matchSeniority('Senior Software Engineer (Backend)', [], '')).toBe('senior');
  });

  it('detects a Slovenian lead title', () => {
    expect(matchSeniority('Vodja razvoja', [], '')).toBe('senior');
  });

  it('does NOT mark a job senior because the body mentions a senior colleague', () => {
    expect(matchSeniority('Frontend Developer', [], 'Poročal boš senior razvijalcu.'))
      .toBe('unknown');
  });

  it('detects an explicit junior title', () => {
    expect(matchSeniority('Junior Frontend Developer', [], '')).toBe('junior');
  });

  it('detects the Slovenian junior marker', () => {
    expect(matchSeniority('Mlajši razvijalec (m/ž)', [], '')).toBe('junior');
  });

  it('detects an explicit mid marker', () => {
    expect(matchSeniority('Medior Frontend Developer', [], '')).toBe('mid');
  });

  it('prefers junior when an ad advertises junior/medior', () => {
    expect(matchSeniority('Junior/Medior razvijalec', [], '')).toBe('junior');
  });

  it('reads an open-ended years requirement as its stated number', () => {
    expect(matchSeniority('Razvijalec', [], 'Zahtevamo 3+ let izkušenj.')).toBe('mid');
  });

  it('excludes five or more years', () => {
    expect(matchSeniority('Razvijalec', [], 'Vsaj 5 let izkušenj.')).toBe('senior');
  });

  it('reads a range as its upper bound', () => {
    expect(matchSeniority('Razvijalec', [], 'Potrebujemo 1-2 leti izkušenj.')).toBe('junior');
  });

  it('takes the largest number when several are stated', () => {
    expect(matchSeniority('Razvijalec', [], '2 leti s Reactom, 6 let v razvoju.')).toBe('senior');
  });

  it('handles the singular Slovenian form', () => {
    expect(matchSeniority('Razvijalec', [], 'Vsaj 1 leto izkušenj.')).toBe('junior');
  });

  it('handles English phrasing', () => {
    expect(matchSeniority('Developer', [], 'At least 4 years of experience.')).toBe('mid');
  });

  it('returns unknown when there is no signal at all', () => {
    expect(matchSeniority('Razvijalec programske opreme (m/ž)', [], 'Zanimivo delo.'))
      .toBe('unknown');
  });

  it('does not read "letters" as a years requirement', () => {
    expect(matchSeniority('Razvijalec', [], '5 letters of code review needed.')).toBe('unknown');
  });

  it('does not read the Slovenian word "letalo" as a years requirement', () => {
    expect(matchSeniority('Razvijalec', [], 'Upravljamo 20 letalo.')).toBe('unknown');
  });

  it('does not read "letakov" as a years requirement', () => {
    expect(matchSeniority('Razvijalec', [], 'Izdelali smo 12 letakov.')).toBe('unknown');
  });

  it('still reads the English plural "years"', () => {
    expect(matchSeniority('Razvijalec', [], 'At least 4 years of experience.')).toBe('mid');
  });

  it('lets an explicit title marker win over a body years figure', () => {
    expect(matchSeniority('Junior Developer', [], 'Ekipa ima 10 let izkušenj.')).toBe('junior');
  });
});

describe('isWanted', () => {
  it('rejects a job with no role match', () => {
    expect(isWanted({ roleMatch: [], seniority: 'junior' })).toBe(false);
  });

  it('rejects a senior web job', () => {
    expect(isWanted({ roleMatch: ['react'], seniority: 'senior' })).toBe(false);
  });

  it('accepts an unknown-seniority web job', () => {
    expect(isWanted({ roleMatch: ['react'], seniority: 'unknown' })).toBe(true);
  });

  it('accepts a mid web job', () => {
    expect(isWanted({ roleMatch: ['fullstack'], seniority: 'mid' })).toBe(true);
  });
});

describe('classify', () => {
  it('classifies a full raw job', () => {
    const c = classify(raw({
      title: 'Junior Frontend Developer',
      tags: ['React'],
      description: 'Delo na spletnih aplikacijah.',
    }));
    expect(c.seniority).toBe('junior');
    expect(c.roleMatch).toContain('frontend');
    expect(isWanted(c)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/classify.test.ts`
Expected: FAIL — `Cannot find module '../src/classify.js'`.

- [ ] **Step 3: Implement `src/classify.ts`**

```ts
import type { RawJob, Seniority } from './types.js';

export interface Classification {
  roleMatch: string[];
  seniority: Seniority;
}

/**
 * Role keywords. Both tiers match anywhere — title, tags, or body.
 * This biases toward recall: Slovenian ads often bury the real stack in the
 * requirements while the title says only "Razvijalec (m/ž)".
 */
const ROLE_KEYWORDS = [
  'frontend', 'front-end', 'front end',
  'fullstack', 'full-stack', 'full stack',
  'spletni razvijalec', 'spletnih aplikacij', 'spletne aplikacije',
  'web developer', 'web development',
] as const;

const TECH_KEYWORDS = [
  'react', 'vue', 'angular', 'next.js', 'nextjs', 'svelte',
  'javascript', 'typescript',
] as const;

/** Seniority markers. Matched against title and tags ONLY — never the body. */
const SENIOR_MARKERS = [
  'senior', 'sr.', 'lead', 'vodja', 'arhitekt', 'architect',
  'principal', 'staff', 'head of',
] as const;

const JUNIOR_MARKERS = [
  'junior', 'mlajši', 'pripravnik', 'praktikant', 'brez izkušenj',
] as const;

const MID_MARKERS = [
  'medior', 'mid-level', 'mid level', 'midlevel', 'intermediate',
] as const;

/**
 * Years of experience, Slovenian and English.
 * Group 1 is the first number, group 2 the upper bound of a range.
 * Matches: "5+ let", "vsaj 3 leta", "1-2 leti", "1 leto", "4 years".
 * The trailing lookahead is load-bearing: without it "20 letalo" (20 airplanes)
 * and "5 letters" parse as year counts and wrongly exclude a job as senior.
 */
const YEARS_RE = /(\d{1,2})\s*(?:[-–—]\s*(\d{1,2}))?\s*\+?\s*(?:let(?:o|a|i)?|years?)(?![a-zščž])/gi;

const norm = (s: string): string => s.toLowerCase();

const containsAny = (haystack: string, needles: readonly string[]): string[] =>
  needles.filter((n) => haystack.includes(n));

export function matchRole(title: string, tags: string[], body: string): string[] {
  const all = norm([title, tags.join(' '), body].join(' \n '));
  return [...containsAny(all, ROLE_KEYWORDS), ...containsAny(all, TECH_KEYWORDS)];
}

/** Largest years figure stated in the body, or null when none is stated. */
function maxYears(body: string): number | null {
  let max: number | null = null;
  for (const m of body.matchAll(YEARS_RE)) {
    const lower = Number(m[1]);
    const upper = m[2] === undefined ? lower : Number(m[2]);
    // A range takes its upper bound; "3+" and "vsaj 3" take the stated number.
    const value = Math.max(lower, upper);
    if (max === null || value > max) max = value;
  }
  return max;
}

export function matchSeniority(title: string, tags: string[], body: string): Seniority {
  // Markers are title/tags only. A body saying "poročal boš senior razvijalcu"
  // must not exclude an otherwise junior role.
  const heading = norm([title, tags.join(' ')].join(' '));

  if (containsAny(heading, SENIOR_MARKERS).length > 0) return 'senior';
  // Junior is checked before mid so "junior/medior" resolves to the more
  // inclusive label.
  if (containsAny(heading, JUNIOR_MARKERS).length > 0) return 'junior';
  if (containsAny(heading, MID_MARKERS).length > 0) return 'mid';

  const years = maxYears(norm(body));
  if (years === null) return 'unknown';
  if (years >= 5) return 'senior';
  if (years >= 3) return 'mid';
  return 'junior';
}

export function classify(job: RawJob): Classification {
  return {
    roleMatch: matchRole(job.title, job.tags, job.description),
    seniority: matchSeniority(job.title, job.tags, job.description),
  };
}

export function isWanted(c: Classification): boolean {
  return c.roleMatch.length > 0 && c.seniority !== 'senior';
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/classify.test.ts`
Expected: PASS, all cases green.

If the "largest number when several are stated" case fails, check that `YEARS_RE` has the `g` flag — `matchAll` throws without it.

- [ ] **Step 5: Commit**

```bash
git add src/classify.ts tests/classify.test.ts
git commit -m "feat: add role and seniority classification rules"
```

---

### Task 3: Job normalization and stable IDs

**Files:**
- Create: `src/normalize.ts`, `tests/normalize.test.ts`

**Interfaces:**
- Consumes: `RawJob`, `Job` from `src/types.js`; `Classification` from `src/classify.js`
- Produces:
  - `makeId(source: string, sourceId: string): string` — 16 hex chars
  - `toJob(raw: RawJob, c: Classification, now: string): Job`

- [ ] **Step 1: Write the failing tests**

Create `tests/normalize.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { makeId, toJob } from '../src/normalize.js';
import type { RawJob } from '../src/types.js';

const raw: RawJob = {
  source: 'slotech', sourceId: '8052', url: 'https://slo-tech.com/delo/8052',
  title: 'Frontend Developer', company: 'Acme', location: 'Ljubljana',
  postedAt: '2026-08-18', description: 'Delo.', tags: ['React'],
};

describe('makeId', () => {
  it('is stable across calls', () => {
    expect(makeId('slotech', '8052')).toBe(makeId('slotech', '8052'));
  });

  it('differs between sources sharing an id', () => {
    expect(makeId('slotech', '8052')).not.toBe(makeId('mojedelo', '8052'));
  });

  it('is 16 hex characters', () => {
    expect(makeId('slotech', '8052')).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('toJob', () => {
  it('sets both timestamps to the run time', () => {
    const now = '2026-08-21T17:00:00.000Z';
    const job = toJob(raw, { roleMatch: ['frontend', 'react'], seniority: 'junior' }, now);
    expect(job.firstSeenAt).toBe(now);
    expect(job.lastSeenAt).toBe(now);
  });

  it('joins role matches into a single field', () => {
    const job = toJob(raw, { roleMatch: ['frontend', 'react'], seniority: 'junior' }, 'T');
    expect(job.roleMatch).toBe('frontend,react');
  });

  it('carries the source fields through unchanged', () => {
    const job = toJob(raw, { roleMatch: ['frontend'], seniority: 'mid' }, 'T');
    expect(job.title).toBe('Frontend Developer');
    expect(job.url).toBe('https://slo-tech.com/delo/8052');
    expect(job.seniority).toBe('mid');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/normalize.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/normalize.ts`**

```ts
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
    roleMatch: c.roleMatch.join(','),
    seniority: c.seniority,
    firstSeenAt: now,
    lastSeenAt: now,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/normalize.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/normalize.ts tests/normalize.test.ts
git commit -m "feat: add stable job ids and raw-to-job normalization"
```

---

### Task 4: SQLite storage

**Files:**
- Create: `src/store.ts`, `tests/store.test.ts`

**Interfaces:**
- Consumes: `Job` from `src/types.js`
- Produces:
  - `openDb(path: string): Db` — creates the schema if absent; pass `':memory:'` in tests
  - `upsertJobs(db: Db, jobs: Job[]): void`
  - `allJobs(db: Db): Job[]`
  - `jobsFirstSeenAt(db: Db, timestamp: string): Job[]`
  - `Db` — exported alias for `better-sqlite3`'s `Database.Database` type

- [ ] **Step 1: Write the failing tests**

Create `tests/store.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { openDb, upsertJobs, allJobs, jobsFirstSeenAt } from '../src/store.js';
import type { Job } from '../src/types.js';

const job = (over: Partial<Job> = {}): Job => ({
  source: 'slotech', sourceId: '8052', url: 'https://slo-tech.com/delo/8052',
  title: 'Frontend Developer', company: 'Acme', location: 'Ljubljana',
  postedAt: '2026-08-18', description: 'Delo.', tags: ['React'],
  id: 'aaaa000000000001', roleMatch: 'frontend', seniority: 'junior',
  firstSeenAt: '2026-08-21T17:00:00.000Z', lastSeenAt: '2026-08-21T17:00:00.000Z',
  ...over,
});

describe('store', () => {
  it('round-trips a job', () => {
    const db = openDb(':memory:');
    upsertJobs(db, [job()]);
    const rows = allJobs(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.title).toBe('Frontend Developer');
    expect(rows[0]!.tags).toEqual(['React']);
  });

  it('does not duplicate a job seen twice', () => {
    const db = openDb(':memory:');
    upsertJobs(db, [job()]);
    upsertJobs(db, [job({ lastSeenAt: '2026-08-22T17:00:00.000Z' })]);
    expect(allJobs(db)).toHaveLength(1);
  });

  it('never overwrites first_seen_at', () => {
    const db = openDb(':memory:');
    upsertJobs(db, [job()]);
    upsertJobs(db, [job({
      firstSeenAt: '2026-08-22T17:00:00.000Z',
      lastSeenAt: '2026-08-22T17:00:00.000Z',
    })]);
    expect(allJobs(db)[0]!.firstSeenAt).toBe('2026-08-21T17:00:00.000Z');
  });

  it('updates last_seen_at and mutable fields on re-ingest', () => {
    const db = openDb(':memory:');
    upsertJobs(db, [job()]);
    upsertJobs(db, [job({ title: 'Frontend Developer (m/ž)', lastSeenAt: 'T2' })]);
    const row = allJobs(db)[0]!;
    expect(row.title).toBe('Frontend Developer (m/ž)');
    expect(row.lastSeenAt).toBe('T2');
  });

  it('reports only jobs first seen at the given run timestamp', () => {
    const db = openDb(':memory:');
    const run1 = '2026-08-21T17:00:00.000Z';
    const run2 = '2026-08-22T17:00:00.000Z';
    upsertJobs(db, [job({ id: 'a1', firstSeenAt: run1, lastSeenAt: run1 })]);
    upsertJobs(db, [
      job({ id: 'a1', firstSeenAt: run2, lastSeenAt: run2 }),
      job({ id: 'b2', sourceId: '9000', firstSeenAt: run2, lastSeenAt: run2 }),
    ]);
    const fresh = jobsFirstSeenAt(db, run2);
    expect(fresh.map((j) => j.id)).toEqual(['b2']);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/store.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/store.ts`**

`tags` is an array, which SQLite cannot store directly; it is persisted as a JSON string and parsed back on read.

```ts
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/store.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/store.ts tests/store.test.ts
git commit -m "feat: add SQLite store with first-seen-preserving upsert"
```

---

### Task 5: CSV output

**Files:**
- Create: `src/csv.ts`, `tests/csv.test.ts`

**Interfaces:**
- Consumes: `Job` from `src/types.js`
- Produces:
  - `CSV_COLUMNS: readonly string[]`
  - `toCsv(jobs: Job[]): string`
  - `writeCsv(path: string, jobs: Job[]): void`

- [ ] **Step 1: Write the failing tests**

Create `tests/csv.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { toCsv, CSV_COLUMNS } from '../src/csv.js';
import type { Job } from '../src/types.js';

const job = (over: Partial<Job> = {}): Job => ({
  source: 'slotech', sourceId: '8052', url: 'https://slo-tech.com/delo/8052',
  title: 'Frontend Developer', company: 'Acme', location: 'Ljubljana',
  postedAt: '2026-08-18', description: 'Dolg opis.', tags: ['React'],
  id: 'a1', roleMatch: 'frontend', seniority: 'junior',
  firstSeenAt: '2026-08-21T17:00:00.000Z', lastSeenAt: '2026-08-21T17:00:00.000Z',
  ...over,
});

describe('toCsv', () => {
  it('writes a header row', () => {
    expect(toCsv([]).trim()).toBe(CSV_COLUMNS.join(','));
  });

  it('omits the description column', () => {
    expect(CSV_COLUMNS).not.toContain('description');
    expect(toCsv([job()])).not.toContain('Dolg opis');
  });

  it('quotes and escapes a field containing a comma and a quote', () => {
    const csv = toCsv([job({ company: 'Acme, "The" d.o.o.' })]);
    expect(csv).toContain('"Acme, ""The"" d.o.o."');
  });

  it('renders an empty cell for a null field', () => {
    const csv = toCsv([job({ company: null, postedAt: null })]);
    const cells = csv.trim().split('\n')[1]!.split(',');
    expect(cells).toContain('');
  });

  it('writes one row per job', () => {
    const csv = toCsv([job({ id: 'a' }), job({ id: 'b' })]);
    expect(csv.trim().split('\n')).toHaveLength(3);
  });

  it('replaces newlines inside a field so rows stay on one line', () => {
    const csv = toCsv([job({ title: 'Frontend\nDeveloper' })]);
    expect(csv.trim().split('\n')).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/csv.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/csv.ts`**

```ts
import { writeFileSync } from 'node:fs';
import type { Job } from './types.js';

/** Description is deliberately absent — it makes the file unusable in a spreadsheet. */
export const CSV_COLUMNS = [
  'source', 'title', 'company', 'location', 'seniority', 'role_match',
  'tags', 'posted_at', 'first_seen_at', 'url',
] as const;

const cell = (value: string | null): string => {
  if (value === null || value === '') return '';
  const flat = value.replace(/[\r\n]+/g, ' ').trim();
  return /[",]/.test(flat) ? `"${flat.replace(/"/g, '""')}"` : flat;
};

const row = (j: Job): string => [
  j.source, j.title, j.company, j.location, j.seniority, j.roleMatch,
  j.tags.join(' '), j.postedAt, j.firstSeenAt, j.url,
].map(cell).join(',');

export function toCsv(jobs: Job[]): string {
  return [CSV_COLUMNS.join(','), ...jobs.map(row)].join('\n') + '\n';
}

export function writeCsv(path: string, jobs: Job[]): void {
  writeFileSync(path, toCsv(jobs), 'utf8');
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/csv.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/csv.ts tests/csv.test.ts
git commit -m "feat: add CSV rendering with RFC-style escaping"
```

---

### Task 6: HTTP helper

**Files:**
- Create: `src/http.ts`, `tests/http.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `USER_AGENT: string`
  - `REQUEST_DELAY_MS: number`
  - `sleep(ms: number): Promise<void>`
  - `fetchText(url: string, opts?: { encoding?: string; headers?: Record<string, string> }): Promise<string>`
  - `fetchJson<T>(url: string, headers?: Record<string, string>): Promise<T>`
  - `stripHtml(html: string): string`

- [ ] **Step 1: Write the failing tests**

Only `stripHtml` and `sleep` are unit tested — the fetch wrappers are exercised through the source adapters against fixtures, and testing them directly would mean live network I/O.

Create `tests/http.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { stripHtml, sleep, USER_AGENT } from '../src/http.js';

describe('stripHtml', () => {
  it('removes tags and keeps the text', () => {
    expect(stripHtml('<ul><li><p>Razvoj v C++</p></li></ul>')).toBe('Razvoj v C++');
  });

  it('inserts a space between adjacent blocks so words do not fuse', () => {
    expect(stripHtml('<p>Zahtevamo</p><p>3+ let</p>')).toBe('Zahtevamo 3+ let');
  });

  it('decodes numeric and named entities', () => {
    expect(stripHtml('Programski in&#382;enir &amp; razvijalec')).toBe('Programski inženir & razvijalec');
  });

  it('collapses runs of whitespace', () => {
    expect(stripHtml('a   \n\n  b')).toBe('a b');
  });

  it('returns an empty string for empty input', () => {
    expect(stripHtml('')).toBe('');
  });
});

describe('sleep', () => {
  it('resolves', async () => {
    await expect(sleep(1)).resolves.toBeUndefined();
  });
});

describe('USER_AGENT', () => {
  it('identifies the scraper and links to the repo', () => {
    expect(USER_AGENT).toMatch(/job-scraper/);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/http.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/http.ts`**

```ts
import iconv from 'iconv-lite';
import * as cheerio from 'cheerio';

export const USER_AGENT =
  'job-scraper/1.0 (personal job search bot; +https://github.com/svenahac/job-scraper)';

/** Delay between sequential requests to the same host. */
export const REQUEST_DELAY_MS = 600;

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

interface FetchTextOptions {
  /** e.g. 'iso-8859-2'. Omit for UTF-8. */
  encoding?: string;
  headers?: Record<string, string>;
}

async function request(url: string, headers: Record<string, string>): Promise<Response> {
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, ...headers },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`GET ${url} failed: ${res.status} ${res.statusText}`);
  return res;
}

export async function fetchText(url: string, opts: FetchTextOptions = {}): Promise<string> {
  const res = await request(url, opts.headers ?? {});
  if (!opts.encoding) return res.text();
  // slo-tech serves iso-8859-2; decoding it as UTF-8 destroys every diacritic.
  const buf = Buffer.from(await res.arrayBuffer());
  return iconv.decode(buf, opts.encoding);
}

export async function fetchJson<T>(url: string, headers: Record<string, string> = {}): Promise<T> {
  const res = await request(url, { Accept: 'application/json', ...headers });
  return (await res.json()) as T;
}

/** HTML fragment to plain text, entities decoded, whitespace collapsed. */
export function stripHtml(html: string): string {
  if (!html) return '';
  // Pad block-closing tags first. cheerio's .text() concatenates adjacent
  // blocks with no separator, so "<p>Zahtevamo</p><p>3+ let</p>" would other-
  // wise collapse to "Zahtevamo3+ let" and break keyword matching. Table cells
  // matter as much as paragraphs here: slo-tech is a table-based layout, and an
  // unpadded skills table yields "C!#ekspert.NETekspertGITnapredno znanje".
  const spaced = html.replace(/<\/(?:p|li|div|tr|td|th|dd|dt|h[1-6])>|<br\s*\/?>/gi, ' $& ');
  const $ = cheerio.load(`<div id="__root">${spaced}</div>`);
  return $('#__root').text().replace(/\s+/g, ' ').trim();
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/http.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/http.ts tests/http.test.ts
git commit -m "feat: add HTTP helper with encoding support and HTML stripping"
```

---

### Task 7: slo-tech adapter

**Files:**
- Create: `src/sources/slotech.ts`, `tests/sources/slotech.test.ts`, `tests/fixtures/slotech-listing.html`, `tests/fixtures/slotech-detail.html`

**Interfaces:**
- Consumes: `RawJob`, `Source` from `../types.js`; `fetchText`, `sleep`, `stripHtml`, `REQUEST_DELAY_MS` from `../http.js`
- Produces:
  - `parseListing(html: string): Array<{ sourceId: string; title: string; company: string | null; tags: string[] }>`
  - `parseDetail(html: string): { description: string; postedAt: string | null; location: string | null }`
  - `sloTechSource: Source`

**Reference — verified page structure:**
Listing rows are `<tr>` with `td.name > h3 > a[href="/delo/{id}"]` for title and id, `td.name span.oddelek a` for tags, and `td.company > a` for the company. Detail pages carry the body text and a line reading `objavljeno :: 18. avg 2026 ob 10:14:43`. Both are served as `charset=iso-8859-2` with numeric HTML entities (`&#269;`) on top.

- [ ] **Step 1: Capture the fixtures**

```bash
mkdir -p tests/fixtures tests/sources
UA='job-scraper/1.0 (personal job search bot)'
curl -sS -A "$UA" https://slo-tech.com/delo | iconv -f iso-8859-2 -t utf-8 > tests/fixtures/slotech-listing.html
curl -sS -A "$UA" https://slo-tech.com/delo/8052 | iconv -f iso-8859-2 -t utf-8 > tests/fixtures/slotech-detail.html
wc -c tests/fixtures/slotech-*.html
```

Both files must be non-empty. The fixtures are stored already decoded to UTF-8, so tests read them with plain `readFileSync(..., 'utf8')`.

- [ ] **Step 2: Write the failing tests**

Create `tests/sources/slotech.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseListing, parseDetail } from '../../src/sources/slotech.js';

const listing = readFileSync('tests/fixtures/slotech-listing.html', 'utf8');
const detail = readFileSync('tests/fixtures/slotech-detail.html', 'utf8');

describe('parseListing', () => {
  const rows = parseListing(listing);

  it('finds job rows', () => {
    expect(rows.length).toBeGreaterThan(5);
  });

  it('extracts a numeric source id from the href', () => {
    expect(rows[0]!.sourceId).toMatch(/^\d+$/);
  });

  it('extracts a non-empty title', () => {
    expect(rows[0]!.title.length).toBeGreaterThan(3);
  });

  it('decodes Slovenian diacritics rather than leaving entities', () => {
    const joined = rows.map((r) => r.title).join(' ');
    expect(joined).not.toContain('&#');
  });

  it('extracts the company', () => {
    expect(rows.some((r) => r.company !== null && r.company.length > 1)).toBe(true);
  });

  it('extracts technology tags for at least one row', () => {
    expect(rows.some((r) => r.tags.length > 0)).toBe(true);
  });

  it('extracts only numeric posting ids, filtering out tag and company links', () => {
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.sourceId).toMatch(/^\d+$/);
    const allDeloLinks = (listing.match(/href="\/delo\//g) ?? []).length;
    expect(rows.length).toBeLessThan(allDeloLinks);
  });

  // Synthetic rather than fixture-based on purpose: this isolates our guard.
  // The live fixture happens to contain only numeric ids inside td.name, so a
  // fixture-based assertion passes even with the guard deleted.
  it('rejects a non-numeric /delo/ link even inside a job-row cell', () => {
    const html = `<table>
      <tr>
        <td class="name"><h3><a href="/delo/tagi/react">react</a></h3></td>
        <td class="company"><a href="/delo/podjetje/Acme">Acme</a></td>
      </tr>
      <tr>
        <td class="name"><h3><a href="/delo/8052">Real Job</a></h3></td>
        <td class="company"><a href="/delo/podjetje/Acme">Acme</a></td>
      </tr>
    </table>`;
    expect(parseListing(html).map((r) => r.sourceId)).toEqual(['8052']);
  });
});

describe('parseDetail', () => {
  const parsed = parseDetail(detail);

  it('extracts substantial body text', () => {
    expect(parsed.description.length).toBeGreaterThan(200);
  });

  it('strips HTML tags from the body', () => {
    expect(parsed.description).not.toContain('<');
  });

  it('extracts the posted date as an ISO date', () => {
    expect(parsed.postedAt).toBe('2026-08-18');
  });

  it('extracts the location', () => {
    expect(parsed.location).toBe('Ljubljana');
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run tests/sources/slotech.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `src/sources/slotech.ts`**

```ts
import * as cheerio from 'cheerio';
import type { RawJob, Source } from '../types.js';
import { fetchText, sleep, stripHtml, REQUEST_DELAY_MS } from '../http.js';

const BASE = 'https://slo-tech.com';
const LISTING_URL = `${BASE}/delo`;
const ENCODING = 'iso-8859-2';

export interface ListingRow {
  sourceId: string;
  title: string;
  company: string | null;
  tags: string[];
}

export function parseListing(html: string): ListingRow[] {
  const $ = cheerio.load(html);
  const rows: ListingRow[] = [];

  $('tr').each((_, tr) => {
    const $tr = $(tr);
    const link = $tr.find('td.name h3 a[href^="/delo/"]').first();
    const href = link.attr('href');
    if (!href) return;

    // Only numeric ids are postings. /delo/tagi/... and /delo/podjetje/... are not.
    const match = /^\/delo\/(\d+)$/.exec(href);
    if (!match) return;

    rows.push({
      sourceId: match[1]!,
      title: link.text().trim(),
      company: $tr.find('td.company a').first().text().trim() || null,
      tags: $tr.find('td.name span.oddelek a').map((_i, a) => $(a).text().trim()).get(),
    });
  });

  return rows;
}

const MONTHS: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', maj: '05', jun: '06',
  jul: '07', avg: '08', sep: '09', okt: '10', nov: '11', dec: '12',
};

export function parseDetail(html: string): {
  description: string;
  postedAt: string | null;
  location: string | null;
} {
  const $ = cheerio.load(html);
  // Remove page chrome so the body text is the advert, not the login form.
  // noscript is essential: htmlparser2 treats its contents as raw text, so the
  // page's Piwik tracking snippet leaks literal markup into the description.
  $('script, style, form, nav, header, footer, noscript').remove();
  const description = stripHtml($.root().html() ?? '');

  // "objavljeno :: 18. avg 2026 ob 10:14:43"
  const m = /objavljeno\s*::\s*(\d{1,2})\.\s*([a-zščž]{3})\s*(\d{4})/i.exec(description);
  let postedAt: string | null = null;
  if (m) {
    const month = MONTHS[m[2]!.toLowerCase()];
    if (month) postedAt = `${m[3]}-${month}-${m[1]!.padStart(2, '0')}`;
  }

  // slo-tech exposes a structured location as the sole /delo/mesto/ link.
  const location = $('a[href^="/delo/mesto/"]').first().text().trim() || null;

  return { description, postedAt, location };
}

export const sloTechSource: Source = {
  name: 'slotech',
  async fetchJobs(): Promise<RawJob[]> {
    const listing = await fetchText(LISTING_URL, { encoding: ENCODING });
    const rows = parseListing(listing);
    const jobs: RawJob[] = [];

    for (const row of rows) {
      await sleep(REQUEST_DELAY_MS);
      const url = `${BASE}/delo/${row.sourceId}`;
      const detail = await fetchText(url, { encoding: ENCODING });
      const { description, postedAt, location } = parseDetail(detail);
      jobs.push({
        source: 'slotech',
        sourceId: row.sourceId,
        url,
        title: row.title,
        company: row.company,
        location,
        postedAt,
        description,
        tags: row.tags,
      });
    }

    return jobs;
  },
};
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/sources/slotech.test.ts`
Expected: PASS.

If `parseDetail` returns a description under 200 characters, the chrome-removal selectors stripped too much — check what the fixture actually contains with `grep -o 'Opis delovnega mesta.\{0,200\}' tests/fixtures/slotech-detail.html`.

- [ ] **Step 6: Commit**

```bash
git add src/sources/slotech.ts tests/sources/slotech.test.ts tests/fixtures/slotech-listing.html tests/fixtures/slotech-detail.html
git commit -m "feat: add slo-tech source adapter"
```

---

### Task 8: mojedelo adapter

**Files:**
- Create: `src/sources/mojedelo.ts`, `tests/sources/mojedelo.test.ts`, `tests/fixtures/mojedelo-search.json`, `tests/fixtures/mojedelo-detail.json`

**Interfaces:**
- Consumes: `RawJob`, `Source` from `../types.js`; `fetchJson`, `fetchText`, `sleep`, `stripHtml`, `REQUEST_DELAY_MS` from `../http.js`
- Produces:
  - `parseSearchPage(json: unknown): Array<{ id: string; title: string; company: string | null; location: string | null; postedAt: string | null }>`
  - `parseDetail(json: unknown): { description: string }`
  - `buildJobUrl(title: string, id: string): string`
  - `totalFrom(json: unknown): number`
  - `loadApiHeaders(): Promise<ApiHeaders>`
  - `mojeDeloSource: Source`

**Reference — verified API contract:**

| Item | Value |
|---|---|
| Config | `GET https://api.mojedelo.com/uploaded-files/config/www.mojedelo.com/jb.globals.js` |
| Search | `GET https://api.mojedelo.com/job-ads-search?jobCategoryIds=…&regionIds=…&pageSize=N&startFrom=N` |
| Detail | `GET https://api.mojedelo.com/job-ads/{uuid}` |
| Headers | `tenantId`, `channelId`, `languageId` (all required; a missing one returns HTTP 400) |
| Filters | `jobCategoryIds=64f003ff-6d8b-4be0-b58c-4580e4eeeb8a` (programiranje), `regionIds=d1dce9b1-9fa4-438b-b582-10d371d442e6` (osrednjeslovenska) |
| Result | `{"data":{"items":[…],"total":90}}` |

The three header GUIDs are read at runtime from the config file, not hardcoded: `appConfig.tenantId`, `appConfig.jbChannelId`, and `appConfig.languages[0].id`. The config file is JavaScript, not JSON — extract the values with regexes rather than parsing it.

Search items carry only `adSummary` (about 100 characters), not the full text. Seniority classification needs the detail call, which returns `jobDescription` and `weExpect` as HTML — both must be concatenated, because the years-of-experience requirement usually lives in `weExpect`.

- [ ] **Step 1: Capture the fixtures**

```bash
H=(-H "Accept: application/json" \
   -H "tenantId: 5947a585-ad25-47dc-bff3-f08620d1ce17" \
   -H "channelId: 8805c1b8-a0a9-4f57-ad42-329af3c92a61" \
   -H "languageId: db3c58e6-a083-4f72-b30b-39f2127bb18d")
Q="jobCategoryIds=64f003ff-6d8b-4be0-b58c-4580e4eeeb8a&regionIds=d1dce9b1-9fa4-438b-b582-10d371d442e6"
curl -sS "${H[@]}" "https://api.mojedelo.com/job-ads-search?${Q}&pageSize=3&startFrom=0" \
  | python3 -c "import sys,json;json.dump(json.load(sys.stdin),open('tests/fixtures/mojedelo-search.json','w'),ensure_ascii=False)"
ID=$(python3 -c "import json;print(json.load(open('tests/fixtures/mojedelo-search.json'))['data']['items'][0]['id'])")
curl -sS "${H[@]}" "https://api.mojedelo.com/job-ads/${ID}" \
  | python3 -c "import sys,json;json.dump(json.load(sys.stdin),open('tests/fixtures/mojedelo-detail.json','w'),ensure_ascii=False)"
wc -c tests/fixtures/mojedelo-*.json
```

Note: search items embed base64 company logos, so the search fixture is large. That is expected.

- [ ] **Step 2: Write the failing tests**

Create `tests/sources/mojedelo.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseSearchPage, parseDetail, buildJobUrl } from '../../src/sources/mojedelo.js';

const search = JSON.parse(readFileSync('tests/fixtures/mojedelo-search.json', 'utf8'));
const detail = JSON.parse(readFileSync('tests/fixtures/mojedelo-detail.json', 'utf8'));

describe('parseSearchPage', () => {
  const items = parseSearchPage(search);

  it('extracts every item', () => {
    expect(items.length).toBeGreaterThan(0);
  });

  it('extracts a UUID id', () => {
    expect(items[0]!.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('extracts a title', () => {
    expect(items[0]!.title.length).toBeGreaterThan(3);
  });

  it('extracts the company name', () => {
    expect(items[0]!.company).toBeTruthy();
  });

  it('extracts the town as the location', () => {
    expect(items[0]!.location).toBeTruthy();
  });

  it('extracts the posted date as an ISO date', () => {
    expect(items[0]!.postedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('returns an empty array when the payload has no items', () => {
    expect(parseSearchPage({ data: { items: [], total: 0 } })).toEqual([]);
  });
});

describe('parseDetail', () => {
  it('concatenates jobDescription and weExpect into plain text', () => {
    const { description } = parseDetail(detail);
    expect(description.length).toBeGreaterThan(200);
    expect(description).not.toContain('<');
  });

  it('tolerates a payload missing weExpect', () => {
    const { description } = parseDetail({ data: { jobDescription: '<p>Samo opis.</p>' } });
    expect(description).toBe('Samo opis.');
  });
});

describe('buildJobUrl', () => {
  it('slugifies the title into the public URL', () => {
    expect(buildJobUrl('Software Engineer (m/ž)', 'abc-123'))
      .toBe('https://www.mojedelo.com/job-ad/software-engineer-m-z/abc-123');
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run tests/sources/mojedelo.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `src/sources/mojedelo.ts`**

```ts
import type { RawJob, Source } from '../types.js';
import { fetchJson, fetchText, sleep, stripHtml, REQUEST_DELAY_MS } from '../http.js';

const API = 'https://api.mojedelo.com';
const CONFIG_URL = `${API}/uploaded-files/config/www.mojedelo.com/jb.globals.js`;
const SITE = 'https://www.mojedelo.com';

/** Programiranje / IT. */
const JOB_CATEGORY_ID = '64f003ff-6d8b-4be0-b58c-4580e4eeeb8a';
/** Osrednjeslovenska. */
const REGION_ID = 'd1dce9b1-9fa4-438b-b582-10d371d442e6';

const PAGE_SIZE = 50;

export interface SearchItem {
  id: string;
  title: string;
  company: string | null;
  location: string | null;
  postedAt: string | null;
}

interface ApiHeaders extends Record<string, string> {
  tenantId: string;
  channelId: string;
  languageId: string;
}

/**
 * The API rejects requests without tenantId/channelId/languageId. All three are
 * published in the site's own config file, so they are read at runtime rather
 * than hardcoded — a rotation on their side then does not break the scraper.
 */
export async function loadApiHeaders(): Promise<ApiHeaders> {
  const js = await fetchText(CONFIG_URL);
  const pick = (re: RegExp, label: string): string => {
    const m = re.exec(js);
    if (!m?.[1]) throw new Error(`mojedelo config: could not read ${label}`);
    return m[1];
  };
  return {
    tenantId: pick(/"tenantId"\s*:\s*"([0-9a-f-]{36})"/, 'tenantId'),
    channelId: pick(/"jbChannelId"\s*:\s*"([0-9a-f-]{36})"/, 'jbChannelId'),
    languageId: pick(/"languages"\s*:\s*\[\s*\{\s*"id"\s*:\s*"([0-9a-f-]{36})"/, 'languageId'),
  };
}

interface RawSearchResponse {
  data?: { items?: unknown[]; total?: number };
}

export function parseSearchPage(json: unknown): SearchItem[] {
  const items = (json as RawSearchResponse)?.data?.items ?? [];
  return items.map((raw) => {
    const it = raw as Record<string, any>;
    const startDate: string | undefined = it['startDate'];
    return {
      id: String(it['id']),
      title: String(it['title'] ?? '').trim(),
      company: it['company']?.name ? String(it['company'].name) : null,
      location: it['town']?.name ? String(it['town'].name) : null,
      postedAt: startDate ? startDate.slice(0, 10) : null,
    };
  });
}

export function parseDetail(json: unknown): { description: string } {
  const d = ((json as Record<string, any>)?.['data'] ?? json) as Record<string, any>;
  // weExpect holds the requirements, which is where years-of-experience lives.
  const html = [d?.['jobDescription'], d?.['weExpect']].filter(Boolean).join(' ');
  return { description: stripHtml(String(html)) };
}

const slugify = (s: string): string =>
  s.toLowerCase()
    .replace(/[čć]/g, 'c').replace(/š/g, 's').replace(/ž/g, 'z').replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

export function buildJobUrl(title: string, id: string): string {
  return `${SITE}/job-ad/${slugify(title)}/${id}`;
}

export function totalFrom(json: unknown): number {
  return (json as RawSearchResponse)?.data?.total ?? 0;
}

export const mojeDeloSource: Source = {
  name: 'mojedelo',
  async fetchJobs(): Promise<RawJob[]> {
    const headers = await loadApiHeaders();
    const query = `jobCategoryIds=${JOB_CATEGORY_ID}&regionIds=${REGION_ID}`;

    const items: SearchItem[] = [];
    let startFrom = 0;
    let total = Infinity;

    while (startFrom < total) {
      const page = await fetchJson<unknown>(
        `${API}/job-ads-search?${query}&pageSize=${PAGE_SIZE}&startFrom=${startFrom}`,
        headers,
      );
      total = totalFrom(page);
      const batch = parseSearchPage(page);
      if (batch.length === 0) break;
      items.push(...batch);
      startFrom += batch.length;
      await sleep(REQUEST_DELAY_MS);
    }

    const jobs: RawJob[] = [];
    for (const item of items) {
      await sleep(REQUEST_DELAY_MS);
      const detail = await fetchJson<unknown>(`${API}/job-ads/${item.id}`, headers);
      jobs.push({
        source: 'mojedelo',
        sourceId: item.id,
        url: buildJobUrl(item.title, item.id),
        title: item.title,
        company: item.company,
        location: item.location,
        postedAt: item.postedAt,
        description: parseDetail(detail).description,
        tags: [],
      });
    }

    return jobs;
  },
};
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/sources/mojedelo.test.ts`
Expected: PASS.

- [ ] **Step 6: Verify the adapter against the live API once**

Run: `npx tsx -e "import('./src/sources/mojedelo.ts').then(async m => { const h = await m.loadApiHeaders(); console.log(h); })"`
Expected: prints three GUIDs, none undefined. This confirms the config regexes still match the live file.

- [ ] **Step 7: Commit**

```bash
git add src/sources/mojedelo.ts tests/sources/mojedelo.test.ts tests/fixtures/mojedelo-*.json
git commit -m "feat: add mojedelo source adapter over the job-ads-search API"
```

---

### Task 9: LinkedIn adapter

**Files:**
- Create: `src/sources/linkedin.ts`, `tests/sources/linkedin.test.ts`, `tests/fixtures/linkedin-guest.html`

**Interfaces:**
- Consumes: `RawJob`, `Source` from `../types.js`; `fetchText`, `sleep`, `REQUEST_DELAY_MS` from `../http.js`
- Produces:
  - `parseGuestCards(html: string): Array<{ sourceId: string; title: string; company: string | null; location: string | null; url: string; postedAt: string | null }>`
  - `linkedInSource: Source`

**Reference — verified endpoint:**
`GET https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords=…&location=…&start=N` returns an HTML fragment of up to 25 cards per request (a `start=0` call returned 60 anchors across repeated cards). Each card exposes `a.base-card__full-link[href]` pointing at `https://si.linkedin.com/jobs/view/{slug}-{numericId}`; the numeric tail is the source id.

This source is expected to fail on many CI runs — LinkedIn rate-limits datacenter IPs. The adapter must surface that as a thrown error so the orchestrator records a source failure rather than silently producing zero jobs.

- [ ] **Step 1: Capture the fixture**

```bash
UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'
curl -sS -A "$UA" -o tests/fixtures/linkedin-guest.html \
  "https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords=frontend%20developer&location=Ljubljana%2C%20Slovenia&start=0"
grep -c base-card__full-link tests/fixtures/linkedin-guest.html
```

Expected: a count above zero. If it is zero, this IP is currently rate-limited — wait and retry, or capture from a different network. Do not proceed with an empty fixture.

- [ ] **Step 2: Write the failing tests**

Create `tests/sources/linkedin.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseGuestCards } from '../../src/sources/linkedin.js';

const html = readFileSync('tests/fixtures/linkedin-guest.html', 'utf8');

describe('parseGuestCards', () => {
  const cards = parseGuestCards(html);

  it('finds job cards', () => {
    expect(cards.length).toBeGreaterThan(0);
  });

  it('extracts the numeric job id from the URL tail', () => {
    expect(cards[0]!.sourceId).toMatch(/^\d+$/);
  });

  it('strips tracking parameters from the URL', () => {
    expect(cards[0]!.url).not.toContain('trackingId');
    expect(cards[0]!.url).not.toContain('refId');
  });

  it('extracts a title', () => {
    expect(cards[0]!.title.length).toBeGreaterThan(3);
  });

  it('extracts a company', () => {
    expect(cards.some((c) => c.company !== null)).toBe(true);
  });

  it('deduplicates cards repeated within one response', () => {
    const ids = cards.map((c) => c.sourceId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('returns an empty array for an empty response body', () => {
    expect(parseGuestCards('')).toEqual([]);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run tests/sources/linkedin.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `src/sources/linkedin.ts`**

```ts
import * as cheerio from 'cheerio';
import type { RawJob, Source } from '../types.js';
import { fetchText, sleep, REQUEST_DELAY_MS } from '../http.js';

const GUEST_API =
  'https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search';

/** LinkedIn blocks the scraper User-Agent; the guest endpoint needs a browser one. */
const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/126.0 Safari/537.36';

const QUERIES: Array<{ keywords: string; location: string }> = [
  { keywords: 'frontend developer', location: 'Ljubljana, Slovenia' },
  { keywords: 'fullstack developer', location: 'Ljubljana, Slovenia' },
  { keywords: 'web developer', location: 'Ljubljana, Slovenia' },
  { keywords: 'frontend developer', location: 'Slovenia' },
  { keywords: 'fullstack developer', location: 'Slovenia' },
];

export interface GuestCard {
  sourceId: string;
  title: string;
  company: string | null;
  location: string | null;
  url: string;
  postedAt: string | null;
}

export function parseGuestCards(html: string): GuestCard[] {
  if (!html.trim()) return [];
  const $ = cheerio.load(html);
  const byId = new Map<string, GuestCard>();

  $('a.base-card__full-link').each((_, a) => {
    const $a = $(a);
    const href = $a.attr('href');
    if (!href) return;

    // https://si.linkedin.com/jobs/view/web-developer-at-tasty-dose-4455728200?…
    const clean = href.split('?')[0]!;
    const idMatch = /-(\d{6,})$/.exec(clean);
    if (!idMatch) return;
    const sourceId = idMatch[1]!;
    if (byId.has(sourceId)) return;

    const $card = $a.closest('.base-card, li');
    const text = (sel: string): string | null => {
      const t = $card.find(sel).first().text().trim();
      return t.length > 0 ? t : null;
    };

    byId.set(sourceId, {
      sourceId,
      title: $a.text().trim() || text('.base-search-card__title') || '',
      company: text('.base-search-card__subtitle'),
      location: text('.job-search-card__location'),
      url: clean,
      postedAt: $card.find('time').first().attr('datetime') ?? null,
    });
  });

  return [...byId.values()];
}

export const linkedInSource: Source = {
  name: 'linkedin',
  async fetchJobs(): Promise<RawJob[]> {
    const byId = new Map<string, GuestCard>();

    for (const q of QUERIES) {
      await sleep(REQUEST_DELAY_MS);
      const url = `${GUEST_API}?keywords=${encodeURIComponent(q.keywords)}` +
        `&location=${encodeURIComponent(q.location)}&start=0`;
      // A non-2xx here throws, which is correct: the orchestrator records
      // this source as failed rather than reporting zero jobs found.
      const html = await fetchText(url, { headers: { 'User-Agent': BROWSER_UA } });
      for (const card of parseGuestCards(html)) {
        if (!byId.has(card.sourceId)) byId.set(card.sourceId, card);
      }
    }

    // The guest card carries no body text, and the detail page is behind an
    // auth wall for datacenter IPs. Title plus company is what classification
    // gets; such jobs usually land as seniority 'unknown', which is kept.
    return [...byId.values()].map((c) => ({
      source: 'linkedin',
      sourceId: c.sourceId,
      url: c.url,
      title: c.title,
      company: c.company,
      location: c.location,
      postedAt: c.postedAt,
      description: '',
      tags: [],
    }));
  },
};
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/sources/linkedin.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/sources/linkedin.ts tests/sources/linkedin.test.ts tests/fixtures/linkedin-guest.html
git commit -m "feat: add LinkedIn guest API source adapter"
```

---

### Task 10: Pipeline orchestrator

**Files:**
- Create: `src/index.ts`, `tests/pipeline.test.ts`

**Interfaces:**
- Consumes: everything built so far
- Produces:
  - `runScrape(opts: { sources: Source[]; now: string; dbPath: string; allCsvPath: string; newCsvPath: string }): Promise<RunResult>`
  - `interface RunResult { succeeded: string[]; failed: Array<{ source: string; error: string }>; kept: number; newCount: number }`

- [ ] **Step 1: Write the failing tests**

Create `tests/pipeline.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runScrape } from '../src/index.js';
import type { RawJob, Source } from '../src/types.js';

const raw = (over: Partial<RawJob>): RawJob => ({
  source: 'stub', sourceId: '1', url: 'https://x/1', title: '', company: 'Acme',
  location: 'Ljubljana', postedAt: '2026-08-18', description: '', tags: [], ...over,
});

const stub = (name: string, jobs: RawJob[]): Source => ({
  name,
  fetchJobs: async () => jobs.map((j) => ({ ...j, source: name })),
});

const exploding = (name: string): Source => ({
  name,
  fetchJobs: async () => { throw new Error('rate limited'); },
});

let dir: string;
const paths = () => ({
  dbPath: join(dir, 'jobs.db'),
  allCsvPath: join(dir, 'jobs-all.csv'),
  newCsvPath: join(dir, 'jobs-new.csv'),
});

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'scraper-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe('runScrape', () => {
  it('keeps a junior web job and drops a senior one', async () => {
    const src = stub('a', [
      raw({ sourceId: '1', title: 'Junior Frontend Developer' }),
      raw({ sourceId: '2', title: 'Senior Frontend Developer' }),
    ]);
    const r = await runScrape({ sources: [src], now: 'T1', ...paths() });
    expect(r.kept).toBe(1);
    const csv = readFileSync(paths().allCsvPath, 'utf8');
    expect(csv).toContain('Junior Frontend Developer');
    expect(csv).not.toContain('Senior Frontend Developer');
  });

  it('drops a non-web job', async () => {
    const src = stub('a', [raw({ sourceId: '1', title: 'Robotics Engineer', description: 'C++' })]);
    const r = await runScrape({ sources: [src], now: 'T1', ...paths() });
    expect(r.kept).toBe(0);
  });

  it('records a failing source and still writes CSVs from the others', async () => {
    const good = stub('good', [raw({ sourceId: '1', title: 'Junior Frontend Developer' })]);
    const r = await runScrape({ sources: [exploding('bad'), good], now: 'T1', ...paths() });
    expect(r.succeeded).toEqual(['good']);
    expect(r.failed[0]!.source).toBe('bad');
    expect(r.kept).toBe(1);
    expect(readFileSync(paths().allCsvPath, 'utf8')).toContain('Junior Frontend Developer');
  });

  it('reports a job as new only on the run that first saw it', async () => {
    const src = stub('a', [raw({ sourceId: '1', title: 'Junior Frontend Developer' })]);
    const first = await runScrape({ sources: [src], now: 'T1', ...paths() });
    expect(first.newCount).toBe(1);
    expect(readFileSync(paths().newCsvPath, 'utf8')).toContain('Junior Frontend Developer');

    const second = await runScrape({ sources: [src], now: 'T2', ...paths() });
    expect(second.newCount).toBe(0);
    expect(readFileSync(paths().newCsvPath, 'utf8')).not.toContain('Junior Frontend Developer');
    // The job is still in the full CSV.
    expect(readFileSync(paths().allCsvPath, 'utf8')).toContain('Junior Frontend Developer');
  });

  it('reports only the genuinely new job on a later run', async () => {
    const one = stub('a', [raw({ sourceId: '1', title: 'Junior Frontend Developer' })]);
    await runScrape({ sources: [one], now: 'T1', ...paths() });
    const two = stub('a', [
      raw({ sourceId: '1', title: 'Junior Frontend Developer' }),
      raw({ sourceId: '2', title: 'Medior Vue Developer' }),
    ]);
    const r = await runScrape({ sources: [two], now: 'T2', ...paths() });
    expect(r.newCount).toBe(1);
    const csv = readFileSync(paths().newCsvPath, 'utf8');
    expect(csv).toContain('Medior Vue Developer');
    expect(csv).not.toContain('Junior Frontend Developer');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/pipeline.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/index.ts`**

```ts
import { join } from 'node:path';
import type { Job, RawJob, Source } from './types.js';
import { classify, isWanted } from './classify.js';
import { toJob } from './normalize.js';
import { openDb, upsertJobs, allJobs, jobsFirstSeenAt } from './store.js';
import { writeCsv } from './csv.js';
import { sloTechSource } from './sources/slotech.js';
import { mojeDeloSource } from './sources/mojedelo.js';
import { linkedInSource } from './sources/linkedin.js';

export interface RunResult {
  succeeded: string[];
  failed: Array<{ source: string; error: string }>;
  kept: number;
  newCount: number;
}

export interface RunOptions {
  sources: Source[];
  now: string;
  dbPath: string;
  allCsvPath: string;
  newCsvPath: string;
}

export async function runScrape(opts: RunOptions): Promise<RunResult> {
  const succeeded: string[] = [];
  const failed: Array<{ source: string; error: string }> = [];
  const raws: RawJob[] = [];

  for (const source of opts.sources) {
    try {
      const jobs = await source.fetchJobs();
      raws.push(...jobs);
      succeeded.push(source.name);
      console.log(`[${source.name}] fetched ${jobs.length} postings`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      failed.push({ source: source.name, error: message });
      console.error(`[${source.name}] FAILED: ${message}`);
    }
  }

  const kept: Job[] = [];
  for (const raw of raws) {
    const c = classify(raw);
    if (isWanted(c)) kept.push(toJob(raw, c, opts.now));
  }
  console.log(`kept ${kept.length} of ${raws.length} postings after filtering`);

  const db = openDb(opts.dbPath);
  try {
    upsertJobs(db, kept);
    const fresh = jobsFirstSeenAt(db, opts.now);
    writeCsv(opts.allCsvPath, allJobs(db));
    writeCsv(opts.newCsvPath, fresh);
    console.log(`${fresh.length} new postings this run`);
    return { succeeded, failed, kept: kept.length, newCount: fresh.length };
  } finally {
    db.close();
  }
}

async function main(): Promise<void> {
  const dataDir = join(process.cwd(), 'data');
  const sources = [sloTechSource, mojeDeloSource, linkedInSource];

  const result = await runScrape({
    sources,
    now: new Date().toISOString(),
    dbPath: join(dataDir, 'jobs.db'),
    allCsvPath: join(dataDir, 'jobs-all.csv'),
    newCsvPath: join(dataDir, 'jobs-new.csv'),
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run`
Expected: PASS — the whole suite, every task's tests.

- [ ] **Step 5: Run the scraper for real once**

Run: `npm run scrape`
Expected: per-source counts logged, then `data/jobs.db`, `data/jobs-all.csv`, and `data/jobs-new.csv` created. A LinkedIn failure line is acceptable. Inspect the result:

```bash
head -5 data/jobs-all.csv
wc -l data/jobs-all.csv data/jobs-new.csv
```

Sanity-check that no row has `senior` in the seniority column and that the titles look like web roles. If obvious junk got through, add the offending keyword to `classify.ts` and re-run — that file is the single tuning point.

- [ ] **Step 6: Commit**

```bash
git add src/index.ts tests/pipeline.test.ts data/jobs.db data/jobs-all.csv data/jobs-new.csv
git commit -m "feat: add pipeline orchestrator with per-source failure isolation"
```

---

### Task 11: Nightly GitHub Actions workflow

**Files:**
- Create: `.github/workflows/scrape.yml`, `README.md`

**Interfaces:**
- Consumes: `npm run scrape` from Task 10
- Produces: a scheduled run that commits `data/` back to the repository

- [ ] **Step 1: Create `.github/workflows/scrape.yml`**

```yaml
name: Scrape jobs

on:
  schedule:
    # 17:00 UTC = 19:00 in Ljubljana during CEST, 18:00 during CET.
    # GitHub cron has no DST awareness; the one-hour winter drift is accepted.
    - cron: '0 17 * * *'
  workflow_dispatch:

permissions:
  contents: write

concurrency:
  group: scrape
  cancel-in-progress: false

jobs:
  scrape:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '24'
          cache: 'npm'

      - run: npm ci

      - name: Scrape
        run: npm run scrape

      - name: Commit results
        run: |
          git config user.name  "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git add data/
          if git diff --staged --quiet; then
            echo "no changes to commit"
          else
            git commit -m "chore: scrape $(date -u +%Y-%m-%d)"
            git push
          fi
```

- [ ] **Step 2: Validate the workflow file parses**

Run: `python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/scrape.yml')); print('valid')"`
Expected: `valid`.

- [ ] **Step 3: Write `README.md`**

```markdown
# Job Scraper

Scrapes junior and mid-level frontend/fullstack developer jobs in Slovenia from
slo-tech, mojedelo, and LinkedIn. Runs nightly via GitHub Actions and commits
its results back to this repository.

## Output

- `data/jobs-all.csv` — every job ever seen
- `data/jobs-new.csv` — jobs first seen in the most recent run
- `data/jobs.db` — SQLite source of truth

Past nights' new-job lists are recoverable from this repo's git history.

## Running locally

```bash
npm install
npm run scrape
```

## Tuning what gets matched

All filtering lives in `src/classify.ts`:

- `ROLE_KEYWORDS` / `TECH_KEYWORDS` — what counts as a web job. Both match
  anywhere in the title, tags, or body.
- `SENIOR_MARKERS` / `JUNIOR_MARKERS` / `MID_MARKERS` — matched against the
  title and tags only, never the body, so an ad mentioning a senior colleague
  is not wrongly excluded.
- `YEARS_RE` — years-of-experience parsing over the body. 5 or more is senior
  and excluded; 3-4 is mid; 2 or fewer is junior.

Only `senior` is ever excluded. Ads with no seniority signal are kept and
flagged `unknown`.

## Sources

| Source | Method | Reliability |
|---|---|---|
| slo-tech | HTML scrape, ISO-8859-2 | Reliable |
| mojedelo | JSON API (`/job-ads-search`) | Reliable |
| LinkedIn | Public guest endpoint | Frequently rate-limited from CI |

LinkedIn blocks datacenter IPs, so it fails on many scheduled runs. That is
expected: the run still succeeds on the other two sources, and the failure is
logged. The run fails only if all three sources fail.

## Schedule

Nightly at 17:00 UTC — 19:00 Ljubljana in summer, 18:00 in winter. Trigger a
manual run from the Actions tab with "Run workflow".
```

- [ ] **Step 4: Run the full suite and typecheck one last time**

Run: `npm test && npm run typecheck`
Expected: all tests PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/scrape.yml README.md
git commit -m "ci: add nightly scrape workflow and project README"
```

- [ ] **Step 6: Push to GitHub**

The workflow cannot run until the repository exists on GitHub. Either:

```bash
gh repo create job-scraper --private --source=. --push
```

or create the repository in the web UI and:

```bash
git remote add origin git@github.com:<user>/job-scraper.git
git push -u origin main
```

Then open the Actions tab and trigger "Scrape jobs" manually once to confirm
the scheduled run will work, including the commit-back step.

---

## Verification Checklist

Run before declaring the project done:

- [ ] `npm test` — all tests pass
- [ ] `npm run typecheck` — no type errors
- [ ] `npm run scrape` — produces all three files in `data/`
- [ ] `grep -c ',senior,' data/jobs-all.csv` returns 0
- [ ] A second consecutive `npm run scrape` leaves `jobs-new.csv` with only its header row
- [ ] The manually triggered GitHub Action completes and pushes a commit
