import { describe, it, expect } from 'vitest';
import { buildExport, dedupe, sameAd, titleKey, companyKey } from '../src/export.js';
import type { Job } from '../src/types.js';

const job = (over: Partial<Job>): Job => ({
  id: over.id ?? Math.random().toString(16).slice(2), source: 'zrsz', sourceId: '1',
  url: 'https://x/1', title: 'Koordinator izobraževanj', company: 'Acme d.o.o.',
  location: 'Ljubljana', postedAt: '2026-10-20', description: '', tags: [],
  area: 'ld', areas: 'ld', workMode: 'onsite', employmentType: 'unknown',
  locationClass: 'ljubljana', flags: '', seniority: 'unknown', minYears: null, score: 60,
  reasons: '[]', scoreParts: '{}', firstSeenAt: '2026-10-21T17:00:00.000Z',
  lastSeenAt: '2026-10-21T17:00:00.000Z', ...over,
});

describe('titleKey and companyKey', () => {
  it('strips gender markers, codes and punctuation from titles', () => {
    expect(titleKey('KOORDINATOR IZOBRAŽEVANJ - M/Ž')).toBe('koordinator izobrazevanj');
    expect(titleKey('Koordinator izobraževanj (m/ž)')).toBe('koordinator izobrazevanj');
  });

  it('strips legal forms from companies', () => {
    expect(companyKey('ACME, d.o.o.')).toBe(companyKey('Acme d.o.o.'));
  });
});

describe('sameAd', () => {
  it('matches one ad on two portals despite case and gender markers', () => {
    expect(sameAd(
      job({ source: 'zrsz', title: 'KOORDINATOR IZOBRAŽEVANJ - M/Ž', company: 'ACME D.O.O., LJUBLJANA' }),
      job({ source: 'mojedelo', title: 'Koordinator izobraževanj (m/ž)', company: 'Acme d.o.o.' }),
    )).toBe(true);
  });

  it('matches a reworded long title even when the employer is named differently', () => {
    expect(sameAd(
      job({ source: 'zrsz', title: 'Pedagog andragog VII/2-II (šifra DM 8085) v Prevzgojnem domu Radeče', company: 'Uprava RS za izvrševanje kazenskih sankcij' }),
      job({ source: 'linkedin', title: 'Pedagog andragog VII/2 -II v Prevzgojnem domu Radeče (šifra DM 8085)', company: 'Vlada Republike Slovenije' }),
    )).toBe(true);
  });

  it('matches the live ZRSZ and LinkedIn copies of one public-sector ad', () => {
    expect(sameAd(
      job({ source: 'zrsz', title: 'Pedagog andragog VII/2-II (šifra DM 8085) v Prevzgojnem domu Radeče, Sektorju za tretma, Oddelku za izobraževanje - M/Ž', company: 'UPRAVA RS ZA IZVRŠEVANJE KAZENSKIH SANKCIJ' }),
      job({ source: 'linkedin', title: 'Pedagog andragog VII/2 -II v Prevzgojnem domu Radeče (šifra DM 8085) | Uprava Republike Slovenije za izvrševanje kazenskih sankcij (Ministrstvo za pravosodje)', company: 'Vlada Republike Slovenije' }),
    )).toBe(true);
  });

  it('keeps the same short title at two employers apart', () => {
    expect(sameAd(
      job({ source: 'zrsz', title: 'Project Coordinator', company: 'Alpha' }),
      job({ source: 'mojedelo', title: 'Project Coordinator', company: 'Beta' }),
    )).toBe(false);
  });

  it('keeps the same title at two ljudske univerze apart', () => {
    expect(sameAd(
      job({ source: 'zrsz', title: 'Organizator izobraževanja odraslih', company: 'Ljudska univerza Kranj' }),
      job({ source: 'mojedelo', title: 'Organizator izobraževanja odraslih', company: 'Ljudska univerza Ajdovščina' }),
    )).toBe(false);
  });

  it('keeps the same long title at two named employers apart when it is not near-identical', () => {
    expect(sameAd(
      job({ source: 'zrsz', title: 'Strokovni sodelavec za izobraževanje', company: 'Mestna občina Ljubljana' }),
      job({ source: 'mojedelo', title: 'Strokovni sodelavec za izobraževanje', company: 'Občina Domžale' }),
    )).toBe(false);
  });

  it('does not treat two missing employers as the same one', () => {
    expect(sameAd(job({ source: 'zrsz', company: null }), job({ source: 'mojedelo', company: null }))).toBe(false);
  });

  it('does not merge the same title posted a month apart', () => {
    expect(sameAd(job({ source: 'zrsz', postedAt: '2026-09-01' }), job({ source: 'mojedelo', postedAt: '2026-10-20' })))
      .toBe(false);
  });

  it('never merges two postings from the same source', () => {
    expect(sameAd(job({ source: 'zrsz' }), job({ source: 'zrsz' }))).toBe(false);
  });
});

