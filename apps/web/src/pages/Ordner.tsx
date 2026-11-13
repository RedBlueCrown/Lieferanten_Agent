import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { IconExternal, IconFile, IconFolder, IconRefresh } from '../components/icons';
import { Field, Loadable, PageHead, Panel, Status } from '../components/ui';

interface Item {
  path: string;
  name: string;
  isFolder: boolean;
  size?: number;
  lastModified: string;
  webUrl?: string;
}
interface StoreView {
  info: { kind: string; label: string; rootName: string; webUrl?: string };
  folders: Record<string, string>;
  inbox: Item[];
  standards: Item[];
  exports: Item[];
}

function FileList({ items, empty }: { items: Item[]; empty: string }) {
  if (!items.length) return <p className="muted small" style={{ padding: 'var(--space-md) var(--space-lg)' }}>{empty}</p>;
  return (
    <ul className="files">
      {items.map((f) => (
        <li key={f.path}>
          <button type="button" className="btn btn--quiet btn--sm" onClick={() => (f.webUrl ? window.open(f.webUrl, '_blank', 'noopener') : api.download(`/api/v1/documents/by-path?path=${encodeURIComponent(f.path)}`, { open: f.name.endsWith('.pdf') }))}>
            {f.isFolder ? <IconFolder size={15} /> : <IconFile size={15} />} {f.name}
          </button>
          <span className="muted xs num">{new Date(f.lastModified).toLocaleString('de-CH', { dateStyle: 'short', timeStyle: 'short' })}</span>
        </li>
      ))}
    </ul>
  );
}

