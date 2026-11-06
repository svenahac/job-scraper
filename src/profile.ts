/**
 * The seeker's profile: what to look for, what to drop, and what counts in the
 * match score. Everything tunable lives here; classify.ts only applies it.
 *
 * Term syntax (all lists below): lowercase, diacritics optional. A term must
 * start at a word boundary and matches as a prefix, so 'izobraževanj' finds
 * "izobraževanja" and "izobraževanje". '*' inside a term stands for any run of
 * letters: 'koordinator* izobraževanj' finds "koordinatorka izobraževanj".
 * A trailing '$' demands a word end ('director$' skips "Directorate"), and
 * terms shorter than four characters always match whole words only, so 'hr'
 * never fires inside "hrvaščina".
 */

export type AreaKey =
  | 'ld' | 'projects' | 'education' | 'digital' | 'counselling' | 'institutions' | 'related';

export interface Area {
  key: AreaKey;
  /** Slovenian label shown in the app. */
  label: string;
  /** A hit in the title makes the posting this area outright. */
  title: readonly string[];
  /** Body phrases. With no title hit, BODY_MIN distinct body hits are needed. */
  body: readonly string[];
  /**
   * The area counts only at an INSTITUTION_ORGS employer, or one whose ad
   * calls itself a non-profit (NONPROFIT_BODY). Its title terms are generic
   * ("Administrator", "Koordinator"), so a hit is context, not a title match:
   * off-target professions there ("Računovodja v galeriji") are still dropped.
   */
  institutionsOnly?: true;
}

