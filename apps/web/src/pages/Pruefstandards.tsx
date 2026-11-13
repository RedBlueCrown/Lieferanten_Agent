import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CONTRACT_TYPES, dateCH, type ReviewStandard } from '@vm/domain';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { IconDownload, IconExternal, IconRefresh } from '../components/icons';
import { AmpelIcon, Loadable, PageHead, Panel, Status } from '../components/ui';

export function Pruefstandards() {
  const me = useAuth((s) => s.me)!;
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['standards'], queryFn: () => api.get<ReviewStandard[]>('/api/v1/standards') });
  const [open, setOpen] = useState<string | null>('SaaS-Vertrag');
  const [tpl, setTpl] = useState<string>(CONTRACT_TYPES[0]);
  const sync = useMutation({
    mutationFn: () => api.post<{ changed: string[] }>('/api/v1/standards/sync'),
    onSuccess: (r) => {
      toast.success(r.changed.length ? `${r.changed.length} Prüfstandard(s) neu eingelesen` : 'Keine Änderungen in den Word-Dokumenten');
      qc.invalidateQueries({ queryKey: ['standards'] });
    },
  });
  const openFile = (s: ReviewStandard) => (s.source.webUrl ? window.open(s.source.webUrl, '_blank', 'noopener') : api.download(`/api/v1/documents/by-path?path=${encodeURIComponent(s.source.path)}`));

  return (
    <>
      <PageHead
        title="Prüfstandards"
        lead={`Sie pflegen die Standards als Word-Dokumente im Ordner «Prüfstandards» (${me.system.storage.label}). Nach dem Speichern liest die Anwendung jede Änderung ein und versioniert sie.`}
        actions={
          <button type="button" className="btn btn--secondary" onClick={() => sync.mutate()} disabled={sync.isPending}>
            <IconRefresh size={16} /> {sync.isPending ? 'Liest ein …' : 'Jetzt neu einlesen'}
          </button>
        }
      />

      <div className="split split--wide-left">
        <Loadable q={q}>
          {(list) => (
            <div className="stack">
              {list.map((s) => (
                <Panel
                  key={s.contractType}
                  title={
                    <button type="button" className="linklike panel-toggle" aria-expanded={open === s.contractType} onClick={() => setOpen(open === s.contractType ? null : s.contractType)}>
                      <h2 style={{ fontSize: 'var(--text-lg)' }}>{s.contractType}</h2>
                      <span className="muted small">
                        Version {s.version}, Stand {s.updatedAt}, {s.criteria.length} Kriterien{s.author ? `, ${s.author}` : ''}
                      </span>
                    </button>
                  }
                  actions={
                    <>
                      {s.warnings.length ? <Status tone="gelb">{s.warnings.length} Hinweis{s.warnings.length > 1 ? 'e' : ''}</Status> : <Status tone="gruen">vollständig gelesen</Status>}
                      <button type="button" className="btn btn--quiet btn--sm" onClick={() => openFile(s)}>
                        <IconExternal size={15} /> In Word öffnen
                      </button>
                    </>
                  }
                  pad={false}
                >
                  {s.warnings.length > 0 && (
                    <ul className="warnings">
                      {s.warnings.map((w) => (
                        <li key={w}>{w}</li>
                      ))}
                    </ul>
                  )}
                  {open === s.contractType && (
                    <div className="table-wrap">
                      <table className="table criteria">
                        <thead>
                          <tr>
                            <th>Kriterium</th>
                            <th>
                              <span className="row"><AmpelIcon ampel="gruen" /> Akzeptabel</span>
                            </th>
                            <th>
                              <span className="row"><AmpelIcon ampel="gelb" /> Verhandeln</span>
                            </th>
                            <th>
                              <span className="row"><AmpelIcon ampel="rot" /> Nicht akzeptabel</span>
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {s.criteria.map((c) => (
                            <tr key={c.key}>
                              <td className="cell-title">{c.title}</td>
                              <td className="small">{c.gruen}</td>
                              <td className="small">{c.gelb}</td>
                              <td className="small">{c.rot}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  <p className="xs muted" style={{ padding: '10px var(--space-lg)' }}>
                    Quelle: {s.source.path}
                    {s.source.lastModified ? `, gespeichert ${dateCH(s.source.lastModified.slice(0, 10))}` : ''}
                  </p>
                </Panel>
              ))}
            </div>
          )}
        </Loadable>

        <div className="stack">
          <Panel title="So ist ein Prüfstandard aufgebaut">
            <div className="stack-sm small">
              <p>Ein Word-Dokument pro Vertragsart, Dateiname «Prüfstandard &lt;Vertragsart&gt;.docx».</p>
              <ol className="howto">
                <li>Überschrift 1: «Prüfstandard SaaS-Vertrag»</li>
                <li>Zeilen «Version: 2.1», «Stand: …», «Verantwortlich: …»</li>
                <li>Pro Kriterium eine Überschrift 2, zum Beispiel «5. Haftung»</li>
                <li>Darunter eine Tabelle mit vier Zeilen: Grün, Gelb, Rot, Musterformulierung</li>
              </ol>
              <p>Die Musterformulierungen sind gleichzeitig die Textbausteine, aus denen der Entwurfs-Agent neue Verträge zusammenstellt.</p>
            </div>
          </Panel>
          <Panel title="Vorlage herunterladen">
            <div className="stack-sm">
              <select className="select" value={tpl} onChange={(e) => setTpl(e.target.value)} aria-label="Vertragsart">
                {CONTRACT_TYPES.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
              <button type="button" className="btn btn--secondary" onClick={() => api.download(`/api/v1/standards/template.docx?type=${encodeURIComponent(tpl)}`)}>
                <IconDownload size={15} /> Word-Vorlage
              </button>
              <p className="xs muted">Enthält den aktuellen Stand. Speichern Sie die bearbeitete Datei wieder im Ordner «Prüfstandards».</p>
            </div>
          </Panel>
          <Panel title="Später: SharePoint-Liste">
            <p className="small muted">Dieselbe Struktur (Kriterium, Grün, Gelb, Rot, Musterformulierung) kann später aus einer SharePoint-Liste kommen. Die Anwendung liest dann die Liste statt der Word-Dokumente; an den Prüfungen ändert sich nichts.</p>
          </Panel>
        </div>
      </div>
    </>
  );
}
