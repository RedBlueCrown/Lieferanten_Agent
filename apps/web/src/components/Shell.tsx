import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Command } from 'cmdk';
import { Menu } from '@base-ui/react/menu';
import { Popover } from '@base-ui/react/popover';
import { Dialog } from '@base-ui/react/dialog';
import { ROLE_LABEL, type Role } from '@vm/domain';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { track } from '../lib/audit';
import { AgentStageHost } from '../agent/AgentStage';
import { IconBell, IconChevronDown, IconSearch } from './icons';

const NAV: Record<Role, [string, string][]> = {
  projektleitung: [
    ['/', 'Meine Vorgänge'],
    ['/vorgaenge/neu', 'Neuer Vertrag'],
    ['/vertraege', 'Verträge'],
    ['/protokoll', 'Protokoll'],
  ],
  lieferantenmanagement: [
    ['/', 'Fristen'],
    ['/lieferanten', 'Lieferanten'],
    ['/vertraege', 'Verträge'],
    ['/erfassen', 'Erfassen'],
    ['/ordner', 'Ordner und Schnittstellen'],
    ['/protokoll', 'Protokoll'],
  ],
  rechtsdienst: [
    ['/', 'Prüfungen'],
    ['/pruefstandards', 'Prüfstandards'],
    ['/vertraege', 'Verträge'],
    ['/protokoll', 'Protokoll'],
  ],
};

interface Notification {
  id: string;
  subject: string;
  body: string;
  link: string | null;
  created_at: string;
  read_at: string | null;
}

