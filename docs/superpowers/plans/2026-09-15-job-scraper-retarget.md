# Job Scraper Retarget Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Retarget the scraper from junior web-developer jobs to eight prioritised L&D / HR / project-coordination areas, replace slo-tech with the ZRSZ vacancy API, and purge every previously scraped posting.

**Architecture:** A new `src/profile.ts` is the single source of truth for what counts as a match — eight ranked areas, three rejection lists, and the location/work-mode marker lists. `src/classify.ts` becomes an engine that applies the profile and emits a sortable 0–100 fit score plus the signals behind it. Adapters stay dumb: they fetch broadly and hand `RawJob`s to classification.

**Tech Stack:** Node 24, TypeScript (ESM, `.js` import specifiers), vitest, better-sqlite3, cheerio, iconv-lite. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-15-job-scraper-retarget-design.md`

## Global Constraints

- No new runtime dependencies. `package.json` dependencies stay exactly: `better-sqlite3`, `cheerio`, `iconv-lite`.
- ESM with `.js` specifiers on relative imports, even from `.ts` files (e.g. `import { x } from './profile.js'`).
- All keyword matching is case-insensitive and lowercases before comparing. Slovenian diacritics are preserved, never transliterated, when matching.
- Nothing is ever filtered on years of experience. `seniority` is computed and stored but must not affect `isWanted`.
- `CONTRACT_REJECT` is matched against the title and the source's raw employment field ONLY — never the body.
- Every task ends with `npm test` and `npm run typecheck` both green before the commit.
- Commit messages use Conventional Commits. Do NOT add any Co-Authored-By or
  other attribution trailer.

---

### Task 1: ZRSZ reconnaissance and fixture capture

Resolves the one mechanic the spec could not settle from the JS bundle: the public detail-page link for a ZRSZ vacancy, and whether a description body is reachable. Also captures the fixture every later ZRSZ test depends on.

**Files:**
- Create: `tests/fixtures/zrsz-search.json`
- Create: `docs/superpowers/plans/2026-09-15-zrsz-findings.md`

**Interfaces:**
- Consumes: nothing.
- Produces: `tests/fixtures/zrsz-search.json` (a real search response, used by Task 5); a documented decision on the job URL format and description availability.

- [ ] **Step 1: Capture a real search response as the test fixture**

```bash
curl -s -X POST \
  -H 'Content-Type: application/json' \
  -d '{"nazivDelovnegaMesta":"","lokacija":"","drzave":[],"poklicnaPodrocja":[],"regije":["Osrednjeslovenska"],"stran":1,"stZadetkov":50,"vrniFiltre":false,"urejevalniPojem":0}' \
  "https://apigateway-prod-www-prod.apps.ess.gov.si/iskalnik-po-pdm/v1/delovno-mesto/prosta-delovna-mesta-filtri?user_key=9b7dcbe8ec1855d14f0b2ec4f6335a91" \
  > tests/fixtures/zrsz-search.json
```

- [ ] **Step 2: Verify the fixture is a real payload, not an error**

```bash
node -e "const j=require('./tests/fixtures/zrsz-search.json');
if(!j.seznamDelovnihMest || j.seznamDelovnihMest.length < 10) throw new Error('bad fixture');
console.log('total', j.steviloDelovnihMest, 'items', j.seznamDelovnihMest.length);
console.log(Object.keys(j.seznamDelovnihMest[0]).join(', '));"
```

Expected: a total in the low thousands, 50 items, and keys including `idDelovnoMesto`, `nazivDelovnegaMesta`, `delodajalec`, `krajDM`, `trajanjeZaposlitve`, `delovniCas`, `datumObjave`, `poklic`.

- [ ] **Step 3: Find the real detail link in the browser**

Load the Chrome tools in ONE ToolSearch call:

`select:mcp__claude-in-chrome__tabs_context_mcp,mcp__claude-in-chrome__tabs_create_mcp,mcp__claude-in-chrome__navigate,mcp__claude-in-chrome__computer,mcp__claude-in-chrome__read_page,mcp__claude-in-chrome__read_network_requests,mcp__claude-in-chrome__tabs_close_mcp`

Call `tabs_context_mcp` first, then open a NEW tab on
`https://www.ess.gov.si/iskalci-zaposlitve/iskanje-zaposlitve/iskanje-dela/`.
Click the first result card. Record two things:

1. The URL the browser lands on (this becomes `buildJobUrl`).
2. Whether `read_network_requests` shows a request returning a description
   body for that vacancy — if so, its exact URL and the JSON field holding
   the text.

Do not trigger any dialog. Close the tab when done.

- [ ] **Step 4: Write the findings document**

Create `docs/superpowers/plans/2026-09-15-zrsz-findings.md` recording:
- the detail URL template, written as a literal with `<id>` as the placeholder;
- whether a description endpoint exists, and if so its URL and field name;
- if none exists, the single line: `No description endpoint. Task 5 uses the documented fallback.`

The fallback, if Step 3 finds nothing, is:
`https://www.ess.gov.si/iskalci-zaposlitve/iskanje-zaposlitve/iskanje-dela/#/pdm/<id>` with `description: ''`.

- [ ] **Step 5: Commit**

```bash
git add tests/fixtures/zrsz-search.json docs/superpowers/plans/2026-09-15-zrsz-findings.md
git commit -m "test: capture ZRSZ search fixture and record detail-link findings"
```

---

### Task 2: The seeker profile

**Files:**
- Create: `src/profile.ts`
- Test: `tests/profile.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type AreaKey = 'ld' | 'projects' | 'hr' | 'adult-education' | 'eu-projects' | 'employer-brand' | 'content-comms' | 'events'`
  - `interface Area { key: AreaKey; rank: number; label: string; keywords: readonly string[]; queryTerms: readonly string[] }`
  - `const AREAS: readonly Area[]`
  - `const TITLE_REJECT`, `BODY_WARN`, `CONTRACT_REJECT`, `REMOTE_MARKERS`, `HYBRID_MARKERS`, `PRIMARY_LOCATIONS` — all `readonly string[]`, all lowercase
  - `function leadQueryTerms(): string[]` — one lead term per area, best rank first

- [ ] **Step 1: Write the failing test**

Create `tests/profile.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  AREAS, TITLE_REJECT, BODY_WARN, CONTRACT_REJECT,
  REMOTE_MARKERS, HYBRID_MARKERS, PRIMARY_LOCATIONS, leadQueryTerms,
} from '../src/profile.js';

describe('AREAS', () => {
  it('has eight areas ranked 1 to 8 with no gaps or duplicates', () => {
    expect(AREAS).toHaveLength(8);
    expect(AREAS.map((a) => a.rank).sort((x, y) => x - y)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('ranks learning and development first', () => {
    expect(AREAS.find((a) => a.rank === 1)!.key).toBe('ld');
  });

  it('gives every area a unique key, a label, keywords and query terms', () => {
    expect(new Set(AREAS.map((a) => a.key)).size).toBe(8);
    for (const a of AREAS) {
      expect(a.label.length).toBeGreaterThan(3);
      expect(a.keywords.length).toBeGreaterThan(0);
      expect(a.queryTerms.length).toBeGreaterThan(0);
    }
  });

  it('stores every keyword lowercase, so matching never has to case-fold the profile', () => {
    for (const a of AREAS) {
      for (const k of a.keywords) expect(k).toBe(k.toLowerCase());
    }
  });

  it('draws every query term from its own keyword list', () => {
    for (const a of AREAS) {
      for (const q of a.queryTerms) expect(a.keywords).toContain(q);
    }
  });
});

describe('rejection lists', () => {
  it('never rejects a title phrase that is also an area keyword', () => {
    const keywords = new Set(AREAS.flatMap((a) => [...a.keywords]));
    for (const r of TITLE_REJECT) expect(keywords.has(r)).toBe(false);
  });

  it('does not list "referent za", which would drop adult-education roles', () => {
    expect(TITLE_REJECT).not.toContain('referent za');
  });

  it('rejects the unambiguous non-starters by title', () => {
    for (const t of ['računovodja', 'komercialist', 'klicni center', 'payroll']) {
      expect(TITLE_REJECT).toContain(t);
    }
  });

  it('warns on administrative HR duties without rejecting them', () => {
    expect(BODY_WARN).toContain('kadrovska administracija');
    expect(TITLE_REJECT).not.toContain('kadrovska administracija');
  });

  it('rejects student work and internships by contract', () => {
    for (const c of ['študentsko delo', 'praksa', 'pripravnik']) {
      expect(CONTRACT_REJECT).toContain(c);
    }
  });

  it('keeps all list entries lowercase', () => {
    for (const list of [TITLE_REJECT, BODY_WARN, CONTRACT_REJECT,
                        REMOTE_MARKERS, HYBRID_MARKERS, PRIMARY_LOCATIONS]) {
      for (const e of list) expect(e).toBe(e.toLowerCase());
    }
  });
});

describe('leadQueryTerms', () => {
  it('returns one term per area, best rank first', () => {
    const terms = leadQueryTerms();
    expect(terms).toHaveLength(8);
    expect(terms[0]).toBe(AREAS.find((a) => a.rank === 1)!.queryTerms[0]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/profile.test.ts`
Expected: FAIL — cannot resolve `../src/profile.js`.

- [ ] **Step 3: Write the profile**

Create `src/profile.ts`:

