import { describe, it, expect } from 'vitest';
import type { RawJob, Job, Seniority } from '../src/types.js';

describe('types', () => {
  it('models a raw job from a source', () => {
    const raw: RawJob = {
      source: 'slotech',
      sourceId: '8052',
      url: 'https://slo-tech.com/delo/8052',
      title: 'Frontend Developer',
      company: 'Acme d.o.o.',
      location: 'Ljubljana',
      postedAt: '2026-08-18',
      description: 'Iščemo razvijalca.',
      tags: ['react'],
    };
    expect(raw.source).toBe('slotech');
  });

  it('models a classified job with provenance timestamps', () => {
    const seniority: Seniority = 'junior';
    const job: Job = {
      source: 'slotech',
      sourceId: '8052',
      url: 'https://slo-tech.com/delo/8052',
      title: 'Frontend Developer',
      company: 'Acme d.o.o.',
      location: 'Ljubljana',
      postedAt: '2026-08-18',
      description: 'Iščemo razvijalca.',
      tags: ['react'],
      id: 'abc123',
      area: '',
      areaRank: 0,
      areas: '',
      workMode: 'unknown',
      employmentType: 'unknown',
      locationTier: 'other',
      flags: '',
      score: 0,
      seniority,
      firstSeenAt: '2026-08-21T17:00:00.000Z',
      lastSeenAt: '2026-08-21T17:00:00.000Z',
    };
    expect(job.seniority).toBe('junior');
  });
});