export const AREAS: readonly Area[] = [
  {
    key: 'ld',
    label: 'Izobraževanje in razvoj zaposlenih (L&D)',
    title: [
      'learning & development', 'learning and development', 'learning&development', 'l&d',
      'learning specialist', 'learning coordinator', 'learning partner', 'learning officer',
      'learning advisor', 'learning consultant', 'learning administrator', 'learning analyst',
      'learning experience', 'learning program', 'learning operations', 'learning manager',
      'training coordinator', 'training specialist', 'training officer', 'training administrator',
      'training consultant', 'training manager', 'training program', 'training and development',
      'training & development', 'corporate trainer', 'internal trainer', 'course coordinator',
      'course officer', 'course and conference', 'courses and conferences', 'koordinator* tečaj',
      'talent development', 'employee development', 'people development', 'corporate learning',
      'learning management system', 'lms administrator', 'lms specialist', 'lms', 'academy coordinator',
      'razvoj kadrov', 'razvoj zaposlenih', 'razvoj talentov', 'razvoj kompetenc',
      'izobraževanj* zaposlenih', 'izobraževanj* in razvoj', 'izobraževanj* ter razvoj',
      'koordinator* izobraževanj', 'koordinator* usposabljanj', 'skrbni* izobraževanj',
      'organizator* izobraževanj', 'referent* za izobraževanj', 'specialist* za izobraževanj',
      'strokovnja* za izobraževanj', 'vodja izobraževanj', 'vodja usposabljanj',
      'izobraževanj* in usposabljanj', 'usposabljanj* zaposlenih', 'interna akademija',
      'interne akademije',
    ],
    body: [
      'learning and development', 'learning & development', 'l&d', 'razvoj kadrov',
      'razvoj zaposlenih', 'izobraževanj* zaposlenih', 'organizacij* izobraževanj',
      'izvedb* izobraževanj', 'načrtovanj* izobraževanj', 'potreb* po izobraževanj',
      'koordinacij* izobraževanj', 'izobraževaln* dogodk', 'usposabljanj* zaposlenih',
      'training needs', 'training program', 'learning program', 'training sessions',
      'interna akademija', 'interne akademije', 'notranja akademija', 'talent development',
      'employee development', 'razvoj kompetenc', 'kompetenčn* model', 'competency model',
      'mentorsk* program', 'learning management system', 'lms', 'workday learning',
      'successfactors learning', 'linkedin learning', 'cornerstone', 'degreed',
      'learning culture', 'upskilling', 'reskilling',
    ],
  },
  {
    key: 'projects',
    label: 'Projekti in koordinacija',
    title: [
      'project coordinator', 'project officer', 'project assistant', 'project support',
      'project administrator', 'project associate', 'project specialist', 'junior project manager',
      'programme coordinator', 'program coordinator', 'programme officer', 'program officer',
      'programme assistant', 'program assistant', 'programme associate', 'programme administrator',
      'grants officer', 'grant officer', 'grant coordinator', 'grants coordinator', 'funding officer',
      'eu project', 'eu funding', 'eu affairs', 'mobility officer', 'mobility coordinator',
      'international office', 'international relations officer', 'erasmus',
      'projektn* koordinator', 'koordinator* projekt', 'projektn* sodelav', 'projektn* asistent',
      'projektn* administrator', 'projektn* referent', 'sodelav* za projekt', 'sodelav* na projekt',
      'svetoval* za projekt', 'skrbni* projekt', 'administrator* projekt', 'asistent* za projekt',
      'eu projekt', 'evropsk* projekt', 'mednarodn* projekt', 'razvojn* projekt',
      'projektn* pisarn', 'mednarodn* pisarn', 'mednarodn* sodelovanj', 'koordinator* mednarodn',
      'koordinacij* projekt', 'podpor* projekt', 'podpor* in koordinacij* projekt',
      'koordinator* program', 'programsk* koordinator', 'mobilnost',
    ],
    body: [
      'erasmus', 'evropsk* projekt', 'eu projekt', 'eu-projekt', 'mednarodn* projekt',
      'horizon europe', 'horizon 2020', 'interreg', 'creative europe', 'kreativna evropa',
      'evropsk* socialn* sklad', 'kohezijsk', 'eu funding', 'eu-funded', 'eu funded',
      'project proposals', 'projektn* prijav', 'prijav* na razpis', 'project coordination',
      'koordinacij* projekt', 'vodenj* projekt', 'projektn* vodenj', 'project management',
      'project reporting', 'poročanj* o projekt', 'projektn* poročil', 'projektn* partner',
      'project partners', 'grant agreement',
    ],
  },
  {
    key: 'education',
    label: 'Izobraževanje odraslih in izobraževalni programi',
    title: [
      'andragog', 'adult education', 'adult learning', 'lifelong learning', 'education programme',
      'education program', 'educational program', 'educational programme', 'education officer',
      'education coordinator', 'education specialist', 'education consultant', 'education advisor',
      'education manager', 'education project', 'curriculum', 'learning programme coordinator',
      'izobraževanj* odrasl', 'vseživljenjsk* učenj', 'izobraževaln* program',
      'koordinator* izobraževaln', 'koordinator* študijsk', 'skrbni* študijsk',
      'organizator* izobraževanj', 'strokovn* sodelav* za izobraževanj',
      'strokovn* delav* za izobraževanj', 'strokovn* sodelav* za razvoj izobraževaln',
      'strokovn* sodelav* v izobraževanj', 'svetoval* za izobraževanj',
      'svetoval* v izobraževanj', 'svetovaln* središč', 'kurikul', 'didaktik',
      // Educators at museums and galleries.
      'kustos* pedagog', 'muzejsk* pedagog', 'galerijsk* pedagog', 'museum educat',
      'gallery educat',
    ],
    body: [
      'izobraževanj* odrasl', 'andragoš', 'andragog', 'vseživljenjsk* učenj', 'lifelong learning',
      'adult education', 'adult learning', 'izobraževaln* program', 'study programme',
      'educational programme', 'education programme', 'curriculum', 'kurikul', 'učn* načrt',
      'ljudsk* univerz', 'neformaln* izobraževanj', 'non-formal education', 'svetovanj* v izobraževanj',
      'andragošk* center', 'cmepius', 'zavod za šolstvo', 'didaktik', 'pedagoš',
    ],
  },
  {
    key: 'digital',
    label: 'Digitalno izobraževanje in EdTech',
    title: [
      'edtech', 'ed-tech', 'educational technolog', 'education technolog', 'learning technolog',
      'digital learning', 'digital education', 'e-learning', 'elearning', 'instructional design',
      'learning design', 'learning content', 'course designer', 'course developer', 'course creator',
      'online learning', 'digital skills', 'moodle', 'mooc',
      'digitaln* izobraževanj', 'e-izobraževanj', 'e-učenj', 'spletn* učenj', 'spletn* izobraževanj',
      'digitaln* kompetenc', 'digitaln* vešč', 'izobraževaln* tehnologij',
    ],
    body: [
      'edtech', 'e-learning', 'elearning', 'e-izobraževanj', 'e-učenj', 'moodle', 'articulate',
      'storyline', 'rise 360', 'instructional design', 'learning design', 'digital learning',
      'digitaln* izobraževanj', 'spletn* tečaj', 'online course', 'digital skills',
      'digitaln* kompetenc', 'digitaln* vešč', 'blended learning', 'kombiniran* učenj',
      'learning platform', 'učn* platform', 'izobraževaln* platform', 'learning management system',
    ],
  },
  {
    // Pedagogical work outside the classroom: school counselling services,
    // social work, youth work. Teaching itself stays in TITLE_REJECT.
    key: 'counselling',
    label: 'Svetovalno in socialno delo',
    title: [
      'svetovaln* delav', 'svetovaln* služb', 'socialn* delav', 'socialn* pedagog', 'pedagog$',
      'pedagoginj', 'kariern* svetoval', 'kariern* orientacij', 'mladinsk* delav', 'delo z mladimi',
      'koordinator* prostovolj', 'socialn* vključ', 'social worker', 'youth worker', 'case worker',
      'caseworker', 'counsellor', 'counselor', 'career adviser', 'career advisor', 'career counsel',
      'social inclusion',
    ],
    body: [
      'socialn* delo', 'socialn* varstv', 'center za socialno delo', 'svetovaln* delo',
      'svetovaln* služb', 'psihosocialn', 'ranljiv* skupin', 'socialn* vključ', 'socialn* izključ',
      'mladinsk* delo', 'delo z mladimi', 'karierno svetovanje', 'kariern* orientacij', 'prostovolj',
      'social work', 'social inclusion', 'vulnerable groups', 'counselling', 'counseling',
      'youth work', 'skupnostn', 'community work',
    ],
  },
  {
    // Administrative, organising and programme roles at NGOs, cultural
    // institutions and universities: the employer makes them a fit.
    key: 'institutions',
    label: 'Nevladne, kulturne in univerzitetne ustanove',
    institutionsOnly: true,
    title: [
      'administrator', 'administrativn', 'administrative', 'poslovn* sekretar', 'tajni', 'office',
      'pisarn', 'referent', 'referat', 'strokovn* sodelav', 'strokovn* delav', 'samostojn* strokovn',
      'svetoval', 'koordinator', 'organizator', 'coordinator', 'organiser', 'organizer', 'producent',
      'producer', 'programsk', 'izvajal* program', 'izvajal* delavnic', 'mentor',
    ],
    body: [
      'nevladn* organizacij', 'neprofitn', 'non-profit', 'nonprofit', 'civiln* družb',
      'civil society', 'kulturn* program', 'kulturn* dediščin', 'cultural heritage', 'muzejsk',
      'galerijsk', 'razstav', 'exhibition', 'gledališk', 'kulturn* prireditv', 'kulturn* dogodk',
      'študijsk* proces', 'študijsk* zadev', 'študentsk* zadev', 'visokošolsk', 'higher education',
      'študijsk* program', 'mednarodn* izmenjav', 'student exchange', 'administrativn* podpor',
      'administrativn* del', 'administrative support', 'pisarniš* poslovanj',
    ],
  },
  {
    key: 'related',
    label: 'Druge sorodne pozicije',
    title: [
      'knowledge management', 'knowledge manager', 'knowledge specialist', 'knowledge officer',
      'organisational development', 'organizational development', 'organisation development',
      'people development coordinator', 'community education', 'training and events',
      'capacity building', 'capacity development',
      'upravljanj* znanj', 'organizacijsk* razvoj', 'razvoj organizacij',
      // Only with an education context; see CONTEXTUAL below.
      'research assistant', 'research associate', 'raziskovaln* asistent', 'raziskovaln* sodelav',
      'raziskovalec$', 'raziskovalk', 'event coordinator', 'events coordinator', 'koordinator* dogodk', 'organizator* dogodk',
      'project manager', 'programme manager', 'program manager', 'vodja projekt', 'projektn* vodja',
      'community coordinator', 'strokovn* sodelav',
    ],
    body: [
      'upravljanj* znanj', 'knowledge management', 'capacity building', 'organizacijsk* razvoj',
      'organisational development', 'organizational development', 'educational events',
      'training events', 'community education',
    ],
  },
];

