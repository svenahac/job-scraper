import { useEffect, useMemo, useState } from 'react';
import type { DataFile, Job, LocationClass, WorkMode } from './types';
import {
  EMPLOYMENT_LABEL, LOCATION_LABEL, PART_LABELS, WORK_MODE_LABEL, daysBetween, deadlineInfo,
  formatDate, matchLabel, matchTier, postedAgo, today,
} from './format';

type Sort = 'score' | 'newest' | 'deadline';
type View = 'all' | 'saved' | 'hidden';

interface Filters {
  q: string;
  days: number;
  areas: string[];
  locs: LocationClass[];
  modes: WorkMode[];
  minScore: number;
  hidePast: boolean;
  onlyNew: boolean;
}

const DEFAULT_FILTERS: Filters = {
  q: '', days: 30, areas: [], locs: [], modes: [], minScore: 0, hidePast: true, onlyNew: false,
};

const DAY_OPTIONS = [
  { value: 7, label: '7 dni' },
  { value: 14, label: '14 dni' },
  { value: 30, label: '30 dni' },
  { value: 60, label: '60 dni' },
];

const LOCATIONS: LocationClass[] = ['ljubljana', 'slovenia', 'remote', 'abroad'];
const MODES: WorkMode[] = ['remote', 'hybrid', 'onsite', 'unknown'];

// --- Per-viewer storage. Every access may throw (private mode, blocked
// storage), and the page must work without it.
function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...(JSON.parse(raw) as T) } : fallback;
  } catch { return fallback; }
}
function loadList(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch { return []; }
}
function save(key: string, value: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
}

/**
 * The data version (generatedAt) seen on the previous visit, read once; the
 * current one is recorded for next time. Postings first seen after it are new.
 * The data version, not the clock: a run starts long before its data is
 * deployed, so a visit in between must not swallow that run's postings.
 */
function usePreviouslySeen(current: string | undefined): string | null {
  const [prev] = useState<string | null>(() => {
    try { return localStorage.getItem('kompas:lastSeenData'); } catch { return null; }
  });
  useEffect(() => {
    if (!current) return;
    try { localStorage.setItem('kompas:lastSeenData', current); } catch { /* ignore */ }
  }, [current]);
  return prev;
}

const toggle = <T,>(list: T[], value: T): T[] =>
  list.includes(value) ? list.filter((v) => v !== value) : [...list, value];

/** ZRSZ titles arrive in capitals with a "- M/Ž" tail; show them as a sentence. */
function prettyTitle(title: string): string {
  const t = title.replace(/\s*[-–(]\s*m\s*\/\s*ž\s*\)?\s*$/i, '').replace(/\s+/g, ' ').trim();
  const letters = t.replace(/[^\p{L}]/gu, '');
  const upper = letters.replace(/[^\p{Lu}]/gu, '').length;
  if (letters.length > 6 && upper / letters.length > 0.8) {
    const lower = t.toLocaleLowerCase('sl');
    return lower.charAt(0).toLocaleUpperCase('sl') + lower.slice(1);
  }
  return t;
}

