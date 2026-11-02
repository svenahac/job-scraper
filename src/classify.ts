import type {
  EmploymentType, LocationClass, RawJob, Reason, ScoreParts, Seniority, WorkMode,
} from './types.js';
import type { AreaKey } from './profile.js';
import {
  AREAS, BODY_WARN, CONTEXTUAL, CONTRACT_REJECT, DOMAIN_REJECT, EDUCATION_CONTEXT,
  EDUCATION_ORGS, EU_TERMS, FOREIGN_LANGUAGES, GENERIC_ROLES, GOOD_ORGS, GOOD_THEMES,
  HR_ADMIN_SUBSTANCE, HR_GENERIC, HR_REJECT, HYBRID_MARKERS, JUNIOR_MARKERS,
  LANGUAGE_OPTIONAL, LANGUAGE_REQUIRED, LEARNING_SUBSTANCE, LJUBLJANA_AREA, ONSITE_MARKERS,
  REMOTE_BODY_MARKERS, REMOTE_ELIGIBLE, REMOTE_MARKERS, SENIOR_PENALTY, SENIOR_REJECT, SKILLS, SLOVENIA_MARKERS,
  TITLE_REJECT,
} from './profile.js';
import { fold, hasAny, hits, positions, termRegex } from './match.js';

export type RejectReason =
  | 'contract' | 'domain' | 'senior' | 'hr' | 'off-target' | 'no-area' | 'senior-years'
  | 'location';

export interface AreaMatch {
  key: AreaKey;
  /**
   * title:   a specific role term in the title
   * context: a generic title term backed by an education context, or a match
   *          on the source's own occupation tag
   * body:    enough distinct phrases in the ad body alone
   */
  via: 'title' | 'context' | 'body';
  terms: string[];
}

export interface Classification {
  areas: AreaMatch[];
  /** The area the posting is filed under, or null when none matched. */
  area: AreaKey | null;
  workMode: WorkMode;
  employmentType: EmploymentType;
  locationClass: LocationClass | null;
  seniority: Seniority;
  minYears: number | null;
  /** Required experience for display: the source's wording, else derived. */
  experience: string | null;
  flags: string[];
  parts: ScoreParts;
  score: number;
  reasons: Reason[];
  /** Why the posting is dropped, or null when it is kept. */
  rejected: RejectReason | null;
}

interface Texts {
  title: string;
  body: string;
  /** Source tags plus the source's occupation title. */
  tags: string;
  company: string;
  location: string;
}

const textsOf = (job: RawJob): Texts => ({
  title: fold(job.title),
  body: fold(job.description ?? ''),
  tags: fold([...job.tags, job.occupation ?? ''].join(' | ')),
  company: fold(job.company ?? ''),
  location: fold(job.location ?? ''),
});

const AREA_BY_KEY = new Map(AREAS.map((a) => [a.key, a]));
export const areaLabel = (key: AreaKey): string => AREA_BY_KEY.get(key)?.label ?? key;

/** Specific phrases across the core areas, used to judge a generic title. */
const CONTEXT_BODY: readonly string[] = [
  ...AREA_BY_KEY.get('ld')!.body, ...AREA_BY_KEY.get('education')!.body,
  ...AREA_BY_KEY.get('digital')!.body, ...EU_TERMS,
];

/** Distinct body phrases an area needs when nothing in the title matches. */
export const BODY_MIN = 3;

/**
 * Whether a generic title ("Strokovni sodelavec", "Project Manager") is about
 * education. An education employer alone is not enough — a faculty employs
 * IT and facilities staff too — so it needs one supporting body phrase.
 */
function hasEducationContext(t: Texts): boolean {
  if (hasAny(t.title, EDUCATION_CONTEXT) || hasAny(t.tags, EDUCATION_CONTEXT)) return true;
  const inBody = hits(t.body, CONTEXT_BODY).length;
  return inBody >= 2 || (inBody >= 1 && hasAny(t.company, EDUCATION_ORGS));
}