/**
 * Title terms too generic on their own ("Project Manager" at a builder,
 * "Research Assistant" in a chemistry lab). They count only when the title
 * or the body also carries an EDUCATION_CONTEXT term.
 */
export const CONTEXTUAL: readonly string[] = [
  'research assistant', 'research associate', 'raziskovaln* asistent', 'raziskovaln* sodelav',
  'raziskovalec$', 'raziskovalk',
  'event coordinator', 'events coordinator', 'koordinator* dogodk', 'organizator* dogodk',
  'project manager', 'programme manager', 'program manager', 'vodja projekt', 'projektn* vodja',
  'community coordinator', 'strokovn* sodelav', 'koordinator* program', 'programsk* koordinator',
  'mobilnost',
];

/** What turns a generic title into an in-scope one. */
export const EDUCATION_CONTEXT: readonly string[] = [
  'izobraževanj', 'izobraževaln', 'usposabljanj', 'učenj', 'andragog', 'pedagog', 'didakt',
  'education', 'educational', 'learning', 'training', 'curriculum', 'kurikul', 'erasmus',
  'evropsk* projekt', 'eu projekt', 'mednarodn* projekt', 'lifelong', 'vseživljenjsk',
  'kompetenc', 'competenc', 'skills', 'vešč', 'e-learning', 'edtech', 'univerz', 'fakultet',
  'university', 'school', 'šol', 'mladin', 'youth',
];

/** Companies whose name alone gives a generic title an education context. */
export const EDUCATION_ORGS: readonly string[] = [
  'univerz', 'university', 'fakultet', 'faculty', 'ljudsk* univerz', 'andragošk', 'cmepius',
  'izobraževaln', 'education', 'learning', 'akademij', 'academy', 'šolsk* center',
  'zavod za šolstvo', 'edtech', 'erasmus',
];

/** EU-programme vocabulary. Makes project roles a better fit. */
export const EU_TERMS: readonly string[] = [
  'erasmus', 'evropsk* projekt', 'eu projekt', 'eu-projekt', 'horizon europe', 'horizon 2020',
  'interreg', 'creative europe', 'kreativna evropa', 'evropsk* socialn* sklad', 'kohezijsk',
  'eu funding', 'eu-funded', 'eu funded', 'european commission', 'evropsk* komisij',
];

/**
 * NGOs, cultural institutions and universities, matched against the
 * employer's name. 'univerza$' and its cases, not 'univerz': the University
 * Medical Centre ("Univerzitetni klinični center") is a hospital.
 */
