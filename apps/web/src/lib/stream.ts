import type { StampedEvent } from '@vm/domain';
import { useAuth } from './auth';

/**
 * Follows an agent job over server-sent events. Uses fetch (not EventSource)
 * so the bearer token goes in a header; reconnects from the last sequence.
 */
export function followJob(jobId: string, onEvent: (e: StampedEvent) => void, onEnd: () => void): () => void {
  let last = -1;
  let stopped = false;
  let ctrl: AbortController | null = null;

  const run = async (attempt: number): Promise<void> => {
    if (stopped) return;
    ctrl = new AbortController();
    try {
      const r = await fetch(`/api/v1/jobs/${jobId}/events?from=${last}`, { headers: { authorization: `Bearer ${useAuth.getState().token}` }, signal: ctrl.signal });
      if (!r.ok || !r.body) throw new Error(`HTTP ${r.status}`);
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i: number;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const chunk = buf.slice(0, i);
          buf = buf.slice(i + 2);
          if (chunk.startsWith('event: end')) {
            stopped = true;
            onEnd();
            return;
          }
          const line = chunk.split('\n').find((l) => l.startsWith('data: '));
          if (!line) continue;
          const e = JSON.parse(line.slice(6)) as StampedEvent;
          if (e.seq <= last) continue;
          last = e.seq;
          onEvent(e);
        }
      }
      if (!stopped) setTimeout(() => run(attempt + 1), 500);
    } catch {
      if (!stopped && attempt < 6) setTimeout(() => run(attempt + 1), 400 * 2 ** attempt);
    }
  };
  run(0);
  return () => {
    stopped = true;
    ctrl?.abort();
  };
}
