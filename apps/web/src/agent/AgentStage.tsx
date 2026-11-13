/**
 * The agent stage: a live view of what an AI agent is doing, built only from
 * the job's real events. The beam follows the line being read, every value
 * travels from its source line to its card, and the rail shows which service
 * works on which step.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import clsx from 'clsx';
import { AGENT_LABEL, AMPEL_LABEL, EXTRACT_FIELDS, type Ampel, type LayoutPage, type StampedEvent } from '@vm/domain';
import { followJob } from '../lib/stream';
import { useAuth } from '../lib/auth';
import { track } from '../lib/audit';
import { IconArrowRight, IconCheck, IconMinus, IconSpark, IconX } from '../components/icons';
import { AmpelIcon } from '../components/ui';
import { useStage, type StageJob } from './store';
import './agent.css';

interface StageStep {
  key: string;
  label: string;
  service: string;
  status: 'run' | 'done' | 'skip';
  detail?: string;
  startMs: number;
  endMs?: number;
}
interface FieldCard {
  key: string;
  label: string;
  value: string;
  quote: string;
  page: number;
  line: number;
  confidence: number;
}
interface VerdictCard {
  id: string;
  clauseIndex: number | null;
  criterionTitle: string;
  ampel: Ampel;
  reason: string;
  missing: boolean;
  src: string | null;
}
interface BlockCard {
  index: number;
  title: string;
  text: string;
  origin: 'baustein' | 'ki';
}
interface Link {
  id: number;
  from: string;
  to: string;
  tone: 'gold' | Ampel;
}
interface State {
  steps: StageStep[];
  doc: { name: string; pages: LayoutPage[] } | null;
  scan: string | null;
  scanned: Set<string>;
  hits: Map<string, 'gold' | Ampel>;
  notes: { text: string; seq: number }[];
  fields: FieldCard[];
  match: { supplierName: string; supplierId: string | null; score: number } | null;
  clauses: Map<number, string>;
  verdicts: VerdictCard[];
  blocks: BlockCard[];
  metrics: { tokensIn: number; tokensOut: number; pages?: number; lines?: number; model?: string };
  links: Link[];
  ms: number;
  done: boolean;
  error: string | null;
}

const initial = (): State => ({
  steps: [],
  doc: null,
  scan: null,
  scanned: new Set(),
  hits: new Map(),
  notes: [],
  fields: [],
  match: null,
  clauses: new Map(),
  verdicts: [],
  blocks: [],
  metrics: { tokensIn: 0, tokensOut: 0 },
  links: [],
  ms: 0,
  done: false,
  error: null,
});

let linkSeq = 0;

function reduce(s: State, e: StampedEvent | { t: 'prune'; id: number }): State {
  if (e.t === 'prune') return { ...s, links: s.links.filter((l) => l.id !== e.id) };
  const next: State = { ...s, ms: Math.max(s.ms, e.ms) };
  switch (e.t) {
    case 'stage': {
      const steps = [...s.steps];
      const i = steps.findIndex((x) => x.key === e.stage);
      if (i < 0) steps.push({ key: e.stage, label: e.label, service: e.service, status: e.status, detail: e.detail, startMs: e.ms, endMs: e.status === 'done' ? e.ms : undefined });
      else steps[i] = { ...steps[i], label: e.label, service: e.service || steps[i].service, status: e.status, detail: e.detail ?? steps[i].detail, endMs: e.status === 'done' ? e.ms : steps[i].endMs };
      return { ...next, steps };
    }
    case 'doc':
      return { ...next, doc: { name: e.name, pages: e.pages } };
    case 'scan': {
      const key = `${e.page}:${e.line}`;
      const scanned = new Set(s.scanned);
      if (s.doc) {
        // Everything up to the current line counts as read.
        const [cp, cl] = [e.page, e.line];
        s.doc.pages.forEach((p, pi) => p.lines.forEach((_, li) => (pi < cp || (pi === cp && li <= cl)) && scanned.add(`${pi}:${li}`)));
      }
      return { ...next, scan: key, scanned };
    }
    case 'note':
      return { ...next, notes: [...s.notes.slice(-5), { text: e.text, seq: e.seq }] };
    case 'field': {
      const src = `${e.page}:${e.line}`;
      const hits = new Map(s.hits).set(src, 'gold');
      const id = ++linkSeq;
      return { ...next, hits, fields: [...s.fields.filter((f) => f.key !== e.key), { key: e.key, label: e.label, value: e.value, quote: e.quote, page: e.page, line: e.line, confidence: e.confidence }], links: [...s.links, { id, from: `line-${src}`, to: `card-${e.key}`, tone: 'gold' }] };
    }
    case 'match':
      return { ...next, match: { supplierName: e.supplierName, supplierId: e.supplierId, score: e.score } };
    case 'clause': {
      const clauses = new Map(s.clauses).set(e.index, `${e.page}:${e.line}`);
      return { ...next, clauses };
    }
    case 'verdict': {
      const src = e.clauseIndex !== null ? (s.clauses.get(e.clauseIndex) ?? null) : null;
      const hits = new Map(s.hits);
      if (src) {
        const prev = hits.get(src);
        const rank = { gruen: 0, gelb: 1, rot: 2, gold: -1 } as const;
        if (!prev || rank[e.ampel] > rank[prev]) hits.set(src, e.ampel);
      }
      const id = `v-${e.criterionKey}`;
      const links = src ? [...s.links, { id: ++linkSeq, from: `line-${src}`, to: `card-${id}`, tone: e.ampel }] : s.links;
      return { ...next, hits, verdicts: [...s.verdicts, { id, clauseIndex: e.clauseIndex, criterionTitle: e.criterionTitle, ampel: e.ampel, reason: e.reason, missing: e.missing, src }], links };
    }
    case 'block': {
      const id = ++linkSeq;
      return { ...next, blocks: [...s.blocks, { index: e.index, title: e.title, text: e.text, origin: e.origin }], links: [...s.links, { id, from: `src-${e.index}`, to: `card-b${e.index}`, tone: 'gold' }] };
    }
    case 'metric':
      return { ...next, metrics: { tokensIn: s.metrics.tokensIn + (e.tokensIn ?? 0), tokensOut: s.metrics.tokensOut + (e.tokensOut ?? 0), pages: e.pages ?? s.metrics.pages, lines: e.lines ?? s.metrics.lines, model: e.model ?? s.metrics.model } };
    case 'done':
      return { ...next, done: true, scan: null };
    case 'error':
      return { ...next, error: e.message, done: true };
    default:
      return next;
  }
}

const reduceMotion = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Paces the presentation so each step can be followed; never invents events. */
function useEventQueue(jobId: string, apply: (e: StampedEvent) => void) {
  useEffect(() => {
    const queue: StampedEvent[] = [];
    let busy = false;
    let ended = false;
    let cancelled = false;
    const quiet = reduceMotion();
    const delay = (e: StampedEvent) => {
      if (quiet) return 0;
      const backlog = queue.length;
      const fast = backlog > 8;
      switch (e.t) {
        case 'scan':
          return fast ? 0 : 35;
        case 'field':
        case 'verdict':
          return fast ? 140 : 480;
        case 'block':
          return fast ? 90 : 300;
        case 'note':
          return fast ? 40 : 140;
        default:
          return 0;
      }
    };
    const pump = async () => {
      if (busy) return;
      busy = true;
      while (queue.length && !cancelled) {
        const e = queue.shift()!;
        apply(e);
        const d = delay(e);
        if (d) await new Promise((r) => setTimeout(r, d));
      }
      busy = false;
      if (ended && !cancelled) apply({ t: 'stage', stage: '__drained', label: '', service: '', status: 'skip', seq: -1, ms: 0 } as StampedEvent);
    };
    const stop = followJob(
      jobId,
      (e) => {
        queue.push(e);
        pump();
      },
      () => {
        ended = true;
        pump();
      },
    );
    return () => {
      cancelled = true;
      stop();
    };
  }, [jobId, apply]);
}