export const INSTITUTION_ORGS: readonly string[] = [
  // Culture.
  'muzej', 'museum', 'galerij', 'gallery', 'gledališ', 'theatre', 'theater', 'opera$',
  'filharmonij', 'orkest', 'knjižnic', 'library', 'kultur', 'cultural', 'kinodvor', 'kinotek',
  'cankarjev dom', 'sng', 'festival', 'arhiv', 'dediščin', 'umetnost', 'umetnišk', 'kud',
  'ljubljanski grad', 'mladinsk* center', 'mladinsk* dom',
  // Non-profits and the social sector.
  'društv', 'zveza', 'fundacij', 'foundation', 'ustanova', 'nevladn', 'nvo', 'ngo', 'non-profit',
  'nonprofit', 'neprofitn', 'humanitarn', 'rdeč* križ', 'red cross', 'karitas', 'caritas',
  'center za socialn* delo', 'andragošk', 'ljudsk* univerz', 'cmepius',
  // Universities and their members.
  'univerza$', 'univerze$', 'univerzi$', 'university$', 'fakultet', 'faculty', 'akademija za',
  'academy of',
];

/** An ad that says this about its employer is from a non-profit. */
export const NONPROFIT_BODY: readonly string[] = [
  'nevladn* organizacij', 'non-governmental organi', 'neprofitn* organizacij', 'neprofitn* zavod',
  'non-profit organi', 'nonprofit organi', 'not-for-profit', 'civil society organi',
  'organizacij* civiln* družb', 'humanitarn* organizacij',
];

/**
 * Project work counts only when it is social-science or digital (the seeker
 * does not program). These place it in the social sciences, humanities,
 * culture or the social sector: one hit in the title or source tags.
 */
export const SOCIAL_CONTEXT: readonly string[] = [
  'družboslov', 'social science', 'humanist', 'humanities', 'sociolog', 'antropolog', 'politolog',
  'kulturolog', 'komunikolog', 'pedagog', 'andragog', 'kultur', 'culture', 'cultural', 'umetnost',
  'umetnišk', 'arts$', 'dediščin', 'heritage', 'muzej', 'museum', 'galerij', 'gledališ', 'theatre',
  'socialn', 'social$', 'skupnost', 'community', 'mladin', 'youth', 'nevladn', 'ngo', 'nvo',
  'non-profit', 'nonprofit', 'neprofitn', 'civil society', 'civiln* družb', 'human rights',
  'človekov* pravic', 'enakost', 'equality', 'gender', 'migrant', 'migracij', 'begun', 'refugee',
  'prostovolj',
  'volunteer', 'demokra', 'participacij', 'zaposljiv', 'employability', 'inclusion', 'vključevanj',
  'journalis', 'novinar', 'komunikacij', 'communication', 'policy', 'javn* politik', 'eu affairs',
  'evropsk* zadev',
];

/** The same for ad prose: specific phrases, two distinct hits needed. */
export const SOCIAL_BODY: readonly string[] = [
  'družboslov', 'social sciences', 'humanistik', 'humanities', 'nevladn* organizacij',
  'non-governmental', 'neprofitn', 'non-profit', 'nonprofit', 'civil society', 'civiln* družb',
  'socialn* vključ', 'social inclusion', 'ranljiv* skupin', 'vulnerable groups',
  'človekov* pravic', 'human rights', 'enakost spolov', 'gender equality', 'migrant', 'begun',
  'refugee', 'mladinsk* delo', 'youth work', 'mladin', 'youth', 'kulturn* dediščin',
  'cultural heritage', 'kulturn* program', 'cultural programme', 'umetnost', 'muzej', 'museum',
  'galerij', 'gledališ', 'prostovolj', 'volunteer', 'skupnostn', 'community development',
  'lokaln* skupnost', 'local communit', 'participacij', 'demokracij', 'democracy',
  'javn* politik', 'public policy', 'sociolog', 'antropolog', 'politolog', 'zaposljiv',
  'employability', 'socialn* podjetn', 'social entrepreneur', 'novinar', 'journalism',
  // EU programmes for education, youth, culture and social inclusion.
  'erasmus', 'creative europe', 'kreativna evropa', 'evropsk* socialn* sklad', 'esf$',
  'europe for citizens', 'cerv$',
];

/** Digital work in the title or source tags: one hit. */
export const DIGITAL_CONTEXT: readonly string[] = [
  'digital', 'digitaln', 'digitaliz', 'e-learning', 'e-učenj', 'e-izobraževanj', 'online',
  'spletn', 'web', 'internet', 'social media', 'družbenih omrežij', 'družbena omrežja',
  'družbenih medij', 'multimedij', 'content', 'saas', 'software', 'programsk* oprem', 'aplikacij',
  'platform', 'ux', 'umetn* inteligenc', 'artificial intelligence', 'ai$', 'ikt', 'ict',
  'informacijsk* tehnologij', 'information technolog', 'it projekt', 'it project', 'e-commerce',
  'e-trgovin', 'spletn* trgovin',
];

/**
 * Digital work in ad prose: two distinct hits. Narrower than the title list:
 * "spletna stran" and "online" sit in every ad's application instructions.
 */
export const DIGITAL_BODY: readonly string[] = [
  'digital', 'digitaln', 'digitaliz', 'e-learning', 'e-učenj', 'social media',
  'družbenih omrežij', 'družbena omrežja', 'družbenih medij', 'multimedij', 'saas', 'software',
  'programsk* oprem', 'umetn* inteligenc', 'artificial intelligence', 'informacijsk* tehnologij',
  'information technolog', 'ikt', 'ict', 'e-commerce', 'e-trgovin', 'spletn* trgovin',
  'spletn* vsebin', 'web content', 'website', 'ux', 'online platform', 'spletn* platform',
  'digital tools', 'digitaln* orodj',
];

