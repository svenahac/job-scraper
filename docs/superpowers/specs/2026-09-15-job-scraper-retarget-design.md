# Job Scraper Retarget — L&D / HR / Project Coordination

Date: 2026-09-15
Status: Approved
Supersedes the targeting (not the plumbing) of `2026-08-21-job-scraper-design.md`.

## Context

The scraper currently finds junior/mid frontend and fullstack developer roles
from slo-tech, mojedelo and LinkedIn. The target profile has changed
completely: the seeker is an andragogy graduate with Petrol + A1 + Erasmus+
experience, Workday/LMS exposure, and a background in organising training. The
wanted roles are learning & development, project coordination, HR /
people & culture, adult education, EU projects, employer branding,
communications and event coordination.

The plumbing — source adapters returning `RawJob[]`, a classification step, a
SQLite store, two CSV exports, nightly GitHub Actions — is sound and is kept.
What changes is what counts as a match, plus one source swap.

## Goals

- Replace the single flat keyword list with eight prioritised areas.
- Add explicit rejection rules, so unwanted work never reaches the CSV.
- Replace slo-tech with ZRSZ (ess.gov.si), keep mojedelo, keep LinkedIn.
- Emit a sortable fit score plus the signals behind it.
- Purge every previously scraped posting.

## Non-goals

- No change to the nightly schedule, the commit-back workflow, or the store.
- No filtering on years of experience. The seeker's explicit instruction is to
  apply even when an ad asks for more experience than she has.
- No new runtime dependencies.

## The seeker profile — `src/profile.ts` (new)

A single module is the only place that encodes what she wants. `classify.ts`
becomes an engine that applies it; adapters that need search keywords derive
them from it. This prevents the eight areas being copy-pasted into three
adapters and drifting apart.

```ts
export interface Area {
  key: string;          // 'ld'
  rank: number;         // 1 = highest priority
  label: string;        // human-readable, used in the CSV
  keywords: string[];   // matched in title, tags and body
  queryTerms: string[]; // drives keyword-based sources (LinkedIn)
}
```

### Areas

**Rank 1 — `ld`, Izobraževanje in razvoj kadrov / L&D**

`razvoj kadrov`, `izobraževanje in razvoj kadrov`, `learning and development`,
`learning & development`, `l&d`, `learning specialist`, `learning coordinator`,
`training coordinator`, `training specialist`, `talent development`,
`people development`, `hr development`, `razvoj zaposlenih`,
`koordinator izobraževanj`, `koordinatorka izobraževanj`,
`skrbnik izobraževanj`, `interna akademija`, `interne akademije`,
`korporativna akademija`, `onboarding`, `employee development`,
`učenje in razvoj`, `strokovnjak za izobraževanje`

Query terms: `razvoj kadrov`, `learning and development`, `training coordinator`,
`talent development`, `koordinator izobraževanj`

**Rank 2 — `projects`, Projektno delo / koordinacija projektov**

`projektni koordinator`, `projektna koordinatorka`, `koordinator projektov`,
`project coordinator`, `project assistant`, `project specialist`,
`junior project manager`, `project manager`, `projektni sodelavec`,
`projektna sodelavka`, `projektni vodja`, `vodja projektov`,
`program coordinator`, `projektno vodenje`, `projektna pisarna`

Query terms: `projektni koordinator`, `project coordinator`,
`koordinator projektov`, `project manager`

**Rank 3 — `hr`, HR / People & Culture**

`hr specialist`, `hr coordinator`, `hr koordinator`, `kadrovski specialist`,
`people & culture`, `people and culture`, `people operations`, `people ops`,
`employee experience`, `talent management`, `talent acquisition`,
`employer branding`, `employee engagement`, `hr project`, `hr generalist`,
`hr business partner`, `kadrovik`, `strokovni sodelavec za kadre`

Query terms: `hr specialist`, `people and culture`, `kadrovski specialist`,
`talent management`

**Rank 4 — `adult-education`, Izobraževanje odraslih / andragoško delo**

`andragog`, `andragoško`, `izobraževanje odraslih`, `adult education`,
`strokovni sodelavec za izobraževanje`, `svetovalec za izobraževanje`,
`koordinator izobraževanja`, `koordinator programov`, `vodja programov`,
`strokovni delavec v izobraževanju`, `ljudska univerza`,
`izobraževalni program`, `organizator izobraževanja`, `učitelj odraslih`

