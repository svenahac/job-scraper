import type { EmploymentType, LocationClass, ScoreParts, WorkMode } from './types';

export const WORK_MODE_LABEL: Record<WorkMode, string> = {
  remote: 'Na daljavo',
  hybrid: 'Hibridno',
  onsite: 'Na lokaciji',
  unknown: 'Ni navedeno',
};

export const LOCATION_LABEL: Record<LocationClass, string> = {
  ljubljana: 'Ljubljana z okolico',
  coast: 'Koper ali Izola',
  remote: 'Na daljavo',
  slovenia: 'Slovenija, kraj ni naveden',
};

export const EMPLOYMENT_LABEL: Record<EmploymentType, string | null> = {
  permanent: 'Nedoločen čas',
  'fixed-term': 'Določen čas',
  'part-time': 'Krajši delovni čas',
  unknown: null,
};

export const PART_LABELS: Array<{ key: keyof ScoreParts; label: string; max: number }> = [
  { key: 'relevance', label: 'Povezanost s področjem', max: 35 },
  { key: 'experience', label: 'Ujemanje z izkušnjami in izobrazbo', max: 15 },
  { key: 'workMode', label: 'Remote / hibridno delo', max: 15 },
  { key: 'level', label: 'Zahtevana raven izkušenj', max: 15 },
  { key: 'location', label: 'Lokacija in jeziki', max: 10 },
  { key: 'organisation', label: 'Vrsta organizacije in vsebina', max: 10 },
];

export function matchLabel(score: number): string {
  if (score >= 75) return 'Odlično ujemanje';
  if (score >= 60) return 'Dobro ujemanje';
  if (score >= 45) return 'Delno ujemanje';
  return 'Šibko ujemanje';
}

export function matchTier(score: number): 'high' | 'good' | 'mid' | 'low' {
  if (score >= 75) return 'high';
  if (score >= 60) return 'good';
  if (score >= 45) return 'mid';
  return 'low';
}

const DAY = 86_400_000;

/** Local calendar date of today as YYYY-MM-DD. */
export function today(): string {
  return new Date().toLocaleDateString('sv-SE');
}

/** Whole days from `a` to `b`, both YYYY-MM-DD. */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);
}

/** "12. 11. 2026" */
export function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${Number(d)}. ${Number(m)}. ${y}`;
}

/** Slovenian plural of "dan" (day): 1 dan, 2 dneva, 3-4 dnevi, 5+ dni. */
export function days(n: number): string {
  const mod = n % 100;
  if (mod === 1) return `${n} dan`;
  if (mod === 2) return `${n} dneva`;
  if (mod === 3 || mod === 4) return `${n} dnevi`;
  return `${n} dni`;
}

export function postedAgo(iso: string | null): string {
  if (!iso) return 'datum objave ni znan';
  const n = daysBetween(iso.slice(0, 10), today());
  if (n <= 0) return 'objavljeno danes';
  if (n === 1) return 'objavljeno včeraj';
  if (n === 2) return 'objavljeno pred 2 dnevoma';
  return `objavljeno pred ${n} dnevi`;
}

export function deadlineInfo(iso: string | null): { text: string; urgent: boolean; past: boolean } | null {
  if (!iso) return null;
  const n = daysBetween(today(), iso.slice(0, 10));
  if (n < 0) return { text: `rok je potekel ${formatDate(iso)}`, urgent: false, past: true };
  if (n === 0) return { text: 'rok poteče danes', urgent: true, past: false };
  return { text: `rok ${formatDate(iso)} · še ${days(n)}`, urgent: n <= 5, past: false };
}