/**
 * Programming as part of the job: a project role naming it in the title, or
 * twice in the ad, is not the digital work the seeker means.
 */
export const PROGRAMMING: readonly string[] = [
  'programiranj', 'programming', 'programsk* jezik', 'coding', 'kodiranj', 'javascript',
  'typescript', 'python', 'java$', 'php$', 'sql$', 'html', 'css$', 'backend', 'back-end',
  'frontend', 'front-end', 'full-stack', 'fullstack', 'software development', 'software engineer',
  'razvoj programsk* oprem', 'razvijalec', 'razvijalk', 'developer', 'devops', 'git$', 'api$',
];

/**
 * Role words generic enough that the ad body decides. Sources use these to
 * pick which postings are worth a detail-page request.
 */
export const GENERIC_ROLES: readonly string[] = [
  'strokovn* sodelav', 'strokovn* delav', 'svetoval', 'koordinator', 'referent', 'organizator',
  'asistent', 'specialist', 'sodelav', 'skrbni', 'officer', 'coordinator', 'assistant',
  'associate', 'advisor', 'adviser', 'consultant', 'administrator', 'administrativn', 'tajni',
  'poslovn* sekretar', 'pisarn', 'office', 'producent', 'mentor',
];

/** Words that place a stated language among the requirements. */
export const LANGUAGE_REQUIRED: readonly string[] = [
  'znanj', 'obvlad', 'tekoč', 'fluent', 'proficien', 'required', 'zahtev', 'pogoj', 'must',
  'native', 'c1', 'c2', 'b2', 'aktivn', 'excellent', 'odličn',
];

/** Words that make a stated language a nice-to-have instead. */
export const LANGUAGE_OPTIONAL: readonly string[] = [
  'prednost', 'advantage', 'asset', 'plus', 'zaželen', 'desirable', 'nice to have', 'bonus',
  'preferred',
];

/**
 * General-HR titles: dropped outright, unless the title itself also names
 * learning (an "HR Specialist – Learning & Development" survives).
 */
export const HR_REJECT: readonly string[] = [
  'hr business partner', 'hrbp', 'hr manager', 'head of hr', 'hr director', 'hr lead',
  'hr head', 'chief people', 'people partner', 'people business partner', 'hr generalist',
  'hr administrator', 'hr admin', 'hr assistant', 'hr operations', 'people operations',
  'recruiter', 'recruitment', 'recruiting', 'talent acquisition', 'talent sourcer', 'sourcer',
  'headhunter', 'rekruter', 'kadrovanj', 'zaposlovanj', 'selekcij', 'iskanj* kad', 'payroll',
  'obračun* plač', 'plač',
  'compensation', 'benefits', 'total rewards', 'employee relations', 'personnel administration',
  'kadrovsk* referent', 'kadrovsk* administr', 'kadrovik', 'kadrovičk',
  'vodja kadrov', 'direktor* kadrov', 'kadrovsk* služb', 'kadrovsk* zadev', 'kadrovsk* področj',
  'delovnopravn', 'delovno-pravn',
];

/**
 * HR titles that may still be L&D in substance. Kept only when the body is
 * clearly about learning: three or more LEARNING_SUBSTANCE hits, and more of
 * them than HR_ADMIN_SUBSTANCE hits.
 */
export const HR_GENERIC: readonly string[] = [
  'hr specialist', 'hr coordinator', 'hr officer', 'hr associate', 'hr expert', 'hr consultant',
  'hr partner', 'hr project', 'people & culture', 'people and culture', 'people specialist',
  'people coordinator', 'people experience', 'employee experience', 'talent management',
  'kadrovsk* specialist', 'kadrovsk* strokovn', 'strokovn* sodelav* za kadr', 'kadrov',
  'človešk* vir', 'human resources', 'hr',
];

export const LEARNING_SUBSTANCE: readonly string[] = [
  'izobraževanj', 'usposabljanj', 'learning', 'training', 'razvoj kadrov', 'razvoj zaposlenih',
  'kompetenc', 'competenc', 'talent development', 'onboarding', 'uvajanj', 'mentorstv',
  'coaching', 'lms', 'e-learning', 'akademij', 'academy',
];

export const HR_ADMIN_SUBSTANCE: readonly string[] = [
  'payroll', 'obračun* plač', 'plač', 'kadrovsk* evidenc', 'kadrovsk* administracij',
  'pogodb* o zaposlitvi', 'employment contract', 'delovnopravn', 'delovno-pravn',
  'zaposlovanj', 'recruit', 'rekrutacij', 'selekcij', 'iskanj* kandidat', 'talent acquisition',
  'odsotnost', 'bolniš', 'evidenc* delovnega časa',
];

/**
 * Clearly senior, managerial or executive titles: dropped. "Vodja" and
 * "Manager" are deliberately absent — in Slovenian ads they often name a
 * coordinator-level role — and cost points instead (SENIOR_PENALTY).
 */
