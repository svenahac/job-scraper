import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  parseSearchPage, parseDetail, selectItems, connectionPointOf, describeLocation,
  describeSchedule, describeOffering, formatSalary, formatExperience, formatLanguages,
  buildSearchBody, buildDetailUrl, buildJobUrl, toRawJob, QUERIES, PAGE_SIZE,
  ZRSZ_CONNECTION_POINT,
} from '../../src/sources/eures.js';
import type { EuresItem } from '../../src/sources/eures.js';

const load = (name: string): unknown =>
  JSON.parse(readFileSync(`tests/fixtures/${name}`, 'utf8'));

/** The remote query, captured 2026-11-02. */
const remote = parseSearchPage(load('eures-search.json'));
/** All of Slovenia, most recent first: HZZ, BA, then the ZRSZ mirror. */
const slovenia = parseSearchPage(load('eures-search-si.json'));
/** Jobsplus Malta: languages, experience, deadline and a monthly salary. */
const malta = parseDetail(load('eures-detail.json'));
/** Germany's BA: remote work allowed and a yearly salary range. */
const berlin = parseDetail(load('eures-detail-remote.json'));

const byId = (items: EuresItem[], id: string): EuresItem => {
  const it = items.find((i) => i.sourceId === id);
  if (!it) throw new Error(`fixture has no ${id}`);
  return it;
};
const bonn = byId(remote.items, 'MTIyMDYtMTM5MTAzMDEtUyAx');
const tarbes = byId(remote.items, 'ODQ2MDkxOCA5');
const veghel = byId(remote.items, 'NWQzODU2YzItNGI3ZS1jOTM0LWUwNjMtNjg5M2IyMGE0ZjNlIDQy');

describe('parseSearchPage', () => {
  it('reads the total and every vacancy', () => {
    expect(remote.total).toBe(72);
    expect(remote.items).toHaveLength(4);
  });

  it('keeps the portal id as the source id', () => {
    expect(bonn.sourceId).toBe('MTIyMDYtMTM5MTAzMDEtUyAx');
  });

  it('cleans stray control characters and runs of spaces out of the title', () => {
    expect(bonn.title).toBe('Koordinator Transportplanung & Disposition (gn) hybrides Arbeiten '
      + '(Remote & Präsenz) (Speditionskaufmann/-frau)');
    expect(slovenia.items[0]!.title).toBe('ZAVARIVAČ/ZAVARIVAČICA');
  });

  it('reads the employer, and null for a missing or placeholder one', () => {
    expect(bonn.company).toBe('PS Direkt GmbH Co. KG');
    expect(veghel.company).toBeNull();
    expect(tarbes.company).toBeNull();
  });

  it('turns the creation timestamp into an ISO date', () => {
    expect(bonn.postedAt).toBe('2026-10-28');
    expect(tarbes.postedAt).toBe('2026-11-01');
  });

  it('reads the country as ISO alpha-2 and names it as the location', () => {
    expect(bonn.country).toBe('DE');
    expect(bonn.location).toBe('Germany');
    expect(veghel.location).toBe('Netherlands');
  });

  it('labels the schedule and the offering type in EURES wording', () => {
    expect(bonn.workTimeRaw).toBe('Full-time');
    expect(veghel.workTimeRaw).toBe('Part-time, Flexible, Full-time');
    expect(tarbes.workTimeRaw).toBeNull();
    expect(bonn.employmentRaw).toBe('Direct hire');
    expect(veghel.employmentRaw).toBe('Temporary');
  });

  it('keeps the list body for vacancies whose detail is not fetched', () => {
    expect(tarbes.description).toContain('Rémunération');
  });

  it('decodes the connection point from the id', () => {
    expect(bonn.connectionPoint).toBe(1);
    expect(tarbes.connectionPoint).toBe(9);
    expect(veghel.connectionPoint).toBe(42);
  });

  it('returns nothing for an unexpected payload', () => {
    expect(parseSearchPage({})).toEqual({ total: 0, items: [] });
    expect(parseSearchPage(null)).toEqual({ total: 0, items: [] });
  });
});

