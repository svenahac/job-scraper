import { describe, it, expect } from 'vitest';
import { toCsv, CSV_COLUMNS } from '../src/csv.js';
import type { Job } from '../src/types.js';

const job = (over: Partial<Job> = {}): Job => ({
  source: 'slotech', sourceId: '8052', url: 'https://slo-tech.com/delo/8052',
  title: 'Frontend Developer', company: 'Acme', location: 'Ljubljana',
  postedAt: '2026-08-18', description: 'Dolg opis.', tags: ['React'],
  id: 'a1', roleMatch: 'frontend', seniority: 'junior',
  firstSeenAt: '2026-08-21T17:00:00.000Z', lastSeenAt: '2026-08-21T17:00:00.000Z',
  ...over,
});

describe('toCsv', () => {
  it('writes a header row', () => {
    expect(toCsv([]).trim()).toBe(CSV_COLUMNS.join(','));
  });

  it('omits the description column', () => {
    expect(CSV_COLUMNS).not.toContain('description');
    expect(toCsv([job()])).not.toContain('Dolg opis');
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