export const SENIOR_REJECT: readonly string[] = [
  'senior', 'sr.', 'principal', 'head of', 'director$', 'directors$', 'direktor$', 'direktoric',
  'generaln* direktor', 'chief', 'vice president', 'vp of', 'predsedni', 'predstojni', 'dekan',
  'ravnatelj', 'glavn* tajni', 'generaln* sekretar', 'secretary general', 'podsekretar',
  'lead$', 'leader', 'team lead', 'vodiln', 'z doktoratom', 'phd', 'postdoc', 'doktor znanosti',
  'sekretar$', 'sekretarka$', 'vodja sektorja', 'vodja službe', 'vodja oddelka', 'vodja enote',
  'vodja področja', 'vodja divizije', 'executive director', 'managing director', 'višj* vodja',
  // The head of a faculty's administration, not a secretary.
  'tajni* fakultet', 'tajni* univerz', 'tajni* članic', 'tajni* akademij',
];

/**
 * Exceptions to 'sekretar$' above: in the civil service "Sekretar" is a
 * senior rank, but a "poslovni sekretar" is an administrative assistant.
 */
export const SENIOR_EXCEPT: readonly string[] = [
  'poslovn* sekretar', 'administrativn* sekretar',
];

/** Titles that cost experience points but are not dropped. */
export const SENIOR_PENALTY: readonly string[] = [
  'vodja', 'manager', 'višj* svetoval', 'samostojn* strokovn* sodelav* specialist',
  'expert', 'ekspert',
];

export const JUNIOR_MARKERS: readonly string[] = [
  'junior', 'entry level', 'entry-level', 'associate', 'assistant', 'asistent', 'mlajš',
  'začetn', 'graduate', 'trainee', 'brez izkušenj', 'no experience',
];

/**
 * Off-target professions. Dropped, unless an area title term also matches
 * ("Učitelj v izobraževanju odraslih" survives on its adult-education match).
 */
export const TITLE_REJECT: readonly string[] = [
  'računovod', 'knjigovod', 'komercialist', 'prodaj', 'sales', 'account manager',
  'key account', 'klicni center', 'call center', 'telefonsk', 'vnos podatkov', 'data entry',
  'inkaso', 'izterjav', 'blagajn', 'skladišč', 'voznik', 'driver', 'natakar', 'kuhar', 'čistil',
  'varnostnik', 'revizor', 'auditor', 'finančn* svetoval', 'bančn* svetoval', 'zavarovaln',
  'email marketing', 'podporo strankam', 'customer support', 'customer service',
  'učitelj', 'vzgojitelj', 'profesor', 'predavatelj', 'docent', 'zdravnik', 'medicinsk* sestr',
  'negoval', 'farmacevt', 'fizioterapevt', 'psiholog', 'logoped',
  'programer', 'razvijalec', 'developer', 'software', 'devops', 'inženir', 'engineer', 'tehnik',
  'tehničn', 'laborant', 'laborator', 'javn* naročil', 'finančn', 'ekonomsk', 'pravn',
  'sistemsk* administr', 'system administr', 'omrežn* administr', 'network administr',
  'administrator* baz', 'database administr', 'tehnolog',
  'mehanik', 'električar', 'serviser', 'hišnik', 'vzdrževal', 'operater', 'proizvodn',
  'osebn* asistent', 'zobozdrav', 'zdravstvenik', 'sanitarn', 'strežb', 'na pošti', 'poštn',
  'evidentičar', 'kontrolor', 'varuh', 'oskrbovalec', 'negovalk',
  'nabav', 'procurement', 'logist', 'pravnik', 'odvetni', 'lawyer', 'legal counsel',
  'marketing manager', 'seo', 'graphic designer', 'grafičn* oblikoval', 'controller',
  'kontroling', 'finance', 'financial', 'accountant', 'analitik podatk', 'data analyst',
  'data scientist', 'teacher', 'teaching', 'tutor', 'lecturer', 'udeleženec', 'udeleženk',
  'informatik', 'oskrbovaln', 'it podpor', 'it support', 'računalničar',
  'izredn* dogod', 'product manager', 'product owner',
];

/**
 * Posts for a profession the seeker is not trained in, even under a
 * counselling title ("Svetovalni delavec – psiholog"). Read from the title and
 * the source's occupation code; kept when the title also lets a DEGREE_ROUTE
 * profession apply ("pedagog ali psiholog").
 */
export const DEGREE_REJECT: readonly string[] = ['psiholog', 'logoped'];
export const DEGREE_ROUTE: readonly string[] = ['pedagog', 'andragog', 'socialn* delav'];

/** Trade/engineering qualifiers in title, occupation or tags. Never rescued. */
export const DOMAIN_REJECT: readonly string[] = [
  'gradben', 'gradnj', 'elektrotehni', 'elektroinštal', 'strojn', 'energetik', 'plc',
  'montaž', 'avtomatizacij', 'construction', 'mechanical', 'electrical',
  // Product roles at EdTech companies: the "EdTech" does not make them L&D.
  'product manager', 'product designer', 'product owner', 'head of product',
  // Special-needs teaching needs its own degree; 'pedagog$' would let it in.
  'specialn* pedagog', 'specialn* in rehabilitacijsk', 'rehabilitacijsk* pedagog',
  'inkluzivn* pedagog',
];

/** Contract kinds out of scope for an experienced graduate. Title and contract field only. */
export const CONTRACT_REJECT: readonly string[] = [
  'študentsk* delo', 'študentsko', 'student job', 'volontersk', 'volunteer', 'praktikant',
  'pripravni', 'obvezn* praks', 'internship', 'intern$', 'interns$', 'stažist',
  'seconded national expert', 'national expert', 'sne$',
];

