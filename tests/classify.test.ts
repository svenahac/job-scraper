import { describe, it, expect } from 'vitest';
import {
  matchAreas, detectWorkMode, inLjubljanaArea, detectEmploymentType, requiredYears,
  requiredForeignLanguages, locationClassFor, worthDetail, classify, isWanted,
} from '../src/classify.js';
import type { RawJob } from '../src/types.js';

const raw = (over: Partial<RawJob>): RawJob => ({
  source: 'test', sourceId: '1', url: 'https://x', title: '', company: null,
  location: 'Ljubljana', postedAt: null, description: '', tags: [],
  employmentRaw: null, workTimeRaw: null, occupation: null, country: 'SI', ...over,
});

const kept = (over: Partial<RawJob>): boolean => isWanted(classify(raw(over)));
const why = (over: Partial<RawJob>) => classify(raw(over)).rejected;

describe('matchAreas', () => {
  const area = (title: string, description = '', company: string | null = null) =>
    matchAreas({ title, description, tags: [], company }).map((a) => `${a.key}:${a.via}`);

  it("files each of the seeker's role families under its own area", () => {
    expect(area('Learning & Development Specialist')).toContain('ld:title');
    expect(area('Koordinatorka izobraževanj (m/ž)')).toContain('ld:title');
    expect(area('LMS Administrator')).toContain('ld:title');
    expect(area('EU Project Officer')).toContain('projects:title');
    expect(area('Projektni sodelavec (m/ž)')).toContain('projects:title');
    expect(area('Andragog / organizator izobraževanja odraslih')).toContain('education:title');
    expect(area('Strokovni sodelavec za razvoj izobraževalnih programov')).toContain('education:title');
    expect(area('Junior Instructional Designer')).toContain('digital:title');
    expect(area('E-learning Project Coordinator')).toContain('digital:title');
    expect(area('Knowledge Management Specialist')).toContain('related:title');
  });

  it('needs an education context before a generic title counts', () => {
    expect(area('Project Manager')).toEqual([]);
    expect(area('Project Manager', 'Vodenje projektov Erasmus+ in izobraževanja odraslih ter priprava evropskih projektov.'))
      .toContain('related:context');
    expect(area('Research Assistant in Education')).toContain('related:context');
  });

  it('does not take an education employer alone as context', () => {
    expect(area('Strokovni sodelavec za tehnične zadeve', '', 'Fakulteta za družbene vede')).toEqual([]);
  });

  it('takes a role from the body only with several specific phrases', () => {
    const body = 'Skrbel boš za organizacijo izobraževanj, analizo potreb po izobraževanju in razvoj zaposlenih.';
    expect(area('Strokovni sodelavec VII/2', body)).toContain('ld:body');
    expect(area('Strokovni sodelavec VII/2', 'Organizacija izobraževanj.')).toEqual([]);
  });

  it('does not take generic project prose as an EU-project match', () => {
    const body = 'Vodenje projektov, koordinacija projektov in project management v gradbeništvu.';
    expect(area('Strokovni sodelavec', body)).toEqual([]);
  });

  it('returns nothing for an unrelated role', () => {
    expect(area('CNC operater')).toEqual([]);
  });
});

describe('exclusions from the brief', () => {
  it('drops general and senior HR roles', () => {
    expect(why({ title: 'HR Business Partner' })).toBe('hr');
    expect(why({ title: 'HR Manager' })).toBe('hr');
    expect(why({ title: 'Recruiter (m/ž)' })).toBe('hr');
    expect(why({ title: 'Talent Acquisition Specialist' })).toBe('hr');
    expect(why({ title: 'Referent za obračun plač' })).toBe('hr');
    expect(why({ title: 'Kadrovski referent (m/ž)' })).toBe('hr');
  });

  it('keeps an HR-titled role whose title names learning', () => {
    expect(kept({ title: 'HR Specialist – Learning & Development' })).toBe(true);
  });

  it('keeps a generic HR title whose duties are mostly learning, and drops one that is mostly admin', () => {
    const learning = 'Organizacija izobraževanj, usposabljanja zaposlenih, onboarding, razvoj kompetenc in LMS.';
    const admin = 'Zaposlovanje, selekcija kandidatov, pogodbe o zaposlitvi, obračun plač in kadrovske evidence.';
    expect(kept({ title: 'HR Specialist', description: learning })).toBe(true);
    expect(why({ title: 'HR Specialist', description: admin })).toBe('hr');
  });

  it('drops clearly senior, managerial and executive roles', () => {
    expect(why({ title: 'Senior Learning Specialist' })).toBe('senior');
    expect(why({ title: 'Head of Learning & Development' })).toBe('senior');
    expect(why({ title: 'Direktor izobraževanja' })).toBe('senior');
    expect(why({ title: 'L&D Team Lead' })).toBe('senior');
    expect(why({ title: 'Vodilni strokovni sodelavec za projekte' })).toBe('senior');
  });

  it('keeps a "Vodja projektov" role but marks it down', () => {
    const c = classify(raw({ title: 'Vodja projektov', description: 'Vodenje Erasmus+ projektov in evropskih projektov s področja izobraževanja.' }));
    expect(isWanted(c)).toBe(true);
    expect(c.reasons.some((r) => r.kind === 'warn')).toBe(true);
  });

  it('does not mistake a Directorate for a director', () => {
    expect(kept({ title: 'Programme Officer, Directorate-General for Education', country: 'BE', location: 'Brussels', international: true })).toBe(true);
  });

  it('drops off-target professions unless the title also names a target role', () => {
    expect(why({ title: 'Bančni svetovalec v poslovalnici' })).not.toBeNull();
    expect(why({ title: 'Učitelj razrednega pouka' })).not.toBeNull();
    expect(kept({ title: 'Učitelj v izobraževanju odraslih' })).toBe(true);
  });

  it('drops construction and engineering project roles', () => {
    expect(why({ title: 'Koordinator projektov gradnje' })).toBe('domain');
  });

  it('drops student work and internships', () => {
    expect(why({ title: 'Študentsko delo – pomoč pri izobraževanjih' })).toBe('contract');
    expect(why({ title: 'Training Coordinator', employmentRaw: 'Internship' })).toBe('contract');
  });

  it('keeps a 3–5 year requirement and drops an 8+ year one', () => {
    expect(kept({ title: 'Training Coordinator', experienceRaw: '3+ do 5 let' })).toBe(true);
    expect(why({ title: 'Training Coordinator', description: 'Zahtevamo najmanj 8 let delovnih izkušenj.' }))
      .toBe('senior-years');
  });
});

