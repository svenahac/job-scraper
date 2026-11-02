import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  parseListPage, parseFeed, parseDetail, parseJobHref, buildJob, orderForDetail, tidyTitle,
} from '../../src/sources/eucareers.js';

const listHtml = readFileSync('tests/fixtures/eucareers-list.html', 'utf8');
const feedXml = readFileSync('tests/fixtures/eucareers-feed.xml', 'utf8');
const detailHtml = readFileSync('tests/fixtures/eucareers-detail.html', 'utf8');
const detailLinkHtml = readFileSync('tests/fixtures/eucareers-detail-link.html', 'utf8');

describe('parseJobHref', () => {
  it('drops the language suffix from the id but keeps it in the URL', () => {
    expect(parseJobHref('/jobs/administrative-agent-16_fr?prefLang=en')).toEqual({
      id: 'administrative-agent-16',
      url: 'https://eu-careers.europa.eu/jobs/administrative-agent-16_fr',
    });
    expect(parseJobHref('https://eu-careers.europa.eu/jobs/hr-officer_en')!.id).toBe('hr-officer');
    expect(parseJobHref('/jobs_en')).toBeNull();
  });
});

describe('tidyTitle', () => {
  it('collapses a repeated standard title', () => {
    expect(tidyTitle('IT Officer - IT Officer - Access Management')).toBe('IT Officer - Access Management');
    expect(tidyTitle('Administrative Agent - Gestion des ressources humaines'))
      .toBe('Administrative Agent - Gestion des ressources humaines');
    expect(tidyTitle('HR Officer')).toBe('HR Officer');
  });
});

describe('parseListPage', () => {
  const { items, lastPage } = parseListPage(listHtml);
  const byId = new Map(items.map((i) => [i.id, i]));

  it('reads every vacancy card', () => {
    expect(items.map((i) => i.id)).toEqual([
      'learning-and-development-officer', 'procurement-officer', 'programme-officer-1',
      'hr-officer', 'administrative-agent-16',
    ]);
  });

  it('reads the last page number from the pager', () => {
    expect(lastPage).toBe(6);
  });

  it('reads title, institution, deadline, contract, grade and location', () => {
    expect(byId.get('learning-and-development-officer')).toMatchObject({
      url: 'https://eu-careers.europa.eu/jobs/learning-and-development-officer_en',
      title: 'Learning and Development Officer',
      institution: 'European Centre for Disease Prevention and Control (ECDC)',
      deadline: '2026-11-04',
      contractType: 'Temporary staff',
      grade: 'AST 4',
      location: 'Stockholm, Sweden',
    });
  });

  it('takes the deadline as the page states it, not its UTC timestamp', () => {
    // datetime="2026-11-06T22:59:00+00:00" is 23:59 on 6 November in Brussels.
    expect(byId.get('hr-officer')!.deadline).toBe('2026-11-06');
  });

  it('copes with a card that states no grade (ACER, Ljubljana)', () => {
    expect(byId.get('procurement-officer')).toMatchObject({
      institution: 'Agency for the Cooperation of Energy Regulators (ACER)',
      contractType: 'Temporary staff',
      grade: null,
      location: 'Ljubljana, Slovenia',
    });
  });

  it('returns nothing for an empty body', () => {
    expect(parseListPage('')).toEqual({ items: [], lastPage: 0 });
  });
});

describe('parseFeed', () => {
  const items = parseFeed(feedXml);
  const byId = new Map(items.map((i) => [i.id, i]));

  it('reads every item', () => {
    expect(items).toHaveLength(4);
  });

  it('reads date, reference, domain, grade, contract and standard title', () => {
    expect(byId.get('hr-officer')).toMatchObject({
      reference: 'EMA/CA/11428',
      postedAt: '2026-10-30',
      domain: 'Human Resources',
      grades: ['FG IV'],
      contractType: 'Contract staff',
      occupation: 'HR Officer',
    });
    expect(byId.get('hr-officer')!.summary).toMatch(/^EMA is looking for an HR Officer/);
  });

  it('keeps every grade of a range', () => {
    expect(byId.get('document-management-officer')!.grades).toEqual(['AST 1', 'AST 3']);
  });

  it('drops a summary that is only a link to the agency site', () => {
    expect(byId.get('senior-specialist-head-team-247-operational-centre')!.summary).toBe('');
  });

  it('matches French-only vacancies to their list card', () => {
    expect(byId.get('administrative-agent-16')!.domain).toBe('Buildings and Supplies');
  });
});

