# Slovenian Junior/Mid Web Developer Job Scraper — Design

**Date:** 2026-08-21
**Status:** Approved, pending implementation plan

## Purpose

Collect junior and mid-level frontend/fullstack web developer job postings
from three Slovenian sources every evening, store them in a SQLite database
committed to this repository, and emit two CSVs: every job ever seen, and the
jobs first seen in the latest run.

Success means the maintainer opens `data/jobs-new.csv` each morning and finds
a short, accurate list of roles worth applying to, with no senior positions
and no non-web roles.

## Sources

### slo-tech.com/delo

Server-rendered HTML, `Content-Type: text/html; charset=iso-8859-2`. The
listing page exposes each posting as `<a href="/delo/{id}">{title}</a>`
followed by technology tag links (`/delo/tagi/{tag}`) and a company link
(`/delo/podjetje/{name}`).

The listing gives title, tags, and company. Seniority classification needs
the body text, so the adapter fetches each `/delo/{id}` detail page.

Responses must be decoded from ISO-8859-2 before parsing. Decoding as UTF-8
mangles every Slovenian diacritic and silently breaks keyword matching.

### mojedelo.com

A Vue SPA; the HTML shell contains no job data. Jobs come from
`https://api.mojedelo.com`, which requires three headers:

| Header | Value |
|---|---|
| `tenantId` | `5947a585-ad25-47dc-bff3-f08620d1ce17` |
| `channelId` | `8805c1b8-a0a9-4f57-ad42-329af3c92a61` |
| `languageId` | `db3c58e6-a083-4f72-b30b-39f2127bb18d` |

All three are published by the site itself at
`https://api.mojedelo.com/uploaded-files/config/www.mojedelo.com/jb.globals.js`
(as `appConfig.tenantId`, `jbChannelId`, and `languages[0].id`). The adapter
reads them from that config at runtime rather than hardcoding them, so a
rotation on their side does not break the scraper.

With those headers, `GET /job-ads` returns `200 {"data":{"items":[],"total":0}}`
— correct host and authentication, wrong endpoint or parameter names. The
exact search route is resolved during implementation by capturing the request
the SPA issues for the target filter URL.

Target filters, as selected in the maintainer's browser:
`jobCategoryIds=64f003ff-6d8b-4be0-b58c-4580e4eeeb8a` (programiranje) and
`regionIds=d1dce9b1-9fa4-438b-b582-10d371d442e6` (osrednjeslovenska).

**Contingency:** if the JSON endpoint cannot be resolved, this adapter falls
back to Playwright driving the filtered search URL and reading the rendered
DOM. The JSON path is strongly preferred — it is faster, stabler, and adds no
browser dependency to CI.

### LinkedIn

Uses the public guest endpoint
`/jobs-guest/jobs/api/seeMoreJobPostings/search`, which returns an HTML
fragment of job cards without authentication. Queries cover Ljubljana and
remote-in-Slovenia listings for the same web developer role terms.

LinkedIn rate-limits datacenter IPs aggressively, and GitHub Actions runners
are datacenter IPs. This source is expected to fail on a substantial fraction
of nights. That is accepted: no session cookie is used, no LinkedIn account is
put at risk, and a blocked night degrades the run rather than failing it.

## Architecture

```
src/
  sources/
    slotech.ts       listing HTML -> detail pages -> RawJob[]
    mojedelo.ts      config fetch -> JSON API -> RawJob[]
    linkedin.ts      guest search endpoint -> RawJob[]
  classify.ts        role gate + seniority gate
  normalize.ts       RawJob -> Job, stable id
  store.ts           SQLite schema, upsert, new-job detection
  csv.ts             writes jobs-all.csv and jobs-new.csv
  index.ts           orchestrator
data/
  jobs.db
  jobs-all.csv
  jobs-new.csv
.github/workflows/scrape.yml
```

Each adapter implements one interface and knows nothing about filtering,
storage, or output:

```ts
interface Source {
  name: string;
  fetchJobs(): Promise<RawJob[]>;
}
```

This keeps every adapter independently testable against a saved fixture, and
makes adding a fourth source a matter of writing one file.

**Language:** TypeScript on Node. Chosen over Python for maintainer
familiarity — the seniority keyword rules will be edited often, and they
should live in a file the maintainer wants to open. Dependencies: `cheerio`
(HTML), `iconv-lite` (ISO-8859-2), `better-sqlite3` (storage). No framework.

## Data flow

1. Run all three adapters. Each is wrapped so a thrown error is logged as a
   source failure and does not abort the run.
2. Normalize every `RawJob` into a `Job` with a stable id.
3. Classify: apply the role gate, then the seniority gate.
4. Drop anything classified `senior` or failing the role gate.
5. Upsert survivors into SQLite.
6. Rewrite both CSVs from the database.

The process exits non-zero only if **all three** sources fail. One or two
failures produce a successful run over the sources that worked, with the
failures recorded in the log.

## Classification

Two independent gates, both keyword-based, both living in `classify.ts` so
tuning happens in one place.

### Role gate

A posting must match at least one web keyword across its title, tags, or
body:

- **Role keywords** — `frontend`, `front-end`, `fullstack`, `full-stack`,
  `spletni razvijalec`, `spletne aplikacije`, `web developer`.
- **Technology keywords** — `react`, `vue`, `angular`, `next.js`, `svelte`,
  `javascript`, `typescript`.

