import { writeFileSync } from 'node:fs';
import type { Job } from './types.js';

/** Description is deliberately absent — it makes the file unusable in a spreadsheet. */
export const CSV_COLUMNS = [
  'score', 'area', 'title', 'company', 'location', 'work_mode',
  'employment_type', 'seniority', 'areas', 'source', 'posted_at', 'url',
] as const;

const cell = (value: string | null): string => {
  if (value === null || value === '') return '';
  const flat = value.replace(/[\r\n]+/g, ' ').trim();
  return /[",]/.test(flat) ? `"${flat.replace(/"/g, '""')}"` : flat;
};

const row = (j: Job): string => [
  String(j.score), j.area, j.title, j.company, j.location, j.workMode,
  j.employmentType, j.seniority, j.areas, j.source, j.postedAt, j.url,
].map(cell).join(',');

export function toCsv(jobs: Job[]): string {
  return [CSV_COLUMNS.join(','), ...jobs.map(row)].join('\n') + '\n';
}

export function writeCsv(path: string, jobs: Job[]): void {
  writeFileSync(path, toCsv(jobs), 'utf8');
}
