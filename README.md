# Karierni kompas

A personal job radar for learning & development, adult education, education
programmes, EU/education projects and digital learning (EdTech). It collects
postings nightly from several job portals, drops what does not fit the
seeker's profile, scores the rest 0–100, merges the same ad found on several
portals, and shows the result in a small web app on Vercel.

```
GitHub Actions (nightly)                         Vercel
  npm run scrape                                   web/ (Vite + React, static)
    sources → classify → store (SQLite) → export     reads data/jobs.json at build
                                         └─ data/jobs.json ── commit ──▶ redeploy
```

## The app

`web/` is a static site that reads `data/jobs.json`. It filters by posting
date (7/14/30/60 days, 30 by default), area, location, work mode and minimum
match score, sorts by score, date or application deadline, and lets the viewer
save or hide postings. Saved and hidden postings stay in that browser only.

Each posting shows its title, organisation, location, work mode, posting date,
deadline, required experience, salary when published, the match score with
its breakdown, short reasons why it fits (or what to watch out for), and links
to every portal carrying it.

The data file carries no advert text — only metadata, our own notes, and links
to the originals — because several portals forbid republishing their content.

## Sources

| Source | Method | Notes |
|---|---|---|
| Zavod RS za zaposlovanje (ZRSZ) | JSON API used by its own site | All of Slovenia. Public-sector employers (universities, ljudske univerze, javni zavodi) must post here. |
| MojeDelo | JSON API used by its own site | Seven relevant categories. |
| Optius | Server-rendered pages + official RSS | Rate-limits hard; detail pages are fetched 25 per night. |
| LinkedIn | Public guest endpoint | All of Slovenia plus EU-remote roles. Often rate-limited from CI. |
| Himalayas | Official public API | Remote roles open to Slovenia. Terms: link to the original, name the source. |
| EU Careers (EPSO) | Official RSS + listing pages | EU institutions and agencies (incl. ACER in Ljubljana). |
| EuroBrussels | Server-rendered pages | International organisations, mostly Brussels. |
| Euractiv Jobs | WordPress REST API + RSS | Now jobs.rapporteur.com. |
| EURES | JSON API used by its own portal | Mostly a mirror of ZRSZ for Slovenia; adds EU remote roles. |

Considered and left out: **Indeed** (Cloudflare bot challenge; its terms ban
scrapers), **EURAXESS** (robots.txt disallows every job page), **Remotive**,
**We Work Remotely**, **Working Nomads**, **Arbeitnow** (little or nothing
relevant, or unverifiable terms).

A source that fails does not fail the run; the app's footer shows which
sources were reached and when each last succeeded.

## Matching and scoring

Everything tunable lives in `src/profile.ts`; `src/classify.ts` applies it.

- **Areas** — the role families from the brief: L&D, projects &
  coordination, adult education & education programmes, digital learning &
  EdTech, counselling & social work, NGOs / cultural institutions /
  universities, and related roles. A specific term in the title files a
  posting outright. Generic titles ("Strokovni sodelavec", "Project Manager",
  "Research Assistant") count only with an education context. With nothing in
  the title, at least three specific phrases in the ad body are needed.
- **Project work** counts only when it is social-science (humanities,
  culture, education, the social sector, an NGO or university employer) or
  digital, and never when the ad asks for programming.
- **NGOs, museums, galleries, theatres and universities** — administrative,
  organising and programme roles ("Administrator", "Poslovni sekretar",
  "Strokovni sodelavec v referatu") count at these employers, or where the ad
  calls its employer a non-profit; the same titles elsewhere do not.
- **Counselling, not teaching** — school counselling services, social work
  and youth work are in; classroom teaching stays out.
- **Location** — Ljubljana and its surroundings, or Koper and Izola. The rest
  of Slovenia and everything abroad count only when fully remote; hybrid or
  on-site work abroad is dropped, international-organisation boards included.
  A Slovenian ad that names no town is kept with a warning.
- **Dropped** — general HR (business partners, HR managers, recruiters,
  payroll, HR admin) unless the title or the duties are about learning;
  clearly senior, managerial or executive titles; roles requiring 8+ years;
  student work and internships; off-target professions (including finance,
  legal, technical, lab and IT-administration roles) and
  construction/engineering projects.
- **Score** (0–100) — relevance to learning/education/projects (35), overlap
  with the seeker's experience and tools such as LMS, Workday, SAP and
  SharePoint (15), remote or hybrid work (15), required experience level (15),
  location and language requirements (10), and the kind of organisation and
  themes such as EU projects or lifelong learning (10), minus HR-admin or
  sales duties.

`npm test` covers the rules with concrete examples (`tests/classify.test.ts`).

## Running locally

```bash
npm install
npm run scrape            # writes data/jobs.json (and data/jobs.db, untracked)
cd web && npm install && npm run dev
```

## Storage and schedule

`data/jobs.db` keeps every kept posting with its full text, first-seen time
and cached detail pages, so each night only new ads cost a detail request. It
lives in the GitHub Actions cache, not in git. If the cache is lost the next
run simply starts fresh.

The scrape runs daily at 18:00 Europe/Ljubljana, summer time included.
GitHub starts scheduled runs hours late, so the workflow is scheduled for
08:30 UTC and then waits until 18:00 Ljubljana before scraping; if GitHub
starts it after 18:00 it scrapes at once. Trigger a run by hand from the
Actions tab with "Run workflow"; manual runs skip the wait. Each run that
changes `data/jobs.json` commits it, and Vercel redeploys the app from that
commit.

Optional secret: `HIMALAYAS_API_KEY` (a free key from Himalayas raises its
rate limit; without one the shared public quota is used).