describe('connectionPointOf', () => {
  it('reads the number after the reference', () => {
    expect(connectionPointOf('MjkyOTIzNCAxOQ')).toBe(19);
    expect(connectionPointOf('MzQ5MzA2NSAxNA')).toBe(ZRSZ_CONNECTION_POINT);
  });

  it('returns null for an id of another shape', () => {
    expect(connectionPointOf('not-an-id')).toBeNull();
  });
});

describe('selectItems', () => {
  it("drops ZRSZ's mirrored vacancies and keeps other services' Slovenian ones", () => {
    const kept = selectItems(slovenia.items).map((i) => i.sourceId);
    expect(kept).toEqual(['MjkyOTIzNCAxOQ', 'MTM4ODQtMzMyNzM3LVMgMQ']);
  });

  it('keeps a vacancy found by both queries once', () => {
    expect(selectItems([bonn, bonn, tarbes])).toHaveLength(2);
  });
});

describe('describeLocation', () => {
  it('names the Slovenian region, so Osrednjeslovenska reads as Ljubljana', () => {
    expect(describeLocation({ SI: ['SI041'] }))
      .toEqual({ location: 'Osrednjeslovenska, Slovenia', country: 'SI' });
  });

  it('falls back to the country when no region is given', () => {
    expect(describeLocation({ SI: [null] })).toEqual({ location: 'Slovenia', country: 'SI' });
  });

  it('maps the NUTS country codes that differ from ISO', () => {
    expect(describeLocation({ EL: ['EL303'] })).toEqual({ location: 'Greece', country: 'GR' });
  });

  it('lists every country and takes the first as the country code', () => {
    expect(describeLocation({ AT: ['AT130'], DE: [] }))
      .toEqual({ location: 'Austria; Germany', country: 'AT' });
  });

  it('returns nulls for a missing map', () => {
    expect(describeLocation(undefined)).toEqual({ location: null, country: null });
  });
});

describe('describeSchedule / describeOffering', () => {
  it('passes unknown codes through and drops "any"', () => {
    expect(describeSchedule(['any'])).toBeNull();
    expect(describeSchedule(['shift'])).toBe('shift');
    expect(describeOffering('contracttohire')).toBe('Contract to hire');
    expect(describeOffering(null)).toBeNull();
  });
});

describe('parseDetail', () => {
  it('reads the deadline as an ISO date', () => {
    expect(malta.deadline).toBe('2026-11-23');
    expect(berlin.deadline).toBeNull();
  });

  it('formats the salary range with currency and interval', () => {
    expect(malta.salary).toBe('1,473–1,733.33 EUR per month');
    expect(berlin.salary).toBe('35,000–50,000 EUR per year');
  });

  it('reads the required experience', () => {
    expect(malta.experienceRaw).toBe('1 year');
    expect(berlin.experienceRaw).toBeNull();
  });

  it('reads the language requirement once per language, with its CEFR level', () => {
    expect(malta.languagesRaw).toBe('English (B1)');
    expect(berlin.languagesRaw).toBeNull();
  });

  it('passes remote work on only when the vacancy allows it', () => {
    expect(berlin.workModeRaw).toBe('Remote work possible');
    expect(malta.workModeRaw).toBeNull();
  });

  it('returns the body as plain text', () => {
    expect(malta.description).toContain('employee training programmes');
    expect(berlin.description).toContain('100 % Homeoffice');
    expect(berlin.description).not.toMatch(/<[a-z]/i);
    expect(berlin.description).not.toContain('&amp;');
  });

  it('returns empty fields for an empty payload', () => {
    expect(parseDetail({})).toEqual({
      description: '', deadline: null, salary: null, experienceRaw: null,
      languagesRaw: null, workModeRaw: null,
    });
  });
});

describe('formatSalary', () => {
  const pay = (s: Record<string, unknown>) =>
    ({ description: '', salaries: [{ currencyCode: 'EUR', payingIntervalCode: 'month', ...s }] });

  it('handles a single figure and open-ended ranges', () => {
    expect(formatSalary(pay({ minimumSalary: 2000, maximumSalary: 2000 }))).toBe('2,000 EUR per month');
    expect(formatSalary(pay({ minimumSalary: 2000, maximumSalary: null }))).toBe('from 2,000 EUR per month');
    expect(formatSalary(pay({ minimumSalary: null, maximumSalary: 3000 }))).toBe('up to 3,000 EUR per month');
  });

  it("falls back to the package's own wording, else null", () => {
    expect(formatSalary({ description: '<p>Volgens cao</p>', salaries: [{ minimumSalary: null }] }))
      .toBe('Volgens cao');
    expect(formatSalary({ description: '', salaries: [] })).toBeNull();
    expect(formatSalary(null)).toBeNull();
  });
});

