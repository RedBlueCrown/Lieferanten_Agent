import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { DEFAULT_SETTINGS, ROLE_PERMISSIONS } from '@vm/domain';
import { config } from '../config';
import { actor, markAudited, need, principal, reqInfo } from '../http';
import { pollStore } from '../services/operations';
import { FOLDERS } from '../storage/types';
import { diff } from '../util';

const tags = ['System'];

export async function registerCoreRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const s = fastify.services;

  app.get('/api/v1/me', { schema: { tags, summary: 'Angemeldete Person, Rechte und Systemzustand' } }, async (req) => {
    const p = principal(req);
    const store = await s.store.describe();
    return {
      user: { oid: p.oid, name: p.name, firstName: p.firstName, email: p.email, title: p.title, unit: p.unit, initials: p.initials, roles: p.roles, kind: p.kind },
      permissions: [...new Set(p.roles.flatMap((r) => ROLE_PERMISSIONS[r]))],
      system: {
        today: s.today(),
        authMode: config.auth.mode,
        ai: { provider: s.ai.name, model: s.ai.model, region: config.ai.regionLabel, documentReader: config.ai.provider === 'azure' && config.ai.docIntelEndpoint ? 'Azure AI Document Intelligence' : 'pdf.js' },
        storage: store,
        database: s.db.kind === 'postgres' ? 'Azure Database for PostgreSQL' : 'PGlite (lokal)',
        mail: config.mail.provider === 'acs' ? 'Azure Communication Services' : 'In der Anwendung',
        events: config.events.provider === 'eventgrid' ? 'Azure Event Grid' : 'Webhooks',
      },
    };
  });

  // Page views and UI actions from the browser.
  app.post(
    '/api/v1/audit/ui',
    {
      schema: {
        tags: ['Audit'],
        summary: 'Aktionen in der Oberfläche protokollieren',
        body: z.object({ events: z.array(z.object({ type: z.enum(['seitenaufruf', 'aktion', 'suche', 'abmeldung']), name: z.string().max(200), path: z.string().max(300).optional(), details: z.record(z.string(), z.unknown()).optional() })).max(50) }),
      },
    },
    async (req) => {
      const a = actor(req);
      for (const e of req.body.events) {
        await s.audit.record({ actor: a, action: `ui.${e.type}`, targetType: 'oberflaeche', targetId: e.path ?? null, summary: e.name, details: e.details ?? {}, ...reqInfo(req) });
      }
      markAudited(req);
      return { recorded: req.body.events.length };
    },
  );

  app.get('/api/v1/notifications', { schema: { tags, summary: 'Benachrichtigungen' } }, async (req) => {
    const p = principal(req);
    return s.notify.forUser(p.oid, p.roles);
  });

  app.post('/api/v1/notifications/read', { schema: { tags, body: z.object({ id: z.string().optional() }) } }, async (req) => {
    const p = principal(req);
    await s.notify.markRead(p.oid, p.roles, req.body.id);
    markAudited(req);
    return { ok: true };
  });

  app.get('/api/v1/search', { schema: { tags, summary: 'Suche über Lieferanten, Verträge und Vorgänge', querystring: z.object({ q: z.string().min(1).max(100) }) } }, async (req) => {
    need(req, 'contracts:read');
    const q = `%${req.query.q}%`;
    const [suppliers, contracts, cases] = await Promise.all([
      s.db.query('select id, name, class, city from suppliers where name ilike $1 or city ilike $1 limit 8', [q]),
      s.db.query('select c.id, c.title, c.type, s.name as supplier from contracts c join suppliers s on s.id=c.supplier_id where c.title ilike $1 or s.name ilike $1 or c.id ilike $1 limit 8', [q]),
      s.db.query('select id, title, status, supplier_name from cases where title ilike $1 or supplier_name ilike $1 limit 8', [q]),
    ]);
    return { suppliers, contracts, cases };
  });

  app.get('/api/v1/store', { schema: { tags: ['Dokumente'], summary: 'Gemeinsamer Ordner (OneDrive) und Inhalt der Arbeitsordner' } }, async (req) => {
    need(req, 'contracts:read');
    const [info, inbox, standards, exports] = await Promise.all([s.store.describe(), s.store.list(FOLDERS.inbox), s.store.list(FOLDERS.standards), s.store.list(FOLDERS.export)]);
    return { info, folders: FOLDERS, inbox, standards, exports };
  });

  app.post('/api/v1/store/sync', { schema: { tags: ['Dokumente'], summary: 'Ordner jetzt abgleichen (Eingang und Prüfstandards)' } }, async (req) => {
    const p = principal(req);
    const result = await pollStore(s);
    await s.audit.record({ actor: actor(req), action: 'ordner.abgeglichen', targetType: 'ordner', targetId: (await s.store.describe()).label, summary: `${p.name} hat den Ordnerabgleich gestartet`, details: result, ...reqInfo(req) });
    markAudited(req);
    return result;
  });

  app.get('/api/v1/settings', { schema: { tags } }, async (req) => {
    need(req, 'contracts:read');
    return s.repo.settings();
  });

  app.put(
    '/api/v1/settings',
    {
      schema: {
        tags,
        summary: 'Vorlaufzeiten und Zustellpuffer',
        body: z.object({
          bufferWorkdays: z.number().int().min(0).max(30),
          noticeLadder: z.object({ A: z.array(z.number().int().positive()), B: z.array(z.number().int().positive()), C: z.array(z.number().int().positive()) }),
          reviewLeadDays: z.number().int().min(0).max(365),
          endLeadDays: z.number().int().min(0).max(365),
        }),
      },
    },
    async (req) => {
      need(req, 'settings:write');
      const before = await s.repo.settings();
      await s.db.query(`insert into settings (key, value) values ('deadlines', $1) on conflict (key) do update set value=excluded.value`, [JSON.stringify(req.body)]);
      await s.audit.record({ actor: actor(req), action: 'einstellungen.geaendert', targetType: 'einstellungen', targetId: 'deadlines', summary: 'Vorlaufzeiten geändert', details: { changes: diff(before as never, req.body as never), defaults: DEFAULT_SETTINGS }, ...reqInfo(req) });
      markAudited(req);
      return req.body;
    },
  );
}