function Paper({ pages, scan, scanned, hits }: { pages: LayoutPage[]; scan: string | null; scanned: Set<string>; hits: Map<string, 'gold' | Ampel> }) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(560);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth - 32));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    if (!scan || !ref.current) return;
    const line = ref.current.querySelector<HTMLElement>(`[data-line="${scan}"]`);
    if (!line) return;
    const box = ref.current;
    const top = line.offsetTop + (line.offsetParent as HTMLElement).offsetTop;
    if (top < box.scrollTop + 80 || top > box.scrollTop + box.clientHeight - 120) box.scrollTo({ top: top - box.clientHeight / 3, behavior: reduceMotion() ? 'auto' : 'smooth' });
  }, [scan]);
  const [sp, sl] = scan ? scan.split(':').map(Number) : [-1, -1];
  return (
    <div className="paperstack" ref={ref}>
      {pages.map((p, pi) => {
        const k = width / p.width;
        const beam = sp === pi ? p.lines[sl] : undefined;
        return (
          <div key={pi} className="paper" style={{ width: p.width * k, height: p.height * k }}>
            {p.lines.map((l, li) => {
              const id = `${pi}:${li}`;
              const hit = hits.get(id);
              return (
                <div
                  key={li}
                  id={`line-${id}`}
                  data-line={id}
                  className={clsx('paper__line', scanned.has(id) && 'is-read', hit && `is-hit is-${hit}`)}
                  style={{ left: l.box[0] * k, top: l.box[1] * k, width: Math.max(l.box[2] * k, 8), height: Math.max(l.box[3] * k, 9), fontSize: Math.max(7, l.box[3] * k * 0.78) }}
                >
                  {l.text}
                </div>
              );
            })}
            {beam && (
              <div className="beam" style={{ transform: `translateY(${(beam.box[1] + beam.box[3]) * k}px)` }} aria-hidden>
                <span className="beam__band" />
                <span className="beam__line" />
              </div>
            )}
            <span className="paper__pageno">Seite {pi + 1}</span>
          </div>
        );
      })}
    </div>
  );
}

