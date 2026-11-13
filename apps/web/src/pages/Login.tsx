import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ROLE_LABEL, type Role } from '@vm/domain';
import { demoLogin } from '../lib/api';
import { useAuth } from '../lib/auth';

interface Account {
  oid: string;
  name: string;
  firstName: string;
  email: string;
  title: string;
  unit: string;
  initials: string;
  roles: Role[];
}

const WHAT: Record<Role, string> = {
  projektleitung: 'Erstellt Verträge und reicht sie zur Prüfung ein.',
  lieferantenmanagement: 'Überblick über Lieferanten, Verträge und Fristen.',
  rechtsdienst: 'Prüft Verträge mit KI gegen die Prüfstandards.',
};

export function Login() {
  const setToken = useAuth((s) => s.setToken);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const accounts = useQuery({ queryKey: ['accounts'], queryFn: async () => (await fetch('/api/mock-entra/accounts')).json() as Promise<Account[]> });

  const pick = async (a: Account) => {
    setBusy(a.oid);
    setError(null);
    try {
      setToken(await demoLogin(a.oid));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Anmeldung fehlgeschlagen');
      setBusy(null);
    }
  };

  return (
    <div className="login">
      <div className="login__brand">
        <img src="/llv-logo.png" alt="Landesverwaltung Fürstentum Liechtenstein" width={204} height={147} />
        <h1>Vertragsmanagement</h1>
        <p>Verträge, Fristen und rechtliche Prüfung an einem Ort. Feste Regeln für Ablauf und Fristen, KI-Agenten für das Lesen und Prüfen, und Sie entscheiden.</p>
      </div>
      <div className="login__panel">
        <div className="login__head">
          <h2>Konto auswählen</h2>
          <p className="muted small">Anmeldung über Microsoft Entra ID, für die Demo simuliert. Es wird kein Passwort abgefragt.</p>
        </div>
        {accounts.isLoading && <div className="skeleton" style={{ height: 180 }} />}
        {accounts.error && <div className="error-box">Die Anmeldung ist nicht erreichbar.</div>}
        <div className="accounts">
          {(accounts.data ?? []).map((a) => (
            <button type="button" key={a.oid} className="account" onClick={() => pick(a)} disabled={!!busy}>
              <span className="avatar avatar--lg">{a.initials}</span>
              <span className="account__text">
                <b>{a.name}</b>
                <span>{a.email}</span>
                <span className="account__role">
                  {ROLE_LABEL[a.roles[0]]}: {WHAT[a.roles[0]]}
                </span>
              </span>
              <span className="account__go">{busy === a.oid ? 'Anmelden …' : 'Anmelden'}</span>
            </button>
          ))}
        </div>
        {error && <div className="error-box">{error}</div>}
        <p className="xs muted">Alle Anmeldungen und Aktionen werden im Audit-Protokoll festgehalten. In Produktion übernimmt Microsoft Entra ID die Anmeldung, die Rollen kommen aus den App-Rollen der Anwendung.</p>
      </div>
    </div>
  );
}