```typescript
export type AreaKey =
  | 'ld' | 'projects' | 'hr' | 'adult-education'
  | 'eu-projects' | 'employer-brand' | 'content-comms' | 'events';

export interface Area {
  key: AreaKey;
  /** 1 is the strongest fit. Drives the score and the CSV sort. */
  rank: number;
  label: string;
  /** Matched anywhere — title, tags or body. Lowercase. */
  keywords: readonly string[];
  /** The subset used to drive keyword-based sources such as LinkedIn. */
  queryTerms: readonly string[];
}

export const AREAS: readonly Area[] = [
  {
    key: 'ld',
    rank: 1,
    label: 'Izobraževanje in razvoj kadrov / L&D',
    keywords: [
      'razvoj kadrov', 'izobraževanje in razvoj kadrov', 'learning and development',
      'learning & development', 'l&d', 'learning specialist', 'learning coordinator',
      'training coordinator', 'training specialist', 'talent development',
      'people development', 'hr development', 'razvoj zaposlenih',
      'koordinator izobraževanj', 'koordinatorka izobraževanj', 'skrbnik izobraževanj',
      'interna akademija', 'interne akademije', 'korporativna akademija',
      'onboarding', 'employee development', 'učenje in razvoj',
      'strokovnjak za izobraževanje',
    ],
    queryTerms: [
      'razvoj kadrov', 'learning and development', 'training coordinator',
      'talent development', 'koordinator izobraževanj',
    ],
  },
  {
    key: 'projects',
    rank: 2,
    label: 'Projektno delo / koordinacija projektov',
    keywords: [
      'projektni koordinator', 'projektna koordinatorka', 'koordinator projektov',
      'project coordinator', 'project assistant', 'project specialist',
      'junior project manager', 'project manager', 'projektni sodelavec',
      'projektna sodelavka', 'projektni vodja', 'vodja projektov',
      'program coordinator', 'projektno vodenje', 'projektna pisarna',
    ],
    queryTerms: [
      'projektni koordinator', 'project coordinator', 'koordinator projektov',
      'project manager',
    ],
  },
  {
    key: 'hr',
    rank: 3,
    label: 'HR / People & Culture',
    keywords: [
      'hr specialist', 'hr coordinator', 'hr koordinator', 'kadrovski specialist',
      'people & culture', 'people and culture', 'people operations', 'people ops',
      'employee experience', 'talent management', 'talent acquisition',
      'employer branding', 'employee engagement', 'hr project', 'hr generalist',
      'hr business partner', 'kadrovik', 'strokovni sodelavec za kadre',
    ],
    queryTerms: [
      'hr specialist', 'people and culture', 'kadrovski specialist',
      'talent management',
    ],
  },
  {
    key: 'adult-education',
    rank: 4,
    label: 'Izobraževanje odraslih / andragoško delo',
    keywords: [
      'andragog', 'andragoško', 'izobraževanje odraslih', 'adult education',
      'strokovni sodelavec za izobraževanje', 'svetovalec za izobraževanje',
      'koordinator izobraževanja', 'koordinator programov', 'vodja programov',
      'strokovni delavec v izobraževanju', 'ljudska univerza',
      'izobraževalni program', 'organizator izobraževanja', 'učitelj odraslih',
    ],
    queryTerms: [
      'andragog', 'izobraževanje odraslih', 'koordinator izobraževanja',
      'vodja programov',
    ],
  },
  {
    key: 'eu-projects',
    rank: 5,
    label: 'EU / Erasmus+ / razvojni projekti',
    keywords: [
      'erasmus', 'erasmus+', 'eu projekt', 'eu projekti', 'evropski projekt',
      'evropskih projektov', 'eu project', 'project officer',
      'programme coordinator', 'program officer', 'mednarodni projekti',
      'koordinator mednarodnih projektov', 'razvojni projekti', 'mobilnost',
      'kohezijska', 'strukturni skladi', 'javni razpis',
    ],
    queryTerms: [
      'erasmus', 'mednarodni projekti', 'project officer', 'eu projekti',
    ],
  },
  {
    key: 'employer-brand',
    rank: 6,
    label: 'Employer branding / employee experience',
    keywords: [
      'employer branding', 'employer brand', 'employee experience',
      'employee engagement', 'internal communications', 'interna komunikacija',
      'notranje komuniciranje', 'culture & engagement', 'hr marketing',
      'talent attraction', 'blagovna znamka delodajalca',
    ],
    queryTerms: ['employer branding', 'interna komunikacija', 'employee experience'],
  },
  {
    key: 'content-comms',
    rank: 7,
    label: 'Content / communications / community',
    keywords: [
      'content coordinator', 'content specialist', 'communications coordinator',
      'communications specialist', 'community manager', 'community coordinator',
      'social media coordinator', 'social media specialist', 'marketing coordinator',
      'koordinator komuniciranja', 'strokovni sodelavec za odnose z javnostmi',
      'odnosi z javnostmi',
    ],
    queryTerms: ['content coordinator', 'communications specialist', 'community manager'],
  },
  {
    key: 'events',
    rank: 8,
    label: 'Event / program coordination',
    keywords: [
      'event coordinator', 'event manager', 'koordinator dogodkov',
      'organizator dogodkov', 'programski koordinator', 'konferenčni koordinator',
      'events & people', 'community & events', 'organizacija dogodkov',
    ],
    queryTerms: ['event coordinator', 'koordinator dogodkov'],
  },
] as const;

/**
 * Hard drop, matched against the TITLE only — and overridden when an area
 * keyword also matches the title, so "Vodja projektov prodaje" survives on its
 * project match. "referent za" is deliberately absent: it would kill
 * "Referent za izobraževanje odraslih", which is a target role.
 */
export const TITLE_REJECT: readonly string[] = [
  'računovodja', 'računovodkinja', 'knjigovodja', 'knjigovodkinja',
  'komercialist', 'prodajni svetovalec', 'prodajni zastopnik', 'prodajni referent',
  'terenski prodajalec', 'prodajalec', 'klicni center', 'telefonski',
  'obračun plač', 'payroll', 'vnos podatkov', 'data entry', 'inkaso',
  'izterjava', 'blagajnik', 'skladiščnik', 'voznik', 'natakar', 'kuhar',
  'čistilka', 'varnostnik', 'revizor',
];

/** Flag only. An L&D role that also mentions payroll is still an L&D role. */
export const BODY_WARN: readonly string[] = [
  'payroll', 'obračun plač', 'kadrovska administracija', 'kadrovske evidence',
  'delovnopravna administracija', 'delovno-pravna administracija',
  'vodenje evidenc', 'arhiviranje', 'prodajni cilji', 'doseganje prodajnih',
  'klicanje strank',
];

/**
 * Hard drop, matched against the title and the source's raw employment field
 * ONLY. Never the body: "praksa" is everywhere in ordinary Slovenian ad prose
 * ("dobra praksa", "v praksi").
 */
export const CONTRACT_REJECT: readonly string[] = [
  'študentsko delo', 'študentsko', 'praksa', 'praktikant', 'pripravnik',
  'pripravništvo', 'volontersko', 'volonterski', 'obvezna praksa',
];

export const REMOTE_MARKERS: readonly string[] = [
  'delo od doma', 'od doma', 'remote', 'na daljavo', 'teleworking', 'full remote',
];

export const HYBRID_MARKERS: readonly string[] = [
  'hibrid', 'hybrid', 'kombinirano delo', 'delno od doma',
];

export const PRIMARY_LOCATIONS: readonly string[] = [
  'ljubljana', 'osrednjeslovenska', 'vrhnika', 'domžale', 'kamnik',
  'grosuplje', 'medvode', 'škofljica', 'brezovica', 'logatec', 'trzin',
];

/** One lead term per area, best rank first. Drives keyword-based sources. */
export function leadQueryTerms(): string[] {
  return [...AREAS]
    .sort((a, b) => a.rank - b.rank)
    .map((a) => a.queryTerms[0]!);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/profile.test.ts`
Expected: PASS, 12 tests.

If the "never rejects a title phrase that is also an area keyword" test fails, the fix is to remove the entry from `TITLE_REJECT` — never to remove it from an area.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/profile.ts tests/profile.test.ts
git commit -m "feat: add the seeker profile with eight ranked areas"
```

---

### Task 3: Types and the classification engine

Replaces the web-developer keyword matcher wholesale. `seniority` matching is kept verbatim from the current file — it is still computed and stored, but no longer excludes anything.

**Files:**
- Modify: `src/types.ts` (whole file)
- Modify: `src/classify.ts` (whole file)
- Test: `tests/classify.test.ts` (rewritten)
- Test: `tests/types.test.ts` (check it still compiles; adjust the `RawJob` literal if it names fields)

**Interfaces:**
- Consumes: everything Task 2 produces.
- Produces:
  - `type WorkMode = 'remote' | 'hybrid' | 'onsite' | 'unknown'`
  - `type EmploymentType = 'permanent' | 'fixed-term' | 'part-time' | 'unknown'`
  - `type LocationTier = 'ljubljana' | 'remote' | 'other'`
  - `RawJob` gains optional `employmentRaw`, `workTimeRaw`, `occupation` (all `string | null`)
  - `Job` drops `roleMatch`; gains `area: string`, `areaRank: number`, `areas: string`, `workMode`, `employmentType`, `locationTier`, `flags: string`, `score: number`
  - `interface Classification { areas: AreaKey[]; area: AreaKey | null; areaRank: number; workMode: WorkMode; employmentType: EmploymentType; locationTier: LocationTier; flags: string[]; seniority: Seniority; score: number; rejected: boolean }`
  - `function matchAreas(title: string, tags: string[], body: string): AreaKey[]`
  - `function detectWorkMode(title: string, location: string | null, body: string): WorkMode`
  - `function detectLocationTier(location: string | null, workMode: WorkMode): LocationTier`
  - `function detectEmploymentType(employmentRaw: string | null, workTimeRaw: string | null, title: string, body: string): EmploymentType`
  - `function scoreFor(p: { areaRank: number; locationTier: LocationTier; workMode: WorkMode; employmentType: EmploymentType; flags: string[] }): number`
  - `function classify(job: RawJob): Classification`
  - `function isWanted(c: Classification): boolean`

- [ ] **Step 1: Write the failing test**

Replace `tests/classify.test.ts` entirely:

```typescript
import { describe, it, expect } from 'vitest';
import {
  matchAreas, detectWorkMode, detectLocationTier, detectEmploymentType,
  scoreFor, classify, isWanted,
} from '../src/classify.js';
import type { RawJob } from '../src/types.js';

const raw = (over: Partial<RawJob>): RawJob => ({
  source: 'test', sourceId: '1', url: 'https://x', title: '', company: null,
  location: null, postedAt: null, description: '', tags: [],
  employmentRaw: null, workTimeRaw: null, occupation: null, ...over,
});

