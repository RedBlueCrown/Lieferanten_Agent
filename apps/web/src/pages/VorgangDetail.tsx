import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import clsx from 'clsx';
import { AMPEL_LABEL, CASE_STATUS_LABEL, chf, dateCH, type Finding } from '@vm/domain';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import type { CaseDetail, DraftClause } from '../lib/types';
import { useStage } from '../agent/store';
import { IconDownload, IconFile, IconSpark, IconUpload } from '../components/icons';
import { AmpelStatus, CaseStatusBadge, CaseTrack, ErrorBox, Field, Modal, PageHead, Panel, Skeleton, Status } from '../components/ui';
import { AuditTimeline } from './Protokoll';

export function effectiveFindings(c: Pick<CaseDetail, 'review'>) {
  return (c.review?.findings ?? []).map((f) => {
    const d = c.review!.decisions[f.criterionKey];
    return { ...f, ampel: d?.ampel ?? f.ampel, comment: d?.comment, exception: d?.exception, aiAmpel: f.ampel } as Finding & { comment?: string; exception?: string; aiAmpel: Finding['ampel'] };
  });
}

function ClauseEditor({ c, i, caseId, editable }: { c: DraftClause; i: number; caseId: string; editable: boolean }) {
  const qc = useQueryClient();
  const [edit, setEdit] = useState(false);
  const [text, setText] = useState(c.text);
  const [just, setJust] = useState(c.justification ?? '');
  const save = useMutation({
    mutationFn: (body: { text?: string; justification?: string }) => api.patch(`/api/v1/cases/${caseId}/clauses/${c.key}`, body),
    onSuccess: () => {
      setEdit(false);
      qc.invalidateQueries({ queryKey: ['case', caseId] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Fehler'),
  });
  return (
    <article className={clsx('clause', `clause--${c.origin}`)}>
      <div className="clause__head">
        <h3>
          § {i + 1} {c.title}
        </h3>
        {c.origin === 'ki' ? <Status tone="ai">KI-formuliert</Status> : c.origin === 'angepasst' ? <Status tone="gelb">Abweichung vom Textbaustein</Status> : null}
        {editable && !edit && (
          <button type="button" className="btn btn--quiet btn--sm" onClick={() => setEdit(true)}>
            Bearbeiten
          </button>
        )}
      </div>
      {edit ? (
        <div className="stack-sm">
          <textarea className="textarea" value={text} onChange={(e) => setText(e.target.value)} rows={Math.max(4, Math.ceil(text.length / 90))} aria-label={`Text von ${c.title}`} />
          <div className="row">
            <button type="button" className="btn btn--primary btn--sm" disabled={save.isPending} onClick={() => save.mutate({ text })}>
              Speichern
            </button>
            <button type="button" className="btn btn--secondary btn--sm" onClick={() => { setText(c.text); setEdit(false); }}>
              Abbrechen
            </button>
            {c.template && text !== c.template && (
              <button type="button" className="btn btn--quiet btn--sm" onClick={() => setText(c.template)}>
                Textbaustein wiederherstellen
              </button>
            )}
          </div>
        </div>
      ) : (
        <p>{c.text}</p>
      )}
      {c.origin === 'angepasst' && (
        <div className="clause__just">
          <Field label="Begründung der Abweichung" hint="Pflicht für die Einreichung. Der Rechtsdienst sieht sie bei der Prüfung.">
            <div className="row">
              <input className="input grow" value={just} onChange={(e) => setJust(e.target.value)} disabled={!editable} />
              {editable && just !== (c.justification ?? '') && (
                <button type="button" className="btn btn--secondary btn--sm" onClick={() => save.mutate({ justification: just })}>
                  Speichern
                </button>
              )}
            </div>
          </Field>
        </div>
      )}
    </article>
  );
}

export function VorgangDetail() {
  const { id } = useParams();
  const me = useAuth((s) => s.me)!;
  const qc = useQueryClient();
  const openStage = useStage((s) => s.open);
  const stageJob = useStage((s) => s.job);
  const q = useQuery({ queryKey: ['case', id], queryFn: () => api.get<CaseDetail>(`/api/v1/cases/${id}`), refetchInterval: (qq) => (qq.state.data?.status === 'unterzeichnet' || stageJob ? 4000 : false) });
  const [submitOpen, setSubmitOpen] = useState(false);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);

  if (q.isLoading) return <Skeleton rows={8} />;
  if (q.error || !q.data) return <ErrorBox error={q.error} retry={q.refetch} />;
  const c = q.data;
  const isOwner = me.user.roles.includes('projektleitung');
  const editable = isOwner && c.status === 'entwurf';
  const deviations = c.clauses.filter((b) => b.origin === 'angepasst');
  const missingJust = deviations.filter((b) => !b.justification?.trim());
  const points = effectiveFindings(c).filter((f) => f.ampel !== 'gruen');
  const refresh = () => qc.invalidateQueries({ queryKey: ['case', id] });

  const action = async (a: string, body: Record<string, unknown> = {}) => {
    setBusy(true);
    try {
      await api.post(`/api/v1/cases/${c.id}/actions/${a}`, body);
      toast.success(a === 'einreichen' ? 'Beim Rechtsdienst eingereicht' : 'Gespeichert');
      setSubmitOpen(false);
      refresh();
      qc.invalidateQueries({ queryKey: ['cases'] });
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Fehler');
    } finally {
      setBusy(false);
    }
  };

  const upload = async (kind: 'neue_fassung' | 'unterzeichnet', file: File) => {
    setBusy(true);
    try {
      const r = await api.upload<{ jobId: string | null }>(`/api/v1/cases/${c.id}/documents?kind=${kind}`, file);
      if (r.jobId) openStage({ jobId: r.jobId, kind: 'erfassung', title: `Unterzeichnete Fassung: ${c.title}`, resultPath: `/vorgaenge/${c.id}`, resultLabel: 'Zum Vorgang' });
      toast.success(kind === 'unterzeichnet' ? 'Unterzeichnete Fassung hochgeladen' : 'Neue Fassung beim Rechtsdienst');
      refresh();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Upload fehlgeschlagen');
    } finally {
      setBusy(false);
    }
  };

  const startDraft = async () => {
    const { jobId } = await api.post<{ jobId: string }>(`/api/v1/cases/${c.id}/draft`);
    openStage({ jobId, kind: 'entwurf', title: `Entwurf: ${c.title}`, resultPath: `/vorgaenge/${c.id}`, resultLabel: 'Entwurf ansehen' });
  };

  return (
    <>
      <PageHead
        crumbs={[{ label: 'Meine Vorgänge', to: '/' }, { label: c.title }]}
        title={c.title}
        lead={`${c.supplierName}, ${c.type}, ${c.source === 'llv_entwurf' ? 'aus der LLV-Vorlage' : 'Papier des Lieferanten'}`}
        actions={<CaseStatusBadge status={c.status} />}
      />
      <CaseTrack status={c.status} />

      <div className="split split--wide-left">
        <div className="stack">
          {c.source === 'llv_entwurf' ? (
            <Panel
              title="Vertragsentwurf"
              actions={
                c.clauses.length > 0 && (
                  <button type="button" className="btn btn--secondary btn--sm" onClick={() => api.download(`/api/v1/cases/${c.id}/document.docx?kind=entwurf`)}>
                    <IconDownload size={15} /> Als Word
                  </button>
                )
              }
            >
              {c.clauses.length ? (
                <div className="draft">
                  <p className="muted small">
                    Unveränderte Textbausteine gelten beim Rechtsdienst als vorgeprüft. {deviations.length ? `${deviations.length} Abweichung${deviations.length > 1 ? 'en' : ''} vom Standard.` : 'Keine Abweichung vom Standard.'}
                  </p>
                  {c.clauses.map((b, i) => (
                    <ClauseEditor key={b.key + b.text.length} c={b} i={i} caseId={c.id} editable={editable} />
                  ))}
                </div>
              ) : (
                <div className="empty">
                  <span className="empty__title">Noch kein Entwurf</span>
                  <p>Der Entwurfs-Agent stellt den Vertrag aus den Textbausteinen zusammen.</p>
                  <button type="button" className="btn btn--ai" onClick={startDraft}>
                    <IconSpark size={16} /> Entwurf erstellen lassen
                  </button>
                </div>
              )}
            </Panel>
          ) : (
            <Panel title="Dokumente">
              <ul className="doclist">
                {c.documents.map((d) => (
                  <li key={d.id}>
                    <button type="button" className="btn btn--quiet" onClick={() => api.download(`/api/v1/documents/${d.id}/content`, { open: true })}>
                      <IconFile size={16} /> {d.name}
                    </button>
                    <span className="muted xs">{d.path}</span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          {points.length > 0 && c.status !== 'in_pruefung' && (
            <Panel
              title={`Verhandlungspunkte des Rechtsdienstes (${points.length})`}
              actions={
                <button type="button" className="btn btn--secondary btn--sm" onClick={() => api.download(`/api/v1/cases/${c.id}/document.docx?kind=verhandlung`)}>
                  <IconDownload size={15} /> Verhandlungsschreiben (Word)
                </button>
              }
            >
              <ol className="points">
                {points.map((f) => (
                  <li key={f.criterionKey} className={`point point--${f.ampel}`}>
                    <div className="row-between">
                      <b>{f.criterionTitle}</b>
                      <AmpelStatus ampel={f.ampel} />
                    </div>
                    <p className="small">{f.reason}</p>
                    {f.comment && <p className="small"><b>Hinweis Rechtsdienst:</b> {f.comment}</p>}
                    {f.exception && <p className="small"><b>Als Ausnahme akzeptiert:</b> {f.exception}</p>}
                    {f.proposal && (
                      <details>
                        <summary className="small">Gegenvorschlag der LLV</summary>
                        <p className="small proposal">{f.proposal}</p>
                      </details>
                    )}
                  </li>
                ))}
              </ol>
            </Panel>
          )}
        </div>

        <div className="stack">
          <Panel title="Nächster Schritt">
            <div className="stack-sm">
              {c.status === 'entwurf' && (
                <>
                  <p className="small">Prüfen Sie den Entwurf. Wenn er vollständig ist, reichen Sie ihn beim Rechtsdienst ein (Haltepunkt H2).</p>
                  <button type="button" className="btn btn--primary" disabled={!c.clauses.length || !isOwner} onClick={() => setSubmitOpen(true)}>
                    Zur rechtlichen Prüfung einreichen
                  </button>
                </>
              )}
              {c.status === 'in_pruefung' && <p className="small">Der Rechtsdienst prüft {c.dueDate ? `bis ${dateCH(c.dueDate)}` : 'den Vertrag'}. Sie werden benachrichtigt.</p>}
              {c.status === 'nachverhandlung' && (
                <>
                  <p className="small">Klären Sie die Verhandlungspunkte mit {c.supplierName} und laden Sie die neue Fassung hoch. Sie geht direkt wieder an den Rechtsdienst.</p>
                  <UploadButton label="Neue Fassung hochladen" disabled={busy || !isOwner} onFile={(f) => upload('neue_fassung', f)} />
                </>
              )}
              {c.status === 'freigegeben' && (
                <>
                  <p className="small">Der Vertrag ist freigegeben. Lassen Sie ihn gemäss Zeichnungsberechtigung unterzeichnen und laden Sie die unterzeichnete Fassung hoch. Der Erfassungs-Agent gleicht sie mit der freigegebenen Fassung ab.</p>
                  <UploadButton label="Unterzeichnete Fassung hochladen" disabled={busy || !isOwner} onFile={(f) => upload('unterzeichnet', f)} />
                </>
              )}
              {c.status === 'unterzeichnet' && <p className="small">Das Lieferantenmanagement bestätigt jetzt die Vertragsdaten (Haltepunkt H1).</p>}
              {c.status === 'aktiv' && <p className="small">Der Vertrag ist aktiv{c.contractId ? ` (${c.contractId})` : ''} und seine Fristen werden überwacht.</p>}
              {(c.status === 'entwurf' || c.status === 'nachverhandlung') && isOwner && (
                <button type="button" className="btn btn--quiet btn--sm" onClick={() => confirm('Vorgang wirklich verwerfen?') && action('verwerfen')}>
                  Vorgang verwerfen
                </button>
              )}
            </div>
          </Panel>

          {c.source === 'llv_entwurf' && (
            <Panel title="Eckdaten">
              <dl className="kv">
                <dt>Beginn</dt>
                <dd className="num">{dateCH(String(c.fields.start ?? ''))}</dd>
                <dt>Laufzeit</dt>
                <dd>{String(c.fields.termMonths ?? '–')} Monate</dd>
                <dt>Kündigungsfrist</dt>
                <dd>{String(c.fields.noticeMonths ?? '–')} Monate</dd>
                <dt>Betrag pro Jahr</dt>
                <dd className="num">{chf(Number(c.fields.amount ?? 0))}</dd>
                <dt>Status</dt>
                <dd>{CASE_STATUS_LABEL[c.status]}</dd>
              </dl>
            </Panel>
          )}

          <Panel title="Verlauf" pad={false}>
            <AuditTimeline items={c.audit} compact />
          </Panel>
        </div>
      </div>

      <Modal
        open={submitOpen}
        onOpenChange={setSubmitOpen}
        title="Zur rechtlichen Prüfung einreichen"
        wide
        footer={
          <>
            <button type="button" className="btn btn--secondary" onClick={() => setSubmitOpen(false)}>
              Abbrechen
            </button>
            <button type="button" className="btn btn--primary" disabled={busy || missingJust.length > 0} onClick={() => action('einreichen', { comment })}>
              {busy ? 'Wird eingereicht …' : 'Einreichen'}
            </button>
          </>
        }
      >
        <div className="notice">
          <span>
            <b>Haltepunkt H2.</b> Der Rechtsdienst erhält einen Prüfauftrag mit einer Frist von 7 Tagen. {c.clauses.length - deviations.length} unveränderte Textbausteine gelten als vorgeprüft.
          </span>
        </div>
        {deviations.length > 0 && (
          <div className="stack-sm">
            <b>Abweichungen vom Standard</b>
            {deviations.map((d) => (
              <div key={d.key} className={clsx('row-between', 'well')}>
                <span>{d.title}</span>
                {d.justification ? <Status tone="gruen">begründet</Status> : <Status tone="rot">Begründung fehlt</Status>}
              </div>
            ))}
            {missingJust.length > 0 && <p className="field__error">Bitte begründen Sie jede Abweichung direkt bei der Klausel.</p>}
          </div>
        )}
        <Field label="Nachricht an den Rechtsdienst (optional)">
          <textarea className="textarea" value={comment} onChange={(e) => setComment(e.target.value)} />
        </Field>
      </Modal>
      <p className="xs muted">
        <Link to={`/protokoll?objekt=${c.id}`}>Alle Einträge zu diesem Vorgang im Protokoll</Link>
      </p>
    </>
  );
}

function UploadButton({ label, onFile, disabled }: { label: string; onFile: (f: File) => void; disabled?: boolean }) {
  return (
    <label className={clsx('btn btn--primary', disabled && 'is-disabled')} aria-disabled={disabled}>
      <IconUpload size={16} /> {label}
      <input type="file" accept=".pdf,.docx" className="sr-only" disabled={disabled} onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
    </label>
  );
}

export { AMPEL_LABEL };
