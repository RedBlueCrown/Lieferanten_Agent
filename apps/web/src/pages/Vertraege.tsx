import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { chf, CONTRACT_TYPES, dateCH, type TermState } from '@vm/domain';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { track } from '../lib/audit';
import { IconDownload, IconFile } from '../components/icons';
import { Empty, Loadable, PageHead, Panel, Status } from '../components/ui';

interface Row {
  id: string;
  supplierId: string;
  supplierName: string;
  type: string;
  title: string;
  start: string | null;
  end: string | null;
  noticeMonths: number;
  renewalMonths: number;
  annualValue: number;
  law: string | null;
  venue: string | null;
  status: string;
  documentPath: string | null;
  term: TermState;
}

export function Vertraege() {
  const me = useAuth((s) => s.me)!;
  const [params, setParams] = useSearchParams();
  const q = useQuery({ queryKey: ['contracts'], queryFn: () => api.get<Row[]>('/api/v1/contracts') });
  const search = params.get('q') ?? '';
  const type = params.get('art') ?? '';
  const supplier = params.get('lieferant') ?? '';
  const set = (k: string, v: string) => {
    const n = new URLSearchParams(params);
    if (v) n.set(k, v);
    else n.delete(k);
    setParams(n, { replace: true });
  };
  const rows = useMemo(
    () =>
      (q.data ?? []).filter(
        (c) => (!search || `${c.title} ${c.supplierName} ${c.id}`.toLowerCase().includes(search.toLowerCase())) && (!type || c.type === type) && (!supplier || c.supplierId === supplier),
      ),
    [q.data, search, type, supplier],
  );
  const canExport = me.permissions.includes('export');

  return (
    <>
      <PageHead
        title="Verträge"
        lead="Alle Verträge mit dem nächsten Kündigungstermin, wie ihn die Fristenlogik heute berechnet."
        actions={
          canExport && (
            <button
              type="button"
              className="btn btn--secondary"
              onClick={() => {
                track({ type: 'aktion', name: 'Excel-Export angefordert' });
                api.download('/api/v1/exports/contracts.xlsx');
              }}
            >
              <IconDownload size={16} /> Excel
            </button>
          )
        }
      />
      <div className="row">
        <input className="input" style={{ maxWidth: 320 }} type="search" placeholder="Vertrag, Lieferant oder Nummer" value={search} onChange={(e) => set('q', e.target.value)} aria-label="Verträge durchsuchen" />
        <select className="select" style={{ maxWidth: 240 }} value={type} onChange={(e) => set('art', e.target.value)} aria-label="Vertragsart">
          <option value="">Alle Vertragsarten</option>
          {CONTRACT_TYPES.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
        {supplier && (
          <button type="button" className="btn btn--quiet btn--sm" onClick={() => set('lieferant', '')}>
            Lieferantenfilter entfernen
          </button>
        )}
        <span className="muted small">{rows.length} Verträge</span>
      </div>
      <Panel pad={false}>
        <Loadable q={q} empty={() => (rows.length ? null : <Empty title="Keine Verträge gefunden">Passen Sie Suche oder Filter an.</Empty>)}>
          {() => (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Vertrag</th>
                    <th>Art</th>
                    <th>Laufzeit bis</th>
                    <th>Kündigung absenden bis</th>
                    <th className="right">Wert p. a.</th>
                    <th>Recht</th>
                    <th>Ablage</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((c) => (
                    <tr key={c.id}>
                      <td>
                        <div className="cell-title">{c.title}</div>
                        <div className="cell-sub">
                          {me.permissions.includes('suppliers:write') ? <Link to={`/lieferanten/${c.supplierId}`}>{c.supplierName}</Link> : c.supplierName}, {c.id}
                        </div>
                      </td>
                      <td className="small">{c.type}</td>
                      <td className="small nowrap num">
                        {c.end ? dateCH(c.term.termEnd ?? c.end) : 'unbefristet'}
                        {c.term.renewalsSoFar > 0 && <div className="cell-sub">{c.term.renewalsSoFar}× verlängert</div>}
                      </td>
                      <td className="small nowrap">
                        {c.status !== 'aktiv' ? (
                          <Status>{c.status}</Status>
                        ) : c.term.missed ? (
                          <>
                            <Status tone="rot">verpasst</Status>
                            <div className="cell-sub">läuft bis {dateCH(c.term.missed.extendedTo)}</div>
                          </>
                        ) : c.term.actBy ? (
                          <span className="num">{dateCH(c.term.actBy)}</span>
                        ) : (
                          <span className="muted">{c.term.endsByItself ? 'endet ohne Kündigung' : '–'}</span>
                        )}
                      </td>
                      <td className="right num">{chf(c.annualValue)}</td>
                      <td className="small nowrap">
                        {c.law ?? '–'}
                        {c.venue ? `, ${c.venue}` : ''}
                      </td>
                      <td>
                        {c.documentPath ? (
                          <button type="button" className="btn btn--quiet btn--sm" onClick={() => api.download(`/api/v1/documents/by-path?path=${encodeURIComponent(c.documentPath!)}`, { open: true })}>
                            <IconFile size={15} /> PDF
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
          )}
        </Loadable>
      </Panel>
    </>
  );
}
