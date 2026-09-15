import { describe, it, expect } from 'vitest';
import {
  matchAreas, detectWorkMode, detectLocationTier, detectEmploymentType,
  scoreFor, classify, isWanted,
} from '../src/classify.js';
import type { RawJob } from '../src/types.js';

const raw = (over: Partial<RawJob>): RawJob => ({
  source: 'test', sourceId: '1', url: 'https://x', title: '', company: null,
  location: null, postedAt: null, description: '', tags: [],
  employmentRaw: null, workTimeRaw: null, occupation: null, ...over,
});

describe('matchAreas', () => {
  it('matches each area from its title', () => {
    const cases: Array<[string, string]> = [
      ['Specialist za izobraževanje in razvoj kadrov (m/ž)', 'ld'],
      ['Projektni koordinator (m/ž)', 'projects'],
      ['HR Specialist', 'hr'],
      ['Andragog (m/ž)', 'adult-education'],
      ['Koordinator mednarodnih projektov Erasmus+', 'eu-projects'],
      ['Employer Branding Specialist', 'employer-brand'],
      ['Community Manager (m/ž)', 'content-comms'],
      ['Koordinator dogodkov (m/ž)', 'events'],
    ];
    for (const [title, key] of cases) {
      expect(matchAreas(title, [], '')).toContain(key);
    }
  });

  it('matches a keyword buried in the body', () => {
    expect(matchAreas('Strokovni sodelavec (m/ž)', [], 'Skrbel boš za razvoj zaposlenih.'))
      .toContain('ld');
  });

  it('matches a keyword in a tag', () => {
    expect(matchAreas('Sodelavec (m/ž)', ['Erasmus+'], '')).toContain('eu-projects');
  });

  it('is case insensitive and keeps diacritics', () => {
    expect(matchAreas('IZOBRAŽEVANJE ODRASLIH', [], '')).toContain('adult-education');
  });

  it('returns every matching area, not just the first', () => {
    const areas = matchAreas('Employer Branding & Employee Experience Specialist', [], '');
    expect(areas).toContain('hr');
    expect(areas).toContain('employer-brand');
  });

  it('returns empty for an unrelated role', () => {
    expect(matchAreas('CNC operater (m/ž)', [], 'Delo na stroju.')).toEqual([]);
  });
});

describe('detectWorkMode', () => {
  it('detects remote from the body', () => {
    expect(detectWorkMode('HR Specialist', null, 'Možno delo od doma.')).toBe('remote');
  });

  it('detects hybrid from the body', () => {
    expect(detectWorkMode('HR Specialist', null, 'Hibridno delo, 2 dni v pisarni.')).toBe('hybrid');
  });

  it('prefers hybrid when both markers appear', () => {
    expect(detectWorkMode('HR Specialist', null, 'Hibridno: delo od doma 2 dni.')).toBe('hybrid');
  });

  it('detects remote from the location string', () => {
    expect(detectWorkMode('HR Specialist', 'Slovenia (Remote)', '')).toBe('remote');
  });

  it('is unknown when nothing says', () => {
    expect(detectWorkMode('HR Specialist', 'Ljubljana', '')).toBe('unknown');
  });
});

describe('detectLocationTier', () => {
  it('tiers a Ljubljana location first', () => {
    expect(detectLocationTier('Ljubljana', 'unknown')).toBe('ljubljana');
  });

  it('tiers an Osrednjeslovenska town as ljubljana', () => {
    expect(detectLocationTier('DOMŽALE', 'unknown')).toBe('ljubljana');
  });

  it('tiers a remote job outside Ljubljana as remote', () => {
    expect(detectLocationTier('Maribor', 'remote')).toBe('remote');
  });

  it('prefers ljubljana over remote when both apply', () => {
    expect(detectLocationTier('Ljubljana', 'remote')).toBe('ljubljana');
  });

  it('tiers everything else as other', () => {
    expect(detectLocationTier('Murska Sobota', 'unknown')).toBe('other');
    expect(detectLocationTier(null, 'unknown')).toBe('other');
  });
});

