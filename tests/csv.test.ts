import { describe, it, expect } from 'vitest';
import { CSV_COLUMNS, toCsv } from '../src/csv.js';
import type { Job } from '../src/types.js';

const job = (over: Partial<Job>): Job => ({
  source: 'zrsz', sourceId: '1', url: 'https://x/1', title: 'HR Specialist',
  company: 'Acme', location: 'Ljubljana', postedAt: '2026-09-15', description: '',
  tags: [], employmentRaw: null, workTimeRaw: null, occupation: null,
  id: 'abc', area: 'hr', areaRank: 3, areas: 'hr', workMode: 'hybrid',
  employmentType: 'permanent', flags: '',
  seniority: 'unknown', score: 67,
  firstSeenAt: '2026-09-15T00:00:00.000Z', lastSeenAt: '2026-09-15T00:00:00.000Z',
  ...over,
});

describe('CSV_COLUMNS', () => {
  it('leads with score so the spreadsheet sorts on fit', () => {
    expect(CSV_COLUMNS[0]).toBe('score');
  });

  it('carries the signal columns and no longer carries role_match', () => {
    for (const c of ['area', 'work_mode', 'employment_type', 'areas']) {
      expect(CSV_COLUMNS).toContain(c);
    }
    expect(CSV_COLUMNS).not.toContain('role_match');
  });

  it('leaves out the internal columns that only clutter the spreadsheet', () => {
    for (const c of ['area_rank', 'flags', 'first_seen_at', 'location_tier']) {
      expect(CSV_COLUMNS).not.toContain(c);
    }
  });

  it('omits description, which makes the file unusable in a spreadsheet', () => {
    expect(CSV_COLUMNS).not.toContain('description');
  });
});

describe('toCsv', () => {
  it('writes the score as the first cell of a row', () => {
    const line = toCsv([job({})]).split('\n')[1]!;
    expect(line.startsWith('67,')).toBe(true);
  });

  it('quotes a comma-joined areas cell', () => {
    const line = toCsv([job({ areas: 'ld,hr' })]).split('\n')[1]!;
    expect(line).toContain('"ld,hr"');
  });

  it('does not write flags or the first-seen timestamp', () => {
    const csv = toCsv([job({ flags: 'body:payroll' })]);
    expect(csv).not.toContain('body:payroll');
    expect(csv).not.toContain('2026-09-15T00:00:00.000Z');
  });

  it('writes a header row', () => {
    expect(toCsv([]).trim()).toBe(CSV_COLUMNS.join(','));
  });

  it('omits the description column', () => {
    expect(CSV_COLUMNS).not.toContain('description');
    expect(toCsv([job({ description: 'Dolg opis.' })])).not.toContain('Dolg opis');
  });

  it('quotes and escapes a field containing a comma and a quote', () => {
    const csv = toCsv([job({ company: 'Acme, "The" d.o.o.' })]);
    expect(csv).toContain('"Acme, ""The"" d.o.o."');
  });

  it('renders an empty cell for a null field', () => {
    const csv = toCsv([job({ company: null, postedAt: null })]);
    const cells = csv.trim().split('\n')[1]!.split(',');
    expect(cells).toContain('');
  });

  it('writes one row per job', () => {
    const csv = toCsv([job({ id: 'a' }), job({ id: 'b' })]);
    expect(csv.trim().split('\n')).toHaveLength(3);
  });

  it('replaces newlines inside a field so rows stay on one line', () => {
    const csv = toCsv([job({ title: 'Frontend\nDeveloper' })]);
    expect(csv.trim().split('\n')).toHaveLength(2);
  });
});