function Links({ links, root, onDone }: { links: Link[]; root: React.RefObject<HTMLDivElement | null>; onDone: (id: number) => void }) {
  const [paths, setPaths] = useState<{ id: number; d: string; tone: Link['tone'] }[]>([]);
  const [tick, setTick] = useState(0);
  // Follow layout changes (cards growing, panels scrolling) while links are visible.
  useEffect(() => {
    if (!links.length) return;
    const t = setInterval(() => setTick((x) => x + 1), 80);
    return () => clearInterval(t);
  }, [links.length]);
  const seen = useRef(new Set<number>());
  useEffect(() => {
    for (const l of links) {
      if (seen.current.has(l.id)) continue;
      seen.current.add(l.id);
      document.getElementById(l.to)?.scrollIntoView({ block: 'nearest', behavior: reduceMotion() ? 'auto' : 'smooth' });
      setTimeout(() => onDone(l.id), 1400);
    }
  }, [links, onDone]);
  useLayoutEffect(() => {
    const r = root.current;
    if (!r) return;
    const base = r.getBoundingClientRect();
    const next = links
      .map((l) => {
        const a = document.getElementById(l.from);
        const b = document.getElementById(l.to);
        if (!a || !b) return null;
        const ra = a.getBoundingClientRect();
        const rb = b.getBoundingClientRect();
        const x1 = Math.min(ra.right, ra.left + 420) - base.left;
        const y1 = ra.top + ra.height / 2 - base.top;
        const x2 = rb.left - base.left;
        const y2 = rb.top + Math.min(rb.height / 2, 22) - base.top;
        const dx = Math.max(60, (x2 - x1) * 0.5);
        return { id: l.id, d: `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`, tone: l.tone };
      })
      .filter(Boolean) as { id: number; d: string; tone: Link['tone'] }[];
    setPaths(next);
  }, [links, root, tick]);
  if (reduceMotion()) return null;
  return (
    <>
      <svg className="links" aria-hidden>
        {paths.map((p) => (
          <path key={p.id} d={p.d} className={`link link--${p.tone}`} pathLength={1} />
        ))}
      </svg>
      {paths.map((p) => (
        <span key={p.id} className={`packet packet--${p.tone}`} style={{ offsetPath: `path('${p.d}')` }} aria-hidden />
      ))}
    </>
  );
}

