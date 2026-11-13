import { Link, useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { dateCH } from '@vm/domain';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import type { CaseListItem } from '../lib/types';
import { IconArrowRight, IconFile, IconSpark } from '../components/icons';
import { AmpelStatus, CaseStatusBadge, CaseTrack, Empty, Loadable, PageHead } from '../components/ui';

function nextStep(c: CaseListItem): string {
  switch (c.status) {
    case 'entwurf':
      return c.clauseCount ? 'Entwurf prüfen und einreichen.' : 'Entwurf erstellen lassen.';
    case 'in_pruefung':
      return `Beim Rechtsdienst${c.dueDate ? `, Prüffrist ${dateCH(c.dueDate)}` : ''}.`;
    case 'nachverhandlung':
      return 'Verhandlungspunkte mit dem Lieferanten klären und neue Fassung hochladen.';
    case 'freigegeben':
      return 'Unterzeichnen lassen und die unterzeichnete Fassung hochladen.';
    case 'unterzeichnet':
      return 'Das Lieferantenmanagement bestätigt die Vertragsdaten.';
    case 'aktiv':
      return 'Vertrag ist im Register.';
    default:
      return '';
  }
}

export function Vorgaenge() {
  const me = useAuth((s) => s.me)!;
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ['cases', 'mine'], queryFn: () => api.get<CaseListItem[]>('/api/v1/cases?scope=mine') });
  const list = q.data ?? [];
  const mine = list.filter((c) => c.createdBy.oid === me.user.oid);
  const needsMe = mine.filter((c) => ['entwurf', 'nachverhandlung', 'freigegeben'].includes(c.status)).length;
  const atLegal = mine.filter((c) => c.status === 'in_pruefung').length;

  return (
    <>
      <PageHead
        title={`Hallo ${me.user.firstName}`}
        lead={q.data ? `${needsMe ? `${needsMe} Vorgang${needsMe > 1 ? 'e brauchen' : ' braucht'} Ihren nächsten Schritt` : 'Bei Ihnen ist nichts offen'}, ${atLegal} ${atLegal === 1 ? 'liegt' : 'liegen'} beim Rechtsdienst.` : 'Ihre Vorgänge werden geladen.'}
        actions={
          <>
            <button type="button" className="btn btn--secondary" onClick={() => navigate('/vorgaenge/neu?art=lieferantenpapier')}>
              <IconFile size={16} /> Lieferantenvertrag prüfen lassen
            </button>
            <button type="button" className="btn btn--primary" onClick={() => navigate('/vorgaenge/neu')}>
              <IconSpark size={16} /> Neuen Vertrag erstellen
            </button>
          </>
        }
      />
      <Loadable
        q={q}
        empty={(d) =>
          d.length ? null : (
            <Empty title="Noch keine Vorgänge" action={<Link className="btn btn--primary" to="/vorgaenge/neu">Neuen Vertrag erstellen</Link>}>
              Erstellen Sie einen Vertrag aus den Textbausteinen des Rechtsdienstes oder lassen Sie einen Vertrag des Lieferanten prüfen.
            </Empty>
          )
        }
      >
        {(d) => (
          <ol className="caselist">
            {d.map((c) => (
              <li key={c.id}>
                <Link to={`/vorgaenge/${c.id}`} className="casecard">
                  <div className="casecard__head">
                    <div className="stack-sm" style={{ gap: 2 }}>
                      <span className="casecard__title">{c.title}</span>
                      <span className="muted small">
                        {c.supplierName}, {c.type}, {c.source === 'llv_entwurf' ? 'LLV-Vorlage' : 'Papier des Lieferanten'}
                      </span>
                    </div>
                    <CaseStatusBadge status={c.status} />
                  </div>
                  <CaseTrack status={c.status} />
                  <div className="row-between">
                    <span className="small">{nextStep(c)}</span>
                    <span className="row">
                      {c.review && (
                        <>
                          {c.review.summary.rot > 0 && <AmpelStatus ampel="rot" label={`${c.review.summary.rot} nicht akzeptabel`} />}
                          {c.review.summary.gelb > 0 && <AmpelStatus ampel="gelb" label={`${c.review.summary.gelb} verhandeln`} />}
                        </>
                      )}
                      <IconArrowRight size={16} />
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ol>
        )}
      </Loadable>
    </>
  );
}
