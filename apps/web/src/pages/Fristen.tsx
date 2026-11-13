import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import clsx from 'clsx';
import { chf, dateCH, DECISION_LABEL, GROUP_LABEL, type Deadline, type DeadlineDecision, type DeadlineGroup } from '@vm/domain';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { IconArrowRight, IconCalendar, IconSpark, IconUpload } from '../components/icons';
import { Empty, ErrorBox, Field, Figure, Modal, PageHead, Panel, Skeleton, Status } from '../components/ui';

interface DeadlinesView {
  today: string;
  open: Deadline[];
  decided: { key: string; decision: DeadlineDecision; note: string; decided_by: { name: string }; decided_at: string; deadline: Deadline | null }[];
  lockedValue: number;
}

const DECISIONS: Record<Deadline['kind'], DeadlineDecision[]> = {
  verpasst: ['sonderkuendigung_pruefen', 'neu_verhandeln', 'verlaengern'],
  kuendigung: ['kuendigen', 'verlaengern', 'neu_verhandeln'],
  ende: ['neu_verhandeln', 'auslaufen'],
  review: ['review_erledigt'],
  luecke: ['nicht_zutreffend'],
};

const EFFECT: Record<DeadlineDecision, string> = {
  kuendigen: 'Der Vertrag wird als gekündigt markiert. Ein Kündigungsschreiben aus der Vorlage wird im Ordner des Lieferanten abgelegt; die Unterschrift erfolgt gemäss Zeichnungsberechtigung.',
  verlaengern: 'Der Vertrag läuft weiter. Die Frist gilt als bewusst entschieden.',
  neu_verhandeln: 'Für die Projektleitung wird ein Vorgang mit den Eckdaten dieses Vertrags angelegt; sie wird benachrichtigt.',
  auslaufen: 'Der Vertrag wird als auslaufend markiert und endet ohne Nachfolger.',
  sonderkuendigung_pruefen: 'Der Fall wird als «Sonderkündigung prüfen» festgehalten. Klären Sie mit dem Rechtsdienst, ob eine ausserordentliche Kündigung möglich ist.',
  review_erledigt: 'Das Review gilt als durchgeführt; das nächste ist in 12 Monaten fällig.',
  nicht_zutreffend: 'Der Hinweis wird mit Ihrer Begründung als nicht zutreffend abgelegt.',
};

function DateBlock({ d, today }: { d: Deadline; today: string }) {
  if (!d.date) return <div className="dateblock dateblock--none">Lücke</div>;
  const n = d.daysLeft ?? 0;
  return (
    <div className={clsx('dateblock', d.group === 'ueberfaellig' && 'is-over', d.group === 'diese_woche' && 'is-week')}>
      <span className="dateblock__day num">{dateCH(d.date).slice(0, 6)}</span>
      <span className="dateblock__year num">{d.date.slice(0, 4)}</span>
      <span className="dateblock__rel">{n < 0 ? `seit ${-n} Tagen` : n === 0 ? 'heute' : `in ${n} Tagen`}</span>
      {void today}
    </div>
  );
}

function BoardRow({ d, today, onDecide }: { d: Deadline; today: string; onDecide: (d: Deadline, x: DeadlineDecision) => void }) {
  const missed = d.kind === 'verpasst' ? d.term?.missed : null;
  return (
    <li className={clsx('boardrow', `boardrow--${d.kind}`)}>
      <DateBlock d={d} today={today} />
      <div className="boardrow__main">
        <div className="row">
          <Status tone={d.kind === 'verpasst' ? 'rot' : d.severity === 'kritisch' ? 'rot' : d.severity === 'hoch' ? 'gelb' : 'neutral'}>{d.title}</Status>
          <span className="tag">Klasse {d.supplierClass}</span>
        </div>
        <Link to={`/lieferanten/${d.supplierId}`} className="boardrow__title">
          {d.contractTitle ?? d.supplierName}
        </Link>
        <span className="muted small">
          {d.supplierName}
          {d.contractType ? `, ${d.contractType}` : ''}
        </span>
        <p className="small">{d.detail}</p>
        {missed && (
          <div className="consequence">
            <span>
              Läuft jetzt bis <b className="num">{dateCH(missed.extendedTo)}</b>
            </span>
            <span>
              Zusätzlich gebunden <b className="num">{chf(missed.lockedValue)}</b>
            </span>
            <span>
              Nächste Kündigung absenden bis <b className="num">{dateCH(missed.nextActBy)}</b>
            </span>
          </div>
        )}
      </div>
      <div className="boardrow__actions">
        {DECISIONS[d.kind].map((x, i) => (
          <button key={x} type="button" className={clsx('btn btn--sm', i === 0 && d.kind !== 'luecke' ? 'btn--primary' : 'btn--secondary')} onClick={() => onDecide(d, x)}>
            {DECISION_LABEL[x]}
          </button>
        ))}
      </div>
    </li>
  );
}