describe('dedupe', () => {
  it('keeps one entry naming every portal, details from the richest copy', () => {
    const merged = dedupe([
      job({ id: 'a', source: 'zrsz', url: 'https://zrsz/1', description: 'kratko', deadline: '2026-11-20' }),
      job({ id: 'b', source: 'mojedelo', url: 'https://mojedelo/1', description: 'precej daljši opis oglasa', salary: '2.000 € bruto', score: 70 }),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.ids.sort()).toEqual(['a', 'b']);
    expect(merged[0]!.sources.map((s) => s.source)).toEqual(['mojedelo', 'zrsz']);
    expect(merged[0]!.deadline).toBe('2026-11-20');
    expect(merged[0]!.salary).toBe('2.000 € bruto');
    expect(merged[0]!.score).toBe(70);
  });

  it('keeps the first-seen copy\'s id when a richer copy joins later', () => {
    const merged = dedupe([
      job({ id: 'early', source: 'zrsz', description: 'kratko', firstSeenAt: '2026-10-20T17:00:00.000Z' }),
      job({ id: 'late', source: 'mojedelo', description: 'precej daljši opis', firstSeenAt: '2026-10-22T17:00:00.000Z' }),
    ]);
    expect(merged[0]!.id).toBe('early');
  });

  it('never chains two postings from one portal together through a third', () => {
    const merged = dedupe([
      job({ id: 'z1', source: 'zrsz', title: 'Koordinator izobraževanj', company: 'Acme' }),
      job({ id: 'z2', source: 'zrsz', title: 'Koordinator izobraževanj', company: 'Acme' }),
      job({ id: 'm1', source: 'mojedelo', title: 'Koordinator izobraževanj', company: 'Acme' }),
    ]);
    expect(merged).toHaveLength(2);
  });

  it('keeps the earliest posting date of the copies', () => {
    const merged = dedupe([
      job({ source: 'zrsz', postedAt: '2026-10-22' }),
      job({ source: 'mojedelo', postedAt: '2026-10-20' }),
    ]);
    expect(merged[0]!.postedAt).toBe('2026-10-20');
  });
});

describe('buildExport', () => {
  it('leaves out postings older than the window and sorts by score', () => {
    const file = buildExport([
      job({ id: 'old', title: 'Old one', postedAt: '2026-08-01' }),
      job({ id: 'low', title: 'Low one', score: 40 }),
      job({ id: 'high', title: 'High one', score: 80 }),
    ], [], '2026-11-02T17:00:00.000Z');
    expect(file.jobs.map((j) => j.id)).toEqual(['high', 'low']);
    expect(file.areas.length).toBe(5);
  });

  it('publishes no ad text, only metadata and our own notes', () => {
    const file = buildExport([job({ description: 'Full advert text that must not be republished.' })], [],
      '2026-11-02T17:00:00.000Z');
    expect(JSON.stringify(file)).not.toContain('Full advert text');
  });
});