function matchAreasIn(t: Texts): AreaMatch[] {
  let ctx: boolean | undefined;
  const context = (): boolean => (ctx ??= hasEducationContext(t));
  const out: AreaMatch[] = [];
  for (const a of AREAS) {
    const inTitle = hits(t.title, a.title);
    const strong = inTitle.filter((h) => !CONTEXTUAL.includes(h));
    if (strong.length > 0) { out.push({ key: a.key, via: 'title', terms: strong }); continue; }
    const weak = inTitle.filter((h) => CONTEXTUAL.includes(h));
    const inTags = hits(t.tags, a.title).filter((h) => !CONTEXTUAL.includes(h));
    if (inTags.length > 0 || (weak.length > 0 && context())) {
      out.push({ key: a.key, via: 'context', terms: [...weak, ...inTags] });
      continue;
    }
    const inBody = hits(t.body, a.body);
    // Project vocabulary is in every other ad; on its own it only counts
    // for EU-programme work, which is what the seeker is after.
    const enough = a.key === 'projects'
      ? inBody.length >= BODY_MIN && hits(t.body, EU_TERMS).length >= 2
      : inBody.length >= BODY_MIN;
    if (enough) out.push({ key: a.key, via: 'body', terms: inBody });
  }
  return out;
}

/** Every area a posting matches, strongest evidence first. */
export function matchAreas(job: Pick<RawJob, 'title' | 'description' | 'tags' | 'company'> &
  Partial<Pick<RawJob, 'occupation' | 'location'>>): AreaMatch[] {
  return matchAreasIn(textsOf({
    source: '', sourceId: '', url: '', postedAt: null, location: null, ...job,
  }));
}

const VIA_RANK = { title: 0, context: 1, body: 2 } as const;

/**
 * The area to file a posting under: the strongest evidence wins, and the
 * catch-all 'related' area yields to any core area with equal evidence — or
 * with body evidence when 'related' only matched a generic title.
 */
function primaryArea(areas: AreaMatch[]): AreaMatch | null {
  if (areas.length === 0) return null;
  const sorted = [...areas].sort((a, b) => VIA_RANK[a.via] - VIA_RANK[b.via]);
  const best = sorted[0]!;
  if (best.key !== 'related') return best;
  const core = sorted.find((a) => a.key !== 'related' && VIA_RANK[a.via] <= VIA_RANK.body);
  return core && (best.via !== 'title' || core.via === 'title') ? core : best;
}

/** Whole-word match on any LJUBLJANA_AREA place, so "ig" never hits "Rigonce". */
export function inLjubljanaArea(location: string | null): boolean {
  if (!location) return false;
  const loc = fold(location);
  return LJUBLJANA_AREA.some((p) => termRegex(`${p}$`).test(loc));
}

export function detectWorkMode(
  workModeRaw: string | null | undefined, title: string, location: string | null, body: string,
): WorkMode {
  const raw = fold(workModeRaw ?? '');
  if (raw) {
    if (hasAny(raw, HYBRID_MARKERS)) return 'hybrid';
    if (hasAny(raw, REMOTE_MARKERS)) return 'remote';
    if (hasAny(raw, ONSITE_MARKERS)) return 'onsite';
  }
  const head = fold([title, location ?? ''].join(' \n '));
  const prose = fold(body);
  if (hasAny(head, HYBRID_MARKERS) || hasAny(prose, HYBRID_MARKERS)) return 'hybrid';
  if (hasAny(head, REMOTE_MARKERS) || hasAny(prose, REMOTE_BODY_MARKERS)) return 'remote';
  if (location && location.trim().length > 0) return 'onsite';
  return 'unknown';
}

/** "20 ur/teden", "30 hours/week". Below 35 is part-time. */
const HOURS_RE = /(\d{1,2})\s*(?:ur|hours?)\s*\/\s*(?:teden|week)\b/i;