describe('matchAreas', () => {
  it('matches each area from its title', () => {
    const cases: Array<[string, string]> = [
      ['Specialist za izobraževanje in razvoj kadrov (m/ž)', 'ld'],
      ['Projektni koordinator (m/ž)', 'projects'],
      ['HR Specialist', 'hr'],
      ['Andragog (m/ž)', 'adult-education'],
      ['Koordinator mednarodnih projektov Erasmus+', 'eu-projects'],
      ['Employer Branding Specialist', 'employer-brand'],
      ['Community Manager (m/ž)', 'content-comms'],
      ['Koordinator dogodkov (m/ž)', 'events'],
    ];
    for (const [title, key] of cases) {
      expect(matchAreas(title, [], '')).toContain(key);
    }
  });

  it('matches a keyword buried in the body', () => {
    expect(matchAreas('Strokovni sodelavec (m/ž)', [], 'Skrbel boš za razvoj zaposlenih.'))
      .toContain('ld');
  });

  it('matches a keyword in a tag', () => {
    expect(matchAreas('Sodelavec (m/ž)', ['Erasmus+'], '')).toContain('eu-projects');
  });

  it('is case insensitive and keeps diacritics', () => {
    expect(matchAreas('IZOBRAŽEVANJE ODRASLIH', [], '')).toContain('adult-education');
  });

  it('returns every matching area, not just the first', () => {
    const areas = matchAreas('Employer Branding & Employee Experience Specialist', [], '');
    expect(areas).toContain('hr');
    expect(areas).toContain('employer-brand');
  });

  it('returns empty for an unrelated role', () => {
    expect(matchAreas('CNC operater (m/ž)', [], 'Delo na stroju.')).toEqual([]);
  });
});

describe('detectWorkMode', () => {
  it('detects remote from the body', () => {
    expect(detectWorkMode('HR Specialist', null, 'Možno delo od doma.')).toBe('remote');
  });

  it('detects hybrid from the body', () => {
    expect(detectWorkMode('HR Specialist', null, 'Hibridno delo, 2 dni v pisarni.')).toBe('hybrid');
  });

  it('prefers hybrid when both markers appear', () => {
    expect(detectWorkMode('HR Specialist', null, 'Hibridno: delo od doma 2 dni.')).toBe('hybrid');
  });

  it('detects remote from the location string', () => {
    expect(detectWorkMode('HR Specialist', 'Slovenia (Remote)', '')).toBe('remote');
  });

  it('is unknown when nothing says', () => {
    expect(detectWorkMode('HR Specialist', 'Ljubljana', '')).toBe('unknown');
  });
});

describe('detectLocationTier', () => {
  it('tiers a Ljubljana location first', () => {
    expect(detectLocationTier('Ljubljana', 'unknown')).toBe('ljubljana');
  });

  it('tiers an Osrednjeslovenska town as ljubljana', () => {
    expect(detectLocationTier('DOMŽALE', 'unknown')).toBe('ljubljana');
  });

  it('tiers a remote job outside Ljubljana as remote', () => {
    expect(detectLocationTier('Maribor', 'remote')).toBe('remote');
  });

  it('prefers ljubljana over remote when both apply', () => {
    expect(detectLocationTier('Ljubljana', 'remote')).toBe('ljubljana');
  });

  it('tiers everything else as other', () => {
    expect(detectLocationTier('Murska Sobota', 'unknown')).toBe('other');
    expect(detectLocationTier(null, 'unknown')).toBe('other');
  });
});

describe('detectEmploymentType', () => {
  it('reads permanent from the raw employment field', () => {
    expect(detectEmploymentType('Nedoločen čas', '40 ur/teden', '', '')).toBe('permanent');
  });

  it('reads fixed-term from the raw employment field', () => {
    expect(detectEmploymentType('Določen čas (opredeljeno v podrobnostih)', '40 ur/teden', '', ''))
      .toBe('fixed-term');
  });

  it('reads part-time from a weekly-hours figure below 35', () => {
    expect(detectEmploymentType('Nedoločen čas', '20 ur/teden', '', '')).toBe('part-time');
  });

  it('reads part-time from the phrase', () => {
    expect(detectEmploymentType(null, null, '', 'Krajši delovni čas.')).toBe('part-time');
  });

  it('falls back to the body when the raw fields are absent', () => {
    expect(detectEmploymentType(null, null, '', 'Zaposlitev za nedoločen čas.')).toBe('permanent');
  });

  it('is unknown when nothing says', () => {
    expect(detectEmploymentType(null, null, 'HR Specialist', '')).toBe('unknown');
  });
});

describe('scoreFor', () => {
  it('scores a rank-1 permanent Ljubljana job highest', () => {
    expect(scoreFor({
      areaRank: 1, locationTier: 'ljubljana', workMode: 'unknown',
      employmentType: 'permanent', flags: [],
    })).toBe(75);
  });

  it('scores a rank-8 job with nothing else at its area points only', () => {
    expect(scoreFor({
      areaRank: 8, locationTier: 'other', workMode: 'unknown',
      employmentType: 'unknown', flags: [],
    })).toBe(12);
  });

  it('awards hybrid points when the tier is other', () => {
    expect(scoreFor({
      areaRank: 1, locationTier: 'other', workMode: 'hybrid',
      employmentType: 'unknown', flags: [],
    })).toBe(58);
  });

  it('subtracts eight per flag', () => {
    expect(scoreFor({
      areaRank: 1, locationTier: 'ljubljana', workMode: 'unknown',
      employmentType: 'permanent', flags: ['a', 'b'],
    })).toBe(59);
  });

  it('never goes below zero', () => {
    expect(scoreFor({
      areaRank: 8, locationTier: 'other', workMode: 'unknown',
      employmentType: 'unknown', flags: ['a', 'b', 'c'],
    })).toBe(0);
  });
});