export function Fristen() {
  const me = useAuth((s) => s.me)!;
  const qc = useQueryClient();
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ['deadlines'], queryFn: () => api.get<DeadlinesView>('/api/v1/deadlines') });
  const pending = useQuery({ queryKey: ['ingest'], queryFn: () => api.get<{ id: string; status: string; resolution: unknown; title: string }[]>('/api/v1/ingest') });
  const suppliers = useQuery({ queryKey: ['suppliers'], queryFn: () => api.get<{ stats: { annualValue: number; contracts: number } }[]>('/api/v1/suppliers') });
  const [dlg, setDlg] = useState<{ d: Deadline; x: DeadlineDecision } | null>(null);
  const [note, setNote] = useState('');
  const [showGaps, setShowGaps] = useState(false);

  const decide = useMutation({
    mutationFn: (v: { key: string; decision: DeadlineDecision; note: string }) => api.post<{ effects: string[]; createdCaseId: string | null; letterPath: string | null }>('/api/v1/deadlines/decide', v),
    onSuccess: (r, v) => {
      toast.success(`Entschieden: ${DECISION_LABEL[v.decision]}`, { description: r.effects.join('. ') || 'Im Protokoll festgehalten.' });
      setDlg(null);
      setNote('');
      qc.invalidateQueries({ queryKey: ['deadlines'] });
      qc.invalidateQueries({ queryKey: ['notifications'] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Fehler'),
  });

  const groups = useMemo(() => {
    const g: Record<DeadlineGroup, Deadline[]> = { ueberfaellig: [], diese_woche: [], naechste_30: [], spaeter: [], luecken: [] };
    (q.data?.open ?? []).forEach((d) => g[d.group].push(d));
    return g;
  }, [q.data]);
  const waiting = (pending.data ?? []).filter((j) => !j.resolution && j.status === 'done');
  const missedCount = (q.data?.open ?? []).filter((d) => d.kind === 'verpasst').length;
  const volume = (suppliers.data ?? []).reduce((n, s) => n + s.stats.annualValue, 0);

  const lead = q.data
    ? [
        missedCount ? `${missedCount} Kündigungstermine sind verpasst` : null,
        groups.diese_woche.length ? `${groups.diese_woche.length} Entscheid${groups.diese_woche.length > 1 ? 'e sind' : ' ist'} diese Woche fällig` : 'diese Woche ist nichts fällig',
      ]
        .filter(Boolean)
        .join(', ') + '.'
    : 'Ihre Fristen werden geladen.';

  return (
    <>
      <PageHead
        title={`Hallo ${me.user.firstName}`}
        lead={lead}
        actions={
          <>
            <button
              type="button"
              className="btn btn--secondary"
              onClick={async () => {
                const url = `${location.origin}/api/v1/deadlines.ics?access_token=${useAuth.getState().token}`;
                await navigator.clipboard?.writeText(url).catch(() => undefined);
                toast.success('Kalender-Link kopiert', { description: 'In Outlook unter «Kalender hinzufügen, aus dem Internet» einfügen.' });
              }}
            >
              <IconCalendar size={16} /> Kalender abonnieren
            </button>
            <button type="button" className="btn btn--primary" onClick={() => navigate('/erfassen')}>
              <IconUpload size={16} /> Vertrag erfassen
            </button>
          </>
        }
      />

      {q.data && (
        <div className="figures">
          <Figure label="Durch verpasste Termine gebunden" value={chf(q.data.lockedValue)} note={`${missedCount} Verträge verlängern sich automatisch`} tone={q.data.lockedValue ? 'rot' : undefined} />
          <Figure label="Entscheide diese Woche" value={groups.diese_woche.length} note="Kündigung oder Verlängerung" />
          <Figure label="Nächste 30 Tage" value={groups.naechste_30.length} note="Kündigungen, Reviews, Vertragsenden" />
          <Figure label="Vertragsvolumen pro Jahr" value={chf(volume)} note={`${(suppliers.data ?? []).reduce((n, s) => n + s.stats.contracts, 0)} aktive Verträge`} />
        </div>
      )}

      {waiting.length > 0 && (
        <Link to="/erfassen" className="notice notice--ai" style={{ textDecoration: 'none' }}>
          <IconSpark size={18} />
          <span className="grow">
            <b>{waiting.length} gelesene{waiting.length > 1 ? ' Verträge warten' : 'r Vertrag wartet'} auf Ihre Bestätigung (H1).</b> Erst nach Ihrer Bestätigung zählen die Fristen.
          </span>
          <IconArrowRight size={16} />
        </Link>
      )}

      {q.isLoading && <Skeleton rows={8} />}
      {q.error && <ErrorBox error={q.error} retry={q.refetch} />}

      {q.data && (
        <section className="board" aria-label="Fristen">
          {(['ueberfaellig', 'diese_woche', 'naechste_30', 'spaeter'] as DeadlineGroup[]).map((g) => (
            <div key={g} className="board__group">
              <div className="board__grouphead">
                <h2>{GROUP_LABEL[g]}</h2>
                <span className="muted num">{groups[g].length}</span>
                {g === 'ueberfaellig' && q.data.lockedValue > 0 && <span className="board__locked num">{chf(q.data.lockedValue)} zusätzlich gebunden</span>}
              </div>
              {groups[g].length ? (
                <ol className="board__rows">
                  {groups[g].map((d) => (
                    <BoardRow key={d.key} d={d} today={q.data.today} onDecide={(dd, x) => setDlg({ d: dd, x })} />
                  ))}
                </ol>
              ) : (
                <p className="muted small board__none">Nichts in diesem Zeitraum.</p>
              )}
            </div>
          ))}

          <div className="board__group">
            <div className="board__grouphead">
              <h2>{GROUP_LABEL.luecken}</h2>
              <span className="muted num">{groups.luecken.length}</span>
              <button type="button" className="btn btn--quiet btn--sm" onClick={() => setShowGaps(!showGaps)} aria-expanded={showGaps}>
                {showGaps ? 'Weniger anzeigen' : 'Alle anzeigen'}
              </button>
            </div>
            <ol className="board__rows">
              {(showGaps ? groups.luecken : groups.luecken.slice(0, 3)).map((d) => (
                <BoardRow key={d.key} d={d} today={q.data.today} onDecide={(dd, x) => setDlg({ d: dd, x })} />
              ))}
            </ol>
          </div>
        </section>
      )}

      {q.data && q.data.decided.length > 0 && (
        <Panel title="Zuletzt entschieden" pad={false}>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Entscheid</th>
                  <th>Vertrag</th>
                  <th>Begründung</th>
                  <th>Von</th>
                </tr>
              </thead>
              <tbody>
                {q.data.decided.slice(0, 8).map((x) => (
                  <tr key={x.key}>
                    <td>
                      <Status tone="accent">{DECISION_LABEL[x.decision]}</Status>
                    </td>
                    <td>
                      <div className="cell-title">{x.deadline?.contractTitle ?? x.deadline?.title ?? x.key}</div>
                      <div className="cell-sub">{x.deadline?.supplierName}</div>
                    </td>
                    <td className="small">{x.note || '–'}</td>
                    <td className="small nowrap">
                      {x.decided_by.name}
                      <div className="cell-sub">{new Date(x.decided_at).toLocaleString('de-CH', { dateStyle: 'short', timeStyle: 'short' })}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      {q.data && !q.data.open.length && <Empty title="Keine offenen Fristen">Alle Verträge sind entschieden oder liegen ausserhalb der Vorlaufzeit.</Empty>}

      <Modal
        open={!!dlg}
        onOpenChange={(o) => !o && setDlg(null)}
        title={dlg ? `${DECISION_LABEL[dlg.x]}: ${dlg.d.contractTitle ?? dlg.d.title}` : ''}
        footer={
          <>
            <button type="button" className="btn btn--secondary" onClick={() => setDlg(null)}>
              Abbrechen
            </button>
            <button type="button" className="btn btn--primary" disabled={decide.isPending || (dlg?.x === 'nicht_zutreffend' && note.trim().length < 3)} onClick={() => dlg && decide.mutate({ key: dlg.d.key, decision: dlg.x, note })}>
              {decide.isPending ? 'Wird gespeichert …' : `${DECISION_LABEL[dlg?.x ?? 'kuendigen']} bestätigen`}
            </button>
          </>
        }
      >
        {dlg && (
          <>
            <div className="notice">
              <span>
                <b>Haltepunkt H4, Fristentscheid.</b> {EFFECT[dlg.x]}
              </span>
            </div>
            <dl className="kv">
              <dt>Lieferant</dt>
              <dd>{dlg.d.supplierName}</dd>
              {dlg.d.term?.noticeBy && (
                <>
                  <dt>Kündigung eintreffen bis</dt>
                  <dd className="num">{dateCH(dlg.d.term.noticeBy)}</dd>
                  <dt>Wirksam per</dt>
                  <dd className="num">{dateCH(dlg.d.term.terminationDate)}</dd>
                </>
              )}
            </dl>
            <Field label={dlg.x === 'nicht_zutreffend' ? 'Begründung (Pflicht)' : 'Begründung'} hint="Wird mit Ihrem Namen im Protokoll festgehalten.">
              <textarea className="textarea" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Zum Beispiel: Ablösung durch neue Lösung ab 2027 geplant" />
            </Field>
          </>
        )}
      </Modal>
    </>
  );
}