Both tiers match anywhere in the posting, body included. This is a deliberate
bias toward recall over precision: Slovenian ads often bury the actual stack
in the requirements list while the title says only "Razvijalec (m/ž)", and
missing one of those costs more than skimming a few false positives.

The known cost is that ads listing "poznavanje JavaScripta je prednost" among
the nice-to-haves of a Java or C++ role will match. The `role_match` column
records which keywords fired, so a posting that got in on a single incidental
technology mention is visible at a glance in the CSV. If that noise becomes
annoying in practice, restricting technology keywords to title and tags is a
one-line change in `classify.ts`.

This gate matters because slo-tech's board is general IT — its listings are
dominated by C++, embedded, and robotics roles that must not reach the CSV.

### Seniority gate

Evaluated in order; the first match wins:

1. **Explicit senior markers** → `senior` (excluded): `senior`, `sr.`, `lead`,
   `vodja`, `arhitekt`, `principal`, `staff`, `head of`.
2. **Explicit junior markers** → `junior`: `junior`, `mlajši`, `pripravnik`,
   `praktikant`, `brez izkušenj`.
3. **Explicit mid markers** → `mid`: `medior`, `mid-level`, `mid level`,
   `midlevel`, `intermediate`. Junior is checked first, so an ad advertising
   "junior/medior" classifies as `junior` — both are wanted, and the more
   inclusive label is the safer default.
4. **Years-of-experience regex** over the body, matching both Slovenian and
   English phrasings (`5+ let`, `vsaj 3 leta`, `1-2 leti`, `3 years`).

   Every match yields a single number: for a range (`1-2 leti`) take the
   upper bound; for an open-ended or minimum phrasing (`3+ let`, `vsaj 3
   leta`) take the stated number itself. When a body states several
   requirements, the largest resulting number decides. That number maps to:
   - `>= 5` → `senior` (excluded)
   - `3` or `4` → `mid`
   - `<= 2` → `junior`
5. **No signal** → `unknown`.

`unknown` postings are kept and flagged. Slovenian ads frequently omit
seniority entirely, and a missed junior role costs the maintainer far more
than one extra row to skim. Only `senior` is ever excluded.

## Storage

SQLite (`data/jobs.db`) is the source of truth; both CSVs are derived
artifacts regenerated in full on every run.

```sql
CREATE TABLE jobs (
  id            TEXT PRIMARY KEY,  -- sha256(source + ':' + source_id)
  source        TEXT NOT NULL,
  source_id     TEXT NOT NULL,
  url           TEXT NOT NULL,
  title         TEXT NOT NULL,
  company       TEXT,
  location      TEXT,
  posted_at     TEXT,              -- ISO date when the source provides one
  description   TEXT,
  role_match    TEXT NOT NULL,     -- matched web keywords, comma-joined
  seniority     TEXT NOT NULL,     -- junior | mid | unknown
  first_seen_at TEXT NOT NULL,     -- ISO timestamp
  last_seen_at  TEXT NOT NULL
);
```

Upsert semantics: insert on a new id, otherwise update `last_seen_at` and
mutable fields. `first_seen_at` is never overwritten — it is what makes
new-job detection correct across re-runs.

A job is **new** when its `first_seen_at` equals the current run's timestamp.
Running the scraper twice in one day therefore reports the second run's new
jobs correctly rather than re-reporting the first run's.

## Outputs

Both files are written to `data/` and committed by the workflow.

- **`jobs-all.csv`** — every job in the database.
- **`jobs-new.csv`** — only jobs first seen in the latest run.

Columns: `source, title, company, location, seniority, role_match, posted_at,
first_seen_at, url`. Descriptions stay in the database and out of the CSV;
including them makes the file unusable in a spreadsheet.

`jobs-new.csv` is overwritten each run. Past nights remain recoverable from
git history, since every run commits the file — no dated archive is needed.

## Scheduling

`.github/workflows/scrape.yml`, triggered by `cron: '0 17 * * *'` plus
`workflow_dispatch` for manual runs.

GitHub Actions cron is UTC and has no DST awareness. `17:00 UTC` is `19:00`
in Ljubljana during CEST and `18:00` during CET. This one-hour winter drift is
accepted; a wall-clock-exact alternative would run at both 17:00 and 18:00 UTC
and exit early unless the local Ljubljana hour is 19.

The workflow needs `permissions: contents: write` to commit `data/` back to
the repository. It commits only when the scrape produced changes.

## Politeness

Requests are issued sequentially per source with a short delay between them,
under a descriptive User-Agent. Detail-page fetches are the bulk of the
traffic; slo-tech's board is small enough that a full pass is well under a
hundred requests. No source is fetched concurrently with itself.

## Testing

TDD throughout. No test performs live network I/O.

- **Parser tests** — each adapter runs against a committed fixture of a real
  response. The slo-tech HTML fixture is already captured.
- **Classifier tests** — a table of real Slovenian and English titles and
  bodies, including the ambiguous no-signal cases and the years-regex
  boundaries at 2, 3, and 5 years.
- **Store tests** — a job ingested twice appears in `jobs-new.csv` exactly
  once; `first_seen_at` survives the second ingest.
- **Failure-handling test** — one adapter throwing still produces CSVs from
  the other two, and the run exits zero.

## Out of scope

Notifications, a web UI, application tracking, deduplication of the same role
posted across two boards, and any authenticated LinkedIn access.

## Prerequisite

The repository has been initialized with `git init` but has no GitHub remote.
The nightly workflow requires the repository to be pushed to GitHub. Creating
the remote is a manual step for the maintainer.
