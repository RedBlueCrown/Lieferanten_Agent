import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import clsx from 'clsx';
import { CONTRACT_TYPES, dateCH, EXTRACT_FIELDS, NOTICE_MODE_LABEL, type ExtractedField, type LayoutPage, type NoticeMode, type StampedEvent } from '@vm/domain';
import { api, ApiError } from '../lib/api';
import { useStage } from '../agent/store';
import { IconCheck, IconFile, IconSpark, IconUpload } from '../components/icons';
import { Empty, ErrorBox, Field, Loadable, PageHead, Panel, Skeleton, Status } from '../components/ui';

interface IngestJob {
  id: string;
  status: 'running' | 'done' | 'failed';
  title: string;
  subject: { documentId: string; fileName: string; caseId: string | null };
  result: null | {
    documentId: string;
    fileName: string;
    path: string;
    fields: ExtractedField[];
    supplier: { id: string | null; name: string; score: number };
    checks: { level: 'ok' | 'warn' | 'error'; text: string }[];
    caseId: string | null;
    differences: { key: string; label: string; approved: string; signed: string }[];
  };
  error: string | null;
  provider: string;
  created_by: { name: string; kind: string } | null;
  created_at: string;
  resolution: null | { action: string; contractId?: string; by: { name: string }; at: string; reason?: string };
}