Query terms: `andragog`, `izobraževanje odraslih`, `koordinator izobraževanja`,
`vodja programov`

**Rank 5 — `eu-projects`, EU / Erasmus+ / razvojni projekti**

`erasmus`, `erasmus+`, `eu projekt`, `eu projekti`, `evropski projekt`,
`evropskih projektov`, `eu project`, `project officer`, `programme coordinator`,
`program officer`, `mednarodni projekti`, `koordinator mednarodnih projektov`,
`razvojni projekti`, `mobilnost`, `kohezijska`, `strukturni skladi`,
`javni razpis`

Query terms: `erasmus`, `evropski projekti`, `project officer`,
`mednarodni projekti`

**Rank 6 — `employer-brand`, Employer branding / employee experience**

`employer branding`, `employer brand`, `employee experience`,
`employee engagement`, `internal communications`, `interna komunikacija`,
`notranje komuniciranje`, `culture & engagement`, `hr marketing`,
`talent attraction`, `blagovna znamka delodajalca`

Query terms: `employer branding`, `interna komunikacija`, `employee experience`

**Rank 7 — `content-comms`, Content / communications / community**

`content coordinator`, `content specialist`, `communications coordinator`,
`communications specialist`, `community manager`, `community coordinator`,
`social media coordinator`, `social media specialist`, `marketing coordinator`,
`koordinator komuniciranja`, `strokovni sodelavec za odnose z javnostmi`,
`odnosi z javnostmi`

Query terms: `content coordinator`, `communications specialist`,
`community manager`

**Rank 8 — `events`, Event / program coordination**

`event coordinator`, `event manager`, `koordinator dogodkov`,
`organizator dogodkov`, `programski koordinator`, `konferenčni koordinator`,
`events & people`, `community & events`, `organizacija dogodkov`

Query terms: `event coordinator`, `koordinator dogodkov`

Areas deliberately overlap — `employee experience` sits in both `hr` and
`employer-brand`. A posting records every area it matches; the best (lowest)
rank drives the score.

### Rejection rules

**`TITLE_REJECT` — hard drop, matched against the title only**

`računovodja`, `računovodkinja`, `knjigovodja`, `knjigovodkinja`,
`komercialist`, `prodajni svetovalec`, `prodajni zastopnik`,
`prodajni referent`, `terenski prodajalec`, `prodajalec`, `klicni center`,
`telefonski`, `obračun plač`, `payroll`, `vnos podatkov`, `data entry`,
`inkaso`, `izterjava`, `blagajnik`, `skladiščnik`, `voznik`, `natakar`,
`kuhar`, `čistilka`, `varnostnik`, `revizor`

`referent za` is deliberately absent: it would drop
"Referent za izobraževanje odraslih", which is a target role. Titles like
"Referent za kadrovske zadeve" are already excluded by failing to match any
area.

**Override:** a title reject loses when an area keyword also matches the
title. "Vodja projektov prodaje" keeps its `projects` match rather than dying
on `prodaj`. The reject is recorded as a flag instead. This biases toward
recall, matching the seeker's stated preference to see borderline ads.

**`BODY_WARN` — flag only, never drops**

`payroll`, `obračun plač`, `kadrovska administracija`, `kadrovske evidence`,
`delovnopravna administracija`, `delovno-pravna administracija`,
`vodenje evidenc`, `arhiviranje`, `prodajni cilji`, `doseganje prodajnih`,
`klicanje strank`

**`CONTRACT_REJECT` — hard drop, matched against title and the source's raw
employment field only, never the body**

`študentsko delo`, `študentsko`, `praksa`, `praktikant`, `pripravnik`,
`pripravništvo`, `volontersko`, `volonterski`, `obvezna praksa`

Body matching is excluded on purpose: `praksa` occurs constantly in ordinary
Slovenian ad prose ("dobra praksa", "v praksi").

### Location and work mode

`REMOTE_MARKERS`: `delo od doma`, `od doma`, `remote`, `na daljavo`,
`teleworking`, `full remote`

`HYBRID_MARKERS`: `hibrid`, `hybrid`, `kombinirano delo`, `delno od doma`

`PRIMARY_LOCATIONS`: `ljubljana`, `osrednjeslovenska`, `vrhnika`, `domžale`,
`kamnik`, `grosuplje`, `medvode`, `škofljica`, `brezovica`, `logatec`, `trzin`

## Classification — `src/classify.ts` (rewritten)

Produces, per posting:

