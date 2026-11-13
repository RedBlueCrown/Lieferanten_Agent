/**
 * Outbound events for third-party systems. Every event goes to an outbox
 * table first (so nothing is lost), then a dispatcher delivers it:
 *   EVENTS_PROVIDER=eventgrid → Azure Event Grid topic (CloudEvents 1.0)
 *   EVENTS_PROVIDER=local     → signed webhooks registered in the app
 */
import crypto from 'node:crypto';
import { config } from '../config';
import type { Db } from '../db';
import { newId } from '../util';

export const EVENT_TYPES = [
  'contract.created',
  'contract.updated',
  'contract.terminated',
  'deadline.upcoming',
  'deadline.missed',
  'deadline.decided',
  'review.completed',
  'case.submitted',
  'case.approved',
  'case.returned',
  'document.ingested',
] as const;

type Publisher = { send: (events: unknown[]) => Promise<unknown> };

export class EventsService {
  private publisher?: Publisher;
  private running = false;

  constructor(private readonly db: Db) {}

  async publish(type: (typeof EVENT_TYPES)[number], subject: string, data: Record<string, unknown>) {
    await this.db.query('insert into events_outbox (id, type, subject, data) values ($1,$2,$3,$4)', [newId('evt'), type, subject, JSON.stringify(data)]);
  }

  async dispatch(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      const pending = await this.db.query<{ id: string; type: string; subject: string; data: Record<string, unknown>; created_at: Date | string; attempts: number }>(
        'select * from events_outbox where delivered_at is null and attempts < 8 order by created_at limit 50',
      );
      for (const e of pending) {
        const envelope = { id: e.id, type: e.type, subject: e.subject, occurred_at: new Date(e.created_at).toISOString(), data: e.data };
        try {
          if (config.events.provider === 'eventgrid') await this.toEventGrid(envelope);
          else await this.toWebhooks(envelope);
          await this.db.query('update events_outbox set delivered_at=now(), attempts=attempts+1, last_error=null where id=$1', [e.id]);
        } catch (err) {
          await this.db.query('update events_outbox set attempts=attempts+1, last_error=$2 where id=$1', [e.id, String(err).slice(0, 500)]);
        }
      }
      return pending.length;
    } finally {
      this.running = false;
    }
  }

  private async toEventGrid(e: { id: string; type: string; subject: string; occurred_at: string; data: unknown }) {
    if (!this.publisher) {
      const { EventGridPublisherClient } = await import('@azure/eventgrid');
      const { DefaultAzureCredential } = await import('@azure/identity');
      this.publisher = new EventGridPublisherClient(config.events.eventGridEndpoint!, 'CloudEvent', new DefaultAzureCredential()) as unknown as Publisher;
    }
    await this.publisher.send([{ id: e.id, type: `li.llv.vertragsmanagement.${e.type}`, source: '/vertragsmanagement', subject: e.subject, time: new Date(e.occurred_at), data: e.data }]);
  }

  private async toWebhooks(e: { id: string; type: string }) {
    const hooks = await this.db.query<{ id: string; url: string; secret: string; events: string[] }>('select * from webhooks where active');
    const body = JSON.stringify(e);
    for (const h of hooks.filter((h) => h.events.includes('*') || h.events.includes(e.type))) {
      const signature = crypto.createHmac('sha256', h.secret).update(body).digest('hex');
      let status: number | null = null;
      let error: string | null = null;
      try {
        const r = await fetch(h.url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-vm-event': e.type, 'x-vm-delivery': e.id, 'x-vm-signature': `sha256=${signature}` }, body, signal: AbortSignal.timeout(10_000) });
        status = r.status;
        if (!r.ok) error = `HTTP ${r.status}`;
      } catch (err) {
        error = String(err).slice(0, 300);
      }
      await this.db.query('insert into webhook_deliveries (id, webhook_id, event_id, status, error, attempt) values ($1,$2,$3,$4,$5,1)', [newId('D'), h.id, e.id, status, error]);
    }
  }
}