const fmtMs = (ms: number) => `${(ms / 1000).toFixed(1).replace('.', ',')} s`;

function StageBody({ job }: { job: StageJob }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const me = useAuth((s) => s.me);
  const { minimize, close, setDone, minimized } = useStage();
  const [s, dispatch] = useReducer(reduce, undefined, initial);
  const [drained, setDrained] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const started = useRef(Date.now());

  const apply = useCallback((e: StampedEvent) => {
    if (e.t === 'stage' && e.stage === '__drained') {
      setDrained(true);
      return;
    }
    dispatch(e);
  }, []);
  useEventQueue(job.jobId, apply);
  const prune = useCallback((id: number) => dispatch({ t: 'prune', id }), []);

  const finished = s.done && drained;
  useEffect(() => {
    if (finished) return;
    const t = setInterval(() => setElapsed(Date.now() - started.current), 100);
    return () => clearInterval(t);
  }, [finished]);
  useEffect(() => {
    if (!finished) return;
    setDone(true);
    qc.invalidateQueries();
    track({ type: 'aktion', name: `KI-Ansicht beendet: ${job.title}`, details: { jobId: job.jobId, error: s.error } });
    if (useStage.getState().minimized) {
      toast.success(`${AGENT_LABEL[job.kind]} ist fertig`, { description: job.title, action: { label: job.resultLabel, onClick: () => { close(); navigate(job.resultPath); } } });
    }
  }, [finished]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !minimized && minimize();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [minimize, minimized]);

  const isAzure = me?.system.ai.provider === 'azure';
  const tally = useMemo(() => s.verdicts.reduce((t, v) => ({ ...t, [v.ampel]: t[v.ampel] + 1 }), { gruen: 0, gelb: 0, rot: 0 } as Record<Ampel, number>), [s.verdicts]);
  const totalLines = s.doc?.pages.reduce((n, p) => n + p.lines.length, 0) ?? 0;
  const progress = s.steps.length ? s.steps.filter((x) => x.status === 'done').length / Math.max(s.steps.length, job.kind === 'erfassung' ? 4 : 3) : 0;
  const lastNote = s.notes[s.notes.length - 1];

  const goResult = () => {
    close();
    navigate(job.resultPath);
  };

  if (minimized) {
    return (
      <button type="button" className="dock" onClick={() => useStage.getState().restore()}>
        <IconSpark size={18} className="dock__spark" />
        <span className="dock__text">
          <b>{AGENT_LABEL[job.kind]}</b>
          <span>{finished ? (s.error ? 'Fehler' : 'Fertig: Ergebnis ansehen') : (lastNote?.text ?? 'arbeitet …')}</span>
        </span>
        <span className="dock__bar">
          <span style={{ transform: `scaleX(${finished ? 1 : Math.max(0.06, progress)})` }} />
        </span>
      </button>
    );
  }

  return (
    <div className="stage" role="dialog" aria-modal="true" aria-label={`${AGENT_LABEL[job.kind]}: ${job.title}`} ref={root}>
      <header className="stage__head">
        <div className="stage__title">
          <span className="stage__agent">
            <IconSpark size={18} /> {AGENT_LABEL[job.kind]}
          </span>
          <h2>{job.title}</h2>
        </div>
        <div className="stage__chips">
          <span className="chip">{isAzure ? `Azure OpenAI ${me?.system.ai.model ?? ''}` : 'Regelbasierte Demo-KI'}</span>
          <span className="chip">{me?.system.ai.region ?? 'Azure Schweiz Nord'}</span>
          <span className="chip chip--time num" aria-live="off">{fmtMs(finished ? s.ms : elapsed)}</span>
        </div>
        <div className="stage__actions">
          {!finished && (
            <button type="button" className="stagebtn" onClick={minimize}>
              <IconMinus size={16} /> Im Hintergrund weiterlaufen lassen
            </button>
          )}
          {finished && (
            <button type="button" className="stagebtn" onClick={close} aria-label="Schliessen">
              <IconX size={16} /> Schliessen
            </button>
          )}
        </div>
      </header>

      <div className="stage__metrics" aria-live="polite">
        {s.metrics.pages !== undefined && (
          <span>
            <b className="num">{s.metrics.pages}</b> Seite{s.metrics.pages === 1 ? '' : 'n'}
          </span>
        )}
        {totalLines > 0 && (
          <span>
            <b className="num">{s.scanned.size}</b> von <b className="num">{totalLines}</b> Zeilen gelesen
          </span>
        )}
        {job.kind === 'erfassung' && (
          <span>
            <b className="num">{s.fields.length}</b> Felder mit Fundstelle
          </span>
        )}
        {job.kind === 'pruefung' && (
          <span>
            <b className="num">{s.verdicts.length}</b> Kriterien beurteilt
          </span>
        )}
        {job.kind === 'entwurf' && (
          <span>
            <b className="num">{s.blocks.length}</b> Klauseln
          </span>
        )}
        {s.metrics.tokensIn + s.metrics.tokensOut > 0 && (
          <span>
            <b className="num">{(s.metrics.tokensIn + s.metrics.tokensOut).toLocaleString('de-CH')}</b> Tokens
          </span>
        )}
      </div>

      <div className={clsx('stage__body', `stage__body--${job.kind}`)}>
        <section className="stage__left" aria-label="Dokument">
          {job.kind === 'entwurf' ? (
            <div className="sources">
              <p className="sources__title">Textbausteine aus dem Prüfstandard des Rechtsdienstes</p>
              {s.blocks.map((b) => (
                <div key={b.index} id={`src-${b.index}`} className={clsx('source', b.origin === 'ki' && 'source--ki')}>
                  <span>{b.origin === 'ki' ? 'Ihre Beschreibung' : 'Word-Dokument'}</span>
                  <b>{b.title}</b>
                </div>
              ))}
              {!s.blocks.length && <div className="sources__wait">Lade den Prüfstandard …</div>}
            </div>
          ) : s.doc ? (
            <>
              <div className="stage__docname">{s.doc.name}</div>
              <Paper pages={s.doc.pages} scan={s.scan} scanned={s.scanned} hits={s.hits} />
            </>
          ) : (
            <div className="paper-wait">
              <div className="paper-wait__sheet keep-motion" />
              <p>{s.steps.find((x) => x.status === 'run')?.label ?? 'Dokument wird geladen'} …</p>
            </div>
          )}
        </section>

        <section className="stage__right" aria-label="Ergebnis">
          <div className="narration" aria-live="polite">
            <span className="narration__label">Was der Agent gerade tut</span>
            <p className="narration__now" key={lastNote?.seq ?? 'x'}>
              {s.error ? `Fehler: ${s.error}` : finished ? 'Fertig.' : (lastNote?.text ?? 'Startet …')}
            </p>
            <ol className="narration__past">
              {s.notes
                .slice(-4, -1)
                .reverse()
                .map((n) => (
                  <li key={n.seq}>{n.text}</li>
                ))}
            </ol>
          </div>

          {job.kind === 'erfassung' && (
            <div className="cards">
              {s.match && (
                <div className={clsx('matchcard', s.match.supplierId ? 'is-known' : 'is-new')}>
                  {s.match.supplierId ? <IconCheck size={16} /> : <IconSpark size={16} />}
                  <span>
                    {s.match.supplierId ? 'Lieferant im Stamm gefunden: ' : 'Neuer Lieferant: '}
                    <b>{s.match.supplierName}</b>
                  </span>
                </div>
              )}
              <div className="fieldgrid">
                {EXTRACT_FIELDS.map((f) => {
                  const hit = s.fields.find((x) => x.key === f.key);
                  return (
                    <div key={f.key} id={`card-${f.key}`} className={clsx('fieldcard', hit ? 'is-found' : finished ? 'is-missing' : 'is-waiting')}>
                      <span className="fieldcard__label">{f.label}</span>
                      <span className="fieldcard__value">{hit ? displayValue(f.key, hit.value) : finished ? 'nicht gefunden' : '…'}</span>
                      {hit && (
                        <span className="fieldcard__conf">
                          <span className="confbar">
                            <span className={clsx(hit.confidence < 0.8 && 'is-low')} style={{ transform: `scaleX(${hit.confidence})` }} />
                          </span>
                          <span className="num">{Math.round(hit.confidence * 100)} %</span>
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {job.kind === 'pruefung' && (
            <div className="cards">
              <div className="tally">
                {(['rot', 'gelb', 'gruen'] as Ampel[]).map((a) => (
                  <div key={a} className={`tally__item tally__item--${a}`}>
                    <AmpelIcon ampel={a} size={16} />
                    <b className="num">{tally[a]}</b>
                    <span>{AMPEL_LABEL[a]}</span>
                  </div>
                ))}
              </div>
              <div className="verdicts">
                {s.verdicts.map((v) => (
                  <div key={v.id} id={`card-${v.id}`} className={clsx('verdict', `verdict--${v.ampel}`)}>
                    <div className="verdict__head">
                      <b>{v.criterionTitle}</b>
                      <span className={`status status--${v.ampel}`}>
                        <AmpelIcon ampel={v.ampel} size={13} />
                        {v.missing ? 'Fehlt' : AMPEL_LABEL[v.ampel]}
                      </span>
                    </div>
                    <p>{v.reason}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {job.kind === 'entwurf' && (
            <div className="draftpaper">
              {s.blocks.map((b, i) => (
                <div key={b.index} id={`card-b${b.index}`} className={clsx('draftblock', b.origin === 'ki' && 'draftblock--ki')}>
                  <div className="draftblock__head">
                    <b>
                      § {i + 1} {b.title}
                    </b>
                    <span className={clsx('status', b.origin === 'ki' ? 'status--ai' : 'status--neutral')}>{b.origin === 'ki' ? 'KI-formuliert' : 'Textbaustein'}</span>
                  </div>
                  <p>{b.text}</p>
                </div>
              ))}
            </div>
          )}
        </section>
        <Links links={s.links} root={root} onDone={prune} />
      </div>

      <footer className="stage__rail">
        <ol className="rail">
          {s.steps.map((st) => (
            <li key={st.key} className={clsx('rail__step', `is-${st.status}`)}>
              <span className="rail__icon">{st.status === 'done' ? <IconCheck size={14} /> : st.status === 'run' ? <span className="spinner keep-motion" /> : null}</span>
              <span className="rail__text">
                <b>{st.label}</b>
                <span>{st.service}</span>
                {st.detail && <span className="rail__detail">{st.detail}</span>}
              </span>
              <span className="rail__time num">{st.endMs !== undefined ? fmtMs(st.endMs - st.startMs) : ''}</span>
              {st.status === 'run' && <span className="rail__progress keep-motion" />}
            </li>
          ))}
        </ol>
        {finished && (
          <div className="stage__done">
            <p>
              {s.error
                ? 'Der Agent konnte die Arbeit nicht abschliessen. Sie können manuell weiterarbeiten.'
                : job.kind === 'erfassung'
                  ? `${s.fields.length} Felder gelesen, jedes mit Fundstelle. Bitte prüfen und bestätigen.`
                  : job.kind === 'pruefung'
                    ? `${tally.rot} nicht akzeptabel, ${tally.gelb} zu verhandeln, ${tally.gruen} akzeptabel. Sie entscheiden.`
                    : `${s.blocks.length} Klauseln zusammengestellt. Bitte prüfen und einreichen.`}
            </p>
            <button type="button" className="btn btn--primary" onClick={goResult} autoFocus>
              {job.resultLabel} <IconArrowRight size={16} />
            </button>
          </div>
        )}
      </footer>
    </div>
  );
}

function displayValue(key: string, v: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v.split('-').reverse().join('.');
  if (key === 'wert') return `CHF ${Number(v).toLocaleString('de-CH')}`;
  if (key === 'kuendigungsmodus') return { laufzeitende: 'Ende der Laufzeit', monatsende: 'Monatsende', quartalsende: 'Quartalsende', jahresende: 'Jahresende' }[v] ?? v;
  if (key === 'kuendigungsfrist' || key === 'verlaengerung') return `${v} Monate`;
  return v;
}

export function AgentStageHost() {
  const job = useStage((s) => s.job);
  if (!job) return null;
  return <StageBody key={job.jobId} job={job} />;
}
