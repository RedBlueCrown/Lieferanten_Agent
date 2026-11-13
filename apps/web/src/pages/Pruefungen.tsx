import { Link, useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { dateCH, diffDays, type ReviewStandard } from '@vm/domain';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import type { CaseListItem } from '../lib/types';
import { AmpelStatus, CaseStatusBadge, Empty, Loadable, PageHead, Panel, Status } from '../components/ui';

export function Pruefungen() {
  const me = useAuth((s) => s.me)!;
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ['cases', 'review'], queryFn: () => api.get<CaseListItem[]>('/api/v1/cases?scope=all') });
  const standards = useQuery({ queryKey: ['standards'], queryFn: () => api.get<ReviewStandard[]>('/api/v1/standards') });
  const today = me.system.today;
  const open = (q.data ?? []).filter((c) => c.status === 'in_pruefung').sort((a, b) => (a.dueDate ?? '9').localeCompare(b.dueDate ?? '9'));
  const decided = (q.data ?? []).filter((c) => c.review?.decision).slice(0, 6);
  const next = open[0];
  const warnings = (standards.data ?? []).reduce((n, s) => n + s.warnings.length, 0);

  return (
    <>
      <PageHead
        title={`Hallo ${me.user.firstName}`}
        lead={q.data ? (open.length ? `${open.length} Prüfauftr${open.length > 1 ? 'äge warten' : 'ag wartet'}, der nächste ist ${next?.dueDate ? `am ${dateCH(next.dueDate)}` : 'ohne Frist'} fällig.` : 'Keine offenen Prüfaufträge.') : 'Ihre Prüfaufträge werden geladen.'}
      />
      <Panel title="Prüf-Eingang" pad={false}>
        <Loadable q={q} empty={() => (open.length ? null : <Empty title="Alles geprüft">Neue Prüfaufträge erscheinen hier, sobald die Projektleitung einen Vertrag einreicht.</Empty>)}>
          {() => (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Vertrag</th>
                    <th>Art</th>
                    <th>Quelle</th>
                    <th>Eingereicht von</th>
                    <th>Prüffrist</th>
                    <th>KI-Vorprüfung</th>
                  </tr>
                </thead>
                <tbody>
                  {open.map((c) => {
                    const days = c.dueDate ? diffDays(c.dueDate, today) : null;
                    return (
                      <tr key={c.id} className="is-link" tabIndex={0} onClick={() => navigate(`/pruefungen/${c.id}`)} onKeyDown={(e) => e.key === 'Enter' && navigate(`/pruefungen/${c.id}`)}>
                        <td>
                          <Link to={`/pruefungen/${c.id}`} className="cell-title">
                            {c.title}
                          </Link>
                          <div className="cell-sub">{c.supplierName}</div>
                        </td>
                        <td>{c.type}</td>
                        <td>{c.source === 'llv_entwurf' ? <Status tone="accent">LLV-Entwurf, {c.deviations} Abweichung{c.deviations === 1 ? '' : 'en'}</Status> : <Status>Lieferantenpapier</Status>}</td>
                        <td className="nowrap">{c.createdBy.name}</td>
                        <td className="nowrap">
                          <span className="num">{dateCH(c.dueDate)}</span>
                          {days !== null && <div className="cell-sub" style={days < 0 ? { color: 'var(--color-red)' } : undefined}>{days < 0 ? `seit ${-days} Tagen überfällig` : days === 0 ? 'heute' : `in ${days} Tagen`}</div>}
                        </td>
                        <td>
                          {c.review ? (
                            <span className="row">
                              {c.review.summary.rot > 0 && <AmpelStatus ampel="rot" label={String(c.review.summary.rot)} />}
                              {c.review.summary.gelb > 0 && <AmpelStatus ampel="gelb" label={String(c.review.summary.gelb)} />}
                              <AmpelStatus ampel="gruen" label={String(c.review.summary.gruen)} />
                            </span>
                          ) : (
                            <span className="muted small">noch nicht geprüft</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Loadable>
      </Panel>

      <div className="split">
        <Panel title="Zuletzt entschieden" pad={false}>
          {decided.length ? (
            <table className="table">
              <tbody>
                {decided.map((c) => (
                  <tr key={c.id} className="is-link" onClick={() => navigate(`/pruefungen/${c.id}`)}>
                    <td>
                      <div className="cell-title">{c.title}</div>
                      <div className="cell-sub">{c.supplierName}</div>
                    </td>
                    <td className="right">
                      <CaseStatusBadge status={c.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="muted small" style={{ padding: 'var(--space-lg)' }}>Noch keine Entscheide.</p>
          )}
        </Panel>
        <Panel title="Ihre Prüfstandards" actions={<Link to="/pruefstandards" className="btn btn--quiet btn--sm">Alle ansehen</Link>} pad={false}>
          <table className="table">
            <tbody>
              {(standards.data ?? []).map((s) => (
                <tr key={s.contractType}>
                  <td className="cell-title">{s.contractType}</td>
                  <td className="small">Version {s.version}</td>
                  <td className="small">{s.criteria.length} Kriterien</td>
                  <td className="right">{s.warnings.length ? <Status tone="gelb">{s.warnings.length} Hinweise</Status> : <Status tone="gruen">gelesen</Status>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {warnings > 0 && <p className="small" style={{ padding: '0 var(--space-lg) var(--space-md)' }}>Einige Word-Dokumente sind unvollständig. Details unter Prüfstandards.</p>}
        </Panel>
      </div>
    </>
  );
}