describe('location', () => {
  it('places the Ljubljana area, the rest of Slovenia, and remote work', () => {
    expect(locationClassFor({ location: 'Domžale', country: 'SI' }, 'onsite')).toBe('ljubljana');
    expect(locationClassFor({ location: 'MARIBOR', country: 'SI' }, 'onsite')).toBe('slovenia');
    expect(locationClassFor({ location: 'Europe', country: null }, 'remote')).toBe('remote');
    expect(locationClassFor({ location: '148 countries incl. Slovenia', country: null }, 'remote')).toBe('remote');
  });

  it('keeps on-site work abroad only from international-organisation boards', () => {
    expect(locationClassFor({ location: 'Berlin, Germany', country: 'DE' }, 'onsite')).toBeNull();
    expect(locationClassFor({ location: 'Brussels, Belgium', country: 'BE', international: true }, 'onsite'))
      .toBe('abroad');
  });

  it('drops a remote role restricted to another country', () => {
    expect(locationClassFor({ location: 'USA only', country: 'US' }, 'remote')).toBeNull();
  });
});

describe('inLjubljanaArea', () => {
  it('accepts Ljubljana and the surrounding municipalities, with or without diacritics', () => {
    for (const l of ['Ljubljana', 'LJUBLJANA', 'Ljubljana, Slovenia', 'Domzale', 'Brezovica pri Ljubljani', 'Vrhnika']) {
      expect(inLjubljanaArea(l)).toBe(true);
    }
  });

  it('rejects other towns, and short names inside longer ones', () => {
    expect(inLjubljanaArea('Maribor')).toBe(false);
    expect(inLjubljanaArea('Rigonce')).toBe(false);
    expect(inLjubljanaArea(null)).toBe(false);
  });
});

describe('detectWorkMode', () => {
  it('reads a structured field first', () => {
    expect(detectWorkMode('Hibridno (delno od doma)', 'X', 'Ljubljana', '')).toBe('hybrid');
    expect(detectWorkMode('Od doma', 'X', 'Ljubljana', '')).toBe('remote');
    expect(detectWorkMode('Na delovnem mestu', 'X', 'Ljubljana', 'remote work possible')).toBe('onsite');
  });

  it('reads clear phrases from the ad body', () => {
    expect(detectWorkMode(null, 'X', 'Ljubljana', 'Nudimo možnost dela od doma.')).toBe('hybrid');
    expect(detectWorkMode(null, 'X', 'Ljubljana', 'This is a fully remote position.')).toBe('remote');
  });

  it('ignores body prose that only sounds remote', () => {
    expect(detectWorkMode(null, 'X', 'Ljubljana', 'Izvajanje učenja na daljavo za udeležence.')).toBe('onsite');
    expect(detectWorkMode(null, 'X', 'Ljubljana', 'You will support remote teams.')).toBe('onsite');
    expect(detectWorkMode(null, 'X', 'Ljubljana', 'Fleksibilen delovni čas.')).toBe('onsite');
  });

  it('is unknown without a location or marker', () => {
    expect(detectWorkMode(null, 'X', null, '')).toBe('unknown');
  });
});

