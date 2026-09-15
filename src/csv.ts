import { writeFileSync } from 'node:fs';
import type { Job } from './types.js';

/** Description is deliberately absent — it makes the file unusable in a spreadsheet. */
export const CSV_COLUMNS = [
  'source', 'title', 'company', 'location', 'seniority', 'area',
  'tags', 'posted_at', 'first_seen_at', 'url',
] as const;

const cell = (value: string | null): string => {
  if (value === null || value === '') return '';
  const flat = value.replace(/[\r\n]+/g, ' ').trim();
  return /[",]/.test(flat) ? `"${flat.replace(/"/g, '""')}"` : flat;
};

const row = (j: Job): string => [
  j.source, j.title, j.company, j.location, j.seniority, j.area,
  j.tags.join(' '), j.postedAt, j.firstSeenAt, j.url,
].map(cell).join(',');

export function toCsv(jobs: Job[]): string {
  return [CSV_COLUMNS.join(','), ...jobs.map(row)].join('\n') + '\n';
}

export function writeCsv(path: string, jobs: Job[]): void {
  writeFileSync(path, toCsv(jobs), 'utf8');
}
