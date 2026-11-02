import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  parseSearchPage, parseUtcOffset, describeLocation, isOpenToSlovenia, isFresh,
  formatSalary, sourceIdFromGuid, toRawJob, selectJobs, searchTerms, buildSearchUrl,
  MAX_QUERIES,
} from '../../src/sources/himalayas.js';
import type { HimalayasJob, Country } from '../../src/sources/himalayas.js';

const search = JSON.parse(readFileSync('tests/fixtures/himalayas-search.json', 'utf8'));
const jobs = parseSearchPage(search);
const byTitle = (t: string): HimalayasJob => {
  const job = jobs.find((j) => j.title === t);
  if (!job) throw new Error(`fixture has no "${t}"`);
  return job;
};
const harris = byTitle('Talent Development & Learning Specialist (f/m/d)');
const airalo = byTitle('Training Specialist');
const ableVentures = byTitle('OD & Learning Solutions Associate');
const goFluent = byTitle('Corporate Czech Trainer');
const infuse = byTitle('Instructional Designer (Contract, Remote)');
const pulitzer = byTitle('Program Coordinator, AI Initiative');

/** The day after the fixture was captured. */
const NOW = new Date('2026-11-02T12:00:00Z');

const countries = (...names: string[]): Country[] => names.map((name) => ({ name, alpha2: null }));
const job = (over: Partial<HimalayasJob>): HimalayasJob => ({ ...harris, ...over });

describe('parseSearchPage', () => {
  it('extracts every job', () => {
    expect(jobs).toHaveLength(6);
  });

  it('reads the core fields', () => {
    expect(harris.guid).toBe('https://himalayas.app/companies/harris/jobs/talent-development-learning-specialist-f-m-d');
    expect(harris.companyName).toBe('Harris');
    expect(harris.seniority).toEqual(['Mid-level']);
    expect(harris.pubDate).toBeTypeOf('number');
  });

  it('reads plain-string country restrictions', () => {
    expect(infuse.locationRestrictions).toEqual([{ name: 'Slovenia', alpha2: null }]);
    expect(ableVentures.locationRestrictions).toEqual([]);
  });

  it('reads numeric timezone restrictions', () => {
    expect(harris.timezoneRestrictions).toEqual([-1, 0, 1, 2, 3]);
  });

  it('also accepts the documented object and "UTC±h" shapes', () => {
    const [parsed] = parseSearchPage({
      jobs: [{
        guid: 'g', title: 't',
        locationRestrictions: [{ alpha2: 'si', name: 'Slovenia', slug: 'slovenia' }],
        timezoneRestrictions: ['UTC+1', 'UTC+2'],
      }],
    });
    expect(parsed!.locationRestrictions).toEqual([{ name: 'Slovenia', alpha2: 'SI' }]);
    expect(parsed!.timezoneRestrictions).toEqual([1, 2]);
  });

  it('skips items without a guid or title', () => {
    expect(parseSearchPage({ jobs: [{ title: 'No guid' }, { guid: 'no-title' }] })).toEqual([]);
  });

  it('returns an empty array for an empty or malformed payload', () => {
    expect(parseSearchPage({ jobs: [] })).toEqual([]);
    expect(parseSearchPage(null)).toEqual([]);
    expect(parseSearchPage({ error: 'rate limited' })).toEqual([]);
  });
});

describe('parseUtcOffset', () => {
  it('parses numbers and UTC strings', () => {
    expect(parseUtcOffset(1)).toBe(1);
    expect(parseUtcOffset(-3.5)).toBe(-3.5);
    expect(parseUtcOffset('UTC-5')).toBe(-5);
    expect(parseUtcOffset('UTC+05:30')).toBe(5.5);
    expect(parseUtcOffset('+5:45')).toBe(5.75);
  });

  it('returns null for anything else', () => {
    expect(parseUtcOffset('CET')).toBeNull();
    expect(parseUtcOffset(null)).toBeNull();
  });
});

