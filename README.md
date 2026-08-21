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