| Field | Values |
|---|---|
| `areas` | every matching area key |
| `area` / `areaRank` | the best-ranked match |
| `workMode` | `remote` / `hybrid` / `onsite` / `unknown` |
| `employmentType` | `permanent` / `fixed-term` / `part-time` / `unknown` |
| `locationTier` | `ljubljana` / `remote` / `other` |
| `flags` | body warnings and overridden title rejects |
| `seniority` | unchanged logic, now informational only |
| `score` | 0–100, higher is better |

A posting is kept when it matches at least one area, survives `TITLE_REJECT`
(after the override), and survives `CONTRACT_REJECT`. Seniority no longer
excludes anything.

### Deriving the signals

`workMode` — `remote` when a `REMOTE_MARKERS` term appears in title, location
or body; `hybrid` when a `HYBRID_MARKERS` term does; `onsite` when the source
states a fixed workplace and neither marker appears; `unknown` otherwise.
Hybrid wins over remote when both appear, since an ad naming both is almost
always hybrid.

`locationTier` — `ljubljana` when the location matches `PRIMARY_LOCATIONS`;
otherwise `remote` when `workMode` is `remote`; otherwise `other`.

`employmentType` — read from `employmentRaw` and `workTimeRaw` first, falling
back to title and body. `nedoločen čas` / `permanent` → `permanent`;
`določen čas` / `fixed term` → `fixed-term`; a weekly-hours figure below 35, or
`krajši delovni čas` / `part-time` → `part-time`; otherwise `unknown`.
`part-time` takes precedence over the contract-duration reading, because a
20 h/week permanent role is still a part-time role for ranking purposes.

### Score

| Component | Points |
|---|---|
| Area rank 1 → 8 | 40, 36, 32, 28, 24, 20, 16, 12 |
| `locationTier` ljubljana or remote | 20 |
| `workMode` hybrid | 18 (instead of the tier points, when tier is `other`) |
| `employmentType` permanent | 15 |
| `employmentType` fixed-term | 8 |
| `employmentType` part-time | 4 |
| Each entry in `flags` | −8 |

Score is clamped to 0–100. The CSV sorts by it descending, so the strongest
fits are the first rows of the spreadsheet.

## Data model — `src/types.ts`

`RawJob` gains three optional fields so adapters can pass through structured
facts rather than burying them in prose:

- `employmentRaw: string | null` — e.g. ZRSZ `trajanjeZaposlitve`
- `workTimeRaw: string | null` — e.g. ZRSZ `delovniCas` ("40 ur/teden")
- `occupation: string | null` — e.g. ZRSZ `poklic`

`Job` drops `roleMatch` and gains `area`, `areaRank`, `areas`, `workMode`,
`employmentType`, `locationTier`, `flags`, `score`.

## Sources

### ZRSZ — `src/sources/zrsz.ts` (new)

Endpoint: `POST https://apigateway-prod-www-prod.apps.ess.gov.si/iskalnik-po-pdm/v1/delovno-mesto/prosta-delovna-mesta-filtri?user_key=<key>`

The `user_key` is published in the site's own Angular bundle, alongside the
gateway host, as `F_dataFor3ScaleApi_keyValue` and `F_dataFor3ScaleApi_url`.
Both are read at runtime from
`/typo3temp/assets/compressed/merged-*.js`, discovered by fetching
`https://www.ess.gov.si/iskalci-zaposlitve/` and taking the script tag that
contains `ApiUrlPlaceholder3scale`. A rotation on their side then does not
break the scraper. This mirrors how the mojedelo adapter already reads its
tenant headers.

Request body:

```json
{ "nazivDelovnegaMesta": "", "lokacija": "", "drzave": [],
  "poklicnaPodrocja": [], "regije": [], "stran": 1, "stZadetkov": 500,
  "vrniFiltre": false, "urejevalniPojem": 0 }
```

`stZadetkov: 500` is accepted, so all of Slovenia (~4,400 ads) is nine
requests. The adapter therefore fetches everything and lets `classify.ts`
apply the location policy locally, rather than running a region pass and a
remote pass. This satisfies the same policy with less code and no second
request set.

Each list item maps to a `RawJob`: `idDelovnoMesto` → `sourceId`,
`nazivDelovnegaMesta` → `title`, `delodajalec` → `company`, `krajDM` →
`location`, `datumObjave` → `postedAt`, `trajanjeZaposlitve` →
`employmentRaw`, `delovniCas` → `workTimeRaw`, `poklic` → `occupation`.

