import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { api } from '../lib/api';
import type { AuditRecord } from '../lib/types';
import { IconShield } from '../components/icons';
import { Empty, Loadable, PageHead, Panel, Status } from '../components/ui';

const ACTOR_KIND: Record<string, string> = { user: 'Person', system: 'System', api: 'Schnittstelle', ai: 'KI-Agent' };

function actionTone(a: string): 'rot' | 'gelb' | 'gruen' | 'neutral' | 'accent' | 'ai' {
  if (a.startsWith('ai.')) return 'ai';
  if (a === 'zugriff.verweigert' || a.endsWith('fehlgeschlagen')) return 'rot';
  if (a.startsWith('ui.')) return 'neutral';
  if (a.startsWith('frist.') || a.startsWith('vorgang.') || a === 'vertrag.erfasst') return 'accent';
  return 'neutral';
}

export function AuditTimeline({ items, compact }: { items: AuditRecord[]; compact?: boolean }) {
  const [open, setOpen] = useState<string | null>(null);
  if (!items.length) return <p className="muted small" style={{ padding: 'var(--space-md) var(--space-lg)' }}>Noch keine Einträge.</p>;
  return (
    <ol className={clsx('timeline', compact && 'timeline--compact')}>
      {items.map((r) => (
        <li key={r.id} className="timeline__item">
          <span className="timeline__time num">{new Date(r.at).toLocaleString('de-CH', { dateStyle: 'short', timeStyle: 'medium' })}</span>
          <div className="timeline__body">
            <div className="row">
              <Status tone={actionTone(r.action)}>{r.action}</Status>
              <span className="small">
                <b>{r.actor.name}</b> <span className="muted">({ACTOR_KIND[r.actor.kind] ?? r.actor.kind})</span>
              </span>
            </div>
            <p className="small">{r.summary}</p>
            {!compact && Object.keys(r.details ?? {}).length > 0 && (
              <button type="button" className="linklike xs" onClick={() => setOpen(open === r.id ? null : r.id)} aria-expanded={open === r.id}>
                {open === r.id ? 'Details ausblenden' : 'Details anzeigen'}
              </button>
            )}
            {open === r.id && (
              <pre className="json">{JSON.stringify({ ...r.details, _eintrag: r.seq, _hash: r.hash, _vorgaenger: r.prevHash }, null, 2)}</pre>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}

export function Protokoll() {
  const [params, setParams] = useSearchParams();
  const qs = new URLSearchParams();
  const person = params.get('person') ?? '';
  const objekt = params.get('objekt') ?? '';
  const aktion = params.get('aktion') ?? '';
  const text = params.get('q') ?? '';
  if (person) qs.set('actor', person);
  if (objekt) qs.set('targetId', objekt);
  if (aktion) qs.set('action', aktion);
  if (text) qs.set('q', text);
  qs.set('limit', '200');
  const q = useQuery({ queryKey: ['audit', qs.toString()], queryFn: () => api.get<AuditRecord[]>(`/api/v1/audit?${qs}`) });
  const verify = useMutation({ mutationFn: () => api.get<{ ok: boolean; count: number; brokenAt: number | null; lastHash: string }>('/api/v1/audit/verify') });
  const set = (k: string, v: string) => {
    const n = new URLSearchParams(params);
    if (v) n.set(k, v);
    else n.delete(k);
    setParams(n, { replace: true });
  };

  return (
    <>
      <PageHead
        title="Protokoll"
        lead="Jede Anmeldung, jeder Seitenaufruf, jede Änderung, jede KI-Analyse und jeder Entscheid. Die Einträge sind verkettet: wird einer verändert oder gelöscht, bricht die Kette."
        actions={
          <button type="button" className="btn btn--secondary" onClick={() => verify.mutate()} disabled={verify.isPending}>
            <IconShield size={16} /> {verify.isPending ? 'Prüft …' : 'Integrität prüfen'}
          </button>
        }
      />
      {verify.data && (
        <div className={clsx('notice', !verify.data.ok && 'notice--warn')} role="status">
          <IconShield size={18} />
          <span>
            {verify.data.ok ? (
              <>
                <b>Kette lückenlos.</b> {verify.data.count} Einträge nachgerechnet, letzter Hash <code className="xs">{verify.data.lastHash.slice(0, 16)}…</code>
              </>
            ) : (
              <>
                <b>Kette gebrochen ab Eintrag {verify.data.brokenAt}.</b> Ein Eintrag wurde verändert oder entfernt.
              </>
            )}
          </span>
        </div>
      )}
      <div className="row">
        <input className="input" style={{ maxWidth: 280 }} type="search" placeholder="Text, Vertrag oder Vorgang" value={text} onChange={(e) => set('q', e.target.value)} aria-label="Protokoll durchsuchen" />
        <select className="select" style={{ maxWidth: 240 }} value={aktion} onChange={(e) => set('aktion', e.target.value)} aria-label="Art der Aktion">
          <option value="">Alle Aktionen</option>
          <option value="ai.">KI-Agenten</option>
          <option value="vorgang.">Vorgänge und Haltepunkte</option>
          <option value="frist.">Fristentscheide</option>
          <option value="vertrag.">Verträge</option>
          <option value="pruefung.">Prüfungen</option>
          <option value="pruefstandard.">Prüfstandards</option>
          <option value="dokument.">Dokumente</option>
          <option value="ui.">Oberfläche</option>
          <option value="anmeldung">Anmeldungen</option>
          <option value="zugriff.">Verweigerte Zugriffe</option>
        </select>
        {(person || objekt) && (
          <button type="button" className="btn btn--quiet btn--sm" onClick={() => setParams({})}>
            Filter zurücksetzen
          </button>
        )}
      </div>
      <Panel pad={false}>
        <Loadable q={q} empty={(d) => (d.length ? null : <Empty title="Keine Einträge für diesen Filter" />)}>
          {(d) => <AuditTimeline items={d} />}
        </Loadable>
      </Panel>
    </>
  );
}