/** Flag only. An L&D role that also handles some payroll is still an L&D role. */
export const BODY_WARN: readonly string[] = [
  'payroll', 'obračun* plač', 'kadrovsk* administracij', 'kadrovsk* evidenc',
  'delovnopravn* administracij', 'prodajn* cilj', 'klicanj* strank',
];

/** The seeker's own experience and tools. Each distinct hit raises the score. */
export const SKILLS: ReadonlyArray<{ label: string; terms: readonly string[] }> = [
  { label: 'LMS', terms: ['lms', 'learning management system', 'sistem za upravljanje učenja'] },
  { label: 'Workday', terms: ['workday'] },
  { label: 'SAP', terms: ['sap', 'successfactors'] },
  { label: 'SharePoint', terms: ['sharepoint'] },
  { label: 'LinkedIn Learning', terms: ['linkedin learning'] },
  { label: 'e-učenje', terms: ['e-learning', 'elearning', 'e-izobraževanj', 'e-učenj', 'moodle', 'digitaln* učn'] },
  { label: 'organizacija izobraževanj', terms: ['organizacij* izobraževanj', 'izvedb* izobraževanj', 'organizacij* usposabljanj', 'training coordination', 'coordinate training', 'organi* training', 'training logistics'] },
  { label: 'koordinacija projektov', terms: ['koordinacij* projekt', 'project coordination', 'coordinate project', 'projektn* koordinacij'] },
  { label: 'andragogika', terms: ['andragog', 'adult education', 'izobraževanj* odrasl', 'adult learning'] },
  { label: 'razvoj zaposlenih', terms: ['razvoj zaposlenih', 'razvoj kadrov', 'employee development', 'talent development', 'learning and development', 'learning & development'] },
  { label: 'podpora učnim procesom', terms: ['učn* proces', 'learning process', 'learning support', 'podpor* učenj'] },
  { label: 'EU-projekti', terms: ['erasmus', 'evropsk* projekt', 'eu projekt', 'eu-funded', 'eu funded', 'horizon europe', 'interreg'] },
  { label: 'univerzitetna izobrazba', terms: ['magist', "master's", 'master degree', 'masters degree', 'vii/2', 'vii. stopnj', 'univerzitetn* izobrazb', 'družboslov', 'social sciences', 'humanities'] },
  { label: 'angleščina', terms: ['angleščin', 'angleškega', 'angleški jezik', 'english'] },
  { label: 'španščina', terms: ['španščin', 'španskega', 'spanish'] },
  { label: 'hrvaščina', terms: ['hrvaščin', 'hrvaškega', 'croatian', 'hrvatsk'] },
];

/** Languages the seeker does not speak. A clear requirement costs points. */
export const FOREIGN_LANGUAGES: ReadonlyArray<{ label: string; terms: readonly string[] }> = [
  { label: 'nemščino', terms: ['nemščin', 'nemškega', 'nemški jezik', 'german$', 'deutsch'] },
  { label: 'francoščino', terms: ['francoščin', 'francoskega', 'francoski jezik', 'french$', 'français'] },
  { label: 'italijanščino', terms: ['italijanščin', 'italijanskega', 'italijanski jezik', 'italian$'] },
  { label: 'nizozemščino', terms: ['nizozemščin', 'dutch$'] },
  { label: 'madžarščino', terms: ['madžarščin', 'hungarian$'] },
  { label: 'poljščino', terms: ['poljščin', 'polish$'] },
];

/** Organisations whose very nature makes a role a better fit. */
export const GOOD_ORGS: readonly string[] = [
  'univerz', 'university', 'fakultet', 'faculty', 'ljudsk* univerz', 'andragošk', 'cmepius',
  'zavod', 'inštitut', 'institut', 'institute', 'center za', 'centre for', 'center for', 'društv',
  'zveza', 'fundacij', 'foundation', 'association', 'ngo', 'nvo', 'european', 'evropsk',
  'commission', 'agency', 'agencij', 'united nations', 'unesco', 'unicef', 'undp', 'oecd',
  'council of europe', 'svet evrope', 'world bank', 'akademij', 'academy', 'school', 'šol',
  'edtech', 'learning', 'education', 'izobraževaln', 'ministrstvo za vzgojo',
  'ministrstvo za izobraževanje', 'muzej', 'museum', 'galerij', 'gallery', 'gledališ', 'theatre',
  'knjižnic', 'kultur', 'cultural', 'nevladn', 'neprofitn', 'non-profit', 'nonprofit',
  'center za socialn* delo', 'mladinsk',
];