function prettyName(name: string | null): string | null {
  if (!name) return null;
  const letters = name.replace(/[^\p{L}]/gu, '');
  if (letters.length < 6 || letters !== letters.toLocaleUpperCase('sl')) return name;
  return name.toLocaleLowerCase('sl').replace(/(^|[\s,(-])(\p{L})(?=\p{L}{2})/gu,
    (_, sep: string, ch: string) => sep + ch.toLocaleUpperCase('sl'));
}

const postedOf = (j: Job): string => (j.postedAt ?? j.firstSeenAt).slice(0, 10);

export function App() {
  const [data, setData] = useState<DataFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>(() => load('kompas:filters', DEFAULT_FILTERS));
  const [sort, setSort] = useState<Sort>(() => load('kompas:view', { sort: 'score' as Sort }).sort);
  const [view, setView] = useState<View>('all');
  const [saved, setSaved] = useState<string[]>(() => loadList('kompas:saved'));
  const [hidden, setHidden] = useState<string[]>(() => loadList('kompas:hidden'));
  const [panelOpen, setPanelOpen] = useState(false);
  const prevVisit = usePreviouslySeen(data?.generatedAt);

  useEffect(() => {
    fetch('/jobs.json', { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: DataFile) => setData(d))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  useEffect(() => save('kompas:filters', filters), [filters]);
  useEffect(() => save('kompas:view', { sort }), [sort]);
  useEffect(() => save('kompas:saved', saved), [saved]);
  useEffect(() => save('kompas:hidden', hidden), [hidden]);

  const set = <K extends keyof Filters>(k: K, v: Filters[K]): void =>
    setFilters((f) => ({ ...f, [k]: v }));

  const areaLabel = useMemo(
    () => new Map((data?.areas ?? []).map((a) => [a.key, a.label])), [data]);

  /** New since the previous visit; on a first visit, first seen in the last two days. */
  const isNew = (j: Job): boolean => prevVisit
    ? j.firstSeenAt > prevVisit
    : daysBetween(j.firstSeenAt.slice(0, 10), today()) <= 2;

  // A posting is saved or hidden if any of its merged copies is.
  const savedSet = useMemo(() => {
    const ids = new Set(saved);
    return new Set((data?.jobs ?? []).filter((j) => (j.ids ?? [j.id]).some((i) => ids.has(i))).map((j) => j.id));
  }, [saved, data]);
  const hiddenSet = useMemo(() => {
    const ids = new Set(hidden);
    return new Set((data?.jobs ?? []).filter((j) => (j.ids ?? [j.id]).some((i) => ids.has(i))).map((j) => j.id));
  }, [hidden, data]);
  /** Toggle a posting in a list by every id it has ever had. */
  const toggleJob = (list: string[], j: Job): string[] => {
    const ids = j.ids ?? [j.id];
    return ids.some((i) => list.includes(i)) ? list.filter((i) => !ids.includes(i)) : [...list, j.id];
  };

  const inWindow = useMemo(() => {
    const t = today();
    return (data?.jobs ?? []).filter((j) => daysBetween(postedOf(j), t) <= filters.days);
  }, [data, filters.days]);

  const visible = useMemo(() => {
    const q = filters.q.trim().toLocaleLowerCase('sl');
    const t = today();
    const list = inWindow.filter((j) => {
      if (view === 'saved' && !savedSet.has(j.id)) return false;
      if (view === 'hidden' && !hiddenSet.has(j.id)) return false;
      if (view === 'all' && hiddenSet.has(j.id)) return false;
      if (filters.areas.length > 0 && !filters.areas.some((a) => j.areas.includes(a))) return false;
      if (filters.locs.length > 0 && !filters.locs.includes(j.locationClass)) return false;
      if (filters.modes.length > 0 && !filters.modes.includes(j.workMode)) return false;
      if (j.score < filters.minScore) return false;
      if (filters.hidePast && j.deadline && j.deadline < t) return false;
      if (filters.onlyNew && !isNew(j)) return false;
      if (q) {
        const hay = `${j.title} ${j.company ?? ''} ${j.location ?? ''} ${j.sources.map((x) => x.label).join(' ')}`
          .toLocaleLowerCase('sl');
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    const byDeadline = (j: Job): string => (j.deadline && j.deadline >= t ? j.deadline : '9999');
    return list.sort((a, b) => {
      if (sort === 'newest') return postedOf(b).localeCompare(postedOf(a)) || b.score - a.score;
      if (sort === 'deadline') return byDeadline(a).localeCompare(byDeadline(b)) || b.score - a.score;
      return b.score - a.score || postedOf(b).localeCompare(postedOf(a));
    });
    // isNew depends only on prevVisit, which never changes after mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inWindow, filters, sort, view, savedSet, hiddenSet]);

  const counts = useMemo(() => {
    const c = { area: new Map<string, number>(), loc: new Map<string, number>(), mode: new Map<string, number>() };
    for (const j of inWindow) {
      for (const a of j.areas) c.area.set(a, (c.area.get(a) ?? 0) + 1);
      c.loc.set(j.locationClass, (c.loc.get(j.locationClass) ?? 0) + 1);
      c.mode.set(j.workMode, (c.mode.get(j.workMode) ?? 0) + 1);
    }
    return c;
  }, [inWindow]);

  const stats = useMemo(() => {
    const t = today();
    const open = inWindow.filter((j) => !hiddenSet.has(j.id));
    return {
      total: open.length,
      fresh: open.filter(isNew).length,
      flexible: open.filter((j) => j.workMode === 'remote' || j.workMode === 'hybrid').length,
      strong: open.filter((j) => j.score >= 60).length,
      closing: open.filter((j) => j.deadline && j.deadline >= t && daysBetween(t, j.deadline) <= 7).length,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inWindow, hiddenSet]);

  const activeFilters = filters.areas.length + filters.locs.length + filters.modes.length
    + (filters.minScore > 0 ? 1 : 0) + (filters.onlyNew ? 1 : 0) + (filters.q ? 1 : 0);

  if (error) {
    return <div className="state">Podatkov ni bilo mogoče naložiti ({error}). Poskusi znova čez minuto.</div>;
  }
  if (!data) return <div className="state">Nalagam priložnosti…</div>;

  return (
    <div className="page">
      <header className="masthead">
        <div className="brand">
          <img src="/favicon.svg" alt="" width={36} height={36} />
          <div>
            <h1>Karierni kompas</h1>
            <p className="tagline">
              Izobraževanje, razvoj zaposlenih, projekti in digitalno učenje, zbrano z
              {' '}{data.sources.length} portalov. Posodobljeno {formatDate(data.generatedAt)}.
            </p>
          </div>
        </div>
        <dl className="stats">
          <div><dt>Priložnosti</dt><dd>{stats.total}</dd></div>
          <div><dt>Novo{prevVisit ? ' od zadnjič' : ''}</dt><dd>{stats.fresh}</dd></div>
          <div><dt>Dobro ujemanje</dt><dd>{stats.strong}</dd></div>
          <div><dt>Remote / hibridno</dt><dd>{stats.flexible}</dd></div>
          <div><dt>Rok v 7 dneh</dt><dd>{stats.closing}</dd></div>
        </dl>
      </header>

      <div className="layout">
        <aside className={`filters ${panelOpen ? 'open' : ''}`} aria-label="Filtri">
          <div className="filters-head">
            <h2>Filtri</h2>
            {activeFilters > 0 && (
              <button className="link" onClick={() => setFilters({ ...DEFAULT_FILTERS, days: filters.days })}>
                Ponastavi
              </button>
            )}
          </div>

          <label className="search">
            <span className="sr">Iskanje</span>
            <input
              type="search" placeholder="Išči po nazivu, organizaciji…" value={filters.q}
              onChange={(e) => set('q', e.target.value)}
            />
          </label>

          <fieldset>
            <legend>Objavljeno v zadnjih</legend>
            <div className="segmented">
              {DAY_OPTIONS.map((o) => (
                <button key={o.value} className={filters.days === o.value ? 'on' : ''}
                  onClick={() => set('days', o.value)}>{o.label}</button>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend>Področje</legend>
            {data.areas.map((a) => (
              <label key={a.key} className="check">
                <input type="checkbox" checked={filters.areas.includes(a.key)}
                  onChange={() => set('areas', toggle(filters.areas, a.key))} />
                <span>{a.label}</span><em>{counts.area.get(a.key) ?? 0}</em>
              </label>
            ))}
          </fieldset>

          <fieldset>
            <legend>Lokacija</legend>
            {LOCATIONS.map((l) => (
              <label key={l} className="check">
                <input type="checkbox" checked={filters.locs.includes(l)}
                  onChange={() => set('locs', toggle(filters.locs, l))} />
                <span>{LOCATION_LABEL[l]}</span><em>{counts.loc.get(l) ?? 0}</em>
              </label>
            ))}
          </fieldset>

          <fieldset>
            <legend>Način dela</legend>
            {MODES.map((m) => (
              <label key={m} className="check">
                <input type="checkbox" checked={filters.modes.includes(m)}
                  onChange={() => set('modes', toggle(filters.modes, m))} />
                <span>{WORK_MODE_LABEL[m]}</span><em>{counts.mode.get(m) ?? 0}</em>
              </label>
            ))}
          </fieldset>

          <fieldset>
            <legend>Najnižja ocena ujemanja: <strong>{filters.minScore}</strong></legend>
            <input type="range" min={0} max={90} step={5} value={filters.minScore}
              onChange={(e) => set('minScore', Number(e.target.value))} aria-label="Najnižja ocena ujemanja" />
            <div className="range-scale"><span>vse</span><span>45 delno</span><span>60 dobro</span><span>75+</span></div>
          </fieldset>

          <fieldset>
            <label className="check">
              <input type="checkbox" checked={filters.hidePast} onChange={() => set('hidePast', !filters.hidePast)} />
              <span>Skrij oglase s preteklim rokom</span>
            </label>
            <label className="check">
              <input type="checkbox" checked={filters.onlyNew} onChange={() => set('onlyNew', !filters.onlyNew)} />
              <span>Samo novi oglasi</span>
            </label>
          </fieldset>

          <button className="close-panel" onClick={() => setPanelOpen(false)}>
            Pokaži {visible.length} {visible.length === 1 ? 'oglas' : 'oglasov'}
          </button>
        </aside>

        <main>
          <div className="toolbar">
            <button className="filter-toggle" onClick={() => setPanelOpen(true)}>
              Filtri{activeFilters > 0 ? ` (${activeFilters})` : ''}
            </button>
            <div className="tabs" role="tablist">
              <button role="tab" aria-selected={view === 'all'} onClick={() => setView('all')}>Vsi</button>
              <button role="tab" aria-selected={view === 'saved'} onClick={() => setView('saved')}>
                Shranjeni{savedSet.size ? ` (${savedSet.size})` : ''}
              </button>
              <button role="tab" aria-selected={view === 'hidden'} onClick={() => setView('hidden')}>
                Skriti{hiddenSet.size ? ` (${hiddenSet.size})` : ''}
              </button>
            </div>
            <label className="sort">
              <span>Razvrsti</span>
              <select value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
                <option value="score">po ujemanju</option>
                <option value="newest">najprej najnovejši</option>
                <option value="deadline">po roku za prijavo</option>
              </select>
            </label>
          </div>

          <p className="result-count">
            {visible.length} {visible.length === 1 ? 'priložnost' : 'priložnosti'}
            {view === 'all' ? ` v zadnjih ${filters.days} dneh` : ''}
          </p>

          {visible.length === 0 ? (
            <div className="empty">
              {view === 'saved' ? 'Še nisi shranila nobenega oglasa. Klikni »Shrani« pri oglasu, ki te zanima.'
                : view === 'hidden' ? 'Ni skritih oglasov.'
                : 'Nobena priložnost se ne ujema s temi filtri. Poskusi daljše obdobje ali nižjo oceno.'}
            </div>
          ) : (
            <ol className="jobs">
              {visible.map((j) => (
                <JobCard
                  key={j.id} job={j} areaLabel={areaLabel.get(j.area) ?? j.area} isNew={isNew(j)}
                  saved={savedSet.has(j.id)} hidden={hiddenSet.has(j.id)}
                  onSave={() => setSaved((s) => toggleJob(s, j))}
                  onHide={() => setHidden((h) => toggleJob(h, j))}
                />
              ))}
            </ol>
          )}
        </main>
      </div>

      <footer className="sources">
        <h2>Viri</h2>
        <ul>
          {data.sources.map((s) => (
            <li key={s.name} className={s.ok ? 'ok' : 'down'}>
              <span className="dot" aria-hidden />
              <strong>{s.label}</strong>
              <span>
                {s.ok ? `${s.count} oglasov pregledanih`
                  : `trenutno nedosegljiv${s.lastOkAt ? ` · zadnjič ${formatDate(s.lastOkAt)}` : ''}`}
              </span>
            </li>
          ))}
        </ul>
        <p className="note">
          Ocena ujemanja (0–100) sešteva povezanost s področjem (35), ujemanje z izkušnjami (15),
          možnost dela od doma (15), zahtevano raven izkušenj (15), lokacijo in jezike (10) ter vrsto
          organizacije (10). Splošne kadrovske, rekrutacijske in vodstvene pozicije so izločene.
          Oglasi z več portalov so združeni v enega. Shranjeni in skriti oglasi ostanejo samo v tem brskalniku.
        </p>
      </footer>
    </div>
  );
}

interface CardProps {
  job: Job;
  areaLabel: string;
  isNew: boolean;
  saved: boolean;
  hidden: boolean;
  onSave: () => void;
  onHide: () => void;
}

function JobCard({ job, areaLabel, isNew, saved, hidden, onSave, onHide }: CardProps) {
  const tier = matchTier(job.score);
  const deadline = deadlineInfo(job.deadline);
  const primary = job.sources[0];
  const employment = EMPLOYMENT_LABEL[job.employmentType];
  const fits = job.reasons.filter((r) => r.kind === 'fit');
  const warns = job.reasons.filter((r) => r.kind === 'warn');

  return (
    <li className={`card tier-${tier}${saved ? ' is-saved' : ''}`}>
      <div className="score" aria-label={`Ocena ujemanja ${job.score} od 100`}>
        <span className="num">{job.score}</span>
        <span className="lbl">{matchLabel(job.score)}</span>
      </div>

      <div className="card-body">
        <div className="kicker">
          {isNew && <span className="badge-new">Novo</span>}
          <span>{areaLabel}</span>
          <span aria-hidden>·</span>
          <span>{postedAgo(job.postedAt)}</span>
        </div>

        <h3>
          {primary ? <a href={primary.url} target="_blank" rel="noopener noreferrer">{prettyTitle(job.title)}</a>
            : prettyTitle(job.title)}
        </h3>
        <p className="org">
          {prettyName(job.company) ?? 'Organizacija ni navedena'}
          {job.location ? <> · {prettyName(job.location)}</> : null}
        </p>

        <ul className="chips">
          <li className={`chip mode-${job.workMode}`}>{WORK_MODE_LABEL[job.workMode]}</li>
          <li className="chip">{LOCATION_LABEL[job.locationClass]}</li>
          <li className="chip">Izkušnje: {job.experience ?? 'ni navedeno'}</li>
          {employment && <li className="chip">{employment}</li>}
          {job.salary && <li className="chip chip-salary">{job.salary}</li>}
          {deadline ? (
            <li className={`chip ${deadline.urgent ? 'chip-urgent' : ''} ${deadline.past ? 'chip-past' : ''}`}>
              {deadline.text}
            </li>
          ) : <li className="chip chip-muted">rok ni naveden</li>}
        </ul>

        <div className="why">
          <h4>Zakaj zate</h4>
          <ul>
            {fits.map((r) => <li key={r.text} className="fit">{r.text}</li>)}
            {warns.map((r) => <li key={r.text} className="warn">{r.text}</li>)}
          </ul>
        </div>

        <details>
          <summary>Kako je sestavljena ocena</summary>
          <div className="details">
            <div className="bars">
              {PART_LABELS.map((p) => (
                <div key={p.key} className="bar">
                  <span className="bar-label">{p.label}</span>
                  <span className="bar-track" aria-hidden>
                    <span className="bar-fill" style={{ width: `${Math.max(0, (job.parts[p.key] / p.max) * 100)}%` }} />
                  </span>
                  <span className="bar-val">{job.parts[p.key]}/{p.max}</span>
                </div>
              ))}
              {job.parts.penalty < 0 && (
                <div className="bar penalty">
                  <span className="bar-label">Odbitki</span><span /><span className="bar-val">{job.parts.penalty}</span>
                </div>
              )}
            </div>
            <p className="posted-on">
              Objavljeno na:{' '}
              {job.sources.map((s, i) => (
                <span key={s.source}>
                  {i > 0 && ', '}
                  <a href={s.url} target="_blank" rel="noopener noreferrer">{s.label}</a>
                </span>
              ))}
              {' '}· objava {formatDate(job.postedAt)}
            </p>
          </div>
        </details>

        <div className="actions">
          {primary && (
            <a className="btn btn-primary" href={primary.url} target="_blank" rel="noopener noreferrer">
              Odpri oglas <span aria-hidden>↗</span>
            </a>
          )}
          <button className={`btn ${saved ? 'btn-on' : ''}`} onClick={onSave} aria-pressed={saved}>
            {saved ? '★ Shranjeno' : '☆ Shrani'}
          </button>
          <button className="btn btn-ghost" onClick={onHide}>{hidden ? 'Prikaži znova' : 'Skrij'}</button>
        </div>
      </div>
    </li>
  );
}