function Notifications() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['notifications'], queryFn: () => api.get<Notification[]>('/api/v1/notifications'), refetchInterval: 20_000 });
  const unread = (q.data ?? []).filter((n) => !n.read_at).length;
  return (
    <Popover.Root
      onOpenChange={(open) => {
        if (!open && unread) api.post('/api/v1/notifications/read').then(() => qc.invalidateQueries({ queryKey: ['notifications'] }));
      }}
    >
      <Popover.Trigger className="iconbtn" aria-label={`Benachrichtigungen${unread ? `, ${unread} neu` : ''}`}>
        <IconBell size={20} />
        {unread > 0 && <span className="iconbtn__count num">{unread}</span>}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner sideOffset={8} align="end">
          <Popover.Popup className="popup">
            <div className="notif-list">
              {(q.data ?? []).length === 0 && <p className="muted small" style={{ padding: 12 }}>Keine Benachrichtigungen.</p>}
              {(q.data ?? []).map((n) => (
                <Link key={n.id} to={n.link ?? '/'} className={`notif ${n.read_at ? '' : 'is-unread'}`}>
                  <span className="notif__subject">{n.subject}</span>
                  <span className="notif__body">{n.body}</span>
                  <span className="notif__body">{new Date(n.created_at).toLocaleString('de-CH', { dateStyle: 'short', timeStyle: 'short' })}</span>
                </Link>
              ))}
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

interface SearchResult {
  suppliers: { id: string; name: string; city: string; class: string }[];
  contracts: { id: string; title: string; type: string; supplier: string }[];
  cases: { id: string; title: string; status: string; supplier_name: string }[];
}

function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [q, setQ] = useState('');
  const navigate = useNavigate();
  const role = useAuth((s) => s.me?.user.roles[0]);
  const res = useQuery({ queryKey: ['search', q], queryFn: () => api.get<SearchResult>(`/api/v1/search?q=${encodeURIComponent(q)}`), enabled: q.trim().length > 1 });
  const go = (to: string, label: string) => {
    track({ type: 'suche', name: `Suche «${q}» → ${label}`, path: to });
    onOpenChange(false);
    setQ('');
    navigate(to);
  };
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="backdrop" />
        <Dialog.Popup className="cmdk" aria-label="Suche">
          <Command shouldFilter={false} label="Suche">
            <Command.Input value={q} onValueChange={setQ} placeholder="Lieferant, Vertrag oder Vorgang suchen" autoFocus />
            <Command.List>
              {q.trim().length > 1 && !res.isLoading && <Command.Empty>Nichts gefunden.</Command.Empty>}
              {!!res.data?.suppliers.length && (
                <Command.Group heading="Lieferanten">
                  {res.data.suppliers.map((s) => (
                    <Command.Item key={s.id} value={s.id} onSelect={() => go(role === 'lieferantenmanagement' ? `/lieferanten/${s.id}` : `/vertraege?lieferant=${s.id}`, s.name)}>
                      <span>{s.name}</span>
                      <span className="muted">Klasse {s.class}, {s.city}</span>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
              {!!res.data?.contracts.length && (
                <Command.Group heading="Verträge">
                  {res.data.contracts.map((c) => (
                    <Command.Item key={c.id} value={c.id} onSelect={() => go(`/vertraege?q=${encodeURIComponent(c.title)}`, c.title)}>
                      <span>{c.title}</span>
                      <span className="muted">{c.supplier}</span>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
              {!!res.data?.cases.length && (
                <Command.Group heading="Vorgänge">
                  {res.data.cases.map((c) => (
                    <Command.Item key={c.id} value={c.id} onSelect={() => go(role === 'rechtsdienst' ? `/pruefungen/${c.id}` : `/vorgaenge/${c.id}`, c.title)}>
                      <span>{c.title}</span>
                      <span className="muted">{c.supplier_name}</span>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
            </Command.List>
          </Command>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function Shell() {
  const me = useAuth((s) => s.me)!;
  const logout = useAuth((s) => s.logout);
  const loc = useLocation();
  const navigate = useNavigate();
  const [search, setSearch] = useState(false);
  const role = me.user.roles[0];

  useEffect(() => {
    track({ type: 'seitenaufruf', name: document.title, path: loc.pathname + loc.search });
  }, [loc.pathname, loc.search]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearch(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <>
      <a className="sr-only" href="#inhalt">
        Zum Inhalt
      </a>
      <header className="topbar">
        <div className="topbar__inner">
          <Link to="/" className="brand" aria-label="Vertragsmanagement, Startseite">
            <span className="brand__arms" aria-hidden />
            <span className="brand__text">
              <span className="brand__app">Vertragsmanagement</span>
              <span className="brand__org">Landesverwaltung Liechtenstein</span>
            </span>
          </Link>
          <nav className="nav" aria-label="Hauptnavigation">
            {(NAV[role] ?? []).map(([to, label]) => (
              <NavLink key={to} to={to} end={to === '/'}>
                {label}
              </NavLink>
            ))}
          </nav>
          <div className="topbar__right">
            <button type="button" className="search-trigger" onClick={() => setSearch(true)} aria-label="Suchen">
              <IconSearch size={16} />
              <span>Suchen</span>
              <kbd>Strg K</kbd>
            </button>
            <Notifications />
            <Menu.Root>
              <Menu.Trigger className="userbtn">
                <span className="avatar">{me.user.initials}</span>
                <span className="userbtn__name">
                  <b>{me.user.name}</b>
                  <span className="userbtn__role">{ROLE_LABEL[role]}</span>
                </span>
                <IconChevronDown size={16} />
              </Menu.Trigger>
              <Menu.Portal>
                <Menu.Positioner sideOffset={8} align="end">
                  <Menu.Popup className="popup">
                    <div style={{ padding: '8px 12px' }} className="small">
                      <b>{me.user.name}</b>
                      <div className="muted xs">{me.user.title}, {me.user.unit}</div>
                      <div className="muted xs">{me.system.authMode === 'mock' ? 'Angemeldet über Entra ID (simuliert)' : 'Angemeldet über Microsoft Entra ID'}</div>
                    </div>
                    <Menu.Item className="menuitem" onClick={() => navigate('/protokoll?person=' + me.user.oid)}>
                      Meine Aktivitäten im Protokoll
                    </Menu.Item>
                    <Menu.Item
                      className="menuitem"
                      onClick={async () => {
                        await track({ type: 'abmeldung', name: `${me.user.name} hat sich abgemeldet` }, true);
                        logout();
                        navigate('/');
                      }}
                    >
                      Abmelden
                    </Menu.Item>
                  </Menu.Popup>
                </Menu.Positioner>
              </Menu.Portal>
            </Menu.Root>
          </div>
        </div>
      </header>
      <main className="page" id="inhalt">
        <Outlet />
      </main>
      <footer className="systemstrip" aria-label="Systemzustand">
        <span>
          KI: <b>{me.system.ai.provider === 'azure' ? `Azure OpenAI ${me.system.ai.model}` : 'Regelbasierte Demo-KI'}</b>
        </span>
        <span>
          Dokumente lesen: <b>{me.system.ai.documentReader}</b>
        </span>
        <span>
          Ablage: <b>{me.system.storage.label}</b>
        </span>
        <span>
          Daten: <b>{me.system.database}</b>
        </span>
        <span>
          Region: <b>{me.system.ai.region}</b>
        </span>
        <span>
          Jede Aktion wird im <Link to="/protokoll">Protokoll</Link> festgehalten.
        </span>
      </footer>
      <CommandPalette open={search} onOpenChange={setSearch} />
      <AgentStageHost />
    </>
  );
}