describe('detectEmploymentType', () => {
  it('reads permanent from the raw employment field', () => {
    expect(detectEmploymentType('Nedoločen čas', '40 ur/teden', '', '')).toBe('permanent');
  });

  it('reads fixed-term from the raw employment field', () => {
    expect(detectEmploymentType('Določen čas (opredeljeno v podrobnostih)', '40 ur/teden', '', ''))
      .toBe('fixed-term');
  });

  it('reads part-time from a weekly-hours figure below 35', () => {
    expect(detectEmploymentType('Nedoločen čas', '20 ur/teden', '', '')).toBe('part-time');
  });

  it('reads part-time from the phrase', () => {
    expect(detectEmploymentType(null, null, '', 'Krajši delovni čas.')).toBe('part-time');
  });

  it('falls back to the body when the raw fields are absent', () => {
    expect(detectEmploymentType(null, null, '', 'Zaposlitev za nedoločen čas.')).toBe('permanent');
  });

  it('is unknown when nothing says', () => {
    expect(detectEmploymentType(null, null, 'HR Specialist', '')).toBe('unknown');
  });
});

describe('scoreFor', () => {
  it('scores a rank-1 permanent Ljubljana job highest', () => {
    expect(scoreFor({
      areaRank: 1, locationTier: 'ljubljana', workMode: 'unknown',
      employmentType: 'permanent', flags: [],
    })).toBe(75);
  });

  it('scores a rank-8 job with nothing else at its area points only', () => {
    expect(scoreFor({
      areaRank: 8, locationTier: 'other', workMode: 'unknown',
      employmentType: 'unknown', flags: [],
    })).toBe(12);
  });

  it('awards hybrid points when the tier is other', () => {
    expect(scoreFor({
      areaRank: 1, locationTier: 'other', workMode: 'hybrid',
      employmentType: 'unknown', flags: [],
    })).toBe(58);
  });

  it('subtracts eight per flag', () => {
    expect(scoreFor({
      areaRank: 1, locationTier: 'ljubljana', workMode: 'unknown',
      employmentType: 'permanent', flags: ['a', 'b'],
    })).toBe(59);
  });

  it('never goes below zero', () => {
    expect(scoreFor({
      areaRank: 8, locationTier: 'other', workMode: 'unknown',
      employmentType: 'unknown', flags: ['a', 'b', 'c'],
    })).toBe(0);
  });
});

describe('classify and isWanted', () => {
  it('keeps a matching job and picks its best-ranked area', () => {
    const c = classify(raw({
      title: 'Specialist za razvoj kadrov (m/ž)',
      location: 'Ljubljana',
      employmentRaw: 'Nedoločen čas',
      workTimeRaw: '40 ur/teden',
    }));
    expect(isWanted(c)).toBe(true);
    expect(c.area).toBe('ld');
    expect(c.areaRank).toBe(1);
    expect(c.score).toBe(75);
  });

  it('drops a job that matches no area', () => {
    expect(isWanted(classify(raw({ title: 'CNC operater (m/ž)' })))).toBe(false);
  });

  it('drops a title reject outright', () => {
    expect(isWanted(classify(raw({
      title: 'Komercialist (m/ž)',
      description: 'Projektni koordinator podpira ekipo.',
    })))).toBe(false);
  });

  it('keeps a title reject that is overridden by an area keyword in the title, and flags it', () => {
    const c = classify(raw({ title: 'Vodja projektov - komercialist (m/ž)' }));
    expect(isWanted(c)).toBe(true);
    expect(c.flags.some((f) => f.startsWith('title-reject:'))).toBe(true);
  });

  it('drops student work by title', () => {
    expect(isWanted(classify(raw({ title: 'HR Specialist - študentsko delo' })))).toBe(false);
  });

  it('drops an internship named in the raw employment field', () => {
    expect(isWanted(classify(raw({
      title: 'HR Specialist', employmentRaw: 'Pripravništvo',
    })))).toBe(false);
  });

  it('does NOT drop a job whose body merely says "dobra praksa"', () => {
    const c = classify(raw({
      title: 'HR Specialist', description: 'Sledimo dobrim praksam, dobra praksa je vodilo.',
    }));
    expect(isWanted(c)).toBe(true);
  });

  it('flags administrative duties in the body without dropping the job', () => {
    const c = classify(raw({
      title: 'HR Specialist (m/ž)',
      description: 'Skrbel boš tudi za kadrovske evidence in arhiviranje.',
    }));
    expect(isWanted(c)).toBe(true);
    expect(c.flags.length).toBeGreaterThan(0);
  });

  it('never excludes on seniority', () => {
    const c = classify(raw({
      title: 'Vodja za razvoj kadrov (m/ž)',
      description: 'Zahtevamo vsaj 8 let izkušenj.',
    }));
    expect(c.seniority).toBe('senior');
    expect(isWanted(c)).toBe(true);
  });
});