export function detectEmploymentType(
  employmentRaw: string | null | undefined, workTimeRaw: string | null | undefined,
  title: string, body: string,
): EmploymentType {
  const structured = fold([employmentRaw ?? '', workTimeRaw ?? ''].join(' '));
  const all = `${structured} \n ${fold(title)} \n ${fold(body)}`;
  const hours = HOURS_RE.exec(structured) ?? HOURS_RE.exec(fold(body));
  if (hours && Number(hours[1]) < 35) return 'part-time';
  if (hasAny(all, ['krajš* delovn* čas', 'polovičn* delovn* čas', 'part-time', 'part time'])) {
    return 'part-time';
  }
  if (hasAny(all, ['nedoločen* čas', 'nedoločen', 'permanent', 'open-ended', 'indefinite'])) {
    return 'permanent';
  }
  if (hasAny(all, ['določen* čas', 'fixed term', 'fixed-term', 'temporary', 'contract agent', 'contract staff'])) {
    return 'fixed-term';
  }
  return 'unknown';
}

const NUMBER_WORDS: Record<string, number> = {
  ena: 1, enega: 1, eno: 1, dve: 2, dva: 2, dveh: 2, tri: 3, treh: 3, stiri: 4, stirih: 4,
  pet: 5, petih: 5, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  ten: 10,
};
const NUM = `(\\d{1,2}|${Object.keys(NUMBER_WORDS).join('|')})`;
const YEARS = '(?:let|leti|leta|leto|letnih|years?|yrs)';
const toNum = (s: string): number => NUMBER_WORDS[s] ?? Number(s);

// "najmanj 2 leti delovnih izkušenj", "3+ years of experience", "1-3 leta izkušenj"
const YEARS_THEN_EXP = new RegExp(
  `(?<![\\p{L}\\d])${NUM}\\s*\\+?\\s*(?:(?:-|–|do|to)\\s*\\d{1,2}\\s*)?${YEARS}(?![\\p{L}])` +
  `(?=[^.;]{0,50}?(?:izkusenj|izkusnj|experience|prakse|delovn))`, 'gu');
// "izkušnje: vsaj 2 leti", "experience of at least 3 years"
const EXP_THEN_YEARS = new RegExp(
  `(?:izkusenj|izkusnje|experience)[^.;\\d]{0,30}?(?<![\\p{L}\\d])${NUM}\\s*\\+?\\s*${YEARS}(?![\\p{L}])`,
  'gu');

