import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { CONTRACT_TYPES } from '@vm/domain';
import { actor, markAudited, need, reqInfo, sendFile } from '../http';
import { EVENT_TYPES } from '../services/events';
import { buildStandardDocx, standardFileName } from '../services/standards';
import { FOLDERS } from '../storage/types';
import { HttpError, newId } from '../util';

export async function registerAuditRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const s = fastify.services;

  /* ---------- audit ---------- */

  app.get(
    '/api/v1/audit',
    {
      schema: {
        tags: ['Audit'],
        summary: 'Audit-Protokoll durchsuchen',
        querystring: z.object({ targetType: z.string().optional(), targetId: z.string().optional(), actor: z.string().optional(), action: z.string().optional(), q: z.string().optional(), limit: z.coerce.number().int().max(500).optional(), before: z.coerce.number().int().optional() }),
      },
    },
    async (req) => {
      need(req, 'audit:read');
      return s.audit.list(req.query);
    },
  );

  app.get('/api/v1/audit/verify', { schema: { tags: ['Audit'], summary: 'Hash-Kette des Protokolls vollständig nachrechnen' } }, async (req) => {
    need(req, 'audit:read');
    const r = await s.audit.verify();
    await s.audit.record({ actor: actor(req), action: 'audit.geprueft', targetType: 'audit', targetId: 'kette', summary: r.ok ? `Integrität geprüft: ${r.count} Einträge lückenlos` : `Integrität verletzt ab Eintrag ${r.brokenAt}`, details: r, ...reqInfo(req) });
    markAudited(req);
    return r;
  });

  /* ---------- jobs ---------- */

  app.get('/api/v1/jobs/:id', { schema: { tags: ['KI-Agenten'], summary: 'Auftrag eines KI-Agenten mit allen Ereignissen', params: z.object({ id: z.string() }) } }, async (req) => {
    need(req, 'contracts:read');
    const j = await s.jobs.get(req.params.id);
    if (!j) throw new HttpError(404, 'Auftrag nicht gefunden');
    return j;
  });

  app.get(
    '/api/v1/jobs/:id/events',
    { schema: { tags: ['KI-Agenten'], summary: 'Ereignisse live als Server-Sent Events', params: z.object({ id: z.string() }), querystring: z.object({ from: z.coerce.number().int().default(-1) }) } },
    async (req, reply) => {
      need(req, 'contracts:read');
      const job = await s.jobs.get(req.params.id);
      if (!job) throw new HttpError(404, 'Auftrag nicht gefunden');
      reply.hijack();
      const res = reply.raw;
      res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no' });
      res.write(': verbunden\n\n');
      const heartbeat = setInterval(() => res.write(': ping\n\n'), 15_000);
      let closed = false;
      const end = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        res.write('event: end\ndata: {}\n\n');
        res.end();
      };
      const unsubscribe = await s.jobs.subscribe(
        job.id,
        req.query.from,
        (e) => {
          if (!closed) res.write(`id: ${e.seq}\ndata: ${JSON.stringify(e)}\n\n`);
        },
        end,
      );
      req.raw.on('close', () => {
        closed = true;
        clearInterval(heartbeat);
        unsubscribe();
      });
    },
  );

  /* ---------- review standards ---------- */

  app.get('/api/v1/standards', { schema: { tags: ['Prüfstandards'], summary: 'Prüfstandards, wie die Anwendung sie aus den Word-Dokumenten gelesen hat' } }, async (req) => {
    need(req, 'standards:read');
    return s.standards.list();
  });

  app.post('/api/v1/standards/sync', { schema: { tags: ['Prüfstandards'], summary: 'Word-Dokumente jetzt neu einlesen' } }, async (req) => {
    need(req, 'standards:read');
    const changed = await s.standards.sync(actor(req));
    markAudited(req);
    return { changed };
  });

  app.get('/api/v1/standards/template.docx', { schema: { tags: ['Prüfstandards'], summary: 'Leere Vorlage für einen neuen Prüfstandard', querystring: z.object({ type: z.enum(CONTRACT_TYPES) }) } }, async (req, reply) => {
    need(req, 'standards:read');
    const existing = await s.standards.get(req.query.type);
    const bytes = await buildStandardDocx({
      contractType: req.query.type,
      version: existing ? existing.version : '1.0',
      date: s.today().split('-').reverse().join('.'),
      author: existing?.author || 'Rechtsdienst',
      criteria: existing?.criteria ?? [{ title: 'Neues Kriterium', gruen: 'Was akzeptabel ist.', gelb: 'Was verhandelbar ist.', rot: 'Was nicht akzeptabel ist.', muster: 'Musterformulierung der LLV.' }],
    });
    await s.audit.record({ actor: actor(req), action: 'pruefstandard.vorlage', targetType: 'pruefstandard', targetId: req.query.type, summary: `Vorlage ${standardFileName(req.query.type)} heruntergeladen`, details: { folder: FOLDERS.standards }, ...reqInfo(req) });
    markAudited(req);
    return sendFile(reply, bytes, standardFileName(req.query.type), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  });

  /* ---------- webhooks and events ---------- */

  app.get('/api/v1/webhooks', { schema: { tags: ['Integration'], summary: 'Registrierte Webhooks' } }, async (req) => {
    need(req, 'export');
    return (await s.db.query('select id, url, events, active, created_at from webhooks order by created_at')).map((w) => w);
  });

  app.post(
    '/api/v1/webhooks',
    { schema: { tags: ['Integration'], summary: 'Webhook registrieren (Antwort enthält das Signatur-Geheimnis einmalig)', body: z.object({ url: z.string().url(), events: z.array(z.enum([...EVENT_TYPES, '*'] as [string, ...string[]])).default(['*']) }) } },
    async (req, reply) => {
      need(req, 'export');
      const id = newId('W');
      const secret = crypto.randomBytes(24).toString('base64url');
      await s.db.query('insert into webhooks (id, url, secret, events) values ($1,$2,$3,$4)', [id, req.body.url, secret, JSON.stringify(req.body.events)]);
      await s.audit.record({ actor: actor(req), action: 'webhook.registriert', targetType: 'webhook', targetId: id, summary: `Webhook ${req.body.url} registriert`, details: { url: req.body.url, events: req.body.events }, ...reqInfo(req) });
      markAudited(req);
      return reply.status(201).send({ id, url: req.body.url, events: req.body.events, secret });
    },
  );

  app.delete('/api/v1/webhooks/:id', { schema: { tags: ['Integration'], params: z.object({ id: z.string() }) } }, async (req) => {
    need(req, 'export');
    await s.db.query('update webhooks set active=false where id=$1', [req.params.id]);
    await s.audit.record({ actor: actor(req), action: 'webhook.deaktiviert', targetType: 'webhook', targetId: req.params.id, summary: 'Webhook deaktiviert', ...reqInfo(req) });
    markAudited(req);
    return { ok: true };
  });

  app.get('/api/v1/events', { schema: { tags: ['Integration'], summary: 'Zuletzt veröffentlichte Ereignisse (Ausgang)' } }, async (req) => {
    need(req, 'export');
    return s.db.query('select id, type, subject, data, created_at, delivered_at, attempts, last_error from events_outbox order by created_at desc limit 100');
  });
}
