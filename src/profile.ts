export type AreaKey =
  | 'ld' | 'projects' | 'hr' | 'adult-education'
  | 'eu-projects' | 'employer-brand' | 'content-comms' | 'events';

export interface Area {
  key: AreaKey;
  /** 1 is the strongest fit. Drives the score and the CSV sort. */
  rank: number;
  label: string;
  /** Matched anywhere — title, tags or body. Lowercase. */
  keywords: readonly string[];
  /** The subset used to drive keyword-based sources such as LinkedIn. */
  queryTerms: readonly string[];
}

export const AREAS: readonly Area[] = [
  {
    key: 'ld',
    rank: 1,
    label: 'Izobraževanje in razvoj kadrov / L&D',
    keywords: [
      'razvoj kadrov', 'izobraževanje in razvoj kadrov', 'learning and development',
      'learning & development', 'l&d', 'learning specialist', 'learning coordinator',
      'training coordinator', 'training specialist', 'talent development',
      'people development', 'hr development', 'razvoj zaposlenih',
      'koordinator izobraževanj', 'koordinatorka izobraževanj', 'skrbnik izobraževanj',
      'interna akademija', 'interne akademije', 'korporativna akademija',
      'onboarding', 'employee development', 'učenje in razvoj',
      'strokovnjak za izobraževanje',
    ],
    queryTerms: [
      'razvoj kadrov', 'learning and development', 'training coordinator',
      'talent development', 'koordinator izobraževanj',
    ],
  },
  {
    key: 'projects',
    rank: 2,
    label: 'Projektno delo / koordinacija projektov',
    keywords: [
      'projektni koordinator', 'projektna koordinatorka', 'koordinator projektov',
      'project coordinator', 'project assistant', 'project specialist',
      'junior project manager', 'project manager', 'projektni sodelavec',
      'projektna sodelavka', 'projektni vodja', 'vodja projektov',
      'program coordinator', 'projektno vodenje', 'projektna pisarna',
    ],
    queryTerms: [
      'projektni koordinator', 'project coordinator', 'koordinator projektov',
      'project manager',
    ],
  },
  {
    key: 'hr',
    rank: 3,
    label: 'HR / People & Culture',
    keywords: [
      'hr specialist', 'hr coordinator', 'hr koordinator', 'kadrovski specialist',
      'people & culture', 'people and culture', 'people operations', 'people ops',
      'employee experience', 'talent management', 'talent acquisition',
      'employer branding', 'employee engagement', 'hr project', 'hr generalist',
      'hr business partner', 'kadrovik', 'strokovni sodelavec za kadre',
    ],
    queryTerms: [
      'hr specialist', 'people and culture', 'kadrovski specialist',
      'talent management',
    ],
  },
  {
    key: 'adult-education',
    rank: 4,
    label: 'Izobraževanje odraslih / andragoško delo',
    keywords: [
      'andragog', 'andragoško', 'izobraževanje odraslih', 'adult education',
      'strokovni sodelavec za izobraževanje', 'svetovalec za izobraževanje',
      'koordinator izobraževanja', 'koordinator programov', 'vodja programov',
      'strokovni delavec v izobraževanju', 'ljudska univerza',
      'izobraževalni program', 'organizator izobraževanja', 'učitelj odraslih',
    ],
    queryTerms: [
      'andragog', 'izobraževanje odraslih', 'koordinator izobraževanja',
      'vodja programov',
    ],
  },
  {
    key: 'eu-projects',
    rank: 5,
    label: 'EU / Erasmus+ / razvojni projekti',
    keywords: [
      'erasmus', 'erasmus+', 'eu projekt', 'eu projekti', 'evropski projekt',
      'evropskih projektov', 'eu project', 'project officer',
      'programme coordinator', 'program officer', 'mednarodni projekti',
      'koordinator mednarodnih projektov', 'razvojni projekti', 'mobilnost',
      'kohezijska', 'strukturni skladi', 'javni razpis',
    ],
    queryTerms: [
      'erasmus', 'mednarodni projekti', 'project officer', 'eu projekti',
    ],
  },
  {
    key: 'employer-brand',
    rank: 6,
    label: 'Employer branding / employee experience',
    keywords: [
      'employer branding', 'employer brand', 'employee experience',
      'employee engagement', 'internal communications', 'interna komunikacija',
      'notranje komuniciranje', 'culture & engagement', 'hr marketing',
      'talent attraction', 'blagovna znamka delodajalca',
    ],
    queryTerms: ['employer branding', 'interna komunikacija', 'employee experience'],
  },
  {
    key: 'content-comms',
    rank: 7,
    label: 'Content / communications / community',
    keywords: [
      'content coordinator', 'content specialist', 'communications coordinator',
      'communications specialist', 'community manager', 'community coordinator',
      'social media coordinator', 'social media specialist', 'marketing coordinator',
      'koordinator komuniciranja', 'strokovni sodelavec za odnose z javnostmi',
      'odnosi z javnostmi',
    ],
    queryTerms: ['content coordinator', 'communications specialist', 'community manager'],
  },
  {
    key: 'events',
    rank: 8,
    label: 'Event / program coordination',
    keywords: [
      'event coordinator', 'event manager', 'koordinator dogodkov',
      'organizator dogodkov', 'programski koordinator', 'konferenčni koordinator',
      'events & people', 'community & events', 'organizacija dogodkov',
    ],
    queryTerms: ['event coordinator', 'koordinator dogodkov'],
  },
] as const;

