import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { computeTerm, CONTRACT_TYPES, DECISION_LABEL, type DeadlineDecision, type ExtractedField } from '@vm/domain';
import { actor, markAudited, need, reqInfo, sendFile } from '../http';
import type { JobRow } from '../jobs';
import { contractsFolder, saveDocument, startIngest, type IngestResult } from '../services/agents';
import { buildIcs, buildXlsx, deadlinesView, decideDeadline, exportToStore } from '../services/operations';
import { terms, toSupplier } from '../services/repo';
import { FOLDERS } from '../storage/types';
import { diff, HttpError, newId } from '../util';

const NoticeMode = z.enum(['laufzeitende', 'monatsende', 'quartalsende', 'jahresende']);
const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Datum im Format JJJJ-MM-TT');

export async function registerRegistryRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const s = fastify.services;

  /* ---------- suppliers ---------- */

  app.get('/api/v1/suppliers', { schema: { tags: ['Lieferanten'], summary: 'Alle Lieferanten mit Kennzahlen' } }, async (req) => {
    need(req, 'contracts:read');
    const [sups, cons, view] = await Promise.all([s.repo.suppliers(), s.repo.contracts(), deadlinesView(s)]);
    return sups.map((x) => {
      const own = cons.filter((c) => c.supplierId === x.id && c.status !== 'beendet');
      const dl = view.open.filter((d) => d.supplierId === x.id);
      const ratings = [...Object.values(x.kpi), ...Object.values(x.risk)].map((v) => v.wert);
      return {
        ...x,
        stats: {
          contracts: own.length,
          annualValue: own.reduce((n, c) => n + c.annualValue, 0),
          openDeadlines: dl.filter((d) => d.group !== 'luecken').length,
          critical: dl.filter((d) => d.severity === 'kritisch').length,
          gaps: dl.filter((d) => d.group === 'luecken').length,
          deficient: ratings.filter((r) => r === 'Mangelhaft').length,
          assessed: ratings.length > 0,
        },
      };
    });
  });

  app.get('/api/v1/suppliers/:id', { schema: { tags: ['Lieferanten'], params: z.object({ id: z.string() }) } }, async (req) => {
    need(req, 'contracts:read');
    const sup = await s.repo.supplier(req.params.id);
    if (!sup) throw new HttpError(404, 'Lieferant nicht gefunden');
    const today = s.today();
    const settings = await s.repo.settings();
    const contracts = (await s.repo.contracts('where c.supplier_id=$1', [sup.id])).map((c) => s.repo.withTerm(c, today, settings));
    const view = await deadlinesView(s);
    const audit = await s.audit.list({ targetId: sup.id, limit: 30 });
    return { ...sup, contracts, deadlines: view.open.filter((d) => d.supplierId === sup.id), audit };
  });

  const SupplierPatch = z.object({
    name: z.string().min(2).optional(),
    class: z.enum(['A', 'B', 'C']).optional(),
    city: z.string().nullable().optional(),
    country: z.string().nullable().optional(),
    legalForm: z.string().nullable().optional(),
    contact: z.record(z.string(), z.unknown()).optional(),
    apps: z.array(z.object({ name: z.string(), level: z.string(), operationsOwner: z.string().nullable(), business: z.string().nullable(), contact: z.string().nullable(), note: z.string().default('') })).optional(),
    kpi: z.record(z.string(), z.object({ wert: z.string(), begr: z.string() })).optional(),
    risk: z.record(z.string(), z.object({ wert: z.string(), begr: z.string() })).optional(),
    measures: z.string().optional(),
  });

  app.patch('/api/v1/suppliers/:id', { schema: { tags: ['Lieferanten'], summary: 'Lieferant ändern', params: z.object({ id: z.string() }), body: SupplierPatch } }, async (req) => {
    need(req, 'suppliers:write');
    const before = await s.repo.supplier(req.params.id);
    if (!before) throw new HttpError(404, 'Lieferant nicht gefunden');
    const b = req.body;
    const next = { ...before, ...Object.fromEntries(Object.entries(b).filter(([, v]) => v !== undefined)) } as typeof before;
    await s.db.query(
      `update suppliers set name=$2, class=$3, city=$4, country=$5, legal_form=$6, contact=$7, apps=$8, kpi=$9, risk=$10, measures=$11, updated_at=now(), version=version+1 where id=$1`,
      [before.id, next.name, next.class, next.city, next.country, next.legalForm, JSON.stringify(next.contact), JSON.stringify(next.apps), JSON.stringify(next.kpi), JSON.stringify(next.risk), next.measures],
    );
    const changes = diff(before as never, next as never);
    await s.audit.record({ actor: actor(req), action: 'lieferant.geaendert', targetType: 'lieferant', targetId: before.id, summary: `Lieferant ${before.name} geändert (${Object.keys(changes).join(', ') || 'keine Änderung'})`, details: { changes }, ...reqInfo(req) });
    markAudited(req);
    return s.repo.supplier(before.id);
  });

  app.put(
    '/api/v1/suppliers/by-ref/:system/:externalId',
    {
      schema: {
        tags: ['Lieferanten'],
        summary: 'Lieferant aus einem Quellsystem anlegen oder abgleichen (z. B. Kreditorenstamm)',
        params: z.object({ system: z.string(), externalId: z.string() }),
        body: z.object({ name: z.string().min(2), class: z.enum(['A', 'B', 'C']).default('C'), city: z.string().optional(), country: z.string().optional(), legalForm: z.string().optional() }),
      },
    },
    async (req) => {
      need(req, 'contracts:ingest');
      const ref = { system: req.params.system, id: req.params.externalId };
      const existing = await s.db.one('select * from suppliers where external_refs @> $1', [JSON.stringify([ref])]);
      const b = req.body;
      let id: string;
      if (existing) {
        id = String(existing.id);
        await s.db.query('update suppliers set name=$2, city=coalesce($3,city), country=coalesce($4,country), legal_form=coalesce($5,legal_form), updated_at=now(), version=version+1 where id=$1', [id, b.name, b.city ?? null, b.country ?? null, b.legalForm ?? null]);
      } else {
        id = `L-${2000 + Number((await s.db.one<{ n: string }>('select count(*) as n from suppliers'))!.n)}`;
        await s.db.query('insert into suppliers (id, name, class, city, country, legal_form, external_refs) values ($1,$2,$3,$4,$5,$6,$7)', [id, b.name, b.class, b.city ?? null, b.country ?? null, b.legalForm ?? null, JSON.stringify([ref])]);
      }
      await s.audit.record({ actor: actor(req), action: existing ? 'lieferant.abgeglichen' : 'lieferant.angelegt', targetType: 'lieferant', targetId: id, summary: `${b.name} aus ${ref.system} ${existing ? 'abgeglichen' : 'angelegt'}`, details: { ref, body: b }, ...reqInfo(req) });
      markAudited(req);
      return toSupplier((await s.db.one('select * from suppliers where id=$1', [id]))!);
    },
  );

  /* ---------- contracts ---------- */

  app.get(
    '/api/v1/contracts',
    {
      schema: {
        tags: ['Verträge'],
        summary: 'Verträge abholen, gefiltert',
        querystring: z.object({ status: z.string().optional(), supplierId: z.string().optional(), q: z.string().optional(), updatedSince: z.string().optional() }),
      },
    },
    async (req) => {
      need(req, 'contracts:read');
      const where: string[] = [];
      const params: unknown[] = [];
      const add = (sql: string, v: unknown) => {
        params.push(v);
        where.push(sql.replace('?', `$${params.length}`));
      };
      if (req.query.status) add('c.status = ?', req.query.status);
      if (req.query.supplierId) add('c.supplier_id = ?', req.query.supplierId);
      if (req.query.q) {
        params.push(`%${req.query.q}%`);
        where.push(`(c.title ilike $${params.length} or s.name ilike $${params.length})`);
      }
      if (req.query.updatedSince) add('c.updated_at >= ?', req.query.updatedSince);
      const today = s.today();
      const settings = await s.repo.settings();
      return (await s.repo.contracts(where.length ? 'where ' + where.join(' and ') : '', params)).map((c) => s.repo.withTerm(c, today, settings));
    },
  );

  app.get('/api/v1/contracts/:id', { schema: { tags: ['Verträge'], params: z.object({ id: z.string() }) } }, async (req) => {
    need(req, 'contracts:read');
    const c = await s.repo.contract(req.params.id);
    if (!c) throw new HttpError(404, 'Vertrag nicht gefunden');
    const documents = await s.db.query('select id, name, path, kind, size, created_at from documents where contract_id=$1 order by created_at desc', [c.id]);
    return { ...s.repo.withTerm(c, s.today(), await s.repo.settings()), documents, audit: await s.audit.list({ targetId: c.id, limit: 30 }) };
  });

  const ContractBody = z.object({
    supplierId: z.string(),
    parentId: z.string().nullable().optional(),
    type: z.enum(CONTRACT_TYPES),
    title: z.string().min(2),
    start: IsoDate,
    end: IsoDate.nullable(),
    noticeMonths: z.number().int().min(0).max(60),
    noticeMode: NoticeMode.default('laufzeitende'),
    renewalMonths: z.number().int().min(0).max(120),
    annualValue: z.number().min(0),
    reviewDate: IsoDate.nullable().optional(),
    law: z.string().nullable().optional(),
    venue: z.string().nullable().optional(),
    note: z.string().optional(),
    externalRefs: z.array(z.object({ system: z.string(), id: z.string() })).optional(),
  });

  app.post('/api/v1/contracts', { schema: { tags: ['Verträge'], summary: 'Vertrag als strukturierte Daten einliefern', body: ContractBody } }, async (req, reply) => {
    need(req, 'contracts:ingest');
    const b = req.body;
    if (!(await s.repo.supplier(b.supplierId))) throw new HttpError(400, 'Unbekannter Lieferant');
    const id = `V-${3000 + Number((await s.db.one<{ n: string }>('select count(*) as n from contracts'))!.n)}`;
    await s.db.query(
      `insert into contracts (id, supplier_id, parent_id, type, title, start_date, end_date, notice_months, notice_mode, renewal_months, annual_value, review_date, law, venue, note, external_refs, source)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
      [id, b.supplierId, b.parentId ?? null, b.type, b.title, b.start, b.end, b.noticeMonths, b.noticeMode, b.renewalMonths, b.annualValue, b.reviewDate ?? null, b.law ?? null, b.venue ?? null, b.note ?? '', JSON.stringify(b.externalRefs ?? []), JSON.stringify({ via: 'api' })],
    );
    await s.audit.record({ actor: actor(req), action: 'vertrag.angelegt', targetType: 'vertrag', targetId: id, summary: `Vertrag «${b.title}» über die API angelegt`, details: { body: b }, ...reqInfo(req) });
    await s.events.publish('contract.created', id, { ...b, id });
    markAudited(req);
    return reply.status(201).send(await s.repo.contract(id));
  });

  app.patch('/api/v1/contracts/:id', { schema: { tags: ['Verträge'], summary: 'Vertrag ändern', params: z.object({ id: z.string() }), body: ContractBody.partial().extend({ status: z.enum(['aktiv', 'gekuendigt', 'auslaufend', 'beendet']).optional(), version: z.number().int().optional() }) } }, async (req) => {
    need(req, 'contracts:write');
    const before = await s.repo.contract(req.params.id);
    if (!before) throw new HttpError(404, 'Vertrag nicht gefunden');
    if (req.body.version && req.body.version !== before.version) throw new HttpError(409, 'Der Vertrag wurde inzwischen geändert. Bitte neu laden.', 'conflict');
    const b = req.body;
    const next = { ...before, ...Object.fromEntries(Object.entries(b).filter(([k, v]) => v !== undefined && k !== 'version')) } as typeof before;
    await s.db.query(
      `update contracts set type=$2, title=$3, start_date=$4, end_date=$5, notice_months=$6, notice_mode=$7, renewal_months=$8, annual_value=$9, review_date=$10, law=$11, venue=$12, note=$13, status=$14, updated_at=now(), version=version+1 where id=$1`,
      [before.id, next.type, next.title, next.start, next.end, next.noticeMonths, next.noticeMode, next.renewalMonths, next.annualValue, next.reviewDate, next.law, next.venue, next.note, next.status],
    );
    const changes = diff({ ...before, supplierName: undefined, supplierClass: undefined } as never, { ...next, supplierName: undefined, supplierClass: undefined } as never);
    await s.audit.record({ actor: actor(req), action: 'vertrag.geaendert', targetType: 'vertrag', targetId: before.id, summary: `Vertrag «${before.title}» geändert (${Object.keys(changes).join(', ') || 'keine Änderung'})`, details: { changes }, ...reqInfo(req) });
    await s.events.publish('contract.updated', before.id, { changes });
    markAudited(req);
    return s.repo.contract(before.id);
  });

  /* ---------- deadlines (H4) ---------- */

  app.get('/api/v1/deadlines', { schema: { tags: ['Fristen'], summary: 'Offene und entschiedene Fristen' } }, async (req) => {
    need(req, 'contracts:read');
    return deadlinesView(s);
  });

  app.post(
    '/api/v1/deadlines/decide',
    {
      schema: {
        tags: ['Fristen'],
        summary: 'Haltepunkt H4: über eine Frist entscheiden',
        body: z.object({ key: z.string(), decision: z.enum(Object.keys(DECISION_LABEL) as [DeadlineDecision, ...DeadlineDecision[]]), note: z.string().max(1000).default('') }),
      },
    },
    async (req) => {
      need(req, 'contracts:decide');
      const r = await decideDeadline(s, req.body.key, req.body.decision, req.body.note, actor(req));
      markAudited(req);
      return r;
    },
  );

  app.get('/api/v1/deadlines.ics', { schema: { tags: ['Fristen'], summary: 'Kalender-Feed für Outlook (Token als ?access_token=)' } }, async (req, reply) => {
    need(req, 'contracts:read');
    const view = await deadlinesView(s);
    return reply.header('content-type', 'text/calendar; charset=utf-8').send(buildIcs(view.open));
  });

  /* ---------- documents and ingest (H1) ---------- */

  app.post('/api/v1/documents', { schema: { tags: ['Dokumente'], summary: 'Vertrag hochladen (PDF oder Word); der Erfassungs-Agent startet', consumes: ['multipart/form-data'] } }, async (req, reply) => {
    need(req, 'contracts:ingest');
    const file = await req.file();
    if (!file) throw new HttpError(400, 'Keine Datei');
    if (!/\.(pdf|docx)$/i.test(file.filename)) throw new HttpError(400, 'Nur PDF- oder Word-Dateien');
    const bytes = new Uint8Array(await file.toBuffer());
    const existing = new Set((await s.store.list(FOLDERS.inbox)).map((f) => f.name));
    let name = file.filename.replace(/[\\/:*?"<>|]/g, '-');
    if (existing.has(name)) name = `${path.parse(name).name} (${Date.now().toString(36)})${path.parse(name).ext}`;
    const doc = await saveDocument(s, { bytes, path: `${FOLDERS.inbox}/${name}`, kind: 'eingang', actor: actor(req) });
    const stored = (await s.store.list(FOLDERS.inbox)).find((f) => f.name === name);
    await s.db.query('insert into store_seen (path, etag) values ($1,$2) on conflict (path) do update set etag=excluded.etag', [doc.path, stored?.eTag ?? '']);
    await s.audit.record({ actor: actor(req), action: 'dokument.hochgeladen', targetType: 'dokument', targetId: doc.id, summary: `${file.filename} hochgeladen und im Eingang abgelegt`, details: { path: doc.path, size: bytes.length }, ...reqInfo(req) });
    const jobId = await startIngest(s, { documentId: doc.id, actor: actor(req) });
    markAudited(req);
    return reply.status(202).send({ documentId: doc.id, jobId, path: doc.path });
  });

  app.post('/api/v1/ingest/sample', { schema: { tags: ['Dokumente'], summary: 'Beispielvertrag in den Eingang legen (Demo)' } }, async (req, reply) => {
    need(req, 'contracts:ingest');
    const sample = (await s.store.list('Beispiele')).find((f) => f.name.endsWith('.pdf'));
    if (!sample) throw new HttpError(404, 'Kein Beispielvertrag im Ordner «Beispiele»');
    const { bytes } = await s.store.read(sample.path);
    const name = `${path.parse(sample.name).name} ${new Date().toISOString().slice(11, 19).replace(/:/g, '')}.pdf`;
    const doc = await saveDocument(s, { bytes, path: `${FOLDERS.inbox}/${name}`, kind: 'eingang', actor: actor(req) });
    const stored = (await s.store.list(FOLDERS.inbox)).find((f) => f.name === name);
    await s.db.query('insert into store_seen (path, etag) values ($1,$2) on conflict (path) do update set etag=excluded.etag', [doc.path, stored?.eTag ?? '']);
    await s.audit.record({ actor: actor(req), action: 'dokument.hochgeladen', targetType: 'dokument', targetId: doc.id, summary: `Beispielvertrag ${sample.name} in den Eingang gelegt`, details: { path: doc.path }, ...reqInfo(req) });
    const jobId = await startIngest(s, { documentId: doc.id, actor: actor(req) });
    markAudited(req);
    return reply.status(202).send({ documentId: doc.id, jobId, path: doc.path });
  });

  app.get('/api/v1/documents/:id/content', { schema: { tags: ['Dokumente'], summary: 'Dokument öffnen', params: z.object({ id: z.string() }) } }, async (req, reply) => {
    need(req, 'contracts:read');
    const d = await s.db.one<{ id: string; path: string; name: string; content_type: string }>('select * from documents where id=$1', [req.params.id]);
    if (!d) throw new HttpError(404, 'Dokument nicht gefunden');
    const { bytes } = await s.store.read(d.path);
    await s.audit.record({ actor: actor(req), action: 'dokument.geoeffnet', targetType: 'dokument', targetId: d.id, summary: `${d.name} geöffnet`, details: { path: d.path }, ...reqInfo(req) });
    markAudited(req);
    return sendFile(reply, bytes, d.name, d.content_type, true);
  });

  app.get('/api/v1/documents/by-path', { schema: { tags: ['Dokumente'], summary: 'Datei aus dem gemeinsamen Ordner öffnen', querystring: z.object({ path: z.string() }) } }, async (req, reply) => {
    need(req, 'contracts:read');
    const { bytes, item } = await s.store.read(req.query.path);
    await s.audit.record({ actor: actor(req), action: 'dokument.geoeffnet', targetType: 'datei', targetId: item.path, summary: `${item.name} geöffnet`, details: { path: item.path }, ...reqInfo(req) });
    markAudited(req);
    const type = item.name.endsWith('.pdf') ? 'application/pdf' : item.name.endsWith('.docx') ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : item.name.endsWith('.xlsx') ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'application/octet-stream';
    return sendFile(reply, bytes, item.name, type, item.name.endsWith('.pdf'));
  });

  app.get('/api/v1/ingest', { schema: { tags: ['Dokumente'], summary: 'Gelesene Verträge, die auf Bestätigung warten (H1)' } }, async (req) => {
    need(req, 'contracts:read');
    const rows = await s.db.query<JobRow & { resolution: unknown }>("select id, kind, status, title, subject, result, error, provider, created_by, created_at, finished_at, resolution from jobs where kind='erfassung' order by created_at desc limit 50");
    return rows.map((r) => ({ ...r, created_at: new Date(r.created_at).toISOString() }));
  });

  const ConfirmBody = z.object({
    supplierId: z.string().nullable(),
    newSupplier: z.object({ name: z.string().min(2), class: z.enum(['A', 'B', 'C']), city: z.string().optional(), country: z.string().optional() }).nullable().optional(),
    values: z.object({
      typ: z.enum(CONTRACT_TYPES),
      titel: z.string().min(2),
      beginn: IsoDate,
      ende: IsoDate.nullable(),
      kuendigungsfrist: z.number().int().min(0),
      kuendigungsmodus: NoticeMode,
      verlaengerung: z.number().int().min(0),
      wert: z.number().min(0),
      recht: z.string().nullable(),
      gerichtsstand: z.string().nullable(),
      kontakt: z.string().nullable().optional(),
      anwendung: z.string().nullable().optional(),
      sla: z.string().nullable().optional(),
      review: IsoDate.nullable().optional(),
    }),
  });

  app.post('/api/v1/ingest/:jobId/confirm', { schema: { tags: ['Dokumente'], summary: 'Haltepunkt H1: ausgelesene Daten bestätigen und Vertrag anlegen', params: z.object({ jobId: z.string() }), body: ConfirmBody } }, async (req) => {
    need(req, 'contracts:write');
    const job = await s.db.one<JobRow & { resolution: unknown }>('select * from jobs where id=$1', [req.params.jobId]);
    if (!job || job.kind !== 'erfassung') throw new HttpError(404, 'Erfassung nicht gefunden');
    if (job.status !== 'done') throw new HttpError(409, 'Die Erfassung ist noch nicht abgeschlossen');
    if (job.resolution) throw new HttpError(409, 'Diese Erfassung wurde bereits bestätigt oder verworfen');
    const r = job.result as IngestResult;
    const v = req.body.values;
    const a = actor(req);

    let supplierId = req.body.supplierId;
    if (!supplierId) {
      const ns = req.body.newSupplier;
      if (!ns) throw new HttpError(400, 'Lieferant fehlt');
      supplierId = `L-${2000 + Number((await s.db.one<{ n: string }>('select count(*) as n from suppliers'))!.n)}`;
      await s.db.query('insert into suppliers (id, name, class, city, country, contact) values ($1,$2,$3,$4,$5,$6)', [supplierId, ns.name, ns.class, ns.city ?? null, ns.country ?? null, JSON.stringify({ name: v.kontakt ?? undefined })]);
      await s.audit.record({ actor: a, action: 'lieferant.angelegt', targetType: 'lieferant', targetId: supplierId, summary: `Lieferant ${ns.name} bei der Erfassung angelegt`, details: ns, ...reqInfo(req) });
    }
    const supplier = (await s.repo.supplier(supplierId))!;
    const id = `V-${3000 + Number((await s.db.one<{ n: string }>('select count(*) as n from contracts'))!.n)}`;
    const target = `${contractsFolder(supplier.name)}/${path.posix.basename(r.path)}`;
    try {
      await s.store.move(r.path, target);
      await s.db.query('update documents set path=$2, contract_id=$3, kind=$4 where id=$1', [r.documentId, target, id, 'vertrag']);
    } catch {
      /* file already moved or missing: keep the original path */
    }
    const ai = Object.fromEntries(r.fields.map((f: ExtractedField) => [f.key, f.value]));
    const confirmed: Record<string, string> = Object.fromEntries(Object.entries(v).filter(([, x]) => x !== null && x !== undefined).map(([k, x]) => [k, String(x)]));
    const corrections = Object.keys(confirmed).filter((k) => ai[k] !== undefined && ai[k] !== confirmed[k]).map((k) => ({ field: k, ai: ai[k], confirmed: confirmed[k] }));
    await s.db.query(
      `insert into contracts (id, supplier_id, type, title, start_date, end_date, notice_months, notice_mode, renewal_months, annual_value, review_date, law, venue, document_path, note, source)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [id, supplierId, v.typ, v.titel, v.beginn, v.ende, v.kuendigungsfrist, v.kuendigungsmodus, v.verlaengerung, v.wert, v.review ?? null, v.recht, v.gerichtsstand, target, v.sla ? `Service Level: ${v.sla}` : '', JSON.stringify({ jobId: job.id, documentId: r.documentId, fields: r.fields, confirmedBy: a.name, provider: job.provider })],
    );
    if (v.anwendung && !supplier.apps.some((x) => x.name === v.anwendung)) {
      await s.db.query('update suppliers set apps = apps || $2::jsonb, updated_at=now(), version=version+1 where id=$1', [supplierId, JSON.stringify([{ name: v.anwendung, level: 'L2', operationsOwner: null, business: null, contact: v.kontakt ?? null, note: 'Bei der Erfassung angelegt' }])]);
    }
    await s.db.query('update jobs set resolution=$2 where id=$1', [job.id, JSON.stringify({ action: 'bestaetigt', contractId: id, by: a, at: new Date().toISOString() })]);
    await s.audit.record({
      actor: a,
      action: 'vertrag.erfasst',
      targetType: 'vertrag',
      targetId: id,
      summary: `H1 Daten bestätigt: «${v.titel}» (${supplier.name})${corrections.length ? `, ${corrections.length} KI-Wert(e) korrigiert` : ''}`,
      details: { holdPoint: 'H1', jobId: job.id, documentId: r.documentId, values: v, aiSuggestions: ai, corrections, lowConfidence: r.fields.filter((f) => f.confidence < 0.8).map((f) => f.key), archivedTo: target },
      ...reqInfo(req),
    });
    await s.events.publish('contract.created', id, { supplier: supplier.name, ...v });
    if (r.caseId) {
      await s.db.query("update cases set status='aktiv', contract_id=$2, updated_at=now(), version=version+1 where id=$1", [r.caseId, id]);
      const c = await s.db.one<{ title: string; created_by: { oid: string } }>('select title, created_by from cases where id=$1', [r.caseId]);
      await s.audit.record({ actor: a, action: 'vorgang.aktiv', targetType: 'vorgang', targetId: r.caseId, summary: `Vorgang «${c?.title}» abgeschlossen: Vertrag ${id} ist aktiv`, details: { contractId: id } });
      if (c) await s.notify.send({ to: { oid: c.created_by.oid }, subject: `Vertrag aktiv: ${c.title}`, body: `${a.name} hat die unterzeichnete Fassung bestätigt. Der Vertrag ist im Register.`, link: `/vorgaenge/${r.caseId}` });
    }
    markAudited(req);
    return { contractId: id, supplierId, archivedTo: target, corrections };
  });

  app.post('/api/v1/ingest/:jobId/discard', { schema: { tags: ['Dokumente'], params: z.object({ jobId: z.string() }), body: z.object({ reason: z.string().min(2) }) } }, async (req) => {
    need(req, 'contracts:write');
    const a = actor(req);
    await s.db.query('update jobs set resolution=$2 where id=$1 and resolution is null', [req.params.jobId, JSON.stringify({ action: 'verworfen', reason: req.body.reason, by: a, at: new Date().toISOString() })]);
    await s.audit.record({ actor: a, action: 'erfassung.verworfen', targetType: 'job', targetId: req.params.jobId, summary: `Erfassung verworfen: ${req.body.reason}`, details: { reason: req.body.reason }, ...reqInfo(req) });
    markAudited(req);
    return { ok: true };
  });

  /* ---------- exports ---------- */

  app.get('/api/v1/exports/contracts.xlsx', { schema: { tags: ['Export'], summary: 'Verträge und Fristen als Excel' } }, async (req, reply) => {
    need(req, 'export');
    const bytes = await buildXlsx(s);
    await s.audit.record({ actor: actor(req), action: 'export.heruntergeladen', targetType: 'export', targetId: 'contracts.xlsx', summary: 'Excel-Export heruntergeladen', details: { size: bytes.length }, ...reqInfo(req) });
    markAudited(req);
    return sendFile(reply, bytes, `Vertraege_${s.today()}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  });

  app.post('/api/v1/exports', { schema: { tags: ['Export'], summary: 'Export in den Ordner «Export» schreiben (für Drittsysteme)' } }, async (req) => {
    need(req, 'export');
    const files = await exportToStore(s, actor(req));
    markAudited(req);
    return { files };
  });

  // Term preview for the edit form.
  app.post('/api/v1/contracts/preview-term', { schema: { tags: ['Verträge'], summary: 'Fristen für Vertragsdaten berechnen', body: ContractBody.pick({ start: true, end: true, noticeMonths: true, noticeMode: true, renewalMonths: true, annualValue: true }) } }, async (req) => {
    need(req, 'contracts:read');
    const b = req.body;
    markAudited(req);
    return computeTerm(terms({ ...b, id: 'preview', supplierId: '', parentId: null, type: '', title: '', currency: 'CHF', reviewDate: null, law: null, venue: null, status: 'aktiv', terminatedPer: null, documentPath: 'x', note: '', owner: null, externalRefs: [], source: null, version: 1, updatedAt: '' }), s.today(), await s.repo.settings());
  });

  void newId;
}