describe('describeLocation', () => {
  it('calls an unrestricted job worldwide', () => {
    expect(describeLocation(ableVentures.locationRestrictions)).toBe('Worldwide');
  });

  it('calls a full European list Europe', () => {
    expect(describeLocation(harris.locationRestrictions)).toBe('Europe');
  });

  it('lists a short restriction in full', () => {
    expect(describeLocation(goFluent.locationRestrictions)).toBe('Romania, Slovenia');
    expect(describeLocation(infuse.locationRestrictions)).toBe('Slovenia');
  });

  it('counts a long mixed list and names Slovenia when included', () => {
    expect(describeLocation(airalo.locationRestrictions)).toBe('148 countries incl. Slovenia');
  });

  it('names a partial European list that includes Slovenia', () => {
    const list = countries('Austria', 'Croatia', 'Germany', 'Hungary', 'Italy', 'Slovenia');
    expect(describeLocation(list)).toBe('Europe (6 countries incl. Slovenia)');
  });

  it('never mentions Slovenia or Europe when Slovenia is excluded', () => {
    const list = countries('Austria', 'Belgium', 'Croatia', 'Germany', 'Italy', 'Spain');
    const label = describeLocation(list);
    expect(label).toBe('6 countries: Austria, Belgium, Croatia, …');
    expect(label.toLowerCase()).not.toMatch(/sloven|europe/);
  });
});

describe('isOpenToSlovenia', () => {
  it('keeps every fixture job (the API was queried with country=Slovenia)', () => {
    for (const j of jobs) expect(isOpenToSlovenia(j)).toBe(true);
  });

  it('drops a job restricted to countries without Slovenia', () => {
    expect(isOpenToSlovenia(job({ locationRestrictions: countries('United States') }))).toBe(false);
  });

  it('matches Slovenia by ISO code too', () => {
    expect(isOpenToSlovenia(job({ locationRestrictions: [{ name: 'Republic of Slovenia', alpha2: 'SI' }] })))
      .toBe(true);
  });

  it('drops a worldwide job tied to American time zones', () => {
    expect(isOpenToSlovenia(job({ locationRestrictions: [], timezoneRestrictions: [-8, -7, -6, -5] })))
      .toBe(false);
  });

  it('keeps a job whose time zones overlap CET', () => {
    expect(isOpenToSlovenia(job({ locationRestrictions: [], timezoneRestrictions: [-5, -4, -3, -2] })))
      .toBe(true);
  });
});

describe('isFresh', () => {
  it('keeps jobs updated within 30 days', () => {
    expect(isFresh(harris, NOW)).toBe(true);
    expect(isFresh(ableVentures, NOW)).toBe(true); // 27 days old
  });

  it('drops jobs last updated over 30 days ago', () => {
    expect(isFresh(infuse, NOW)).toBe(false); // 2026-09-23
    expect(isFresh(pulitzer, NOW)).toBe(false); // 2026-09-06
  });

  it('drops a job past its listing expiry', () => {
    expect(isFresh(ableVentures, new Date('2026-11-05T00:00:00Z'))).toBe(false);
  });

  it('drops a job without a date', () => {
    expect(isFresh(job({ pubDate: null }), NOW)).toBe(false);
  });
});

describe('formatSalary', () => {
  it('formats a range with currency and period', () => {
    expect(formatSalary(pulitzer)).toBe('54,500–62,000 USD/year');
    expect(formatSalary(airalo)).toBe('1,092,400–1,638,600 PHP/year');
  });

  it('formats one-sided and single amounts', () => {
    expect(formatSalary(job({ minSalary: 40, maxSalary: null, currency: 'EUR', salaryPeriod: 'hourly' })))
      .toBe('from 40 EUR/hour');
    expect(formatSalary(job({ minSalary: null, maxSalary: 3000, currency: 'EUR', salaryPeriod: 'monthly' })))
      .toBe('up to 3,000 EUR/month');
    expect(formatSalary(job({ minSalary: 60000, maxSalary: 60000, currency: 'GBP', salaryPeriod: 'annual' })))
      .toBe('60,000 GBP/year');
  });

  it('is null when no amount is published, even with a currency', () => {
    expect(formatSalary(ableVentures)).toBeNull();
  });
});

