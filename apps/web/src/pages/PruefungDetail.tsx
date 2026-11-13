import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import clsx from 'clsx';
import { AMPEL_LABEL, dateCH, type Ampel, type ReviewStandard } from '@vm/domain';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import type { CaseDetail } from '../lib/types';
import { useStage } from '../agent/store';
import { IconDownload, IconFile, IconSpark } from '../components/icons';
import { AmpelIcon, AmpelStatus, CaseStatusBadge, ErrorBox, Field, Figure, Modal, PageHead, Panel, Skeleton, Status } from '../components/ui';
import { effectiveFindings } from './VorgangDetail';
import { AuditTimeline } from './Protokoll';

interface ClauseText {
  index: number;
  heading: string;
  text: string;
}

const RANK: Record<Ampel, number> = { rot: 0, gelb: 1, gruen: 2 };

function FindingCard({ f, caseId, editable, active, onLocate }: { f: ReturnType<typeof effectiveFindings>[number]; caseId: string; editable: boolean; active: boolean; onLocate: () => void }) {
  const qc = useQueryClient();
  const [comment, setComment] = useState(f.comment ?? '');
  const [exception, setException] = useState(f.exception ?? '');
  const [showComment, setShowComment] = useState(!!f.comment);
  const save = useMutation({
    mutationFn: (body: { ampel?: Ampel; comment?: string; exception?: string }) => api.patch(`/api/v1/cases/${caseId}/findings/${f.criterionKey}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['case', caseId] }),
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Fehler'),
  });
  return (
    <article className={clsx('finding', `finding--${f.ampel}`, active && 'is-active')} id={`finding-${f.criterionKey}`}>
      <div className="finding__head">
        <div className="stack-sm" style={{ gap: 2 }}>
          <b>{f.criterionTitle}</b>
          {f.location ? (
            <button type="button" className="linklike small" onClick={onLocate}>
              {f.location}
            </button>
          ) : (
            <span className="small" style={{ color: 'var(--color-red)' }}>Im Vertrag nicht geregelt</span>
          )}
        </div>
        {editable ? (
          <div className="segmented" role="group" aria-label={`Beurteilung ${f.criterionTitle}`}>
            {(['gruen', 'gelb', 'rot'] as Ampel[]).map((a) => (
              <button key={a} type="button" className={`is-${a}`} aria-pressed={f.ampel === a} onClick={() => a !== f.ampel && save.mutate({ ampel: a })}>
                {AMPEL_LABEL[a]}
              </button>
            ))}
          </div>
        ) : (
          <AmpelStatus ampel={f.ampel} />
        )}
      </div>
      <p className="small">{f.reason}</p>
      {f.ampel !== f.aiAmpel && (
        <p className="xs muted">
          KI-Vorschlag war «{AMPEL_LABEL[f.aiAmpel]}», von Ihnen übersteuert.
        </p>
      )}
      {f.quote && <blockquote className="quote small">{f.quote}</blockquote>}
      {f.proposal && (
        <details>
          <summary className="small">Gegenvorschlag aus dem Prüfstandard</summary>
          <p className="small proposal">{f.proposal}</p>
        </details>
      )}
      {editable && f.ampel === 'rot' && (
        <Field label="Als Ausnahme freigeben" hint="Nur nötig, wenn Sie trotz «Nicht akzeptabel» freigeben. Kommt ins Ausnahmen-Register.">
          <div className="row">
            <input className="input grow" value={exception} onChange={(e) => setException(e.target.value)} placeholder="Begründung der Ausnahme" />
            {exception !== (f.exception ?? '') && (
              <button type="button" className="btn btn--secondary btn--sm" onClick={() => save.mutate({ exception })}>
                Speichern
              </button>
            )}
          </div>
        </Field>
      )}
      {editable &&
        (showComment ? (
          <Field label="Hinweis für die Projektleitung">
            <div className="row">
              <input className="input grow" value={comment} onChange={(e) => setComment(e.target.value)} />
              {comment !== (f.comment ?? '') && (
                <button type="button" className="btn btn--secondary btn--sm" onClick={() => save.mutate({ comment })}>
                  Speichern
                </button>
              )}
            </div>
          </Field>
        ) : (
          <button type="button" className="btn btn--quiet btn--sm" onClick={() => setShowComment(true)}>
            Hinweis hinzufügen
          </button>
        ))}
    </article>
  );
}

export function PruefungDetail() {
  const { id } = useParams();
  const me = useAuth((s) => s.me)!;
  const qc = useQueryClient();
  const openStage = useStage((s) => s.open);
  const stageJob = useStage((s) => s.job);
  const q = useQuery({ queryKey: ['case', id], queryFn: () => api.get<CaseDetail>(`/api/v1/cases/${id}`), refetchInterval: stageJob ? 3000 : false });
  const text = useQuery({ queryKey: ['case-text', id], queryFn: () => api.get<{ name: string; clauses: ClauseText[] }>(`/api/v1/cases/${id}/text`) });
  const standards = useQuery({ queryKey: ['standards'], queryFn: () => api.get<ReviewStandard[]>('/api/v1/standards') });
  const [active, setActive] = useState<string | null>(null);
  const [decision, setDecision] = useState<'freigeben' | 'nachverhandeln' | null>(null);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);

  if (q.isLoading) return <Skeleton rows={10} />;
  if (q.error || !q.data) return <ErrorBox error={q.error} retry={q.refetch} />;
  const c = q.data;
  const editable = me.user.roles.includes('rechtsdienst') && c.status === 'in_pruefung';
  const findings = effectiveFindings(c).sort((a, b) => RANK[a.ampel] - RANK[b.ampel]);
  const sum = findings.reduce((s, f) => ({ ...s, [f.ampel]: s[f.ampel] + 1 }), { gruen: 0, gelb: 0, rot: 0 } as Record<Ampel, number>);
  const redOpen = findings.filter((f) => f.ampel === 'rot' && !f.exception?.trim());
  const std = standards.data?.find((s) => s.contractType === c.type);
  const deviations = c.clauses.filter((b) => b.origin === 'angepasst');
  const byHeading = new Map<string, Ampel>();
  findings.forEach((f) => {
    if (!f.location) return;
    const prev = byHeading.get(f.location);
    if (!prev || RANK[f.ampel] < RANK[prev]) byHeading.set(f.location, f.ampel);
  });

  const startReview = async () => {
    try {
      const { jobId } = await api.post<{ jobId: string }>(`/api/v1/cases/${c.id}/review`);
      openStage({ jobId, kind: 'pruefung', title: c.title, resultPath: `/pruefungen/${c.id}`, resultLabel: 'Befunde beurteilen' });
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Prüfung konnte nicht starten');
    }
  };

  const decide = async () => {
    if (!decision) return;
    setBusy(true);
    try {
      await api.post(`/api/v1/cases/${c.id}/actions/${decision}`, { comment });
      toast.success(decision === 'freigeben' ? 'Freigegeben' : 'Zur Nachverhandlung zurückgegeben', { description: `${c.createdBy.name} wurde benachrichtigt.` });
      setDecision(null);
      qc.invalidateQueries({ queryKey: ['case', id] });
      qc.invalidateQueries({ queryKey: ['cases'] });
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Fehler');
    } finally {
      setBusy(false);
    }
  };

  const locate = (heading: string | null, key: string) => {
    setActive(key);
    if (!heading) return;
    const el = document.querySelector(`[data-heading="${CSS.escape(heading)}"]`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  return (
    <>
      <PageHead
        crumbs={[{ label: 'Prüfungen', to: '/' }, { label: c.title }]}
        title={c.title}
        lead={`${c.supplierName}, ${c.type}, ${c.source === 'llv_entwurf' ? 'LLV-Entwurf' : 'Papier des Lieferanten'}, eingereicht von ${c.createdBy.name}${c.dueDate ? `, Prüffrist ${dateCH(c.dueDate)}` : ''}`}
        actions={
          <>
            <CaseStatusBadge status={c.status} />
            {editable && (
              <button type="button" className="btn btn--ai" onClick={startReview}>
                <IconSpark size={16} /> {c.review ? 'Erneut prüfen' : 'KI-Prüfung starten'}
              </button>
            )}
          </>
        }
      />

      {!c.review ? (
        <Panel>
          <div className="empty">
            <span className="empty__title">Noch nicht geprüft</span>
            <p>
              Der Prüf-Agent gliedert den Vertrag in Klauseln und beurteilt jede gegen Ihren Prüfstandard {c.type}
              {std ? `, Version ${std.version} mit ${std.criteria.length} Kriterien` : ''}. Er sucht auch nach Themen, die im Vertrag fehlen. Sie entscheiden danach über jeden Punkt.
            </p>
            {editable && (
              <button type="button" className="btn btn--ai" onClick={startReview}>
                <IconSpark size={16} /> KI-Prüfung starten
              </button>
            )}
          </div>
        </Panel>
      ) : (
        <div className="figures">
          <Figure label="Nicht akzeptabel" value={sum.rot} note={redOpen.length ? `${redOpen.length} ohne Ausnahme-Begründung` : 'alle begründet'} tone={sum.rot ? 'rot' : undefined} />
          <Figure label="Verhandeln" value={sum.gelb} />
          <Figure label="Akzeptabel" value={sum.gruen} />
          <Figure label="Geprüft gegen" value={`v${c.review.standardVersion}`} note={`Prüfstandard ${c.type}, ${new Date(c.review.at).toLocaleString('de-CH', { dateStyle: 'short', timeStyle: 'short' })}`} />
        </div>
      )}

      {deviations.length > 0 && (
        <Panel title="Begründete Abweichungen der Projektleitung">
          <ul className="stack-sm" style={{ margin: 0, paddingLeft: 18 }}>
            {deviations.map((d) => (
              <li key={d.key} className="small">
                <b>{d.title}:</b> {d.justification}
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <div className="split split--wide-right review">
        <Panel
          title={text.data?.name || 'Vertragstext'}
          actions={
            c.documentId && (
              <button type="button" className="btn btn--quiet btn--sm" onClick={() => api.download(`/api/v1/documents/${c.documentId}/content`, { open: true })}>
                <IconFile size={15} /> Original öffnen
              </button>
            )
          }
          className="review__doc"
        >
          {text.isLoading && <Skeleton rows={8} />}
          <div className="contracttext">
            {(text.data?.clauses ?? []).map((cl) => {
              const a = byHeading.get(cl.heading);
              const isActive = findings.some((f) => f.criterionKey === active && f.location === cl.heading);
              return (
                <section key={cl.index} data-heading={cl.heading} className={clsx('ctclause', a && `ctclause--${a}`, isActive && 'is-active')}>
                  <h3>
                    {a && <AmpelIcon ampel={a} size={14} />} {cl.heading}
                  </h3>
                  <p>{cl.text.startsWith(cl.heading) ? cl.text.slice(cl.heading.length).trim() : cl.text}</p>
                </section>
              );
            })}
          </div>
        </Panel>

        <div className="stack">
          {c.review && (
            <div className="findings">
              {findings.map((f) => (
                <FindingCard key={f.criterionKey + (c.review?.jobId ?? '')} f={f} caseId={c.id} editable={editable} active={active === f.criterionKey} onLocate={() => locate(f.location, f.criterionKey)} />
              ))}
            </div>
          )}
        </div>
      </div>

      {c.review && editable && (
        <div className="decisionbar">
          <div className="small">
            <b>Haltepunkt H3.</b> {redOpen.length ? `${redOpen.length} rote Punkte ohne Ausnahme: Freigabe erst mit Begründung möglich.` : 'Alle roten Punkte sind begründet oder bereinigt.'}
          </div>
          <div className="row">
            <button type="button" className="btn btn--secondary" onClick={() => api.download(`/api/v1/cases/${c.id}/document.docx?kind=verhandlung`)}>
              <IconDownload size={15} /> Verhandlungspunkte (Word)
            </button>
            <button type="button" className="btn btn--secondary" onClick={() => setDecision('nachverhandeln')}>
              Zur Nachverhandlung
            </button>
            <button type="button" className="btn btn--primary" disabled={redOpen.length > 0} onClick={() => setDecision('freigeben')}>
              Freigeben
            </button>
          </div>
        </div>
      )}

      {c.review?.decision && (
        <div className="notice">
          <span>
            <b>{c.review.decision.action === 'freigeben' ? 'Freigegeben' : 'Zur Nachverhandlung zurückgegeben'}</b> von {c.review.decision.by.name} am {new Date(c.review.decision.at).toLocaleString('de-CH', { dateStyle: 'short', timeStyle: 'short' })}.
            {c.review.decision.comment && ` «${c.review.decision.comment}»`}
          </span>
        </div>
      )}

      <Panel title="Verlauf" pad={false}>
        <AuditTimeline items={c.audit} compact />
      </Panel>

      <Modal
        open={!!decision}
        onOpenChange={(o) => !o && setDecision(null)}
        title={decision === 'freigeben' ? 'Vertrag freigeben' : 'Zur Nachverhandlung zurückgeben'}
        footer={
          <>
            <button type="button" className="btn btn--secondary" onClick={() => setDecision(null)}>
              Abbrechen
            </button>
            <button type="button" className="btn btn--primary" disabled={busy} onClick={decide}>
              {busy ? 'Wird gespeichert …' : decision === 'freigeben' ? 'Freigeben' : 'Zurückgeben'}
            </button>
          </>
        }
      >
        <div className="notice">
          <span>
            {decision === 'freigeben'
              ? `Die Projektleitung lässt den Vertrag unterzeichnen. ${findings.filter((f) => f.exception).length} Ausnahme(n) kommen ins Ausnahmen-Register.`
              : `${findings.filter((f) => f.ampel !== 'gruen').length} Verhandlungspunkte gehen mit Ihren Hinweisen und den Gegenvorschlägen an ${c.createdBy.name}.`}
          </span>
        </div>
        <Field label="Kommentar">
          <textarea className="textarea" value={comment} onChange={(e) => setComment(e.target.value)} />
        </Field>
        <Status tone="neutral">Wird mit Ihrem Namen, der Standard-Version und dem KI-Ergebnis im Protokoll festgehalten</Status>
      </Modal>
      <p className="xs muted">
        <Link to={`/protokoll?objekt=${c.id}`}>Alle Einträge zu dieser Prüfung im Protokoll</Link>
      </p>
    </>
  );
}