export function Ordner() {
  const me = useAuth((s) => s.me)!;
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['store'], queryFn: () => api.get<StoreView>('/api/v1/store') });
  const hooks = useQuery({ queryKey: ['webhooks'], queryFn: () => api.get<{ id: string; url: string; events: string[]; active: boolean }[]>('/api/v1/webhooks') });
  const events = useQuery({ queryKey: ['events'], queryFn: () => api.get<{ id: string; type: string; subject: string; created_at: string; delivered_at: string | null; attempts: number; last_error: string | null }[]>('/api/v1/events') });
  const [url, setUrl] = useState('');
  const sync = useMutation({
    mutationFn: () => api.post<{ changedStandards: string[]; started: string[] }>('/api/v1/store/sync'),
    onSuccess: (r) => {
      toast.success('Ordner abgeglichen', { description: `${r.started.length} neue Datei(en) im Eingang, ${r.changedStandards.length} Prüfstandard(s) geändert.` });
      qc.invalidateQueries();
    },
  });
  const exp = useMutation({
    mutationFn: () => api.post<{ files: string[] }>('/api/v1/exports'),
    onSuccess: (r) => {
      toast.success('Export geschrieben', { description: r.files.join(', ') });
      qc.invalidateQueries({ queryKey: ['store'] });
    },
  });
  const addHook = useMutation({
    mutationFn: () => api.post<{ id: string; secret: string }>('/api/v1/webhooks', { url, events: ['*'] }),
    onSuccess: (r) => {
      toast.success('Webhook registriert', { description: `Signatur-Geheimnis (nur jetzt sichtbar): ${r.secret}`, duration: 20000 });
      setUrl('');
      qc.invalidateQueries({ queryKey: ['webhooks'] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Fehler'),
  });

  return (
    <>
      <PageHead
        title="Ordner und Schnittstellen"
        lead={`Die Anwendung arbeitet mit einem gemeinsamen Ordner (${me.system.storage.label}) und einer API für Drittsysteme. Sie hat nur auf diesen Ordner Zugriff.`}
        actions={
          <>
            <button type="button" className="btn btn--secondary" onClick={() => sync.mutate()} disabled={sync.isPending}>
              <IconRefresh size={16} /> {sync.isPending ? 'Gleicht ab …' : 'Ordner jetzt abgleichen'}
            </button>
            {q.data?.info.webUrl && (
              <a className="btn btn--secondary" href={q.data.info.webUrl} target="_blank" rel="noreferrer">
                <IconExternal size={16} /> In OneDrive öffnen
              </a>
            )}
          </>
        }
      />
      <Loadable q={q}>
        {(d) => (
          <div className="split">
            <Panel title={`Eingang (${d.inbox.length})`} actions={<Status tone="accent">wird alle paar Minuten gelesen</Status>} pad={false}>
              <p className="small muted" style={{ padding: 'var(--space-md) var(--space-lg) 0' }}>Legen Sie unterzeichnete Verträge hier ab. Der Erfassungs-Agent liest sie, danach bestätigen Sie die Daten.</p>
              <FileList items={d.inbox} empty="Der Eingang ist leer." />
            </Panel>
            <Panel title={`Prüfstandards (${d.standards.length})`} actions={<Status>gepflegt vom Rechtsdienst</Status>} pad={false}>
              <p className="small muted" style={{ padding: 'var(--space-md) var(--space-lg) 0' }}>Word-Dokumente mit den Kriterien Grün, Gelb und Rot je Vertragsart.</p>
              <FileList items={d.standards} empty="Keine Prüfstandards." />
            </Panel>
            <Panel title={`Export (${d.exports.length})`} actions={<button type="button" className="btn btn--secondary btn--sm" onClick={() => exp.mutate()} disabled={exp.isPending}>Jetzt exportieren</button>} pad={false}>
              <p className="small muted" style={{ padding: 'var(--space-md) var(--space-lg) 0' }}>Excel, JSON und Kalender für Drittsysteme, die Dateien statt der API lesen.</p>
              <FileList items={d.exports} empty="Noch kein Export." />
            </Panel>
            <Panel title="API für Drittsysteme">
              <div className="stack-sm small">
                <p>REST-API mit OpenAPI-Beschreibung. Systeme melden sich per OAuth 2.0 Client Credentials an; jede schreibende Anfrage steht im Protokoll.</p>
                <div className="row">
                  <a className="btn btn--secondary btn--sm" href="/api/docs" target="_blank" rel="noreferrer">
                    <IconExternal size={15} /> API-Dokumentation
                  </a>
                  <a className="btn btn--quiet btn--sm" href="/api/openapi.json" target="_blank" rel="noreferrer">
                    openapi.json
                  </a>
                </div>
                <p className="muted xs">Ereignisse gehen über {me.system.events} an angebundene Systeme, E-Mails über {me.system.mail}.</p>
              </div>
            </Panel>
          </div>
        )}
      </Loadable>

      <div className="split">
        <Panel title="Webhooks" pad={false}>
          <div style={{ padding: 'var(--space-md) var(--space-lg)' }} className="stack-sm">
            <Field label="Neuer Webhook" hint="Erhält jedes Ereignis als JSON, signiert mit HMAC-SHA256 im Header x-vm-signature.">
              <div className="row">
                <input className="input grow" type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://erp.example.li/hooks/vertraege" />
                <button type="button" className="btn btn--secondary" disabled={!url || addHook.isPending} onClick={() => addHook.mutate()}>
                  Registrieren
                </button>
              </div>
            </Field>
          </div>
          <table className="table">
            <tbody>
              {(hooks.data ?? []).map((h) => (
                <tr key={h.id}>
                  <td className="small">{h.url}</td>
                  <td>{h.active ? <Status tone="gruen">aktiv</Status> : <Status>inaktiv</Status>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
        <Panel title="Zuletzt veröffentlichte Ereignisse" pad={false}>
          <table className="table">
            <tbody>
              {(events.data ?? []).slice(0, 10).map((e) => (
                <tr key={e.id}>
                  <td>
                    <code className="xs">{e.type}</code>
                    <div className="cell-sub">{e.subject}</div>
                  </td>
                  <td className="small nowrap">{e.delivered_at ? <Status tone="gruen">zugestellt</Status> : e.last_error ? <Status tone="rot">Fehler</Status> : <Status>wartet</Status>}</td>
                  <td className="xs muted nowrap">{new Date(e.created_at).toLocaleString('de-CH', { dateStyle: 'short', timeStyle: 'short' })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </div>
    </>
  );
}