/** Content themes the seeker named as particularly interesting. */
export const GOOD_THEMES: ReadonlyArray<{ label: string; terms: readonly string[] }> = [
  { label: 'EU-projekti', terms: ['erasmus', 'evropsk* projekt', 'eu projekt', 'eu-funded', 'eu funded', 'horizon europe', 'interreg', 'creative europe', 'evropsk* socialn* sklad'] },
  { label: 'vseživljenjsko učenje', terms: ['vseživljenjsk', 'lifelong learning', 'izobraževanj* odrasl', 'adult education', 'adult learning'] },
  { label: 'digitalizacija izobraževanja', terms: ['digitaln* izobraževanj', 'digital learning', 'digital education', 'e-learning', 'edtech', 'digitalizacij'] },
  { label: 'razvoj kompetenc', terms: ['razvoj kompetenc', 'competence development', 'competency development', 'digitaln* kompetenc', 'digital skills', 'upskilling', 'reskilling'] },
  { label: 'mednarodno okolje', terms: ['mednarodn* okolj', 'international environment', 'international organisation', 'international organization', 'multicultural', 'večkulturn'] },
  { label: 'kultura in dediščina', terms: ['kulturn* program', 'kulturn* dediščin', 'cultural heritage', 'muzejsk', 'galerijsk', 'gledališk'] },
  { label: 'socialno vključevanje', terms: ['socialn* vključ', 'social inclusion', 'ranljiv* skupin', 'vulnerable groups', 'nevladn* organizacij', 'civil society'] },
];

/**
 * Work-mode markers for a structured field, the title or the location, where a
 * bare "remote" is meaningful.
 */
export const REMOTE_MARKERS: readonly string[] = [
  'remote', 'del* od doma', 'od doma', 'del* na daljavo', 'na daljavo', 'work from home', 'wfh',
  'work from anywhere', 'telecommut',
];

/**
 * The same, for ad prose: only unambiguous phrases. A bare "remote" there is
 * as often "remote teams", and "na daljavo" as often "učenje na daljavo"
 * (distance learning), which says nothing about where the job is done.
 */
export const REMOTE_BODY_MARKERS: readonly string[] = [
  'del* od doma', 'del* na daljavo', 'work from home', 'work remotely', 'working remotely',
  'remote work', 'remote position', 'remote role', 'remote job', 'fully remote', 'full remote',
  '100% remote', 'remote-first', 'remote first', 'work from anywhere', 'remote-friendly',
];

/** Checked before REMOTE_MARKERS: an ad naming both is almost always hybrid. */
export const HYBRID_MARKERS: readonly string[] = [
  'hibrid', 'hybrid', 'kombinirano delo', 'delno od doma', 'delno na daljavo',
  'možnost dela od doma', 'možnost dela na daljavo', 'možnost občasnega dela od doma',
  'možnost delnega dela od doma', 'home office', 'telework', 'days from home', 'dni od doma',
  'dneva od doma', 'dni dela od doma',
];

/** Structured work-mode fields only; body prose says "office" too often. */
export const ONSITE_MARKERS: readonly string[] = [
  'on-site', 'onsite', 'on site', 'na lokaciji', 'v pisarni', 'office', 'pisarn',
  'na sedežu', 'in-person', 'na delovnem mestu', 'na terenu',
];

/** Remote postings abroad are kept only when they name a region including Slovenia. */
export const REMOTE_ELIGIBLE: readonly string[] = [
  'slovenia', 'slovenija', 'europe', 'european union', 'eu', 'emea', 'cet', 'cest',
  'worldwide', 'anywhere', 'global', 'evrop',
];

/**
 * Ljubljana and its surroundings: the municipalities of the Osrednjeslovenska
 * region. Matched as whole words with diacritics folded.
 */
export const LJUBLJANA_AREA: readonly string[] = [
  'ljubljana', 'ljubljani', 'ljubljane', 'osrednjeslovenska', 'central slovenia',
  'borovnica', 'brezovica', 'dobrepolje', 'dobrova', 'polhov gradec', 'domžale',
  'grosuplje', 'horjul', 'ig', 'ivančna gorica', 'kamnik', 'komenda', 'litija',
  'logatec', 'log pri brezovici', 'dragomer', 'lukovica', 'medvode', 'mengeš',
  'moravče', 'šmartno pri litiji', 'škofljica', 'trzin', 'velike lašče',
  'vodice', 'vrhnika',
];

/**
 * Koper and Izola, where the seeker would move; elsewhere in Slovenia only
 * fully remote work counts. Whole words, with the locative forms.
 */
export const COAST_AREA: readonly string[] = [
  'koper', 'kopru', 'kopra', 'izola', 'izoli', 'izole',
];

/** Words in a location string that place it in Slovenia. */
export const SLOVENIA_MARKERS: readonly string[] = [
  'slovenia', 'slovenija', 'sloveniji', 'slovenije',
];

/**
 * Keyword-search terms for sources that need a query (LinkedIn, EURES,
 * remote boards). English first; these find most international postings.
 */
export const SEARCH_TERMS_EN: readonly string[] = [
  'learning and development', 'training coordinator', 'learning specialist',
  'talent development', 'LMS administrator', 'digital learning', 'e-learning',
  'instructional designer', 'project coordinator', 'project officer', 'programme officer',
  'programme coordinator', 'education programme', 'adult education', 'education officer',
  'edtech', 'knowledge management', 'project assistant',
];

/** Slovenian terms for Slovenian keyword-driven sources. */
export const SEARCH_TERMS_SL: readonly string[] = [
  'izobraževanje', 'razvoj kadrov', 'koordinator izobraževanj', 'andragog',
  'izobraževanje odraslih', 'projektni koordinator', 'koordinator projektov',
  'projektni sodelavec', 'EU projekti', 'e-izobraževanje', 'izobraževalni programi',
];