/**
 * Hard drop, matched against the TITLE only — and overridden when an area
 * keyword also matches the title, so "Vodja projektov prodaje" survives on its
 * project match. "referent za" is deliberately absent: it would kill
 * "Referent za izobraževanje odraslih", which is a target role.
 */
export const TITLE_REJECT: readonly string[] = [
  'računovodja', 'računovodkinja', 'knjigovodja', 'knjigovodkinja',
  'komercialist', 'prodajni svetovalec', 'prodajni zastopnik', 'prodajni referent',
  'terenski prodajalec', 'prodajalec', 'klicni center', 'telefonski',
  'obračun plač', 'payroll', 'vnos podatkov', 'data entry', 'inkaso',
  'izterjava', 'blagajnik', 'skladiščnik', 'voznik', 'natakar', 'kuhar',
  'čistilka', 'varnostnik', 'revizor',
];

/** Flag only. An L&D role that also mentions payroll is still an L&D role. */
export const BODY_WARN: readonly string[] = [
  'payroll', 'obračun plač', 'kadrovska administracija', 'kadrovske evidence',
  'delovnopravna administracija', 'delovno-pravna administracija',
  'vodenje evidenc', 'arhiviranje', 'prodajni cilji', 'doseganje prodajnih',
  'klicanje strank',
];

/**
 * Hard drop, matched against the title and the source's raw employment field
 * ONLY. Never the body: "praksa" is everywhere in ordinary Slovenian ad prose
 * ("dobra praksa", "v praksi").
 */
export const CONTRACT_REJECT: readonly string[] = [
  'študentsko delo', 'študentsko', 'praksa', 'praktikant', 'pripravnik',
  'pripravništvo', 'volontersko', 'volonterski', 'obvezna praksa',
];

export const REMOTE_MARKERS: readonly string[] = [
  'delo od doma', 'od doma', 'remote', 'na daljavo', 'teleworking', 'full remote',
];

export const HYBRID_MARKERS: readonly string[] = [
  'hibrid', 'hybrid', 'kombinirano delo', 'delno od doma',
];

export const PRIMARY_LOCATIONS: readonly string[] = [
  'ljubljana', 'osrednjeslovenska', 'vrhnika', 'domžale', 'kamnik',
  'grosuplje', 'medvode', 'škofljica', 'brezovica', 'logatec', 'trzin',
];

/** One lead term per area, best rank first. Drives keyword-based sources. */
export function leadQueryTerms(): string[] {
  return [...AREAS]
    .sort((a, b) => a.rank - b.rank)
    .map((a) => a.queryTerms[0]!);
}
