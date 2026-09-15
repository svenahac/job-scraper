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
- `DOMAIN_REJECT` — hard drop for trade/engineering qualifiers (construction,
  electrical, industrial), matched against the title, the occupation and the
  tags. Unlike `TITLE_REJECT`, an area keyword does NOT rescue it — "Vodja
  projektov gradnje" is a construction job even though "vodja projektov" is
  itself an area keyword.
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

A posting whose area match comes only from a source's own occupation tag
(`poklic`, for ZRSZ), with no supporting keyword in the title or the advert
body, is demoted rather than dropped: it loses 20 points plus the usual 8 for
the `area-from:tag:<key>` flag that records it (28 in total), so it still
appears in the CSV but sinks below postings whose match is backed by the
actual ad text. Tag matches backed by a title or body hit are unaffected.

Scores are not strictly comparable across sources: a source that supplies no
description body can never pick up a `flags` penalty, and one that supplies no
contract field can never earn the permanent-employment points, so a thin
listing can outscore a richer one for the same job. There is also no
cross-source de-duplication — a job advertised on both ZRSZ and mojedelo
appears as two rows, since each id is derived from the source plus that
source's own id.

## Sources

| Source | Method | Reliability |
|---|---|---|
| ZRSZ | JSON API (`prosta-delovna-mesta-filtri`), key read from the site bundle | Reliable; no description body |
| mojedelo | JSON API (`/job-ads-search`) | Reliable; full description |
| LinkedIn | Public guest endpoint | Frequently rate-limited from CI |

LinkedIn blocks datacenter IPs, so it fails on many scheduled runs. That is
expected: the run still succeeds on the other two sources, and the failure is
logged. The run fails only if all three sources fail.

## Schedule

Nightly at 17:00 UTC — 19:00 Ljubljana in summer, 18:00 in winter. Trigger a
manual run from the Actions tab with "Run workflow".