describe('detectEmploymentType', () => {
  it('reads the structured fields', () => {
    expect(detectEmploymentType('Nedoločen čas', null, '', '')).toBe('permanent');
    expect(detectEmploymentType('Določen čas', null, '', '')).toBe('fixed-term');
    expect(detectEmploymentType(null, '20 ur/teden', '', '')).toBe('part-time');
  });

  it('does not read part-time from daily-hours prose or a full week', () => {
    expect(detectEmploymentType(null, null, '', 'Delo 8 ur dnevno.')).toBe('unknown');
    expect(detectEmploymentType(null, '40 ur/teden', '', '')).toBe('unknown');
  });
});

describe('requiredYears', () => {
  it('reads the structured field', () => {
    expect(requiredYears('3+ do 5 let', '')).toBe(3);
    expect(requiredYears('1 leto', '')).toBe(1);
    expect(requiredYears('Ni pomembno', '')).toBe(0);
    expect(requiredYears('Brez izkušenj', '')).toBe(0);
    expect(requiredYears('6 mesecev', '')).toBe(0);
  });

  it('reads experience requirements from prose', () => {
    expect(requiredYears(null, 'Pričakujemo najmanj 2 leti delovnih izkušenj.')).toBe(2);
    expect(requiredYears(null, 'At least 3 years of experience in training.')).toBe(3);
    expect(requiredYears(null, 'Experience: minimum 4 years in L&D.')).toBe(4);
  });

  it('ignores the employer describing its own experience', () => {
    expect(requiredYears(null, 'We are a training company with more than 10 years of experience in delivering workshops.')).toBeNull();
    expect(requiredYears(null, 'Smo podjetje z 20 leti izkušenj na trgu.')).toBeNull();
  });

  it('ignores numbers that are not experience', () => {
    expect(requiredYears(null, 'Podjetje s 30 leti tradicije išče sodelavca.')).toBeNull();
    expect(requiredYears(null, '')).toBeNull();
  });
});

describe('requiredForeignLanguages', () => {
  it('reports a language the ad requires', () => {
    expect(requiredForeignLanguages(null, 'Fluent German is required.')).toEqual(['nemščino']);
    expect(requiredForeignLanguages('nemški jezik: tekoče', '')).toEqual(['nemščino']);
  });

  it('ignores a language the ad merely welcomes', () => {
    expect(requiredForeignLanguages(null, 'Knowledge of French is an advantage.')).toEqual([]);
  });
});

describe('worthDetail', () => {
  it('fetches on-topic and generic titles, and skips obvious misses', () => {
    expect(worthDetail('KOORDINATOR IZOBRAŽEVANJ - M/Ž')).toBe(true);
    expect(worthDetail('STROKOVNI SODELAVEC VII/2 - M/Ž')).toBe(true);
    expect(worthDetail('HIŠNIK IV - M/Ž')).toBe(false);
    expect(worthDetail('SENIOR TRAINING MANAGER')).toBe(false);
    expect(worthDetail('Sodelavec', 'Natakar')).toBe(false);
  });
});

describe('classify scoring', () => {
  const remoteJunior = raw({
    title: 'Junior Learning & Development Coordinator', location: 'Europe', country: null,
    workModeRaw: 'Remote',
    description: 'Coordinate training programs, administer our LMS (Workday Learning) and support e-learning. Fluent English.',
  });
  const genericOnsite = raw({
    title: 'Strokovni sodelavec VII/2', location: 'Maribor',
    description: 'Organizacija izobraževanj, izvedba izobraževanj in analiza potreb po izobraževanju. Zahtevamo 5 let delovnih izkušenj.',
  });

  it('ranks a remote junior L&D role above a generic on-site one', () => {
    expect(classify(remoteJunior).score).toBeGreaterThan(classify(genericOnsite).score);
  });

  it('keeps every score within 0–100 and sums its parts', () => {
    for (const r of [remoteJunior, genericOnsite]) {
      const c = classify(r);
      const p = c.parts;
      const sum = p.relevance + p.experience + p.workMode + p.level + p.location + p.organisation + p.penalty;
      expect(c.score).toBe(Math.max(0, Math.min(100, sum)));
    }
  });

  it('explains the fit in Slovenian', () => {
    const c = classify(remoteJunior);
    expect(c.reasons.map((r) => r.text).join(' | ')).toMatch(/Izobraževanje in razvoj zaposlenih/);
    expect(c.reasons.some((r) => /LMS|Workday/.test(r.text))).toBe(true);
    expect(c.reasons.some((r) => r.text === 'Delo na daljavo')).toBe(true);
  });

  it('marks down a role that needs a language the seeker lacks', () => {
    const plain = classify(raw({ title: 'Training Coordinator' }));
    const german = classify(raw({ title: 'Training Coordinator', description: 'Fluent German is required.' }));
    expect(german.score).toBeLessThan(plain.score);
    expect(german.reasons.some((r) => r.text === 'Zahteva nemščino')).toBe(true);
  });
});
