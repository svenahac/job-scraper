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
    expect(area('EU Project Officer', '', 'Erasmus+ Youth Agency')).toContain('projects:title');
    expect(area('Projektni sodelavec (m/ž)', '', 'Društvo za nenasilno komunikacijo')).toContain('projects:title');
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

  it('does not take an education employer alone as an education context', () => {
    expect(area('Strokovni sodelavec za tehnične zadeve', '', 'Fakulteta za družbene vede'))
      .not.toContain('related:context');
    expect(why({ title: 'Strokovni sodelavec za tehnične zadeve', company: 'Fakulteta za družbene vede' }))
      .toBe('off-target');
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
    expect(kept({ title: 'Programme Officer, Directorate-General for Education', country: null, location: 'Europe', workModeRaw: 'Remote', international: true })).toBe(true);
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

describe('project work: social-science or digital only', () => {
  it('drops a project role with no social-science or digital context', () => {
    expect(why({ title: 'Projektni sodelavec (m/ž)' })).toBe('no-area');
    expect(why({ title: 'Project Coordinator', description: 'Coordinate production line projects with suppliers and plant engineers.' }))
      .toBe('no-area');
  });

  it('keeps a project role in the social sector, culture or education', () => {
    expect(kept({ title: 'Projektni sodelavec (m/ž)', description: 'Projekt socialnega vključevanja ranljivih skupin v sodelovanju z nevladnimi organizacijami.' }))
      .toBe(true);
    expect(kept({ title: 'Koordinator projektov', company: 'Muzej novejše zgodovine Slovenije' })).toBe(true);
  });

  it('keeps a digital project role that needs no programming', () => {
    expect(kept({ title: 'Koordinator projektov za digitalne produkte' })).toBe(true);
    expect(kept({ title: 'Project Coordinator', description: 'Coordinate digital campaigns and social media content for our clients.' }))
      .toBe(true);
  });

  it("does not take a portal's broad category as the project's context", () => {
    expect(why({ title: 'Svetovalec za podporo in koordinacijo projektov', company: 'Javni holding d.o.o.', tags: ['Javni sektor, Nevladne organizacije, Kultura'] }))
      .toBe('no-area');
  });

  it('drops a digital project role that asks for programming', () => {
    expect(why({ title: 'Digital Project Coordinator', description: 'Strong Python and SQL skills; JavaScript is a plus.' }))
      .toBe('no-area');
  });
});

describe('NGOs, museums, galleries, theatres and universities', () => {
  const area = (over: Partial<RawJob>) => classify(raw(over)).area;

  it('keeps educational roles at cultural institutions', () => {
    expect(kept({ title: 'Kustos pedagog (m/ž)', company: 'Narodna galerija' })).toBe(true);
    expect(kept({ title: 'Muzejski pedagog', company: 'Mestni muzej Ljubljana' })).toBe(true);
  });

  it('keeps administrative and organising roles at NGOs and cultural institutions', () => {
    expect(area({ title: 'Administrator (m/ž)', company: 'Društvo za nenasilno komunikacijo' })).toBe('institutions');
    expect(area({ title: 'Poslovni sekretar VI (m/ž)', company: 'SNG Drama Ljubljana' })).toBe('institutions');
    expect(area({ title: 'Organizator kulturnih programov', company: 'Cankarjev dom' })).toBe('institutions');
    expect(kept({ title: 'Koordinator (m/ž)', company: 'Zavod Bob', description: 'Smo nevladna organizacija, ki razvija programe za mlade.' }))
      .toBe(true);
  });

  it('keeps administrative and project roles at the university', () => {
    expect(area({ title: 'Samostojni strokovni sodelavec v referatu za študijske zadeve VII/2', company: 'Univerza v Ljubljani, Fakulteta za družbene vede' }))
      .toBe('institutions');
    expect(kept({ title: 'Strokovni sodelavec za mednarodno sodelovanje', company: 'UNIVERZA V LJUBLJANI, FAKULTETA ZA STROJNIŠTVO' }))
      .toBe(true);
  });

  it('does not take the same titles at other employers', () => {
    expect(why({ title: 'Administrator (m/ž)', company: 'Petrol d.d.' })).toBe('no-area');
    expect(why({ title: 'Poslovni sekretar VI (m/ž)', company: 'Acme d.o.o.' })).toBe('no-area');
    expect(why({ title: 'Strokovni sodelavec (m/ž)', company: 'Univerzitetni klinični center Ljubljana' }))
      .toBe('no-area');
  });

  it('still drops off-target, academic and senior roles at those employers', () => {
    expect(why({ title: 'Računovodja (m/ž)', company: 'Moderna galerija' })).toBe('off-target');
    expect(why({ title: 'Asistent za področje kemije', company: 'Univerza v Ljubljani, Fakulteta za kemijo' })).toBe('no-area');
    expect(why({ title: 'Tajnik fakultete (m/ž)', company: 'Univerza v Ljubljani, Filozofska fakulteta' })).toBe('senior');
    expect(why({ title: 'Sekretar (m/ž)', company: 'Ministrstvo za kulturo' })).toBe('senior');
  });
});

describe('counselling and social work instead of school teaching', () => {
  it('keeps counsellors, social workers and youth workers', () => {
    expect(kept({ title: 'Svetovalni delavec – pedagog (m/ž)', company: 'Osnovna šola Ledina' })).toBe(true);
    expect(kept({ title: 'Socialni delavec (m/ž)', company: 'Center za socialno delo Ljubljana' })).toBe(true);
    expect(kept({ title: 'Mladinski delavec', company: 'Mladinski center Koper', location: 'Koper' })).toBe(true);
    expect(classify(raw({ title: 'Socialni delavec (m/ž)' })).area).toBe('counselling');
  });

  it('still drops classroom teaching', () => {
    expect(why({ title: 'Učitelj slovenščine (m/ž)', company: 'Osnovna šola Ledina' })).toBe('off-target');
  });

  it('drops counselling posts meant for psychologists, unless a pedagogue may apply', () => {
    expect(why({ title: 'SVETOVALNI DELAVEC (PSIHOLOG NA OSNOVNI ŠOLI) - M/Ž' })).toBe('off-target');
    expect(why({ title: 'SVETOVALNI DELAVEC - M/Ž', occupation: 'Psiholog' })).toBe('off-target');
    expect(kept({ title: 'Svetovalni delavec – pedagog ali psiholog (m/ž)' })).toBe(true);
  });

  it('does not mistake recruiting for career counselling', () => {
    expect(why({ title: 'Sodelavec za iskanje in selekcijo kadra (m/ž)', occupation: 'Karierni svetovalec' })).toBe('hr');
  });

  it('drops technical specialists at associations', () => {
    expect(why({ title: 'SVETOVALEC - SPECIALIST ZA TEHNOLOGIJO ČEBELARJENJA - M/Ž', company: 'ČEBELARSKA ZVEZA SLOVENIJE' }))
      .toBe('off-target');
  });
});

describe('location', () => {
  it('places the Ljubljana area, Koper and Izola, and remote work', () => {
    expect(locationClassFor({ location: 'Domžale', country: 'SI' }, 'onsite')).toBe('ljubljana');
    expect(locationClassFor({ location: 'KOPER - CAPODISTRIA', country: 'SI' }, 'onsite')).toBe('coast');
    expect(locationClassFor({ location: 'Izola', country: 'SI' }, 'hybrid')).toBe('coast');
    expect(locationClassFor({ location: 'Europe', country: null }, 'remote')).toBe('remote');
    expect(locationClassFor({ location: '148 countries incl. Slovenia', country: null }, 'remote')).toBe('remote');
  });

  it('drops the rest of Slovenia unless the work is fully remote', () => {
    expect(locationClassFor({ location: 'MARIBOR', country: 'SI' }, 'onsite')).toBeNull();
    expect(locationClassFor({ location: 'Celje', country: 'SI' }, 'hybrid')).toBeNull();
    expect(locationClassFor({ location: 'Piran', country: 'SI' }, 'onsite')).toBeNull();
    expect(locationClassFor({ location: 'MARIBOR', country: 'SI' }, 'remote')).toBe('remote');
    expect(why({ title: 'Koordinator izobraževanj', location: 'Novo mesto' })).toBe('location');
    expect(kept({ title: 'Koordinator izobraževanj', location: 'Izola' })).toBe(true);
  });

  it('keeps a Slovenian posting that names no town, with a warning', () => {
    expect(locationClassFor({ location: 'Slovenia', country: 'SI' }, 'onsite')).toBe('slovenia');
    const c = classify(raw({ title: 'Koordinator izobraževanj', location: 'Slovenija' }));
    expect(isWanted(c)).toBe(true);
    expect(c.reasons.some((r) => r.kind === 'warn' && /kraj/i.test(r.text))).toBe(true);
  });

  it('drops on-site and hybrid work abroad, even from international-organisation boards', () => {
    expect(locationClassFor({ location: 'Berlin, Germany', country: 'DE' }, 'onsite')).toBeNull();
    expect(locationClassFor({ location: 'Brussels, Belgium', country: 'BE', international: true }, 'onsite'))
      .toBeNull();
    expect(locationClassFor({ location: 'Brussels, Belgium', country: 'BE', international: true }, 'hybrid'))
      .toBeNull();
    expect(why({ title: 'Programme Officer – Education', location: 'Brussels, Belgium', country: 'BE', international: true }))
      .toBe('location');
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
    title: 'Strokovni sodelavec VII/2', location: 'Ljubljana',
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
