import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  parseListPage, parseDetail, parsePosted, parseDeadline, annotate, buildJob, needsDetail,
  LIST_PAGES, type ListPage,
} from '../../src/sources/eurobrussels.js';

const listHtml = readFileSync('tests/fixtures/eurobrussels-list.html', 'utf8');
const detailHtml = readFileSync('tests/fixtures/eurobrussels-detail.html', 'utf8');
const TODAY = '2026-11-02';

describe('parseListPage', () => {
  const cards = parseListPage(listHtml, TODAY);
  const byId = new Map(cards.map((c) => [c.id, c]));

  it('reads every job card and skips the job-alert row', () => {
    expect(cards.map((c) => c.id)).toEqual([
      '298360', '298280', '297970', '297753', '297176', '298437', '298350', '298092', '296659',
    ]);
  });

  it('reads a highlighted card in full', () => {
    expect(byId.get('298360')).toMatchObject({
      url: 'https://www.eurobrussels.com/job_display/298360/Secretary_General_Caritas_Europa_Brussels_Belgium',
      title: 'Secretary General',
      company: 'Caritas Europa',
      location: 'Brussels, Belgium',
      country: 'BE',
      postedAt: '2026-10-29',
      deadline: '2026-11-19',
      salary: null,
    });
    expect(byId.get('298360')!.teaser).toMatch(/^Provide strategic leadership/);
    expect(byId.get('298360')!.tags).toContain('NGO and Political');
  });

  it('reads the salary line and a non-Belgian country from the URL', () => {
    expect(byId.get('298280')).toMatchObject({
      salary: '€ 1,800 per month', location: 'Paris, France', country: 'FR',
    });
    expect(byId.get('298092')).toMatchObject({ location: 'Dublin, Ireland', country: 'IE' });
  });

  it('leaves the country empty for multi-country ads', () => {
    expect(byId.get('297970')).toMatchObject({ country: null, deadline: '2026-12-04' });
    expect(byId.get('297970')!.location).toMatch(/Multiple Countries/);
  });

  it('reads basic ads, which have no logo or teaser', () => {
    expect(byId.get('298437')).toMatchObject({
      title: 'Policy Traineeship', company: 'Airlines for Europe', teaser: '',
    });
  });

  it('turns "N days left" and "Expiring today" into dates', () => {
    expect(byId.get('298350')!.deadline).toBe('2026-11-05');
    expect(byId.get('296659')!.deadline).toBe('2026-11-03');
    expect(byId.get('297176')!.deadline).toBe(TODAY);
  });

  it('leaves the deadline empty when the card states none', () => {
    expect(byId.get('297753')!.deadline).toBeNull();
  });

  it('returns an empty array for an empty body', () => {
    expect(parseListPage('', TODAY)).toEqual([]);
  });
});

describe('parsePosted / parseDeadline', () => {
  it('handles every relative posting phrase', () => {
    expect(parsePosted('Posted today', TODAY)).toBe(TODAY);
    expect(parsePosted('Posted yesterday', TODAY)).toBe('2026-11-01');
    expect(parsePosted('Posted 1 day ago', TODAY)).toBe('2026-11-01');
    expect(parsePosted('Posted 2 weeks ago', TODAY)).toBe('2026-10-19');
    expect(parsePosted('nothing here', TODAY)).toBeNull();
  });

  it('puts a yearless deadline in the right year across New Year', () => {
    expect(parseDeadline('Deadline 5 January', '2026-12-20')).toBe('2027-01-05');
    expect(parseDeadline('Deadline 28 December', '2026-12-20')).toBe('2026-12-28');
    expect(parseDeadline('Deadline 30 June', TODAY)).toBe('2027-06-30');
    expect(parseDeadline('Deadline 19 November 2027', TODAY)).toBe('2027-11-19');
  });
});

describe('parseDetail', () => {
  it('returns the ad body as plain text, without page chrome', () => {
    const { description } = parseDetail(detailHtml);
    expect(description).toMatch(/^Research Support Officer/);
    expect(description).toContain('comparative research');
    expect(description).not.toMatch(/<[a-z]/i);
    expect(description).not.toContain('Share this Job');
  });
});

describe('annotate / buildJob', () => {
  const cards = parseListPage(listHtml, TODAY);
  const page = (path: string): ListPage => LIST_PAGES.find((p) => p.path === path)!;
  const ads = annotate([
    { page: page('/jobs/on-site'), cards },
    { page: page('/jobs/0_-_2_years_experience'), cards: cards.filter((c) => c.id === '298092') },
    { page: page('/jobs/internship'), cards: cards.filter((c) => c.id === '298437') },
    { page: page('/jobs/5_years+_experience'), cards: cards.filter((c) => c.id === '298360') },
  ]);
  const byId = new Map(ads.map((a) => [a.card.id, a]));

  it('lists each ad once, with the labels of every page it was on', () => {
    expect(ads).toHaveLength(cards.length);
    expect(byId.get('298092')).toMatchObject({
      workModes: ['On-site'], experience: ['0 - 2 Years Experience'],
    });
  });

  it('wants detail pages for the 0–4-year bands only', () => {
    expect(needsDetail(byId.get('298092')!.experience)).toBe(true);
    expect(needsDetail(byId.get('298437')!.experience)).toBe(false);
    expect(needsDetail(byId.get('298360')!.experience)).toBe(false);
    expect(needsDetail([])).toBe(true);
  });

  it('builds a full RawJob with the detail body', () => {
    const job = buildJob(byId.get('298092')!, parseDetail(detailHtml));
    expect(job).toMatchObject({
      source: 'eurobrussels',
      sourceId: '298092',
      company: 'Eurofound - The European Foundation for the Improvement of Living & Working Conditions',
      location: 'Dublin, Ireland',
      country: 'IE',
      workModeRaw: 'On-site',
      experienceRaw: '0 - 2 Years Experience',
      employmentRaw: null,
      deadline: '2026-11-16',
      international: true,
    });
    expect(job.description).toContain('comparative research');
  });

  it('returns an empty description while a detail page is still owed', () => {
    expect(buildJob(byId.get('298092')!, undefined).description).toBe('');
  });

  it('keeps the teaser for ads that never get a detail page', () => {
    const senior = buildJob(byId.get('298360')!, undefined);
    expect(senior.description).toMatch(/^Provide strategic leadership/);
    expect(senior.experienceRaw).toBe('5 Years+ Experience');
  });

  it('files internships as the contract', () => {
    expect(buildJob(byId.get('298437')!, undefined)).toMatchObject({
      employmentRaw: 'Internship', experienceRaw: 'Internship',
    });
  });
});

describe('LIST_PAGES', () => {
  it('stays at seven list requests: three workplace and four experience pages', () => {
    expect(LIST_PAGES.filter((p) => p.kind === 'workplace')).toHaveLength(3);
    expect(LIST_PAGES.filter((p) => p.kind === 'experience')).toHaveLength(4);
  });
});