describe('sourceIdFromGuid', () => {
  it('uses the company/slug path of the canonical URL', () => {
    expect(sourceIdFromGuid(harris.guid)).toBe('harris/talent-development-learning-specialist-f-m-d');
  });

  it('falls back to the guid itself', () => {
    expect(sourceIdFromGuid('abc-123')).toBe('abc-123');
  });
});

describe('toRawJob', () => {
  const raw = toRawJob(airalo);

  it('maps identity and attribution fields', () => {
    expect(raw.source).toBe('himalayas');
    expect(raw.sourceId).toBe('airalo/training-specialist');
    // The API terms require the applicationLink, unchanged.
    expect(raw.url).toBe('https://himalayas.app/companies/airalo/jobs/training-specialist?utm_source=api');
    expect(raw.title).toBe('Training Specialist');
    expect(raw.company).toBe('Airalo');
  });

  it('maps location, work mode and date', () => {
    expect(raw.location).toBe('148 countries incl. Slovenia');
    expect(raw.workModeRaw).toBe('Remote');
    expect(raw.country).toBeNull();
    expect(raw.postedAt).toBe('2026-11-01');
  });

  it('strips the description to plain text', () => {
    expect(raw.description.length).toBeGreaterThan(200);
    expect(raw.description).not.toMatch(/<[a-z/]/i);
  });

  it('maps the structured extras', () => {
    expect(raw.salary).toBe('1,092,400–1,638,600 PHP/year');
    expect(raw.experienceRaw).toBe('Mid-level');
    expect(raw.workTimeRaw).toBe('Full Time');
    expect(raw.employmentRaw).toBeNull();
    expect(raw.occupation).toBe('Training Specialist');
    expect(raw.deadline).toBeNull();
  });

  it('keeps only the broad parent categories as tags', () => {
    expect(toRawJob(pulitzer).tags).toEqual(['Product', 'Operations']);
    expect(raw.tags).toEqual([]);
  });

  it('pins a Slovenia-only job to SI', () => {
    expect(toRawJob(infuse).country).toBe('SI');
    expect(toRawJob(infuse).location).toBe('Slovenia');
  });

  it('treats a contractor role as an employment type, not a working time', () => {
    const r = toRawJob(goFluent);
    expect(r.employmentRaw).toBe('Contractor');
    expect(r.workTimeRaw).toBeNull();
  });

  it('joins multiple seniority levels', () => {
    expect(toRawJob(job({ seniority: ['Entry-level', 'Mid-level'] })).experienceRaw)
      .toBe('Entry-level, Mid-level');
  });
});

describe('selectJobs', () => {
  it('keeps the fresh, eligible postings only', () => {
    const kept = selectJobs(jobs, NOW);
    expect(kept.map((j) => j.company)).toEqual(['Harris', 'Airalo', 'Able Ventures', 'goFLUENT']);
  });
});

describe('searchTerms', () => {
  it('drives the queries from the profile, within the request cap', () => {
    const terms = searchTerms();
    expect(terms.length).toBeGreaterThan(0);
    expect(terms.length).toBeLessThanOrEqual(MAX_QUERIES);
  });

  it('de-duplicates without regard to case and drops blanks', () => {
    expect(searchTerms(['E-learning', 'e-learning ', '', 'edtech'])).toEqual(['E-learning', 'edtech']);
  });

  it('caps the number of queries', () => {
    const many = Array.from({ length: 30 }, (_, i) => `term ${i}`);
    expect(searchTerms(many)).toHaveLength(MAX_QUERIES);
  });
});

describe('buildSearchUrl', () => {
  it('searches jobs open to Slovenia, best matches first', () => {
    expect(buildSearchUrl('learning and development')).toBe(
      'https://himalayas.app/jobs/api/search?q=learning+and+development&country=Slovenia&sort=relevant',
    );
  });
});
