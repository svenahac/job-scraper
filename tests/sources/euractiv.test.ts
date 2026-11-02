import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  parseApiJobs, parseFeed, buildJob, mergeJobs, API_URL,
} from '../../src/sources/euractiv.js';

const apiJson = JSON.parse(readFileSync('tests/fixtures/euractiv-jobs.json', 'utf8')) as unknown;
const feedXml = readFileSync('tests/fixtures/euractiv-feed.xml', 'utf8');

describe('parseApiJobs', () => {
  const jobs = parseApiJobs(apiJson);

  it('reads every job in the fixture', () => {
    expect(jobs.map((j) => j.id)).toEqual(['6555', '6529', '6494']);
  });

  it('decodes HTML entities in the title', () => {
    expect(jobs[0]!.title).toBe('Communication & Projects Officer');
  });

  it('takes the publish date from date_gmt', () => {
    expect(jobs[0]!.postedAt).toBe('2026-10-30');
  });

  it('groups embedded taxonomy terms by taxonomy, entities decoded', () => {
    const t = jobs[0]!.terms;
    expect(t['experience']).toEqual(['1-3 Years']);
    expect(t['work-arrangement']).toEqual(['Hybrid']);
    expect(t['language']).toEqual(expect.arrayContaining(['English', 'French']));
    expect(t['industries']).toEqual(['Business & Consumers']);
  });

  it('returns an empty array for a non-array body', () => {
    expect(parseApiJobs({ code: 'rest_no_route' })).toEqual([]);
  });
});

describe('parseFeed', () => {
  const items = parseFeed(feedXml);

  it('reads every item, with the post id from the guid', () => {
    expect(items.map((i) => i.id)).toEqual(['6555', '6529', '6494']);
  });

  it('reads the job: namespace fields', () => {
    expect(items[0]).toMatchObject({
      company: 'European Builders Confederation EBC',
      location: 'Brussels, Belgium',
      deadline: '2026-11-20',
      jobType: 'Full Time',
      postedAt: '2026-10-30',
    });
  });

  it('reads the CDATA body', () => {
    expect(items[0]!.content).toContain('EU-funded projects');
  });

  it('returns an empty array for an empty body', () => {
    expect(parseFeed('')).toEqual([]);
  });
});

describe('buildJob / mergeJobs', () => {
  const jobs = mergeJobs(parseApiJobs(apiJson), parseFeed(feedXml), '2026-11-02');
  const byId = new Map(jobs.map((j) => [j.sourceId, j]));

  it('fills every field the two endpoints offer', () => {
    expect(byId.get('6555')).toMatchObject({
      source: 'euractiv',
      url: 'https://jobs.rapporteur.com/jobs/communication-projects-officer-brussels-hybrid-european-builders-confederation-ebc/',
      title: 'Communication & Projects Officer',
      company: 'European Builders Confederation EBC',
      location: 'Brussels, Belgium',
      country: 'BE',
      postedAt: '2026-10-30',
      deadline: '2026-11-20',
      experienceRaw: '1-3 Years',
      workModeRaw: 'Hybrid',
      workTimeRaw: 'Full Time',
      employmentRaw: null,
      salary: null,
      international: true,
    });
    expect(byId.get('6555')!.languagesRaw).toMatch(/English/);
    expect(byId.get('6555')!.tags).toEqual(['Communication', 'Business & Consumers']);
  });

  it('gives a plain-text description', () => {
    const d = byId.get('6555')!.description;
    expect(d).toContain('European Builders Confederation');
    expect(d).not.toMatch(/<[a-z]/i);
  });

  it('files an internship as the contract, so the classifier can see it', () => {
    expect(byId.get('6529')).toMatchObject({ employmentRaw: 'Internship', workTimeRaw: null });
  });

  it('drops the "Other" location placeholder and keeps the remote arrangement', () => {
    expect(byId.get('6494')).toMatchObject({ location: null, country: null, workModeRaw: 'Remote' });
  });

  it('drops ads whose deadline has passed', () => {
    const later = mergeJobs(parseApiJobs(apiJson), parseFeed(feedXml), '2026-11-17');
    expect(later.map((j) => j.sourceId)).toEqual(['6555']);
  });

  it('still builds a job from the feed alone', () => {
    const [item] = parseFeed(feedXml);
    const job = buildJob(null, item!)!;
    expect(job).toMatchObject({ sourceId: '6555', company: 'European Builders Confederation EBC' });
    expect(job.description.length).toBeGreaterThan(100);
  });
});

describe('API_URL', () => {
  it('asks for every live ad in one page, with taxonomy names embedded', () => {
    expect(API_URL).toContain('per_page=100');
    expect(API_URL).toContain('_embed=wp:term');
  });
});