const REQUIREMENT_CUE = /(?:najmanj|vsaj|minimum|min\.|at least|zahtev|pricakuj|required|requires|you have|you bring|you'll have|imas|imate|potrebn|need|must|delovne izkusnje|izkusnje:|experience:|qualifications|candidate)/;
const EMPLOYER_CUE = /(?:company|podjetj|we have|imamo|smo |our team|na trgu|on the market|tradicij|organisation with|organization with|agency with|firm with)/;

/**
 * Required years of experience: the lower bound of the most demanding
 * requirement stated. The source's structured field wins over prose.
 */
export function requiredYears(experienceRaw: string | null | undefined, body: string): number | null {
  const raw = fold(experienceRaw ?? '').trim();
  if (raw) {
    if (/brez|no experience|not required|ni zahtevan|ni pomembn/.test(raw)) return 0;
    if (/^(?:do|up to|manj kot|less than)\b/.test(raw)) return 0;
    const years = new RegExp(`${NUM}\\s*\\+?\\s*(?:(?:-|–|do|to)\\s*\\d{1,2}\\s*)?${YEARS}`, 'u').exec(raw);
    if (years) return Math.min(toNum(years[1]!), 15);
    if (/(\d{1,2})\s*(?:mesec|month)/.test(raw)) return 0;
  }
  const text = fold(body);
  let max: number | null = null;
  for (const re of [YEARS_THEN_EXP, EXP_THEN_YEARS]) {
    for (const m of text.matchAll(re)) {
      const n = toNum(m[1]!);
      if (n > 15) continue;
      // "A company with more than 10 years of experience" describes the
      // employer. Only a figure framed as a requirement counts.
      const before = text.slice(Math.max(0, (m.index ?? 0) - 50), m.index ?? 0);
      const framed = re === EXP_THEN_YEARS || /\+/.test(m[0]) || REQUIREMENT_CUE.test(before);
      if (!framed || EMPLOYER_CUE.test(before)) continue;
      if (max === null || n > max) max = n;
    }
  }
  return max;
}

export function experienceLabel(raw: string | null | undefined, years: number | null): string | null {
  if (raw && raw.trim()) return raw.trim();
  if (years === null) return null;
  if (years === 0) return 'Brez zahtevanih izkušenj';
  return `${years}+ ${years === 1 ? 'leto' : years === 2 ? 'leti' : years <= 4 ? 'leta' : 'let'}`;
}

/** Languages the seeker lacks that the ad requires (not merely welcomes). */
export function requiredForeignLanguages(languagesRaw: string | null | undefined, body: string): string[] {
  const langs = fold(languagesRaw ?? '');
  const text = fold(body);
  const out: string[] = [];
  for (const lang of FOREIGN_LANGUAGES) {
    if (hasAny(langs, lang.terms)) { out.push(lang.label); continue; }
    const required = lang.terms.some((term) => positions(text, term).some((i) => {
      const window = text.slice(Math.max(0, i - 60), i + 60);
      return hasAny(window, LANGUAGE_REQUIRED) && !hasAny(window, LANGUAGE_OPTIONAL);
    }));
    if (required) out.push(lang.label);
  }
  return out;
}

export function locationClassFor(
  job: Pick<RawJob, 'location' | 'country' | 'international'> & { title?: string },
  workMode: WorkMode,
): LocationClass | null {
  const loc = fold(job.location ?? '');
  const country = job.country ? job.country.toUpperCase() : null;
  const inLj = inLjubljanaArea(job.location);
  if (country === 'SI' || inLj) return inLj ? 'ljubljana' : 'slovenia';
  // A remote role open to "Europe" or "148 countries incl. Slovenia" is a
  // remote role, not a Slovenian one.
  // The title counts too: "Project Coordinator (Remote, Europe, ±3h CET)".
  const title = fold(job.title ?? '');
  if (workMode === 'remote' && (!loc || hasAny(loc, REMOTE_ELIGIBLE)
    || hasAny(loc, SLOVENIA_MARKERS) || hasAny(title, REMOTE_ELIGIBLE))) return 'remote';
  if (hasAny(loc, SLOVENIA_MARKERS) || (country === null && !loc && !job.international)) {
    return 'slovenia';
  }
  if (job.international) return 'abroad';
  return null;
}

/** Whether a posting with this title is worth a detail-page request. */
export function worthDetail(title: string, occupation?: string | null): boolean {
  const t = fold(title);
  if (hasAny(t, SENIOR_REJECT) || hasAny(t, DOMAIN_REJECT) || hasAny(t, CONTRACT_REJECT)) {
    return false;
  }
  const areaHit = AREAS.some((a) => hasAny(t, a.title))
    || (occupation ? AREAS.some((a) => hasAny(fold(occupation), a.title)) : false);
  if (areaHit) return true;
  if (hasAny(t, TITLE_REJECT)) return false;
  if (occupation && hasAny(fold(occupation), TITLE_REJECT)) return false;
  return hasAny(t, GENERIC_ROLES);
}

const LEARNING_IN_TITLE: readonly string[] = [
  'learning', 'training', 'izobraževanj', 'usposabljanj', 'l&d', 'lms', 'razvoj kadrov',
  'razvoj zaposlenih', 'talent development', 'people development', 'employee development',
];

const RELEVANCE_LABEL: Record<AreaMatch['via'], string> = {
  title: 'Naziv ustreza področju',
  context: 'Delo spada na področje',
  body: 'Vsebina dela se navezuje na področje',
};

export function classify(job: RawJob): Classification {
  const t = textsOf(job);
  const flags: string[] = [];
  const reasons: Reason[] = [];
  const fit = (text: string): void => { reasons.push({ kind: 'fit', text }); };
  const warn = (text: string): void => { reasons.push({ kind: 'warn', text }); };

  const workMode = detectWorkMode(job.workModeRaw, job.title, job.location, job.description);
  const employmentType = detectEmploymentType(
    job.employmentRaw, job.workTimeRaw, job.title, job.description,
  );
  const locationClass = locationClassFor(job, workMode);
  const minYears = requiredYears(job.experienceRaw, job.description);
  const experience = experienceLabel(job.experienceRaw, minYears);

  let areas = matchAreasIn(t);
  let rejected: RejectReason | null = null;
  const learningInTitle = hasAny(t.title, LEARNING_IN_TITLE)
    || areas.some((a) => a.via === 'title' && a.key !== 'projects' && a.key !== 'related');

  if (hasAny(fold(`${job.title} \n ${job.employmentRaw ?? ''}`), CONTRACT_REJECT)) {
    rejected = 'contract';
  } else if (hasAny(`${t.title} \n ${t.tags}`, DOMAIN_REJECT)) {
    rejected = 'domain';
  } else if (hasAny(t.title, SENIOR_REJECT)) {
    rejected = 'senior';
  } else if (!learningInTitle && hasAny(t.title, HR_REJECT)) {
    rejected = 'hr';
  } else if (!learningInTitle && hasAny(t.title, HR_GENERIC)) {
    // An HR title whose duties are mostly learning stays; one that is mostly
    // recruiting, contracts and payroll goes.
    const learn = hits(t.body, LEARNING_SUBSTANCE).length;
    const admin = hits(t.body, HR_ADMIN_SUBSTANCE).length;
    if (learn >= 3 && learn > admin) {
      flags.push('hr-title-learning-body');
      if (!areas.some((a) => a.key === 'ld')) {
        areas = [{ key: 'ld', via: 'context', terms: ['hr+learning'] }, ...areas];
      }
    } else {
      rejected = 'hr';
    }
  }
  if (!rejected && hasAny(t.title, TITLE_REJECT) && !areas.some((a) => a.via === 'title')) {
    rejected = 'off-target';
  }

  const primary = primaryArea(areas);
  if (!rejected && !primary) rejected = 'no-area';
  if (!rejected && minYears !== null && minYears >= 8) rejected = 'senior-years';
  if (!rejected && locationClass === null) rejected = 'location';

  // --- Relevance: how directly the role is about learning, education or projects.
  let relevance = 0;
  const euContext = hasAny(`${t.title} \n ${t.body}`, EU_TERMS);
  if (primary) {
    if (primary.via === 'title') {
      relevance = primary.key === 'projects' ? (euContext || hasEducationContext(t) ? 35 : 30)
        : primary.key === 'related' ? 28 : 35;
    } else if (primary.via === 'context') {
      relevance = areas.some((a) => a !== primary && a.key !== 'related') ? 28 : 24;
    } else {
      relevance = Math.min(18, 10 + 2 * (primary.terms.length - BODY_MIN));
    }
    fit(`${RELEVANCE_LABEL[primary.via]} »${areaLabel(primary.key)}«`);
  }

  // --- Experience: overlap with the seeker's own skills, tools and education.
  const skillText = [t.title, t.body, fold(job.experienceRaw ?? ''), fold(job.languagesRaw ?? '')]
    .join(' \n ');
  const skills = SKILLS.filter((s) => hasAny(skillText, s.terms)).map((s) => s.label);
  const experiencePts = t.body ? Math.min(15, 3 + 2 * skills.length) : 6;
  const notable = skills.filter((s) => s !== 'angleščina' && s !== 'univerzitetna izobrazba');
  if (notable.length > 0) fit(`Ujema se s tvojimi izkušnjami: ${notable.slice(0, 4).join(', ')}`);

  // --- Work mode.
  const workModePts = { remote: 15, hybrid: 13, unknown: 7, onsite: 4 }[workMode];
  if (workMode === 'remote') fit('Delo na daljavo');
  if (workMode === 'hybrid') fit('Hibridno delo (delno od doma)');

  // --- Level: required years and title seniority.
  const junior = hasAny(t.title, JUNIOR_MARKERS);
  const seniorish = hasAny(t.title, SENIOR_PENALTY);
  let level = junior ? 15
    : minYears === null ? 10
    : minYears <= 1 ? 15 : minYears <= 3 ? 13 : minYears <= 5 ? 8 : 3;
  if (seniorish && !junior) level = Math.max(0, level - 5);
  if (junior) fit('Začetna / junior pozicija');
  else if (minYears !== null && minYears <= 3) fit(`Zahtevane izkušnje (${experience}) ustrezajo tvojemu profilu`);
  if (minYears !== null && minYears >= 4) warn(`Zahteva ${minYears}+ let izkušenj`);
  if (seniorish && !junior) warn('Naziv nakazuje vodstveno ali višjo pozicijo');
  const seniority: Seniority = junior || (minYears !== null && minYears <= 2) ? 'junior'
    : minYears !== null && minYears >= 6 ? 'senior'
    : (minYears !== null && minYears >= 3) || seniorish ? 'mid' : 'unknown';

  // --- Location and languages.
  let location = locationClass === 'ljubljana' ? 10
    : locationClass === 'slovenia' ? (workMode === 'remote' ? 10 : workMode === 'hybrid' ? 6 : 4)
    : locationClass === 'remote' ? 9 : 2;
  if (locationClass === 'ljubljana') fit('Ljubljana z okolico');
  if (locationClass === 'remote') fit('Odprto za kandidate iz Slovenije');
  if (locationClass === 'abroad') warn('Delo v tujini (zahteva selitev)');
  const langs = requiredForeignLanguages(job.languagesRaw, `${job.title} \n ${job.description}`);
  if (langs.length > 0) {
    location = Math.max(0, location - 3 * langs.length);
    warn(`Zahteva ${langs.join(' in ')}`);
    flags.push(...langs.map((l) => `language:${l}`));
  }

  // --- Organisation type and themes.
  const goodOrg = job.international === true || hasAny(t.company, GOOD_ORGS);
  const themes = GOOD_THEMES.filter((th) => hasAny(`${t.title} \n ${t.body}`, th.terms))
    .map((th) => th.label);
  const organisation = (goodOrg ? 5 : 0) + Math.min(5, 2 * themes.length);
  if (job.international) fit('Mednarodna organizacija');
  else if (goodOrg) fit('Izobraževalna, javna ali nevladna organizacija');
  if (themes.length > 0) fit(`Tematika: ${themes.slice(0, 3).join(', ')}`);

  // --- Deductions.
  const warns = hits(t.body, BODY_WARN);
  flags.push(...warns.map((w) => `body:${w}`));
  // A language the seeker lacks is a hard requirement, not a detail: it
  // costs location points above and five more here, per language.
  const deductions = Math.min(8, 4 * warns.length) + 5 * langs.length;
  const penalty = deductions > 0 ? -deductions : 0;
  if (warns.some((w) => /plac|kadrovsk|delovnopravn|payroll/.test(fold(w)))) {
    warn('Vključuje tudi kadrovsko administracijo');
  }
  if (warns.some((w) => /prodajn|strank/.test(fold(w)))) warn('Vključuje prodajne naloge');

  const parts: ScoreParts = {
    relevance, experience: experiencePts, workMode: workModePts, level, location, organisation,
    penalty,
  };
  const total = relevance + experiencePts + workModePts + level + location + organisation + penalty;
  const score = primary ? Math.max(0, Math.min(100, Math.round(total))) : 0;

  return {
    areas,
    area: primary?.key ?? null,
    workMode,
    employmentType,
    locationClass,
    seniority,
    minYears,
    experience,
    flags,
    parts,
    score,
    reasons,
    rejected,
  };
}

export function isWanted(c: Classification): boolean {
  return c.rejected === null;
}