describe('classify and isWanted', () => {
  it('keeps a matching job and picks its best-ranked area', () => {
    const c = classify(raw({
      title: 'Specialist za razvoj kadrov (m/ž)',
      location: 'Ljubljana',
      employmentRaw: 'Nedoločen čas',
      workTimeRaw: '40 ur/teden',
    }));
    expect(isWanted(c)).toBe(true);
    expect(c.area).toBe('ld');
    expect(c.areaRank).toBe(1);
    expect(c.score).toBe(75);
  });

  it('drops a job that matches no area', () => {
    expect(isWanted(classify(raw({ title: 'CNC operater (m/ž)' })))).toBe(false);
  });

  it('drops a title reject outright', () => {
    expect(isWanted(classify(raw({
      title: 'Komercialist (m/ž)',
      description: 'Projektni koordinator podpira ekipo.',
    })))).toBe(false);
  });

  it('keeps a title reject that is overridden by an area keyword in the title, and flags it', () => {
    const c = classify(raw({ title: 'Vodja projektov - komercialist (m/ž)' }));
    expect(isWanted(c)).toBe(true);
    expect(c.flags.some((f) => f.startsWith('title-reject:'))).toBe(true);
  });

  it('drops student work by title', () => {
    expect(isWanted(classify(raw({ title: 'HR Specialist - študentsko delo' })))).toBe(false);
  });

  it('drops an internship named in the raw employment field', () => {
    expect(isWanted(classify(raw({
      title: 'HR Specialist', employmentRaw: 'Pripravništvo',
    })))).toBe(false);
  });

  it('does NOT drop a job whose body merely says "dobra praksa"', () => {
    const c = classify(raw({
      title: 'HR Specialist', description: 'Sledimo dobrim praksam, dobra praksa je vodilo.',
    }));
    expect(isWanted(c)).toBe(true);
  });

  it('flags administrative duties in the body without dropping the job', () => {
    const c = classify(raw({
      title: 'HR Specialist (m/ž)',
      description: 'Skrbel boš tudi za kadrovske evidence in arhiviranje.',
    }));
    expect(isWanted(c)).toBe(true);
    expect(c.flags.length).toBeGreaterThan(0);
  });

  it('never excludes on seniority', () => {
    const c = classify(raw({
      title: 'Vodja za razvoj kadrov (m/ž)',
      description: 'Zahtevamo vsaj 8 let izkušenj.',
    }));
    expect(c.seniority).toBe('senior');
    expect(isWanted(c)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/classify.test.ts`
Expected: FAIL — `matchAreas` is not exported.

- [ ] **Step 3: Extend the types**

Replace `src/types.ts`:

```typescript
export type Seniority = 'junior' | 'mid' | 'senior' | 'unknown';
export type WorkMode = 'remote' | 'hybrid' | 'onsite' | 'unknown';
export type EmploymentType = 'permanent' | 'fixed-term' | 'part-time' | 'unknown';
export type LocationTier = 'ljubljana' | 'remote' | 'other';

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
  locationTier: LocationTier;
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
```

- [ ] **Step 4: Write the classification engine**

Replace `src/classify.ts`:

```typescript
import type {
  EmploymentType, LocationTier, RawJob, Seniority, WorkMode,
} from './types.js';
import type { AreaKey } from './profile.js';
import {
  AREAS, BODY_WARN, CONTRACT_REJECT, HYBRID_MARKERS, PRIMARY_LOCATIONS,
  REMOTE_MARKERS, TITLE_REJECT,
} from './profile.js';

export interface Classification {
  areas: AreaKey[];
  area: AreaKey | null;
  areaRank: number;
  workMode: WorkMode;
  employmentType: EmploymentType;
  locationTier: LocationTier;
  flags: string[];
  seniority: Seniority;
  score: number;
  rejected: boolean;
}

const norm = (s: string): string => s.toLowerCase();

const containsAny = (haystack: string, needles: readonly string[]): string[] =>
  needles.filter((n) => haystack.includes(n));

/** Every area whose keywords appear in the title, tags or body. */
export function matchAreas(title: string, tags: string[], body: string): AreaKey[] {
  const all = norm([title, tags.join(' '), body].join(' \n '));
  return AREAS.filter((a) => a.keywords.some((k) => all.includes(k))).map((a) => a.key);
}

export function detectWorkMode(
  title: string, location: string | null, body: string,
): WorkMode {
  const all = norm([title, location ?? '', body].join(' '));
  // Hybrid wins: an ad naming both is almost always hybrid.
  if (containsAny(all, HYBRID_MARKERS).length > 0) return 'hybrid';
  if (containsAny(all, REMOTE_MARKERS).length > 0) return 'remote';
  return 'unknown';
}

export function detectLocationTier(
  location: string | null, workMode: WorkMode,
): LocationTier {
  const loc = norm(location ?? '');
  if (loc && containsAny(loc, PRIMARY_LOCATIONS).length > 0) return 'ljubljana';
  if (workMode === 'remote') return 'remote';
  return 'other';
}

/** "20 ur/teden", "30 hours/week". Below 35 is part-time. */
const HOURS_RE = /(\d{1,2})\s*(?:ur|hours?|h)\b/i;

export function detectEmploymentType(
  employmentRaw: string | null, workTimeRaw: string | null,
  title: string, body: string,
): EmploymentType {
  const structured = norm([employmentRaw ?? '', workTimeRaw ?? ''].join(' '));
  const all = `${structured} ${norm(title)} ${norm(body)}`;

  // Part-time is decided first: a 20 h/week permanent role still ranks as
  // part-time for this search.
  const hours = HOURS_RE.exec(structured) ?? HOURS_RE.exec(norm(body));
  if (hours && Number(hours[1]) < 35) return 'part-time';
  if (all.includes('krajši delovni čas') || all.includes('part-time') ||
      all.includes('part time')) return 'part-time';

  if (all.includes('nedoločen čas') || all.includes('permanent')) return 'permanent';
  if (all.includes('določen čas') || all.includes('fixed term') ||
      all.includes('fixed-term')) return 'fixed-term';
  return 'unknown';
}

/** Points by area rank. Index 0 is unused; rank 1 scores 40. */
const AREA_POINTS = [0, 40, 36, 32, 28, 24, 20, 16, 12] as const;

const EMPLOYMENT_POINTS: Record<EmploymentType, number> = {
  permanent: 15, 'fixed-term': 8, 'part-time': 4, unknown: 0,
};

export function scoreFor(p: {
  areaRank: number; locationTier: LocationTier; workMode: WorkMode;
  employmentType: EmploymentType; flags: string[];
}): number {
  let score = AREA_POINTS[p.areaRank] ?? 0;
  if (p.locationTier === 'ljubljana' || p.locationTier === 'remote') score += 20;
  else if (p.workMode === 'hybrid') score += 18;
  score += EMPLOYMENT_POINTS[p.employmentType];
  score -= 8 * p.flags.length;
  return Math.max(0, Math.min(100, score));
}

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

const YEARS_RE = /(\d{1,2})\s*(?:[-–—]\s*(\d{1,2}))?\s*\+?\s*(?:let(?:o|a|i)?|years?)(?![a-zščž])/gi;

function maxYears(body: string): number | null {
  let max: number | null = null;
  for (const m of body.matchAll(YEARS_RE)) {
    const lower = Number(m[1]);
    const upper = m[2] === undefined ? lower : Number(m[2]);
    const value = Math.max(lower, upper);
    if (max === null || value > max) max = value;
  }
  return max;
}

/** Informational only. Never excludes — the seeker applies regardless. */
export function matchSeniority(title: string, tags: string[], body: string): Seniority {
  const heading = norm([title, tags.join(' ')].join(' '));
  if (containsAny(heading, SENIOR_MARKERS).length > 0) return 'senior';
  if (containsAny(heading, JUNIOR_MARKERS).length > 0) return 'junior';
  if (containsAny(heading, MID_MARKERS).length > 0) return 'mid';

  const years = maxYears(norm(body));
  if (years === null) return 'unknown';
  if (years >= 5) return 'senior';
  if (years >= 3) return 'mid';
  return 'junior';
}

export function classify(job: RawJob): Classification {
  const title = norm(job.title);
  const body = job.description;

  const areas = matchAreas(job.title, job.tags, body);
  const best = AREAS.filter((a) => areas.includes(a.key))
    .sort((a, b) => a.rank - b.rank)[0];

  const flags: string[] = [];

  // A title reject loses to an area keyword in the same title: "Vodja
  // projektov prodaje" keeps its project match and carries a warning instead.
  const titleHits = containsAny(title, TITLE_REJECT);
  const titleAreaHit = matchAreas(job.title, [], '').length > 0;
  const hardTitleReject = titleHits.length > 0 && !titleAreaHit;
  if (titleHits.length > 0 && titleAreaHit) {
    flags.push(...titleHits.map((t) => `title-reject:${t}`));
  }

  // Contract rejects never read the body: "dobra praksa" is ordinary prose.
  const contractHay = norm([job.title, job.employmentRaw ?? ''].join(' '));
  const contractReject = containsAny(contractHay, CONTRACT_REJECT).length > 0;

  flags.push(...containsAny(norm(body), BODY_WARN).map((w) => `body:${w}`));

  const workMode = detectWorkMode(job.title, job.location, body);
  const locationTier = detectLocationTier(job.location, workMode);
  const employmentType = detectEmploymentType(
    job.employmentRaw ?? null, job.workTimeRaw ?? null, job.title, body,
  );
  const areaRank = best?.rank ?? 0;

  return {
    areas,
    area: best?.key ?? null,
    areaRank,
    workMode,
    employmentType,
    locationTier,
    flags,
    seniority: matchSeniority(job.title, job.tags, body),
    score: scoreFor({ areaRank, locationTier, workMode, employmentType, flags }),
    rejected: hardTitleReject || contractReject,
  };
}

export function isWanted(c: Classification): boolean {
  return c.areas.length > 0 && !c.rejected;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/classify.test.ts`
Expected: PASS, 36 tests.

- [ ] **Step 6: Fix `tests/types.test.ts` if it no longer compiles**

Run: `npm run typecheck`. If `tests/types.test.ts` constructs a `Job` literal, add the new required fields (`area: ''`, `areaRank: 0`, `areas: ''`, `workMode: 'unknown'`, `employmentType: 'unknown'`, `locationTier: 'other'`, `flags: ''`, `score: 0`) and remove `roleMatch`. Leave the rest of that file alone.

- [ ] **Step 7: Commit**

```bash
git add src/types.ts src/classify.ts tests/classify.test.ts tests/types.test.ts
git commit -m "feat: classify postings by ranked area, rejection rules and fit score

Seniority is still computed but no longer excludes anything."
```

---

### Task 4: Persistence and export

`normalize.ts`, `store.ts` and `csv.ts` change together for one reason — the shape of a classified job — so they are one task.

**Files:**
- Modify: `src/normalize.ts`
- Modify: `src/store.ts`
- Modify: `src/csv.ts`
- Test: `tests/store.test.ts`, `tests/csv.test.ts`, `tests/normalize.test.ts`

**Interfaces:**
- Consumes: `Job`, `Classification` from Task 3.
- Produces:
  - `toJob(raw: RawJob, c: Classification, now: string): Job` — unchanged signature, new field mapping
  - `CSV_COLUMNS` in the spec's order
  - `allJobs(db)` and `jobsFirstSeenAt(db, ts)` both ordered `score DESC, title ASC`

- [ ] **Step 1: Write the failing tests**

Append to `tests/csv.test.ts` (and delete any existing assertion that mentions `role_match`):

```typescript
import { describe, it, expect } from 'vitest';
import { CSV_COLUMNS, toCsv } from '../src/csv.js';
import type { Job } from '../src/types.js';

const job = (over: Partial<Job>): Job => ({
  source: 'zrsz', sourceId: '1', url: 'https://x/1', title: 'HR Specialist',
  company: 'Acme', location: 'Ljubljana', postedAt: '2026-09-15', description: '',
  tags: [], employmentRaw: null, workTimeRaw: null, occupation: null,
  id: 'abc', area: 'hr', areaRank: 3, areas: 'hr', workMode: 'hybrid',
  employmentType: 'permanent', locationTier: 'ljubljana', flags: '',
  seniority: 'unknown', score: 67,
  firstSeenAt: '2026-09-15T00:00:00.000Z', lastSeenAt: '2026-09-15T00:00:00.000Z',
  ...over,
});

describe('CSV_COLUMNS', () => {
  it('leads with score so the spreadsheet sorts on fit', () => {
    expect(CSV_COLUMNS[0]).toBe('score');
  });

  it('carries the new signal columns and no longer carries role_match', () => {
    for (const c of ['area', 'area_rank', 'location_tier', 'work_mode',
                     'employment_type', 'areas', 'flags']) {
      expect(CSV_COLUMNS).toContain(c);
    }
    expect(CSV_COLUMNS).not.toContain('role_match');
  });

  it('omits description, which makes the file unusable in a spreadsheet', () => {
    expect(CSV_COLUMNS).not.toContain('description');
  });
});

describe('toCsv', () => {
  it('writes the score as the first cell of a row', () => {
    const line = toCsv([job({})]).split('\n')[1]!;
    expect(line.startsWith('67,')).toBe(true);
  });

  it('quotes a comma-joined flags cell', () => {
    const line = toCsv([job({ flags: 'body:payroll,body:arhiviranje' })]).split('\n')[1]!;
    expect(line).toContain('"body:payroll,body:arhiviranje"');
  });
});
```

Append to `tests/store.test.ts`:

```typescript
it('round-trips the new classification fields', () => {
  const db = openDb(':memory:');
  upsertJobs(db, [job({ area: 'ld', areaRank: 1, areas: 'ld,hr', score: 75,
    workMode: 'hybrid', employmentType: 'permanent', locationTier: 'ljubljana',
    flags: 'body:payroll', employmentRaw: 'Nedoločen čas',
    workTimeRaw: '40 ur/teden', occupation: 'Kadrovnik' })]);
  const [back] = allJobs(db);
  expect(back!.area).toBe('ld');
  expect(back!.areaRank).toBe(1);
  expect(back!.areas).toBe('ld,hr');
  expect(back!.score).toBe(75);
  expect(back!.workMode).toBe('hybrid');
  expect(back!.employmentType).toBe('permanent');
  expect(back!.locationTier).toBe('ljubljana');
  expect(back!.flags).toBe('body:payroll');
  expect(back!.employmentRaw).toBe('Nedoločen čas');
  expect(back!.occupation).toBe('Kadrovnik');
  db.close();
});

it('orders jobs by score descending', () => {
  const db = openDb(':memory:');
  upsertJobs(db, [
    job({ id: 'low', sourceId: 'low', score: 20 }),
    job({ id: 'high', sourceId: 'high', score: 80 }),
  ]);
  expect(allJobs(db).map((j) => j.id)).toEqual(['high', 'low']);
  db.close();
});
```

Use the same `job()` helper shown above in `tests/store.test.ts`; adjust the existing helper in that file rather than adding a second one.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/csv.test.ts tests/store.test.ts`
Expected: FAIL — `CSV_COLUMNS[0]` is `'source'`, and the store has no `score` column.

- [ ] **Step 3: Update `normalize.ts`**

Replace the `toJob` function in `src/normalize.ts` (leave `makeId` untouched):

```typescript
export function toJob(raw: RawJob, c: Classification, now: string): Job {
  return {
    ...raw,
    id: makeId(raw.source, raw.sourceId),
    area: c.area ?? '',
    areaRank: c.areaRank,
    areas: c.areas.join(','),
    workMode: c.workMode,
    employmentType: c.employmentType,
    locationTier: c.locationTier,
    flags: c.flags.join(','),
    seniority: c.seniority,
    score: c.score,
    firstSeenAt: now,
    lastSeenAt: now,
  };
}
```

- [ ] **Step 4: Update `store.ts`**

Replace `SCHEMA`, `Row`, `toJobRow`, `upsertJobs` and the two query functions:

```typescript
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
```

Widen the type import at the top of the file to:

```typescript
import type {
  EmploymentType, Job, LocationTier, Seniority, WorkMode,
} from './types.js';
```

- [ ] **Step 5: Update `csv.ts`**

Replace `CSV_COLUMNS` and `row`:

```typescript
/** Description is deliberately absent — it makes the file unusable in a spreadsheet. */
export const CSV_COLUMNS = [
  'score', 'area', 'area_rank', 'title', 'company', 'location',
  'location_tier', 'work_mode', 'employment_type', 'seniority', 'areas',
  'flags', 'source', 'posted_at', 'first_seen_at', 'url',
] as const;

const row = (j: Job): string => [
  String(j.score), j.area, String(j.areaRank), j.title, j.company, j.location,
  j.locationTier, j.workMode, j.employmentType, j.seniority, j.areas,
  j.flags, j.source, j.postedAt, j.firstSeenAt, j.url,
].map(cell).join(',');
```

- [ ] **Step 6: Fix `tests/normalize.test.ts` and run the full suite**

`tests/normalize.test.ts` asserts on `roleMatch`, which no longer exists.
Replace each such assertion with the equivalent new field — a test that
checked `job.roleMatch` becomes a check on `job.areas`, and one that checked
the classification passed through becomes a check on `job.score`. Keep the
`makeId` tests exactly as they are: id derivation is unchanged.

Run: `npm test`
Expected: every test passes except `tests/pipeline.test.ts`, which Task 8 updates. If pipeline failures are the only ones left, continue.

- [ ] **Step 7: Commit**

```bash
npm run typecheck
git add src/normalize.ts src/store.ts src/csv.ts tests/
git commit -m "feat: persist and export the new classification signals"
```

---

### Task 5: ZRSZ source adapter

**Files:**
- Create: `src/sources/zrsz.ts`
- Modify: `src/http.ts` (add `postJson`)
- Test: `tests/sources/zrsz.test.ts`
- Uses: `tests/fixtures/zrsz-search.json` from Task 1

**Interfaces:**
- Consumes: `RawJob`, `Source`; `fetchText`, `sleep`, `REQUEST_DELAY_MS` from `http.ts`; the URL template decided in Task 1.
- Produces:
  - `postJson<T>(url: string, body: unknown, headers?: Record<string, string>): Promise<T>` in `http.ts`
  - `interface ZrszItem { sourceId: string; title: string; company: string | null; location: string | null; postedAt: string | null; employmentRaw: string | null; workTimeRaw: string | null; occupation: string | null }`
  - `parseBundleUrls(html: string): string[]`
  - `parseApiConfig(js: string): { baseUrl: string; userKey: string }`
  - `parseSearchPage(json: unknown): ZrszItem[]`
  - `totalFrom(json: unknown): number`
  - `buildJobUrl(id: string): string`
  - `const zrszSource: Source`

> **CONTROLLER RULING — supersedes parts of this task's text below.**
> Task 1 found that ZRSZ *does* expose a description endpoint, so the
> `description: ''` fallback written into this task's code block is no longer
> what to build. Apply these five changes; everything else in this task stands.
>
> 1. **Detail endpoint.** Add alongside `SEARCH_PATH`:
>    ```typescript
>    const DETAIL_PATH = '/iskalnik-po-pdm/v1/delovno-mesto/podrobnosti-prosto-delovno-mesto';
>    ```
>    Fetch it with `fetchJson` as
>    `` `${baseUrl}${DETAIL_PATH}?idDelovnoMesto=${id}&user_key=${userKey}` ``.
>
> 2. **`parseDetail`.** Add and export:
>    ```typescript
>    /** The advert body plus the two free-text condition fields, as plain text. */
>    export function parseDetail(json: unknown): { description: string } {
>      const d = (json ?? {}) as Record<string, unknown>;
>      const parts = [d['opisDelInNalog'], d['drugiPogoji'], d['ostalo'],
>                     d['delovneIzkusnje']].filter(Boolean).map(String);
>      return { description: stripHtml(parts.join(' ')) };
>    }
>    ```
>    Import `stripHtml` from `../http.js` alongside the existing imports.
>
> 3. **`needsDetail` gate.** ZRSZ returns every vacancy in Slovenia — roughly
>    4,400. One detail request each at `REQUEST_DELAY_MS` is about 44 minutes,
>    and `.github/workflows/scrape.yml` sets `timeout-minutes: 30`. So fetch the
>    body only for ads that already look relevant, exactly as the mojedelo
>    adapter gates its own detail fetch:
>    ```typescript
>    import { matchAreas } from '../classify.js';
>
>    /**
>     * The list response has no body, and one detail request per vacancy would
>     * outrun the nightly job's 30-minute timeout. The body is worth fetching
>     * for ads whose title or occupation already matches an area — there it adds
>     * work mode, warnings and contract detail. Everything else keeps ''.
>     */
>    export function needsDetail(item: ZrszItem): boolean {
>      const tags = item.occupation ? [item.occupation] : [];
>      return matchAreas(item.title, tags, '').length > 0;
>    }
>    ```
>
> 4. **`buildJobUrl`.** Use the template Task 1 verified in the browser against
>    two live cards — note the `?idp=` query segment before the fragment:
>    ```typescript
>    export function buildJobUrl(id: string): string {
>      return `${SITE}/iskalci-zaposlitve/iskanje-zaposlitve/iskanje-dela/?idp=${id}/#/pdm/${id}`;
>    }
>    ```
>
> 5. **`fetchJobs` mapping.** Replace the final `.map(...)` with a loop that
>    fetches the body for gated items only, sleeping `REQUEST_DELAY_MS` before
>    each detail request, and sets `description` to `''` for the rest. Keep every
>    other field mapping exactly as written below.
>
> Also add, before Step 1, a fixture capture and the tests for the two new
> functions:
>
> ```bash
> curl -s "https://apigateway-prod-www-prod.apps.ess.gov.si/iskalnik-po-pdm/v1/delovno-mesto/podrobnosti-prosto-delovno-mesto?idDelovnoMesto=3479420&user_key=9b7dcbe8ec1855d14f0b2ec4f6335a91" \
>   > tests/fixtures/zrsz-detail.json
> ```
>
> ```typescript
> describe('parseDetail', () => {
>   const detail = JSON.parse(readFileSync('tests/fixtures/zrsz-detail.json', 'utf8'));
>
>   it('extracts the advert body as plain text', () => {
>     const { description } = parseDetail(detail);
>     expect(description.length).toBeGreaterThan(20);
>     expect(description).not.toContain('<');
>   });
>
>   it('returns an empty description for an empty payload', () => {
>     expect(parseDetail({}).description).toBe('');
>   });
> });
>
> describe('needsDetail', () => {
>   const item = (over: Partial<ZrszItem>): ZrszItem => ({
>     sourceId: '1', title: 'HIŠNIK IV - M/Ž', company: 'OŠ', location: 'LJUBLJANA',
>     postedAt: null, employmentRaw: null, workTimeRaw: null, occupation: null, ...over,
>   });
>
>   it('fetches the body when the title matches an area', () => {
>     expect(needsDetail(item({ title: 'KOORDINATOR IZOBRAŽEVANJ - M/Ž' }))).toBe(true);
>   });
>
>   it('fetches the body when the occupation matches an area', () => {
>     expect(needsDetail(item({ occupation: 'Andragog' }))).toBe(true);
>   });
>
>   it('skips an unrelated ad, whatever its location', () => {
>     expect(needsDetail(item({ title: 'HIŠNIK IV - M/Ž', location: 'LJUBLJANA' }))).toBe(false);
>   });
> });
> ```
>
> Import `parseDetail` and `needsDetail`, and `import type { ZrszItem }`, in the
> test file's import list.

- [ ] **Step 1: Write the failing test**

Create `tests/sources/zrsz.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  parseBundleUrls, parseApiConfig, parseSearchPage, totalFrom, buildJobUrl,
} from '../../src/sources/zrsz.js';

const search = JSON.parse(readFileSync('tests/fixtures/zrsz-search.json', 'utf8'));

describe('parseBundleUrls', () => {
  it('finds the compressed TYPO3 bundles in the page', () => {
    const html = `<html><script src="/typo3temp/assets/compressed/merged-abc.js?123"></script>
      <script src="/_assets/x/jquery.min.js"></script></html>`;
    expect(parseBundleUrls(html)).toEqual(['/typo3temp/assets/compressed/merged-abc.js?123']);
  });

  it('returns empty when the page has no bundles', () => {
    expect(parseBundleUrls('<html></html>')).toEqual([]);
  });
});

describe('parseApiConfig', () => {
  it('reads the gateway host and user key from the bundle', () => {
    const js = 'const F_dataFor3ScaleApi_url="https://gw.example",' +
      'F_dataFor3ScaleApi_keyName="user_key",F_dataFor3ScaleApi_keyValue="deadbeef";';
    expect(parseApiConfig(js)).toEqual({
      baseUrl: 'https://gw.example', userKey: 'deadbeef',
    });
  });

  it('throws when the bundle does not carry the config', () => {
    expect(() => parseApiConfig('var x = 1;')).toThrow(/API config/);
  });
});

describe('parseSearchPage', () => {
  const items = parseSearchPage(search);

  it('extracts every item', () => {
    expect(items.length).toBeGreaterThan(10);
  });

  it('extracts a numeric source id', () => {
    expect(items[0]!.sourceId).toMatch(/^\d+$/);
  });

  it('extracts a title and an employer', () => {
    expect(items[0]!.title.length).toBeGreaterThan(3);
    expect(items[0]!.company).toBeTruthy();
  });

  it('extracts the posted date as an ISO date', () => {
    expect(items[0]!.postedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('carries the structured contract and working-time fields through', () => {
    expect(items.some((i) => i.employmentRaw && i.employmentRaw.length > 0)).toBe(true);
    expect(items.some((i) => i.workTimeRaw && i.workTimeRaw.includes('ur'))).toBe(true);
  });

  it('carries the occupation through', () => {
    expect(items.some((i) => i.occupation && i.occupation.length > 0)).toBe(true);
  });

  it('returns an empty array when the payload has no items', () => {
    expect(parseSearchPage({ steviloDelovnihMest: 0, seznamDelovnihMest: [] })).toEqual([]);
  });
});

describe('totalFrom', () => {
  it('reads the total', () => {
    expect(totalFrom(search)).toBeGreaterThan(100);
  });

  it('returns zero for an unexpected payload', () => {
    expect(totalFrom({})).toBe(0);
  });
});

describe('buildJobUrl', () => {
  it('builds an absolute ess.gov.si link containing the id', () => {
    const url = buildJobUrl('3471197');
    expect(url.startsWith('https://www.ess.gov.si/')).toBe(true);
    expect(url).toContain('3471197');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/sources/zrsz.test.ts`
Expected: FAIL — cannot resolve `../../src/sources/zrsz.js`.

- [ ] **Step 3: Add `postJson` to `src/http.ts`**

Append, next to `fetchJson`:

```typescript
export async function postJson<T>(
  url: string, body: unknown, headers: Record<string, string> = {},
): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`POST ${url} failed: ${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}
```

- [ ] **Step 4: Write the adapter**

Create `src/sources/zrsz.ts`. Replace the `buildJobUrl` body with the template Task 1 recorded, if it differs from the fallback shown here:

```typescript
import type { RawJob, Source } from '../types.js';
import { fetchText, postJson, sleep, REQUEST_DELAY_MS } from '../http.js';

const SITE = 'https://www.ess.gov.si';
const ENTRY = `${SITE}/iskalci-zaposlitve/`;
const SEARCH_PATH = '/iskalnik-po-pdm/v1/delovno-mesto/prosta-delovna-mesta-filtri';

/** The API accepts 500; all of Slovenia is then about nine requests. */
const PAGE_SIZE = 500;

export interface ApiConfig {
  baseUrl: string;
  userKey: string;
}

export interface ZrszItem {
  sourceId: string;
  title: string;
  company: string | null;
  location: string | null;
  postedAt: string | null;
  employmentRaw: string | null;
  workTimeRaw: string | null;
  occupation: string | null;
}

/** The compressed TYPO3 bundles, in page order. One of them holds the config. */
export function parseBundleUrls(html: string): string[] {
  return [...html.matchAll(/src="(\/typo3temp\/assets\/compressed\/[^"]+?\.js[^"]*)"/g)]
    .map((m) => m[1]!);
}

/**
 * The gateway host and its public user_key are published in the site's own
 * bundle, so they are read at runtime rather than hardcoded — a rotation on
 * their side then does not break the scraper.
 */
export function parseApiConfig(js: string): ApiConfig {
  const url = /F_dataFor3ScaleApi_url\s*=\s*"([^"]+)"/.exec(js);
  const key = /F_dataFor3ScaleApi_keyValue\s*=\s*"([^"]+)"/.exec(js);
  if (!url?.[1] || !key?.[1]) throw new Error('zrsz: bundle carries no API config');
  return { baseUrl: url[1], userKey: key[1] };
}

export async function loadApiConfig(): Promise<ApiConfig> {
  const html = await fetchText(ENTRY);
  const bundles = parseBundleUrls(html);
  if (bundles.length === 0) throw new Error('zrsz: no bundles found on the entry page');

  for (const path of bundles) {
    const js = await fetchText(`${SITE}${path}`);
    if (js.includes('F_dataFor3ScaleApi_keyValue')) return parseApiConfig(js);
    await sleep(REQUEST_DELAY_MS);
  }
  throw new Error('zrsz: no bundle carried the API config');
}

interface RawResponse {
  steviloDelovnihMest?: number;
  seznamDelovnihMest?: unknown[];
}

const text = (v: unknown): string | null => {
  const s = v == null ? '' : String(v).trim();
  return s.length > 0 ? s : null;
};

export function parseSearchPage(json: unknown): ZrszItem[] {
  const items = (json as RawResponse)?.seznamDelovnihMest ?? [];
  return items.map((rawItem) => {
    const it = rawItem as Record<string, unknown>;
    const posted = text(it['datumObjave']);
    return {
      sourceId: String(it['idDelovnoMesto'] ?? ''),
      title: String(it['nazivDelovnegaMesta'] ?? '').trim(),
      company: text(it['delodajalec']),
      location: text(it['krajDM']),
      postedAt: posted ? posted.slice(0, 10) : null,
      employmentRaw: text(it['trajanjeZaposlitve']),
      workTimeRaw: text(it['delovniCas']),
      occupation: text(it['poklic']),
    };
  });
}

export function totalFrom(json: unknown): number {
  return (json as RawResponse)?.steviloDelovnihMest ?? 0;
}

export function buildJobUrl(id: string): string {
  return `${SITE}/iskalci-zaposlitve/iskanje-zaposlitve/iskanje-dela/#/pdm/${id}`;
}

const searchBody = (page: number) => ({
  nazivDelovnegaMesta: '',
  lokacija: '',
  drzave: [],
  poklicnaPodrocja: [],
  regije: [],
  stran: page,
  stZadetkov: PAGE_SIZE,
  vrniFiltre: false,
  urejevalniPojem: 0,
});

export const zrszSource: Source = {
  name: 'zrsz',
  async fetchJobs(): Promise<RawJob[]> {
    const { baseUrl, userKey } = await loadApiConfig();
    const url = `${baseUrl}${SEARCH_PATH}?user_key=${userKey}`;

    // Every vacancy in Slovenia is nine requests at this page size, so the
    // adapter fetches broadly and lets classify.ts apply the location policy.
    const items: ZrszItem[] = [];
    let page = 1;
    let total = Infinity;

    while (items.length < total) {
      const body = await postJson<unknown>(url, searchBody(page));
      total = totalFrom(body);
      const batch = parseSearchPage(body);
      if (batch.length === 0) break;
      items.push(...batch);
      page += 1;
      await sleep(REQUEST_DELAY_MS);
    }

    // The search API exposes no description body and no detail endpoint under
    // this namespace, so classification runs on the title, the occupation and
    // the employer. The structured contract fields make up for much of it.
    return items
      .filter((i) => i.sourceId.length > 0)
      .map((i) => ({
        source: 'zrsz',
        sourceId: i.sourceId,
        url: buildJobUrl(i.sourceId),
        title: i.title,
        company: i.company,
        location: i.location,
        postedAt: i.postedAt,
        description: '',
        tags: i.occupation ? [i.occupation] : [],
        employmentRaw: i.employmentRaw,
        workTimeRaw: i.workTimeRaw,
        occupation: i.occupation,
      }));
  },
};
```

Note the `tags` line: the occupation is passed as a tag so `matchAreas` sees it, since there is no body to search.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/sources/zrsz.test.ts`
Expected: PASS, 14 tests.

- [ ] **Step 6: Smoke-test the adapter against the live API**

```bash
npx tsx -e "import('./src/sources/zrsz.ts').then(async (m) => {
  const jobs = await m.zrszSource.fetchJobs();
  console.log('fetched', jobs.length);
  console.log(jobs.slice(0, 3).map((j) => j.title + ' | ' + j.employmentRaw));
})"
```

Expected: a few thousand postings, and titles that are real. If it throws on the config load, the bundle names changed — re-check `parseBundleUrls` against the live page before touching anything else.

- [ ] **Step 7: Commit**

```bash
npm run typecheck && npm test
git add src/sources/zrsz.ts src/http.ts tests/sources/zrsz.test.ts
git commit -m "feat: add the ZRSZ vacancy source

Reads the public gateway host and user_key from the site's own bundle at
runtime, so a rotation does not break the scraper."
```

---

### Task 6: Retarget MojeDelo

Swaps the IT category for seven relevant ones, drops the region filter from the search call, and gates the expensive per-ad detail fetch so nationwide coverage stays cheap.

**Files:**
- Modify: `src/sources/mojedelo.ts`
- Test: `tests/sources/mojedelo.test.ts`

**Interfaces:**
- Consumes: `matchAreas` from `classify.ts`; `PRIMARY_LOCATIONS` from `profile.ts`.
- Produces:
  - `const CATEGORY_IDS: readonly string[]`
  - `function needsDetail(item: SearchItem): boolean`
  - `SearchItem` unchanged; `mojeDeloSource` unchanged in name

- [ ] **Step 1: Write the failing test**

Append to `tests/sources/mojedelo.test.ts`:

```typescript
import { CATEGORY_IDS, needsDetail } from '../../src/sources/mojedelo.js';

describe('CATEGORY_IDS', () => {
  it('targets HR, education and project-shaped categories, not IT', () => {
    expect(CATEGORY_IDS).toContain('e917f193-c49f-4e28-85ab-5c0746f1df19'); // Kadri, HR
    expect(CATEGORY_IDS).toContain('5022c5c2-029d-4949-a69a-9e156f82747d'); // Izobraževanje
    expect(CATEGORY_IDS).not.toContain('64f003ff-6d8b-4be0-b58c-4580e4eeeb8a'); // IT
  });

  it('lists every id once', () => {
    expect(new Set(CATEGORY_IDS).size).toBe(CATEGORY_IDS.length);
  });
});

describe('needsDetail', () => {
  const item = (over: Partial<SearchItem>): SearchItem => ({
    id: 'x', title: 'Sodelavec (m/ž)', company: 'Acme',
    location: 'Maribor', postedAt: null, ...over,
  });

  it('fetches the body for an Osrednjeslovenska ad whatever its title', () => {
    expect(needsDetail(item({ location: 'Ljubljana' }))).toBe(true);
    expect(needsDetail(item({ location: 'Domžale' }))).toBe(true);
  });

  it('fetches the body for an out-of-region ad whose title already matches an area', () => {
    expect(needsDetail(item({ location: 'Maribor', title: 'HR Specialist' }))).toBe(true);
  });

  it('skips an out-of-region ad with an unrelated title', () => {
    expect(needsDetail(item({ location: 'Maribor', title: 'Viličarist (m/ž)' }))).toBe(false);
  });

  it('treats a missing location as out of region', () => {
    expect(needsDetail(item({ location: null, title: 'Viličarist (m/ž)' }))).toBe(false);
  });
});
```

Add `SearchItem` to the file's existing import from `../../src/sources/mojedelo.js` (as a `import type`).

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/sources/mojedelo.test.ts`
Expected: FAIL — `CATEGORY_IDS` is not exported.

- [ ] **Step 3: Retarget the adapter**

In `src/sources/mojedelo.ts`, add these imports at the top:

```typescript
import { matchAreas } from '../classify.js';
import { PRIMARY_LOCATIONS } from '../profile.js';
```

Replace the `JOB_CATEGORY_ID` and `REGION_ID` constants with:

```typescript
/**
 * The categories where L&D, HR, project-coordination, adult-education and
 * communications roles are actually filed. IT is deliberately gone.
 */
export const CATEGORY_IDS: readonly string[] = [
  'e917f193-c49f-4e28-85ab-5c0746f1df19', // Kadri, HR
  '5022c5c2-029d-4949-a69a-9e156f82747d', // Izobraževanje, Prevajanje, Coaching
  '26bed8a9-3863-40a2-a38f-ee74d2097d72', // Upravljanje, Svetovanje, Vodenje
  '307d6e8a-29c6-4950-a13d-8d1a3078a2d9', // Javni sektor, NVO, Kultura
  'c5af8f46-57bb-45e9-9e66-9cd0ebd562a0', // Marketing, Kreativa, PR, Mediji
  'c9749e1f-8619-40e6-85dd-1a091ef54730', // Administracija
  'd25129f2-66b9-4a57-a7e1-3b7c956a2ba9', // Znanost, Raziskave, Razvoj
];
```

Add, below `buildJobUrl`:

```typescript
/**
 * Search pages are cheap; the per-ad detail fetch is not. The body is worth
 * fetching for anything in the Ljubljana region, and for out-of-region ads
 * whose title already looks relevant — which is where a remote posting shows
 * itself. Everything else is skipped.
 */
export function needsDetail(item: SearchItem): boolean {
  const loc = (item.location ?? '').toLowerCase();
  if (loc && PRIMARY_LOCATIONS.some((t) => loc.includes(t))) return true;
  return matchAreas(item.title, [], '').length > 0;
}
```

Replace the body of `mojeDeloSource.fetchJobs` with:

```typescript
  async fetchJobs(): Promise<RawJob[]> {
    const headers = await loadApiHeaders();

    // No region filter: the location policy is applied locally, so a remote
    // ad posted from another region is not lost at the API boundary.
    const byId = new Map<string, SearchItem>();
    for (const categoryId of CATEGORY_IDS) {
      let startFrom = 0;
      let total = Infinity;

      while (startFrom < total) {
        const page = await fetchJson<unknown>(
          `${API}/job-ads-search?jobCategoryIds=${categoryId}` +
          `&pageSize=${PAGE_SIZE}&startFrom=${startFrom}`,
          headers,
        );
        total = totalFrom(page);
        const batch = parseSearchPage(page);
        if (batch.length === 0) break;
        for (const item of batch) if (!byId.has(item.id)) byId.set(item.id, item);
        startFrom += batch.length;
        await sleep(REQUEST_DELAY_MS);
      }
    }

    const jobs: RawJob[] = [];
    for (const item of byId.values()) {
      const base = {
        source: 'mojedelo',
        sourceId: item.id,
        url: buildJobUrl(item.title, item.id),
        title: item.title,
        company: item.company,
        location: item.location,
        postedAt: item.postedAt,
        tags: [] as string[],
        employmentRaw: null,
        workTimeRaw: null,
        occupation: null,
      };

      if (!needsDetail(item)) {
        jobs.push({ ...base, description: '' });
        continue;
      }

      await sleep(REQUEST_DELAY_MS);
      const detail = await fetchJson<unknown>(`${API}/job-ads/${item.id}`, headers);
      jobs.push({ ...base, description: parseDetail(detail).description });
    }

    return jobs;
  },
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/sources/mojedelo.test.ts`
Expected: PASS.

- [ ] **Step 5: Smoke-test against the live API**

```bash
npx tsx -e "import('./src/sources/mojedelo.ts').then(async (m) => {
  const jobs = await m.mojeDeloSource.fetchJobs();
  console.log('fetched', jobs.length, 'with body', jobs.filter(j => j.description).length);
})"
```

Expected: several hundred postings, of which a minority carry a body. If `with body` is zero, `needsDetail` is wrong — check `PRIMARY_LOCATIONS` casing.

- [ ] **Step 6: Commit**

```bash
npm run typecheck && npm test
git add src/sources/mojedelo.ts tests/sources/mojedelo.test.ts
git commit -m "feat: retarget mojedelo to HR, education and project categories

Drops the API region filter and gates the per-ad detail fetch instead, so a
remote ad from another region is no longer lost at the API boundary."
```

---

### Task 7: Retarget LinkedIn

**Files:**
- Modify: `src/sources/linkedin.ts`
- Test: `tests/sources/linkedin.test.ts`

**Interfaces:**
- Consumes: `AREAS`, `leadQueryTerms` from `profile.ts`.
- Produces:
  - `interface GuestQuery { keywords: string; location: string; remote: boolean }`
  - `function buildQueries(): GuestQuery[]`
  - `function buildQueryUrl(q: GuestQuery): string`
  - `parseGuestCards` and `linkedInSource` unchanged in name

- [ ] **Step 1: Write the failing test**

Append to `tests/sources/linkedin.test.ts`:

```typescript
import { buildQueries, buildQueryUrl } from '../../src/sources/linkedin.js';

describe('buildQueries', () => {
  const queries = buildQueries();

  it('stays at twelve queries, to limit rate-limiting from CI', () => {
    expect(queries).toHaveLength(12);
  });

  it('asks Ljubljana for all eight areas', () => {
    const ljubljana = queries.filter((q) => q.location === 'Ljubljana, Slovenia');
    expect(ljubljana).toHaveLength(8);
    expect(ljubljana.every((q) => q.remote === false)).toBe(true);
  });

  it('asks the whole country only for the top four areas, and only remote', () => {
    const national = queries.filter((q) => q.location === 'Slovenia');
    expect(national).toHaveLength(4);
    expect(national.every((q) => q.remote)).toBe(true);
  });

  it('no longer searches for developer roles', () => {
    for (const q of queries) {
      expect(q.keywords.toLowerCase()).not.toContain('developer');
    }
  });

  it('leads with the highest-ranked area', () => {
    expect(queries[0]!.keywords).toBe('razvoj kadrov');
  });
});

describe('buildQueryUrl', () => {
  it('encodes keywords and location', () => {
    const url = buildQueryUrl({ keywords: 'razvoj kadrov', location: 'Slovenia', remote: false });
    expect(url).toContain('keywords=razvoj%20kadrov');
    expect(url).toContain('location=Slovenia');
    expect(url).not.toContain('f_WT');
  });

  it('adds the remote filter only for a remote query', () => {
    const url = buildQueryUrl({ keywords: 'x', location: 'Slovenia', remote: true });
    expect(url).toContain('f_WT=2');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/sources/linkedin.test.ts`
Expected: FAIL — `buildQueries` is not exported.

- [ ] **Step 3: Retarget the adapter**

In `src/sources/linkedin.ts`, add:

```typescript
import { leadQueryTerms } from '../profile.js';
```

Replace the `QUERIES` constant with:

```typescript
export interface GuestQuery {
  keywords: string;
  location: string;
  /** Adds the guest endpoint's remote filter. */
  remote: boolean;
}

/**
 * Every area against Ljubljana, plus the top four against the whole country
 * with the remote filter on. Twelve requests: LinkedIn rate-limits datacenter
 * IPs hard, so this is deliberately not one query per keyword.
 */
export function buildQueries(): GuestQuery[] {
  const terms = leadQueryTerms();
  return [
    ...terms.map((keywords) => ({ keywords, location: 'Ljubljana, Slovenia', remote: false })),
    ...terms.slice(0, 4).map((keywords) => ({ keywords, location: 'Slovenia', remote: true })),
  ];
}

export function buildQueryUrl(q: GuestQuery): string {
  const params = `keywords=${encodeURIComponent(q.keywords)}` +
    `&location=${encodeURIComponent(q.location)}&start=0`;
  return `${GUEST_API}?${params}${q.remote ? '&f_WT=2' : ''}`;
}
```

In `fetchJobs`, replace the loop head and the URL construction:

```typescript
    for (const q of buildQueries()) {
      await sleep(REQUEST_DELAY_MS);
      const url = buildQueryUrl(q);
```

and give each returned posting the three new fields:

```typescript
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
      employmentRaw: null,
      workTimeRaw: null,
      occupation: null,
    }));
```

Update the trailing comment in `fetchJobs` to read: the guest card carries no body text, so classification gets the title, the company and the location string — which is where LinkedIn states remote.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/sources/linkedin.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npm run typecheck && npm test
git add src/sources/linkedin.ts tests/sources/linkedin.test.ts
git commit -m "feat: retarget LinkedIn queries to the profile's areas"
```

---

### Task 8: Wire the pipeline, delete slo-tech, purge the old data

**Files:**
- Modify: `src/index.ts`
- Delete: `src/sources/slotech.ts`, `tests/sources/slotech.test.ts`, `tests/fixtures/slotech-listing.html`, `tests/fixtures/slotech-detail.html`
- Delete: `data/jobs.db`
- Test: `tests/pipeline.test.ts`

**Interfaces:**
- Consumes: `zrszSource`, `mojeDeloSource`, `linkedInSource`.
- Produces: `RunResult` unchanged.

- [ ] **Step 1: Update the pipeline test**

In `tests/pipeline.test.ts`, extend the `raw()` helper with the three new fields:

```typescript
const raw = (over: Partial<RawJob>): RawJob => ({
  source: 'stub', sourceId: '1', url: 'https://x/1', title: '', company: 'Acme',
  location: 'Ljubljana', postedAt: '2026-08-18', description: '', tags: [],
  employmentRaw: null, workTimeRaw: null, occupation: null, ...over,
});
```

Replace the test named `keeps a junior web job and drops a senior one` with:

```typescript
  it('keeps a matching job and drops one that matches no area', async () => {
    const src = stub('a', [
      raw({ sourceId: '1', title: 'Specialist za razvoj kadrov (m/ž)' }),
      raw({ sourceId: '2', title: 'CNC operater (m/ž)' }),
    ]);
    const result = await runScrape({ sources: [src], now: '2026-08-21T00:00:00.000Z', ...paths() });
    expect(result.kept).toBe(1);
  });

  it('keeps a senior job, because seniority never excludes', async () => {
    const src = stub('a', [raw({
      sourceId: '1', title: 'Vodja za razvoj kadrov (m/ž)',
      description: 'Zahtevamo vsaj 8 let izkušenj.',
    })]);
    const result = await runScrape({ sources: [src], now: '2026-08-21T00:00:00.000Z', ...paths() });
    expect(result.kept).toBe(1);
  });

  it('writes the CSV ordered by score, best fit first', async () => {
    const src = stub('a', [
      raw({ sourceId: '1', title: 'Koordinator dogodkov (m/ž)', location: 'Maribor' }),
      raw({ sourceId: '2', title: 'Specialist za razvoj kadrov (m/ž)', location: 'Ljubljana' }),
    ]);
    await runScrape({ sources: [src], now: '2026-08-21T00:00:00.000Z', ...paths() });
    const lines = readFileSync(paths().allCsvPath, 'utf8').trim().split('\n');
    expect(lines[1]).toContain('razvoj kadrov');
  });
```

Leave the source-isolation tests (one source throwing, all sources throwing) exactly as they are — they are what guarantees a blocked LinkedIn does not fail the nightly run.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/pipeline.test.ts`
Expected: FAIL — the stub jobs no longer match the old web-developer keywords.

- [ ] **Step 3: Wire the new source list**

In `src/index.ts`, replace the slo-tech import with the ZRSZ one:

```typescript
import { zrszSource } from './sources/zrsz.js';
```

and the source list in `main`:

```typescript
  const sources = [zrszSource, mojeDeloSource, linkedInSource];
```

Update the comment above the exit check to say: one or two blocked sources is the expected steady state, especially for LinkedIn from a datacenter IP.

- [ ] **Step 4: Delete slo-tech**

```bash
git rm src/sources/slotech.ts tests/sources/slotech.test.ts \
       tests/fixtures/slotech-listing.html tests/fixtures/slotech-detail.html
```

Then confirm nothing still references it:

```bash
grep -rn "slotech\|slo-tech" src tests README.md || echo "clean"
```

Expected: `clean`. Any remaining hit in `src` or `tests` must be removed; `README.md` is handled in Task 9.

- [ ] **Step 5: Purge the previously scraped data**

Every stored posting is off-target and the schema changed, so the database is deleted rather than migrated. Previous contents stay recoverable from git history.

```bash
git rm data/jobs.db
rm -f data/jobs.db-wal data/jobs.db-shm
```

Leave `data/jobs-all.csv` and `data/jobs-new.csv` in place for now — Task 9's live run overwrites them, which keeps the diff readable.

- [ ] **Step 6: Run the full suite**

Run: `npm test && npm run typecheck`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add -A src tests data
git commit -m "feat!: replace slo-tech with ZRSZ and purge the old postings

The stored jobs were all web-developer roles and the schema changed, so the
database is recreated rather than migrated. Old rows remain in git history."
```

---

### Task 9: Live run and documentation

**Files:**
- Modify: `README.md`
- Modify: `data/jobs-all.csv`, `data/jobs-new.csv` (regenerated)

**Interfaces:**
- Consumes: everything.
- Produces: a verified first run and accurate documentation.

- [ ] **Step 1: Run the scraper for real**

```bash
npm run scrape
```

Expected: `zrsz` and `mojedelo` both report a fetch count; `linkedin` may fail with a 429, which is fine. The `kept N of M` line should show a heavy reduction — thousands fetched, tens to low hundreds kept.

- [ ] **Step 2: Inspect the output by hand**

```bash
head -25 data/jobs-all.csv
echo "--- counts by area ---"
cut -d, -f2 data/jobs-all.csv | sort | uniq -c | sort -rn
echo "--- rows ---"; wc -l data/jobs-all.csv
```

Check three things and fix `src/profile.ts` if any fails:
- **Precision:** the top-scoring rows are genuinely relevant. If accounting, sales or warehouse roles appear, add the offending word to `TITLE_REJECT`.
- **Recall:** L&D, HR and project-coordination roles you would expect are present. If an obvious one is missing, add its phrasing to the right area's `keywords`.
- **Areas:** no single area holds nearly everything. If `content-comms` or `events` dominates, its keywords are too loose.

Re-run `npm run scrape` after any profile change. Note that `jobs-new.csv` only lists rows first seen in the latest run, so a re-run against an existing database shows fewer new rows — that is correct behaviour, not a bug.

- [ ] **Step 3: Rewrite the README**

Replace the opening paragraph, the "Tuning what gets matched" section and the "Sources" table:

````markdown
# Job Scraper

Finds learning & development, HR, project-coordination, adult-education, EU-project,
employer-branding, communications and event-coordination jobs in Slovenia from
ZRSZ, mojedelo and LinkedIn. Runs nightly via GitHub Actions and commits its
results back to this repository.

## Output

- `data/jobs-all.csv` — every job ever seen, best fit first
- `data/jobs-new.csv` — jobs first seen in the most recent run
- `data/jobs.db` — SQLite source of truth

Past nights' new-job lists are recoverable from this repo's git history.

## Running locally

```bash
npm install
npm run scrape
```

## Tuning what gets matched

Everything lives in `src/profile.ts`:

- `AREAS` — eight ranked areas. Rank 1 scores highest and sorts to the top of
  the CSV. Keywords match anywhere: title, tags or body.
- `TITLE_REJECT` — hard drop, title only. Overridden when an area keyword also
  matches the title, so "Vodja projektov prodaje" survives on its project match.
- `BODY_WARN` — never drops anything; each hit costs 8 points and shows up in
  the `flags` column.
- `CONTRACT_REJECT` — hard drop, matched against the title and the source's raw
  employment field only. Never the body, because "praksa" is ordinary prose.
- `REMOTE_MARKERS`, `HYBRID_MARKERS`, `PRIMARY_LOCATIONS` — drive `work_mode`
  and `location_tier`.

Years of experience never exclude anything. `seniority` is recorded for
information only.

### Score

Area rank 1–8 gives 40 down to 12 points; Ljubljana or remote adds 20, hybrid
elsewhere adds 18; permanent adds 15, fixed-term 8, part-time 4; each flag
costs 8. Clamped to 0–100.

## Sources

| Source | Method | Reliability |
|---|---|---|
| ZRSZ | JSON API (`prosta-delovna-mesta-filtri`), key read from the site bundle | Reliable; no description body |
| mojedelo | JSON API (`/job-ads-search`) | Reliable; full description |
| LinkedIn | Public guest endpoint | Frequently rate-limited from CI |

LinkedIn blocks datacenter IPs, so it fails on many scheduled runs. That is
expected: the run still succeeds on the other two sources, and the failure is
logged. The run fails only if all three sources fail.
````

Leave the "Schedule" section unchanged.

- [ ] **Step 4: Verify the README has no stale references**

```bash
grep -n "slo-tech\|slotech\|frontend\|fullstack\|ROLE_KEYWORDS\|TECH_KEYWORDS\|role_match" README.md || echo "clean"
```

Expected: `clean`.

- [ ] **Step 5: Commit**

```bash
npm test && npm run typecheck
git add README.md data/
git commit -m "docs: describe the new target profile and sources"
```

- [ ] **Step 6: Confirm the nightly workflow still holds**

```bash
grep -n "npm run scrape\|git add data" .github/workflows/scrape.yml
```

Expected: both present. The workflow needs no change — it runs `npm run scrape`
and commits `data/`, both of which are unaffected by this work.
