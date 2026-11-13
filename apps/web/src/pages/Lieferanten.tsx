import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Tabs } from '@base-ui/react/tabs';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import clsx from 'clsx';
import { chf, dateCH, NOTICE_MODE_LABEL, type Deadline, type TermState } from '@vm/domain';
import { api } from '../lib/api';
import type { AuditRecord } from '../lib/types';
import { IconFile } from '../components/icons';
import { Empty, ErrorBox, Figure, Loadable, PageHead, Panel, Skeleton, Status } from '../components/ui';
import { AuditTimeline } from './Protokoll';

interface SupplierRow {
  id: string;
  name: string;
  city: string;
  country: string;
  class: 'A' | 'B' | 'C';
  contact: { name?: string; email?: string };
  stats: { contracts: number; annualValue: number; openDeadlines: number; critical: number; gaps: number; deficient: number; assessed: boolean };
}

export function Lieferanten() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const cls = params.get('klasse') ?? '';
  const q = useQuery({ queryKey: ['suppliers'], queryFn: () => api.get<SupplierRow[]>('/api/v1/suppliers') });
  const rows = (q.data ?? []).filter((s) => !cls || s.class === cls);
  const total = rows.reduce((n, s) => n + s.stats.annualValue, 0);
  const top5 = [...rows].sort((a, b) => b.stats.annualValue - a.stats.annualValue).slice(0, 5).reduce((n, s) => n + s.stats.annualValue, 0);

  return (
    <>
      <PageHead title="Lieferanten" lead="Bedeutung, Vertragsvolumen, offene Fristen und Beurteilung jedes Lieferanten." />
      {q.data && (
        <div className="figures">
          <Figure label="Lieferanten" value={rows.length} note={cls ? `Klasse ${cls}` : 'alle Klassen'} />
          <Figure label="Vertragsvolumen pro Jahr" value={chf(total)} />
          <Figure label="Anteil der fünf grössten" value={total ? `${Math.round((top5 / total) * 100)} %` : '–'} note="Konzentrationsrisiko" />
          <Figure label="Mit kritischen Fristen" value={rows.filter((s) => s.stats.critical > 0).length} tone={rows.some((s) => s.stats.critical) ? 'rot' : undefined} />
        </div>
      )}
      <div className="row" role="group" aria-label="Klasse filtern">
        {['', 'A', 'B', 'C'].map((c) => (
          <button key={c} type="button" className={clsx('btn btn--sm', cls === c ? 'btn--primary' : 'btn--secondary')} onClick={() => setParams(c ? { klasse: c } : {})}>
            {c ? `Klasse ${c}` : 'Alle'}
          </button>
        ))}
      </div>
      <Panel pad={false}>
        <Loadable q={q} empty={() => (rows.length ? null : <Empty title="Keine Lieferanten in dieser Klasse" />)}>
          {() => (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Lieferant</th>
                    <th>Klasse</th>
                    <th className="right">Verträge</th>
                    <th className="right">Volumen p. a.</th>
                    <th>Fristen</th>
                    <th>Beurteilung</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((s) => (
                    <tr key={s.id} className="is-link" tabIndex={0} onClick={() => navigate(`/lieferanten/${s.id}`)} onKeyDown={(e) => e.key === 'Enter' && navigate(`/lieferanten/${s.id}`)}>
                      <td>
                        <Link to={`/lieferanten/${s.id}`} className="cell-title">
                          {s.name}
                        </Link>
                        <div className="cell-sub">
                          {s.city} ({s.country}), {s.contact.name}
                        </div>
                      </td>
                      <td>
                        <span className="tag">{s.class}</span>
                      </td>
                      <td className="right num">{s.stats.contracts}</td>
                      <td className="right num">{chf(s.stats.annualValue)}</td>
                      <td>
                        <span className="row">
                          {s.stats.critical > 0 && <Status tone="rot">{s.stats.critical} kritisch</Status>}
                          {s.stats.openDeadlines - s.stats.critical > 0 && <Status tone="gelb">{s.stats.openDeadlines - s.stats.critical} offen</Status>}
                          {s.stats.gaps > 0 && <Status>{s.stats.gaps} Lücken</Status>}
                          {!s.stats.openDeadlines && !s.stats.gaps && <Status tone="gruen">in Ordnung</Status>}
                        </span>
                      </td>
                      <td>{!s.stats.assessed ? <Status>nicht erfasst</Status> : s.stats.deficient ? <Status tone="gelb">{s.stats.deficient} mangelhaft</Status> : <Status tone="gruen">keine Mängel</Status>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Loadable>
      </Panel>
    </>
  );
}

interface ContractRow {
  id: string;
  type: string;
  title: string;
  start: string | null;
  end: string | null;
  noticeMonths: number;
  noticeMode: keyof typeof NOTICE_MODE_LABEL;
  renewalMonths: number;
  annualValue: number;
  reviewDate: string | null;
  law: string | null;
  venue: string | null;
  status: string;
  documentPath: string | null;
  note: string;
  term: TermState;
}

interface SupplierDetail extends Omit<SupplierRow, 'stats'> {
  legalForm: string;
  contact: { name?: string; email?: string; phones?: { art: string; nr: string }[] };
  apps: { name: string; level: string; operationsOwner: string | null; business: string | null; contact: string | null; note: string }[];
  kpi: Record<string, { wert: string; begr: string }>;
  risk: Record<string, { wert: string; begr: string }>;
  measures: string;
  priceHistory: { year: number; offered: number; negotiated: number; hourlyRate: number; note: string }[] | null;
  contracts: ContractRow[];
  deadlines: Deadline[];
  audit: AuditRecord[];
}

const KPI_LABEL: Record<string, string> = {
  liefertermine: 'Einhaltung der Liefertermine',
  agilitaet: 'Reaktionsfähigkeit bei Änderungen',
  qualitaet: 'Technische Qualität',
  preise: 'Stabilität der Preise',
  zusatzkosten: 'Zusatzkosten',
  stundensaetze: 'Stundensätze',
  erreichbarkeit: 'Erreichbarkeit und Reaktionszeiten',
  fachkunde: 'Fachkundige Unterstützung',
  doku: 'Dokumentation und Schulung',
  proaktiv: 'Proaktive Kommunikation',
  ticketing: 'Ticketingsystem',
  eskalation: 'Eskalationspfad',
  meetings: 'Regelmässige Meetings',
  rechtsform: 'Gesellschaftsform',
  finanzen: 'Finanzielle Stabilität',
  mitarbeiter: 'Mitarbeitende',
  kunden: 'Kunden',
  strategie: 'Strategie',
  reifegrad: 'Technischer Reifegrad',
  abhaengigkeit: 'Abhängigkeit',
  nachfolge: 'Nachfolgeregelung',
  exit: 'Exit-Strategie',
};

function Rating({ data }: { data: Record<string, { wert: string; begr: string }> }) {
  const entries = Object.entries(data);
  if (!entries.length) return <Empty title="Noch nicht beurteilt">Die Beurteilung ist eine Datenlücke in der Fristenliste, bis sie erfasst ist.</Empty>;
  return (
    <table className="table">
      <tbody>
        {entries.map(([k, v]) => (
          <tr key={k}>
            <td className="cell-title">{KPI_LABEL[k] ?? k}</td>
            <td>{v.wert === 'Mangelhaft' ? <Status tone="rot">Mangelhaft</Status> : v.wert === 'Top' ? <Status tone="gruen">Top</Status> : v.wert === 'OK' ? <Status tone="gruen">OK</Status> : <Status>{v.wert}</Status>}</td>
            <td className="small muted">{v.begr}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function LieferantDetail() {
  const { id } = useParams();
  const q = useQuery({ queryKey: ['supplier', id], queryFn: () => api.get<SupplierDetail>(`/api/v1/suppliers/${id}`) });
  if (q.isLoading) return <Skeleton rows={10} />;
  if (q.error || !q.data) return <ErrorBox error={q.error} retry={q.refetch} />;
  const s = q.data;
  const volume = s.contracts.filter((c) => c.status !== 'beendet').reduce((n, c) => n + c.annualValue, 0);
  const missed = s.deadlines.filter((d) => d.kind === 'verpasst');

  return (
    <>
      <PageHead
        crumbs={[{ label: 'Lieferanten', to: '/lieferanten' }, { label: s.name }]}
        title={s.name}
        lead={`${s.legalForm ?? ''} in ${s.city} (${s.country}). Ansprechperson ${s.contact.name ?? '–'}${s.contact.email ? `, ${s.contact.email}` : ''}.`}
        actions={<span className="tag">Klasse {s.class}</span>}
      />
      <div className="figures">
        <Figure label="Aktive Verträge" value={s.contracts.filter((c) => c.status === 'aktiv').length} />
        <Figure label="Volumen pro Jahr" value={chf(volume)} />
        <Figure label="Offene Fristen" value={s.deadlines.filter((d) => d.group !== 'luecken').length} note={missed.length ? `${missed.length} verpasst` : undefined} tone={missed.length ? 'rot' : undefined} />
        <Figure label="Anwendungen" value={s.apps.length} note={s.apps.map((a) => a.level).join(', ')} />
      </div>
      {s.deadlines.length > 0 && (
        <div className="notice notice--warn">
          <span>
            <b>Offen:</b> {s.deadlines.map((d) => `${d.title}${d.contractTitle ? ` (${d.contractTitle})` : ''}`).join('; ')}. <Link to="/">Zur Fristenliste</Link>
          </span>
        </div>
      )}
      <Tabs.Root defaultValue="vertraege">
        <Tabs.List className="tabs__list">
          {[
            ['vertraege', `Verträge (${s.contracts.length})`],
            ['anwendungen', `Anwendungen (${s.apps.length})`],
            ['leistung', 'Leistung'],
            ['risiko', 'Risiko'],
            ['preise', 'Preise'],
            ['protokoll', 'Protokoll'],
          ].map(([v, l]) => (
            <Tabs.Tab key={v} value={v} className="tabs__tab">
              {l}
            </Tabs.Tab>
          ))}
          <Tabs.Indicator className="tabs__indicator" />
        </Tabs.List>
        <Tabs.Panel value="vertraege" className="tabs__panel">
          <Panel pad={false}>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Vertrag</th>
                    <th>Laufzeit</th>
                    <th>Kündigung</th>
                    <th className="right">Wert p. a.</th>
                    <th>Recht</th>
                    <th>Ablage</th>
                  </tr>
                </thead>
                <tbody>
                  {s.contracts.map((c) => (
                    <tr key={c.id}>
                      <td>
                        <div className="cell-title">{c.title}</div>
                        <div className="cell-sub">
                          {c.type}, {c.id}
                          {c.status !== 'aktiv' && `, ${c.status}`}
                        </div>
                      </td>
                      <td className="small nowrap">
                        <span className="num">
                          {dateCH(c.start)} bis {c.end ? dateCH(c.term.termEnd ?? c.end) : 'unbefristet'}
                        </span>
                        {c.renewalMonths > 0 && <div className="cell-sub">verlängert sich um {c.renewalMonths} Mt.</div>}
                      </td>
                      <td className="small nowrap">
                        {c.term.missed ? (
                          <>
                            <Status tone="rot">verpasst</Status>
                            <div className="cell-sub">läuft bis {dateCH(c.term.missed.extendedTo)}</div>
                          </>
                        ) : c.term.noticeBy ? (
                          <>
                            <span className="num">bis {dateCH(c.term.noticeBy)}</span>
                            <div className="cell-sub">
                              {c.noticeMonths} Mt. {NOTICE_MODE_LABEL[c.noticeMode]}
                            </div>
                          </>
                        ) : (
                          <span className="muted">{c.term.endsByItself ? 'endet ohne Kündigung' : '–'}</span>
                        )}
                      </td>
                      <td className="right num">{chf(c.annualValue)}</td>
                      <td className="small">
                        {c.law ?? '–'}
                        {c.venue ? `, ${c.venue}` : ''}
                      </td>
                      <td>
                        {c.documentPath ? (
                          <button type="button" className="btn btn--quiet btn--sm" onClick={() => api.download(`/api/v1/documents/by-path?path=${encodeURIComponent(c.documentPath!)}`, { open: true })}>
                            <IconFile size={15} /> Öffnen
                          </button>
                        ) : (
                          <Status tone="gelb">fehlt</Status>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </Tabs.Panel>
        <Tabs.Panel value="anwendungen" className="tabs__panel">
          <Panel pad={false}>
            <table className="table">
              <thead>
                <tr>
                  <th>Anwendung</th>
                  <th>Level</th>
                  <th>Betrieb</th>
                  <th>Fachverantwortung</th>
                </tr>
              </thead>
              <tbody>
                {s.apps.map((a) => (
                  <tr key={a.name}>
                    <td className="cell-title">{a.name}</td>
                    <td>
                      <span className="tag">{a.level}</span>
                    </td>
                    <td className="small">{a.operationsOwner ?? <Status tone="gelb">fehlt</Status>}</td>
                    <td className="small">{a.business ?? '–'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        </Tabs.Panel>
        <Tabs.Panel value="leistung" className="tabs__panel">
          <Panel pad={false}>
            <Rating data={s.kpi} />
          </Panel>
        </Tabs.Panel>
        <Tabs.Panel value="risiko" className="tabs__panel">
          <div className="stack">
            <Panel pad={false}>
              <Rating data={s.risk} />
            </Panel>
            {s.measures && (
              <Panel title="Massnahmenplan">
                <p>{s.measures}</p>
              </Panel>
            )}
          </div>
        </Tabs.Panel>
        <Tabs.Panel value="preise" className="tabs__panel">
          <Panel title="Preis- und Volumenentwicklung">
            {s.priceHistory?.length ? (
              <div style={{ height: 320 }}>
                <ResponsiveContainer>
                  <BarChart data={s.priceHistory} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke="var(--color-rule)" />
                    <XAxis dataKey="year" tickLine={false} axisLine={false} />
                    <YAxis tickFormatter={(v) => `${Math.round(v / 1000)}k`} tickLine={false} axisLine={false} width={48} />
                    <Tooltip formatter={(v) => chf(Number(v))} />
                    <Legend />
                    <Bar dataKey="offered" name="Angebot" fill="var(--color-rule-strong)" radius={[3, 3, 0, 0]} />
                    <Bar dataKey="negotiated" name="Verhandelt" fill="var(--color-accent)" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <Empty title="Keine Preisdaten" />
            )}
          </Panel>
        </Tabs.Panel>
        <Tabs.Panel value="protokoll" className="tabs__panel">
          <Panel pad={false}>
            <AuditTimeline items={s.audit} />
          </Panel>
        </Tabs.Panel>
      </Tabs.Root>
    </>
  );
}