describe('parseDetail', () => {
  it('reads the structured fields, the summary and the vacancy-notice date', () => {
    expect(parseDetail(detailHtml)).toEqual({
      reference: 'SG/COM/2026/1415',
      domain: 'Information and document management',
      unit: 'SG.A.5',
      department: 'SG',
      summary: expect.stringMatching(/^A position as Team Leader/),
      noticeDate: '2026-10-31',
    });
  });

  it('ignores the "<title> - <agency>" fallback summary', () => {
    expect(parseDetail(detailLinkHtml)).toMatchObject({
      reference: 'ECDC/AST4/2026/RMS-LDO',
      domain: 'Human Resources',
      summary: '',
      noticeDate: null,
    });
  });
});

describe('buildJob', () => {
  const { items } = parseListPage(listHtml);
  const byId = new Map(items.map((i) => [i.id, i]));
  const feed = new Map(parseFeed(feedXml).map((f) => [f.id, f]));

  it('merges a list card with its feed item', () => {
    const job = buildJob(byId.get('hr-officer')!, feed.get('hr-officer'));
    expect(job).toMatchObject({
      source: 'eucareers',
      sourceId: 'hr-officer',
      url: 'https://eu-careers.europa.eu/jobs/hr-officer_en',
      title: 'HR Officer',
      company: 'European Medicines Agency (EMA)',
      location: 'Amsterdam, Netherlands',
      country: 'NL',
      postedAt: '2026-10-30',
      deadline: '2026-11-06',
      employmentRaw: 'Contract staff',
      salary: 'EU grade FG IV',
      occupation: 'HR Officer',
      tags: ['Human Resources', 'Contract staff'],
      international: true,
    });
    expect(job.description).toContain('Domain: Human Resources.');
    expect(job.description).toContain('Reference: EMA/CA/11428.');
  });

  it('merges a list card with its detail page', () => {
    const job = buildJob(byId.get('learning-and-development-officer')!, undefined,
      parseDetail(detailLinkHtml));
    expect(job).toMatchObject({ country: 'SE', postedAt: null, tags: ['Human Resources', 'Temporary staff'] });
    expect(job.description).toMatch(/Domain: Human Resources\./);
    expect(job.description).toMatch(/Reference: ECDC\/AST4\/2026\/RMS-LDO\./);
  });

  it('reads a French country name', () => {
    expect(buildJob(byId.get('administrative-agent-16')!).country).toBe('BE');
  });

  it('places ACER in Slovenia', () => {
    expect(buildJob(byId.get('procurement-officer')!).country).toBe('SI');
  });

  it('returns an empty description when neither feed nor detail was read', () => {
    expect(buildJob(byId.get('programme-officer-1')!).description).toBe('');
  });
});

describe('orderForDetail', () => {
  it('puts the latest deadline first', () => {
    const { items } = parseListPage(listHtml);
    const ordered = orderForDetail(items).map((i) => i.deadline);
    expect(ordered).toEqual([...ordered].sort().reverse());
  });

  it('puts long-running seconded-national-expert calls last', () => {
    const { items } = parseListPage(listHtml);
    const sne = { ...items[0]!, id: 'sne', contractType: 'Seconded national experts', deadline: '2031-12-31' };
    const ordered = orderForDetail([sne, ...items]);
    expect(ordered[ordered.length - 1]!.id).toBe('sne');
  });
});
