/**
 * Records page views and UI actions in the audit log. Changes are audited by
 * the API itself; this adds what only the browser knows.
 */
import { useAuth } from './auth';

type UiEvent = { type: 'seitenaufruf' | 'aktion' | 'suche' | 'abmeldung'; name: string; path?: string; details?: Record<string, unknown> };

let queue: UiEvent[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

async function flush(keepalive = false) {
  timer = null;
  const token = useAuth.getState().token;
  if (!queue.length || !token) return;
  const events = queue.splice(0, 50);
  try {
    await fetch('/api/v1/audit/ui', { method: 'POST', keepalive, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ events }) });
  } catch {
    queue.unshift(...events);
  }
}

export function track(e: UiEvent, now = false) {
  queue.push(e);
  if (now) return flush(true);
  if (!timer) timer = setTimeout(() => flush(), 1500);
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => flush(true));
}