describe('formatExperience', () => {
  const exp = (value: number, unitCode: string) =>
    ({ requiredExperiences: [{ measure: { value, unitCode } }] });

  it('states a year or more in whole years, the lower bound', () => {
    expect(formatExperience(exp(12, 'month'))).toBe('1 year');
    expect(formatExperience(exp(120, 'month'))).toBe('10 years');
    expect(formatExperience(exp(18, 'month'))).toBe('1 year');
  });

  it('keeps months under a year', () => {
    expect(formatExperience(exp(6, 'month'))).toBe('6 months');
  });

  it('uses the summary field when there are no measures', () => {
    expect(formatExperience({ requiredYearsOfExperience: 3 })).toBe('3 years');
    expect(formatExperience({ requiredYearsOfExperience: 0 })).toBeNull();
  });
});

describe('formatLanguages', () => {
  it('keeps a desired-only language apart as a nice-to-have', () => {
    expect(formatLanguages([
      { languageCode: 'en', requiredSkillLevel: 'b2', desiredSkillLevel: null },
      { languageCode: 'en', requiredSkillLevel: 'c1', desiredSkillLevel: null },
      { languageCode: 'fr', requiredSkillLevel: null, desiredSkillLevel: 'b1' },
      { languageCode: 'nl', requiredSkillLevel: null, desiredSkillLevel: null },
    ])).toEqual({ required: 'English (C1), Dutch', niceToHave: 'French (B1)' });
  });

  it('returns nulls for no languages', () => {
    expect(formatLanguages([])).toEqual({ required: null, niceToHave: null });
  });
});

describe('queries', () => {
  it('asks for the newest week, a full page, in titles only', () => {
    const body = buildSearchBody(QUERIES[0]!, 2);
    expect(body['page']).toBe(2);
    expect(body['resultsPerPage']).toBe(PAGE_SIZE);
    expect(body['sortSearch']).toBe('MOST_RECENT');
    expect(body['publicationPeriod']).toBe('LAST_WEEK');
    expect(body['locationCodes']).toEqual(['si']);
  });

  it('pairs a remote word with a topic word for the EU-wide query', () => {
    const q = QUERIES.find((x) => x.name === 'remote')!;
    expect(q.locationCodes).toEqual([]);
    expect(q.keywords).toHaveLength(2);
    expect(q.keywords.every((k) => k.specificSearchCode === 'TITLE')).toBe(true);
    expect(q.keywords[0]!.keyword).toContain('remote');
  });
});

describe('urls', () => {
  it('builds the portal job page and the detail endpoint', () => {
    expect(buildJobUrl('MjkyOTIzNCAxOQ'))
      .toBe('https://europa.eu/eures/portal/jv-se/jv-details/MjkyOTIzNCAxOQ?lang=en');
    expect(buildDetailUrl('MjkyOTIzNCAxOQ')).toBe('https://europa.eu/eures/api/jv-searchengine'
      + '/public/jv/id/MjkyOTIzNCAxOQ?requestLang=en&preferredLang=en');
  });
});

describe('toRawJob', () => {
  it('merges the list fields with the detail', () => {
    const job = toRawJob(bonn, berlin, '');
    expect(job).toMatchObject({
      source: 'eures',
      sourceId: bonn.sourceId,
      url: buildJobUrl(bonn.sourceId),
      title: bonn.title,
      company: 'PS Direkt GmbH Co. KG',
      location: 'Germany',
      country: 'DE',
      postedAt: '2026-10-28',
      salary: '35,000–50,000 EUR per year',
      workModeRaw: 'Remote work possible',
      employmentRaw: 'Direct hire',
      workTimeRaw: 'Full-time',
    });
    expect(job.description).toBe(berlin.description);
    expect(job.international).toBeUndefined();
  });

  it('takes the given description and leaves detail fields null without a detail', () => {
    const job = toRawJob(tarbes, null, '');
    expect(job.description).toBe('');
    expect(job.deadline).toBeNull();
    expect(job.salary).toBeNull();
  });
});
