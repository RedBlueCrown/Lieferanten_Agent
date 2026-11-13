/**
 * Runs AI agents as jobs. Events go to live subscribers (server-sent events)
 * and are persisted with the job, so a finished run can be replayed exactly.
 */
import type { AgentEvent, AgentKind, StampedEvent } from '@vm/domain';
import type { Actor, AuditLog } from './audit';
import type { Db } from './db';
import { newId } from './util';

interface LiveJob {
  events: StampedEvent[];
  listeners: Set<(e: StampedEvent) => void>;
  start: number;
  done: boolean;
}

export interface JobRow {
  id: string;
  kind: AgentKind;
  status: 'running' | 'done' | 'failed';
  title: string;
  subject: Record<string, unknown>;
  events: StampedEvent[];
  result: unknown;
  error: string | null;
  provider: string;
  created_by: Actor | null;
  created_at: string;
  finished_at: string | null;
}

export class JobHub {
  private live = new Map<string, LiveJob>();

  constructor(private readonly db: Db, private readonly audit: AuditLog) {}

  /**
   * Starts a job and returns its id at once. `run` gets an emit function and
   * returns the result; `onDone` stores the result where it belongs.
   */
  async start<T>(opts: {
    kind: AgentKind;
    title: string;
    subject: Record<string, unknown>;
    actor: Actor;
    provider: { name: string; model: string; promptVersion: string };
    run: (emit: (e: AgentEvent) => void) => Promise<T>;
    onDone?: (result: T, jobId: string) => Promise<void>;
  }): Promise<string> {
    const id = newId('J');
    await this.db.query('insert into jobs (id, kind, status, title, subject, provider, created_by) values ($1,$2,$3,$4,$5,$6,$7)', [
      id,
      opts.kind,
      'running',
      opts.title,
      JSON.stringify(opts.subject),
      `${opts.provider.name}:${opts.provider.model}`,
      JSON.stringify(opts.actor),
    ]);
    const live: LiveJob = { events: [], listeners: new Set(), start: Date.now(), done: false };
    this.live.set(id, live);
    const emit = (e: AgentEvent) => {
      const s = { ...e, seq: live.events.length, ms: Date.now() - live.start } as StampedEvent;
      live.events.push(s);
      live.listeners.forEach((l) => l(s));
    };
    const started = Date.now();
    await this.audit.record({
      actor: opts.actor,
      action: `ai.${opts.kind}.gestartet`,
      targetType: 'job',
      targetId: id,
      summary: `${opts.title} gestartet`,
      details: { subject: opts.subject, provider: opts.provider.name, model: opts.provider.model, promptVersion: opts.provider.promptVersion },
    });

    (async () => {
      try {
        const result = await opts.run(emit);
        emit({ t: 'done', result });
        await this.db.query('update jobs set status=$2, events=$3, result=$4, finished_at=now() where id=$1', [id, 'done', JSON.stringify(live.events), JSON.stringify(result ?? null)]);
        if (opts.onDone) await opts.onDone(result, id);
        const metrics = live.events.filter((e) => e.t === 'metric') as (StampedEvent & { tokensIn?: number; tokensOut?: number })[];
        await this.audit.record({
          actor: { kind: 'ai', oid: `agent:${opts.kind}`, name: `KI ${opts.kind} (${opts.provider.model})` },
          action: `ai.${opts.kind}.abgeschlossen`,
          targetType: 'job',
          targetId: id,
          summary: `${opts.title} abgeschlossen`,
          details: {
            subject: opts.subject,
            provider: opts.provider.name,
            model: opts.provider.model,
            promptVersion: opts.provider.promptVersion,
            durationMs: Date.now() - started,
            events: live.events.length,
            tokensIn: metrics.reduce((s, m) => s + (m.tokensIn ?? 0), 0),
            tokensOut: metrics.reduce((s, m) => s + (m.tokensOut ?? 0), 0),
            requestedBy: opts.actor.name,
          },
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        emit({ t: 'error', message });
        await this.db.query('update jobs set status=$2, events=$3, error=$4, finished_at=now() where id=$1', [id, 'failed', JSON.stringify(live.events), message]);
        await this.audit.record({ actor: opts.actor, action: `ai.${opts.kind}.fehlgeschlagen`, targetType: 'job', targetId: id, summary: `${opts.title} fehlgeschlagen`, details: { error: message } });
      } finally {
        live.done = true;
        live.listeners.forEach((l) => l({ t: 'stage', stage: '__end', label: '', service: '', status: 'done', seq: -1, ms: 0 } as StampedEvent));
        setTimeout(() => this.live.delete(id), 60_000);
      }
    })();
    return id;
  }

  async get(id: string): Promise<JobRow | undefined> {
    const row = await this.db.one<JobRow>('select * from jobs where id=$1', [id]);
    const live = this.live.get(id);
    if (row && live && !live.done) row.events = live.events;
    return row;
  }

  /**
   * Replays everything after `fromSeq`, then streams live events. Calls
   * `onEnd` when the job has finished (immediately for finished jobs).
   */
  async subscribe(id: string, fromSeq: number, onEvent: (e: StampedEvent) => void, onEnd: () => void): Promise<() => void> {
    const live = this.live.get(id);
    if (live) {
      live.events.filter((e) => e.seq > fromSeq).forEach(onEvent);
      if (live.done) {
        onEnd();
        return () => {};
      }
      const l = (e: StampedEvent) => (e.seq === -1 ? onEnd() : onEvent(e));
      live.listeners.add(l);
      return () => live.listeners.delete(l);
    }
    const row = await this.db.one<JobRow>('select events from jobs where id=$1', [id]);
    (row?.events ?? []).filter((e) => e.seq > fromSeq).forEach(onEvent);
    onEnd();
    return () => {};
  }
}
