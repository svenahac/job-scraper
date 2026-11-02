/**
 * Small helpers shared by the international-organisation boards
 * (EuroBrussels, Euractiv/Rapporteur, EU Careers). Pure functions only.
 */

/** English country names, lower-case, to ISO 3166-1 alpha-2. */
const COUNTRY_CODES: Readonly<Record<string, string>> = {
  albania: 'AL', andorra: 'AD', armenia: 'AM', austria: 'AT', azerbaijan: 'AZ',
  belarus: 'BY', belgium: 'BE', 'bosnia and herzegovina': 'BA', bulgaria: 'BG',
  croatia: 'HR', cyprus: 'CY', czechia: 'CZ', 'czech republic': 'CZ', denmark: 'DK',
  estonia: 'EE', finland: 'FI', france: 'FR', georgia: 'GE', germany: 'DE', greece: 'GR',
  hungary: 'HU', iceland: 'IS', ireland: 'IE', italy: 'IT', kosovo: 'XK', latvia: 'LV',
  liechtenstein: 'LI', lithuania: 'LT', luxembourg: 'LU', malta: 'MT', moldova: 'MD',
  monaco: 'MC', montenegro: 'ME', netherlands: 'NL', 'the netherlands': 'NL',
  'north macedonia': 'MK', norway: 'NO', poland: 'PL', portugal: 'PT', romania: 'RO',
  serbia: 'RS', slovakia: 'SK', slovenia: 'SI', spain: 'ES', sweden: 'SE',
  switzerland: 'CH', turkey: 'TR', türkiye: 'TR', ukraine: 'UA', 'united kingdom': 'GB',
  uk: 'GB', 'united states': 'US', usa: 'US', canada: 'CA', 'united arab emirates': 'AE',
  israel: 'IL', japan: 'JP', 'south korea': 'KR', china: 'CN', india: 'IN',
  australia: 'AU', 'south africa': 'ZA', kenya: 'KE', ethiopia: 'ET', egypt: 'EG',
  morocco: 'MA', tunisia: 'TN', jordan: 'JO', lebanon: 'LB', brazil: 'BR', mexico: 'MX',
  // EU Careers shows French-only vacancies with French country names, and
  // some ads elsewhere are in German.
  belgique: 'BE', allemagne: 'DE', autriche: 'AT', bulgarie: 'BG', chypre: 'CY',
  croatie: 'HR', danemark: 'DK', espagne: 'ES', estonie: 'EE', finlande: 'FI',
  grèce: 'GR', hongrie: 'HU', irlande: 'IE', italie: 'IT', lettonie: 'LV', lituanie: 'LT',
  malte: 'MT', 'pays-bas': 'NL', pologne: 'PL', roumanie: 'RO', slovaquie: 'SK',
  slovénie: 'SI', suède: 'SE', tchéquie: 'CZ', 'république tchèque': 'CZ', suisse: 'CH',
  'royaume-uni': 'GB', belgien: 'BE', deutschland: 'DE', österreich: 'AT', niederlande: 'NL',
  frankreich: 'FR', italien: 'IT', spanien: 'ES', slowenien: 'SI', luxemburg: 'LU',
  schweiz: 'CH', irland: 'IE', polen: 'PL', schweden: 'SE',
};

/** Country names longest first, so "United Kingdom" wins over "Kingdom"-like tails. */
const COUNTRY_NAMES = Object.keys(COUNTRY_CODES).sort((a, b) => b.length - a.length);

/** "Belgium" → 'BE'. Unknown names and placeholders ("Multiple Countries") → null. */
export function countryCode(name: string | null | undefined): string | null {
  const key = (name ?? '').trim().toLowerCase();
  return COUNTRY_CODES[key] ?? null;
}

/** "Brussels, Belgium" → 'BE'. The country is the last comma-separated part. */
export function countryFromLocation(location: string | null | undefined): string | null {
  const parts = (location ?? '').split(',').map((p) => p.trim()).filter(Boolean);
  return parts.length > 0 ? countryCode(parts[parts.length - 1]) : null;
}

/**
 * The country a URL slug ends with, e.g. "…_Paris_France" → { name: 'France',
 * code: 'FR' }. Words may be joined by '_' or '-'.
 */
export function countryFromSlugTail(slug: string): { name: string; code: string } | null {
  const words = slug.toLowerCase().replace(/[-_]+/g, ' ').trim();
  for (const name of COUNTRY_NAMES) {
    if (words === name || words.endsWith(` ${name}`)) {
      const pretty = slug.replace(/[-_]+/g, ' ').trim().slice(-name.length);
      return { name: pretty, code: COUNTRY_CODES[name]! };
    }
  }
  return null;
}

const MONTHS: Readonly<Record<string, number>> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

const pad = (n: number): string => String(n).padStart(2, '0');

export const monthNumber = (name: string): number | null =>
  MONTHS[name.slice(0, 3).toLowerCase()] ?? null;

/**
 * RFC 822 "Fri, 30 Oct 2026 15:51:59 +0000" → "2026-10-30": the calendar date
 * as the feed writes it, without a timezone shift.
 */
export function rfc822Date(s: string | null | undefined): string | null {
  const m = /(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{4})/.exec(s ?? '');
  if (!m) return null;
  const month = monthNumber(m[2]!);
  return month ? `${m[3]}-${pad(month)}-${pad(Number(m[1]))}` : null;
}

/** "19 November 2026" (or "19 Nov 2026") → "2026-11-19". */
export function dayMonthYear(s: string | null | undefined): string | null {
  const m = /(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/.exec(s ?? '');
  if (!m) return null;
  const month = monthNumber(m[2]!);
  return month ? `${m[3]}-${pad(month)}-${pad(Number(m[1]))}` : null;
}

/** Strict YYYY-MM-DD check; anything else → null. */
export function isoDateOrNull(s: string | null | undefined): string | null {
  const v = (s ?? '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

/** Today's date in Brussels (= Ljubljana) time, as YYYY-MM-DD. */
export function todayInBrussels(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}

/** "2026-11-02" + 3 → "2026-11-05". */
export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** True when an ad's deadline, if stated, is today or later. */
export function stillOpen(deadline: string | null | undefined, today: string): boolean {
  return !deadline || deadline >= today;
}