export function Erfassen() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const openStage = useStage((s) => s.open);
  const q = useQuery({ queryKey: ['ingest'], queryFn: () => api.get<IngestJob[]>('/api/v1/ingest'), refetchInterval: 5000 });
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);

  const start = async (file?: File) => {
    setBusy(true);
    try {
      const r = file ? await api.upload<{ jobId: string }>('/api/v1/documents', file) : await api.post<{ jobId: string }>('/api/v1/ingest/sample');
      openStage({ jobId: r.jobId, kind: 'erfassung', title: file?.name ?? 'Beispielvertrag Medicus Terminplanung', resultPath: `/erfassen/${r.jobId}`, resultLabel: 'Ergebnis prüfen' });
      qc.invalidateQueries({ queryKey: ['ingest'] });
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Upload fehlgeschlagen');
    } finally {
      setBusy(false);
    }
  };

  const waiting = (q.data ?? []).filter((j) => !j.resolution);
  const done = (q.data ?? []).filter((j) => j.resolution).slice(0, 8);

  return (
    <>
      <PageHead title="Vertrag erfassen" lead="Laden Sie einen unterzeichneten Vertrag hoch oder legen Sie ihn in den Ordner «Eingang». Der Erfassungs-Agent liest die Daten mit Fundstellen aus, Sie bestätigen sie (Haltepunkt H1)." />
      <label
        className={clsx('dropzone dropzone--big', drag && 'is-drag')}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          const f = e.dataTransfer.files?.[0];
          if (f) start(f);
        }}
      >
        <IconUpload size={28} />
        <span className="dropzone__title">Vertrag als PDF oder Word hierher ziehen</span>
        <span className="muted small">oder klicken, um eine Datei zu wählen. Die Datei wird im Ordner «Eingang» abgelegt und nach der Bestätigung beim Lieferanten archiviert.</span>
        <input type="file" accept=".pdf,.docx" className="sr-only" disabled={busy} onChange={(e) => e.target.files?.[0] && start(e.target.files[0])} />
      </label>
      <div className="row">
        <span className="muted small">Kein Vertrag zur Hand?</span>
        <button type="button" className="btn btn--ai btn--sm" disabled={busy} onClick={() => start()}>
          <IconSpark size={15} /> Beispielvertrag lesen lassen
        </button>
      </div>

      <Panel title={`Wartet auf Ihre Bestätigung (${waiting.length})`} pad={false}>
        <Loadable q={q} empty={() => (waiting.length ? null : <Empty title="Nichts offen">Neue Verträge aus dem Upload oder dem Ordner «Eingang» erscheinen hier.</Empty>)}>
          {() => (
            <table className="table">
              <thead>
                <tr>
                  <th>Dokument</th>
                  <th>Erkannt</th>
                  <th>Quelle</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {waiting.map((j) => (
                  <tr key={j.id} className="is-link" tabIndex={0} onClick={() => navigate(`/erfassen/${j.id}`)} onKeyDown={(e) => e.key === 'Enter' && navigate(`/erfassen/${j.id}`)}>
                    <td>
                      <div className="cell-title">{j.subject.fileName}</div>
                      <div className="cell-sub">{new Date(j.created_at).toLocaleString('de-CH', { dateStyle: 'short', timeStyle: 'short' })}</div>
                    </td>
                    <td className="small">{j.result ? `${j.result.supplier.name}, ${j.result.fields.length} Felder` : '–'}</td>
                    <td className="small">{j.subject.caseId ? `Vorgang ${j.subject.caseId}` : j.created_by?.kind === 'system' ? 'Ordner «Eingang»' : `Upload von ${j.created_by?.name}`}</td>
                    <td>{j.status === 'running' ? <Status tone="ai">wird gelesen</Status> : j.status === 'failed' ? <Status tone="rot">Fehler</Status> : <Status tone="accent">bereit zur Bestätigung</Status>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Loadable>
      </Panel>

      {done.length > 0 && (
        <Panel title="Zuletzt erfasst" pad={false}>
          <table className="table">
            <tbody>
              {done.map((j) => (
                <tr key={j.id}>
                  <td className="cell-title">{j.subject.fileName}</td>
                  <td className="small">{j.resolution?.action === 'bestaetigt' ? <Status tone="gruen">bestätigt als {j.resolution.contractId}</Status> : <Status>verworfen</Status>}</td>
                  <td className="small nowrap">{j.resolution?.by.name}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}
    </>
  );
}

function StaticPaper({ pages, highlight }: { pages: LayoutPage[]; highlight: { page: number; line: number } | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(520);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth - 2));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    if (!highlight) return;
    ref.current?.querySelector(`[data-line="${highlight.page}:${highlight.line}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [highlight]);
  return (
    <div className="staticpaper" ref={ref}>
      {pages.map((p, pi) => {
        const k = w / p.width;
        return (
          <div key={pi} className="paper paper--light" style={{ width: p.width * k, height: p.height * k }}>
            {p.lines.map((l, li) => (
              <div
                key={li}
                data-line={`${pi}:${li}`}
                className={clsx('paper__line is-read', highlight?.page === pi && highlight.line === li && 'is-hit is-gold')}
                style={{ left: l.box[0] * k, top: l.box[1] * k, width: Math.max(l.box[2] * k, 8), height: Math.max(l.box[3] * k, 9), fontSize: Math.max(7, l.box[3] * k * 0.78) }}
              >
                {l.text}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

export function ErfassungPruefen() {
  const { jobId } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const job = useQuery({ queryKey: ['job', jobId], queryFn: () => api.get<IngestJob & { events: StampedEvent[] }>(`/api/v1/jobs/${jobId}`), refetchInterval: (q) => (q.state.data?.status === 'running' ? 2000 : false) });
  const suppliers = useQuery({ queryKey: ['suppliers'], queryFn: () => api.get<{ id: string; name: string }[]>('/api/v1/suppliers') });
  const [values, setValues] = useState<Record<string, string>>({});
  const [supplierId, setSupplierId] = useState<string>('');
  const [newClass, setNewClass] = useState<'A' | 'B' | 'C'>('B');
  const [confirmed, setConfirmed] = useState<Set<string>>(new Set());
  const [focus, setFocus] = useState<{ page: number; line: number } | null>(null);
  const [busy, setBusy] = useState(false);

  const r = job.data?.result;
  const pages = useMemo(() => (job.data?.events.find((e) => e.t === 'doc') as (StampedEvent & { pages: LayoutPage[] }) | undefined)?.pages ?? [], [job.data]);
  useEffect(() => {
    if (!r) return;
    setValues(Object.fromEntries(r.fields.map((f) => [f.key, f.value])));
    setSupplierId(r.supplier.id ?? '');
  }, [r]);

  if (job.isLoading) return <Skeleton rows={10} />;
  if (job.error || !job.data) return <ErrorBox error={job.error} retry={job.refetch} />;
  if (job.data.status === 'running') return <Skeleton rows={6} />;
  if (!r) return <ErrorBox error={new Error(job.data.error ?? 'Kein Ergebnis')} />;

  const field = (k: string) => r.fields.find((f) => f.key === k);
  const low = r.fields.filter((f) => f.confidence < 0.8 || r.differences.some((d) => d.key === f.key));
  const unconfirmedLow = low.filter((f) => !confirmed.has(f.key));
  const resolved = !!job.data.resolution;

  const submit = async () => {
    setBusy(true);
    try {
      const v = values;
      const res = await api.post<{ contractId: string; archivedTo: string; corrections: unknown[] }>(`/api/v1/ingest/${jobId}/confirm`, {
        supplierId: supplierId || null,
        newSupplier: supplierId ? null : { name: v.lieferant ?? r.supplier.name, class: newClass },
        values: {
          typ: v.typ,
          titel: v.titel,
          beginn: v.beginn,
          ende: v.ende || null,
          kuendigungsfrist: Number(v.kuendigungsfrist || 0),
          kuendigungsmodus: (v.kuendigungsmodus || 'laufzeitende') as NoticeMode,
          verlaengerung: Number(v.verlaengerung || 0),
          wert: Number(v.wert || 0),
          recht: v.recht || null,
          gerichtsstand: v.gerichtsstand || null,
          kontakt: v.kontakt || null,
          anwendung: v.anwendung || null,
          sla: v.sla || null,
          review: v.review || null,
        },
      });
      toast.success(`Vertrag ${res.contractId} erfasst`, { description: `Archiviert unter ${res.archivedTo}. ${res.corrections.length ? `${res.corrections.length} KI-Wert(e) korrigiert und protokolliert.` : ''}` });
      qc.invalidateQueries();
      navigate('/');
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Speichern fehlgeschlagen');
    } finally {
      setBusy(false);
    }
  };

  const discard = async () => {
    const reason = prompt('Warum verwerfen? (wird protokolliert)');
    if (!reason || reason.trim().length < 2) return;
    await api.post(`/api/v1/ingest/${jobId}/discard`, { reason });
    qc.invalidateQueries({ queryKey: ['ingest'] });
    navigate('/erfassen');
  };

  const input = (key: string, kind: string) => {
    const v = values[key] ?? '';
    const set = (x: string) => setValues({ ...values, [key]: x });
    if (key === 'typ')
      return (
        <select className="select" value={v} onChange={(e) => set(e.target.value)} disabled={resolved}>
          {CONTRACT_TYPES.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
      );
    if (key === 'kuendigungsmodus')
      return (
        <select className="select" value={v || 'laufzeitende'} onChange={(e) => set(e.target.value)} disabled={resolved}>
          {Object.entries(NOTICE_MODE_LABEL).map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </select>
      );
    return <input className="input" type={kind === 'date' ? 'date' : 'text'} inputMode={kind === 'number' ? 'decimal' : undefined} value={v} onChange={(e) => set(e.target.value)} disabled={resolved} />;
  };

  return (
    <>
      <PageHead
        crumbs={[{ label: 'Erfassen', to: '/erfassen' }, { label: r.fileName }]}
        title="Vertragsdaten bestätigen"
        lead={`Der Erfassungs-Agent hat ${r.fields.length} Felder gelesen. Klicken Sie ein Feld an, um die Fundstelle im Dokument zu sehen.`}
        actions={
          <button type="button" className="btn btn--quiet" onClick={() => api.download(`/api/v1/documents/${r.documentId}/content`, { open: true })}>
            <IconFile size={16} /> Original-PDF
          </button>
        }
      />
      {resolved && (
        <div className="notice">
          <span>
            Bereits {job.data.resolution?.action === 'bestaetigt' ? `bestätigt als ${job.data.resolution.contractId}` : 'verworfen'} von {job.data.resolution?.by.name}.
          </span>
        </div>
      )}
      {r.differences.length > 0 && (
        <div className="notice notice--warn">
          <span>
            <b>Abweichung zur freigegebenen Fassung:</b> {r.differences.map((d) => `${d.label} freigegeben ${d.approved}, unterzeichnet ${d.signed}`).join('; ')}. Bitte klären, bevor Sie bestätigen.
          </span>
        </div>
      )}
      <div className="split split--wide-right">
        <Panel title="Dokument" className="sticky-panel">
          {pages.length ? <StaticPaper pages={pages} highlight={focus} /> : <p className="muted small">Keine Vorschau.</p>}
        </Panel>
        <div className="stack">
          <Panel title="Lieferant">
            <div className="form-grid">
              <Field label="Zuordnung" hint={r.supplier.id ? `KI-Abgleich: ${Math.round(r.supplier.score * 100)} % Übereinstimmung mit dem Stamm` : 'Nicht im Stamm gefunden: wird neu angelegt'}>
                <select className="select" value={supplierId} onChange={(e) => setSupplierId(e.target.value)} disabled={resolved}>
                  <option value="">Neuer Lieferant: {values.lieferant ?? r.supplier.name}</option>
                  {(suppliers.data ?? []).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </Field>
              {!supplierId && (
                <Field label="Bedeutung (Klasse)">
                  <select className="select" value={newClass} onChange={(e) => setNewClass(e.target.value as 'A' | 'B' | 'C')}>
                    <option value="A">A, strategisch</option>
                    <option value="B">B, Standard</option>
                    <option value="C">C, unkritisch</option>
                  </select>
                </Field>
              )}
            </div>
          </Panel>
          <Panel title="Ausgelesene Daten" pad={false}>
            <table className="table extract">
              <thead>
                <tr>
                  <th>Feld</th>
                  <th>Wert</th>
                  <th>Sicherheit</th>
                </tr>
              </thead>
              <tbody>
                {EXTRACT_FIELDS.filter((f) => f.key !== 'lieferant').map((f) => {
                  const hit = field(f.key);
                  const needs = hit && low.includes(hit);
                  return (
                    <tr key={f.key} className={clsx(needs && !confirmed.has(f.key) && 'needs-check')} onFocus={() => hit && setFocus({ page: hit.page, line: hit.line })} onClick={() => hit && setFocus({ page: hit.page, line: hit.line })}>
                      <td className="nowrap small">
                        <b>{f.label}</b>
                        {hit && <div className="cell-sub">«{hit.quote.slice(0, 60)}»</div>}
                      </td>
                      <td style={{ minWidth: 200 }}>{input(f.key, f.kind)}</td>
                      <td className="nowrap">
                        {hit ? (
                          <span className="row">
                            <span className={clsx('conf num', hit.confidence < 0.8 && 'is-low')}>{Math.round(hit.confidence * 100)} %</span>
                            {needs && (
                              <label className="row small">
                                <input type="checkbox" checked={confirmed.has(f.key)} onChange={(e) => setConfirmed((s) => { const n = new Set(s); if (e.target.checked) n.add(f.key); else n.delete(f.key); return n; })} disabled={resolved} />
                                geprüft
                              </label>
                            )}
                          </span>
                        ) : (
                          <span className="muted small">nicht gefunden</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                <tr>
                  <td className="small">
                    <b>Nächstes Review</b>
                    <div className="cell-sub">von Ihnen festzulegen</div>
                  </td>
                  <td>
                    <input className="input" type="date" value={values.review ?? ''} onChange={(e) => setValues({ ...values, review: e.target.value })} disabled={resolved} />
                  </td>
                  <td />
                </tr>
              </tbody>
            </table>
          </Panel>
          <Panel title="Prüfung nach festen Regeln">
            <ul className="checks">
              {r.checks.map((c, i) => (
                <li key={i} className={`check check--${c.level}`}>
                  {c.level === 'ok' ? <IconCheck size={14} /> : '!'} {c.text}
                </li>
              ))}
            </ul>
            {values.ende && <p className="small muted">Nach der Bestätigung berechnet die Fristenlogik den Kündigungstermin vor dem {dateCH(values.ende)} inklusive Zustellpuffer.</p>}
          </Panel>
          {!resolved && (
            <div className="row-between">
              <button type="button" className="btn btn--secondary" onClick={discard}>
                Verwerfen
              </button>
              <div className="row">
                {unconfirmedLow.length > 0 && <span className="small" style={{ color: 'var(--color-red)' }}>{unconfirmedLow.length} Feld{unconfirmedLow.length > 1 ? 'er' : ''} noch einzeln prüfen</span>}
                <button type="button" className="btn btn--primary" disabled={busy || unconfirmedLow.length > 0} onClick={submit}>
                  <IconCheck size={16} /> {busy ? 'Wird gespeichert …' : 'Bestätigen und Vertrag anlegen'}
                </button>
              </div>
            </div>
          )}
          <p className="xs muted">
            Haltepunkt H1: erst mit Ihrer Bestätigung wird der Vertrag aktiv und seine Fristen zählen. KI-Werte, die Sie ändern, werden als Korrektur protokolliert. <Link to={`/protokoll?objekt=${jobId}`}>Protokoll dieser Erfassung</Link>
          </p>
        </div>
      </div>
    </>
  );
}