The API exposes no description body and no detail endpoint under this
namespace, so `description` is `''` and classification runs on title,
occupation and employer. The first implementation task opens the ZRSZ search
page in Chrome to capture the real detail link; if a description source is
found, it fills the existing `description` field and no other code changes.
Fallback, if not found: `description: ''` and a URL of
`https://www.ess.gov.si/iskalci-zaposlitve/iskanje-zaposlitve/iskanje-dela/#/pdm/<id>`.

### MojeDelo — `src/sources/mojedelo.ts` (retargeted)

Categories replace the single IT id:

| Category | Id |
|---|---|
| Kadri, HR | `e917f193-c49f-4e28-85ab-5c0746f1df19` |
| Izobraževanje, Prevajanje, Coaching | `5022c5c2-029d-4949-a69a-9e156f82747d` |
| Upravljanje, Svetovanje, Vodenje | `26bed8a9-3863-40a2-a38f-ee74d2097d72` |
| Javni sektor, NVO, Kultura | `307d6e8a-29c6-4950-a13d-8d1a3078a2d9` |
| Marketing, Kreativa, PR, Mediji | `c5af8f46-57bb-45e9-9e66-9cd0ebd562a0` |
| Administracija | `c9749e1f-8619-40e6-85dd-1a091ef54730` |
| Znanost, Raziskave, Razvoj | `d25129f2-66b9-4a57-a7e1-3b7c956a2ba9` |

The region filter is dropped from the search call. Search pages are cheap;
the per-ad detail fetch is not. The adapter therefore fetches search results
for all of Slovenia, then fetches the detail body only for ads that are in
Osrednjeslovenska **or** whose title already matches an area. This is the
two-pass geography policy, with the expensive half bounded.

### LinkedIn — `src/sources/linkedin.ts` (retargeted)

Queries are built from the areas' `queryTerms`: the lead term of each of the
eight areas against `Ljubljana, Slovenia`, plus the top four areas' lead terms
against `Slovenia` with the guest endpoint's remote filter `f_WT=2`. Twelve
requests, chosen to limit rate-limiting from CI. Everything else about the
adapter is unchanged.

### slo-tech

Deleted: `src/sources/slotech.ts`, `tests/sources/slotech.test.ts`,
`tests/fixtures/slotech-listing.html`, `tests/fixtures/slotech-detail.html`,
and its entry in `src/index.ts`.

## Storage and output

The `jobs` table gains the new columns and drops `role_match`. Because every
stored posting is now off-target, `data/jobs.db` is deleted and recreated
rather than migrated. `data/jobs-all.csv` and `data/jobs-new.csv` are
rewritten by the first run. Previous contents stay recoverable from git
history.

CSV columns, sorted by `score` descending then `title` ascending:

```
score, area, area_rank, title, company, location, location_tier, work_mode,
employment_type, seniority, areas, flags, source, posted_at, first_seen_at, url
```

`description` remains excluded, as before, to keep the file usable in a
spreadsheet.

## Testing

Test-driven throughout.

- `tests/profile.test.ts` — areas are uniquely ranked 1–8; no keyword appears
  in both an area list and `TITLE_REJECT`.
- `tests/classify.test.ts` — rewritten: one case per area; the title-reject
  override; contract rejects from title and from `employmentRaw`, and the
  absence of body-driven contract rejects; work mode and location tier;
  the score table.
- `tests/sources/zrsz.test.ts` — new, with a captured search-response fixture:
  key extraction from the bundle, list-item mapping, paging.
- `tests/sources/mojedelo.test.ts` — extended for the detail-fetch gate.
- `tests/sources/linkedin.test.ts` — query construction from the profile.
- `tests/store.test.ts`, `tests/csv.test.ts`, `tests/pipeline.test.ts` —
  updated for the new columns and ordering.
- slo-tech tests and fixtures deleted.

## Rollout

1. Resolve the ZRSZ detail link in Chrome; apply the fallback if absent.
2. Build `profile.ts` and the rewritten `classify.ts` behind their tests.
3. Add the ZRSZ adapter; retarget mojedelo and LinkedIn; delete slo-tech.
4. Update types, store schema, CSV.
5. Delete `data/jobs.db`; run `npm run scrape`; inspect the CSV by hand for
   precision and recall before committing results.
6. Update `README.md` to describe the new target profile and sources.

The nightly workflow needs no change.
