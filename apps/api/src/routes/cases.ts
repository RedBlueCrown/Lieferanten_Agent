import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from 'docx';
import { addDays, AMPEL_LABEL, assertTransition, availableActions, CASE_STATUS_LABEL, CONTRACT_TYPES, summarize, TransitionError, type CaseAction, type Finding } from '@vm/domain';
import { actor, markAudited, need, principal, reqInfo, sendFile } from '../http';
import { caseClauses, saveDocument, startDraft, startIngest, startReview } from '../services/agents';
import { toCase, type Case } from '../services/cases';
import { FOLDERS } from '../storage/types';
import { diff, HttpError, newId } from '../util';

const tags = ['Vorgänge'];

export async function registerCaseRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const s = fastify.services;

  const load = async (id: string): Promise<Case> => {
    const r = await s.db.one('select * from cases where id=$1', [id]);
    if (!r) throw new HttpError(404, 'Vorgang nicht gefunden');
    return toCase(r);
  };

  const transition = async (req: FastifyRequest, c: Case, action: CaseAction, extra: Record<string, unknown> = {}, set: Record<string, unknown> = {}) => {
    const p = principal(req);
    let t;
    try {
      t = assertTransition(c.status, action, p.roles);
    } catch (e) {
      if (e instanceof TransitionError) throw new HttpError(e.status, e.message, 'transition');
      throw e;
    }
    const cols = Object.keys(set);
    await s.db.query(`update cases set status=$2${cols.map((k, i) => `, ${k}=$${i + 3}`).join('')}, updated_at=now(), version=version+1 where id=$1`, [c.id, t.to, ...cols.map((k) => (typeof set[k] === 'object' && set[k] !== null ? JSON.stringify(set[k]) : set[k]))]);
    await s.audit.record({
      actor: actor(req),
      action: `vorgang.${action}`,
      targetType: 'vorgang',
      targetId: c.id,
      summary: `${t.holdPoint ? t.holdPoint + ' ' : ''}${t.label}: «${c.title}» (${CASE_STATUS_LABEL[c.status]} → ${CASE_STATUS_LABEL[t.to]})`,
      details: { holdPoint: t.holdPoint ?? null, from: c.status, to: t.to, ...extra },
      ...reqInfo(req),
    });
    markAudited(req);
    return t;
  };

  app.get('/api/v1/cases', { schema: { tags, summary: 'Vorgänge', querystring: z.object({ scope: z.enum(['mine', 'review', 'all']).default('all') }) } }, async (req) => {
    need(req, 'contracts:read');
    const p = principal(req);
    const rows = (await s.db.query('select * from cases order by updated_at desc')).map(toCase);
    const list = req.query.scope === 'mine' ? rows.filter((c) => c.createdBy.oid === p.oid || p.roles.includes('projektleitung')) : req.query.scope === 'review' ? rows.filter((c) => ['in_pruefung', 'nachverhandlung', 'freigegeben'].includes(c.status)) : rows;
    return list.map((c) => ({ ...c, clauses: undefined, clauseCount: c.clauses.length, deviations: c.clauses.filter((b) => b.origin === 'angepasst').length, review: c.review ? { summary: c.review.summary, at: c.review.at, standardVersion: c.review.standardVersion, decision: c.review.decision } : null }));
  });

  app.get('/api/v1/cases/:id', { schema: { tags, params: z.object({ id: z.string() }) } }, async (req) => {
    need(req, 'contracts:read');
    const c = await load(req.params.id);
    const p = principal(req);
    const [documents, jobs, audit] = await Promise.all([
      s.db.query('select id, name, path, kind, size, created_at from documents where case_id=$1 order by created_at desc', [c.id]),
      s.db.query("select id, kind, status, title, created_at, finished_at from jobs where subject->>'caseId' = $1 order by created_at desc", [c.id]),
      s.audit.list({ targetId: c.id, limit: 50 }),
    ]);
    return { ...c, actions: availableActions(c.status, p.roles), documents, jobs, audit };
  });

  app.get('/api/v1/cases/:id/text', { schema: { tags, summary: 'Vertragstext des Vorgangs, in Klauseln gegliedert', params: z.object({ id: z.string() }) } }, async (req) => {
    need(req, 'contracts:read');
    await load(req.params.id);
    return caseClauses(s, req.params.id);
  });

  app.post(
    '/api/v1/cases',
    {
      schema: {
        tags,
        summary: 'Neuen Vorgang anlegen (LLV-Entwurf oder Lieferantenpapier)',
        body: z.object({
          source: z.enum(['llv_entwurf', 'lieferantenpapier']),
          type: z.enum(CONTRACT_TYPES),
          title: z.string().min(3).max(120),
          supplierId: z.string().nullable(),
          supplierName: z.string().min(2),
          fields: z.object({
            subject: z.string().max(1000).optional(),
            start: z.string().optional(),
            termMonths: z.number().int().min(1).max(120).optional(),
            noticeMonths: z.number().int().min(0).max(24).optional(),
            amount: z.number().min(0).optional(),
            availability: z.number().min(90).max(100).optional(),
          }),
        }),
      },
    },
    async (req, reply) => {
      need(req, 'cases:create');
      const b = req.body;
      if (b.source === 'llv_entwurf' && b.fields.amount !== undefined && b.fields.amount > 0 && b.fields.amount < 500) throw new HttpError(400, 'Der Betrag pro Jahr wirkt unplausibel tief (unter CHF 500). Bitte prüfen.', 'plausibility');
      const id = `C-${4000 + Number((await s.db.one<{ n: string }>('select count(*) as n from cases'))!.n)}`;
      await s.db.query('insert into cases (id, title, type, supplier_id, supplier_name, source, status, created_by, fields) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)', [
        id,
        b.title,
        b.type,
        b.supplierId,
        b.supplierName,
        b.source,
        b.source === 'llv_entwurf' ? 'entwurf' : 'in_pruefung',
        JSON.stringify(actor(req)),
        JSON.stringify(b.fields),
      ]);
      await s.audit.record({ actor: actor(req), action: 'vorgang.angelegt', targetType: 'vorgang', targetId: id, summary: `Vorgang «${b.title}» angelegt (${b.source === 'llv_entwurf' ? 'LLV-Entwurf' : 'Lieferantenpapier'}, ${b.type})`, details: b, ...reqInfo(req) });
      markAudited(req);
      return reply.status(201).send(await load(id));
    },
  );

  app.post('/api/v1/cases/:id/draft', { schema: { tags, summary: 'Entwurfs-Agent starten', params: z.object({ id: z.string() }) } }, async (req, reply) => {
    need(req, 'cases:create');
    const c = await load(req.params.id);
    if (c.status !== 'entwurf') throw new HttpError(409, 'Nur im Status Entwurf');
    const jobId = await startDraft(s, c.id, actor(req));
    markAudited(req);
    return reply.status(202).send({ jobId });
  });

  app.patch(
    '/api/v1/cases/:id/clauses/:key',
    { schema: { tags, summary: 'Klausel im Entwurf ändern', params: z.object({ id: z.string(), key: z.string() }), body: z.object({ text: z.string().min(1).optional(), justification: z.string().max(1000).optional() }) } },
    async (req) => {
      need(req, 'cases:create');
      const c = await load(req.params.id);
      if (c.status !== 'entwurf') throw new HttpError(409, 'Nur im Status Entwurf');
      const i = c.clauses.findIndex((b) => b.key === req.params.key);
      if (i < 0) throw new HttpError(404, 'Klausel nicht gefunden');
      const before = c.clauses[i];
      const text = req.body.text ?? before.text;
      const origin = before.origin === 'ki' ? 'ki' : text.trim() === before.template.trim() ? 'baustein' : 'angepasst';
      const next = { ...before, text, origin, justification: req.body.justification ?? before.justification } as Case['clauses'][number];
      c.clauses[i] = next;
      await s.db.query('update cases set clauses=$2, updated_at=now(), version=version+1 where id=$1', [c.id, JSON.stringify(c.clauses)]);
      await s.audit.record({ actor: actor(req), action: 'entwurf.klausel_geaendert', targetType: 'vorgang', targetId: c.id, summary: `Klausel «${before.title}» ${origin === 'angepasst' ? 'vom Standard abweichend geändert' : 'geändert'}`, details: { clause: before.key, changes: diff(before as never, next as never) }, ...reqInfo(req) });
      markAudited(req);
      return next;
    },
  );

  app.post('/api/v1/cases/:id/review', { schema: { tags, summary: 'Prüf-Agent starten', params: z.object({ id: z.string() }) } }, async (req, reply) => {
    need(req, 'reviews:decide');
    const c = await load(req.params.id);
    if (c.status !== 'in_pruefung') throw new HttpError(409, 'Nur im Status «Beim Rechtsdienst»');
    const jobId = await startReview(s, c.id, actor(req));
    markAudited(req);
    return reply.status(202).send({ jobId });
  });

  app.patch(
    '/api/v1/cases/:id/findings/:key',
    {
      schema: {
        tags,
        summary: 'Befund übersteuern oder kommentieren (Rechtsdienst)',
        params: z.object({ id: z.string(), key: z.string() }),
        body: z.object({ ampel: z.enum(['gruen', 'gelb', 'rot']).optional(), comment: z.string().max(2000).optional(), exception: z.string().max(2000).optional() }),
      },
    },
    async (req) => {
      need(req, 'reviews:decide');
      const c = await load(req.params.id);
      if (!c.review) throw new HttpError(409, 'Noch keine Prüfung');
      const f = c.review.findings.find((x) => x.criterionKey === req.params.key);
      if (!f) throw new HttpError(404, 'Befund nicht gefunden');
      const a = actor(req);
      const prev = c.review.decisions[f.criterionKey] ?? {};
      const next = { ...prev, ...req.body, by: a.name, at: new Date().toISOString() };
      c.review.decisions[f.criterionKey] = next;
      await s.db.query('update cases set review=$2, updated_at=now(), version=version+1 where id=$1', [c.id, JSON.stringify(c.review)]);
      await s.audit.record({
        actor: a,
        action: req.body.ampel && req.body.ampel !== f.ampel ? 'pruefung.befund_uebersteuert' : 'pruefung.befund_kommentiert',
        targetType: 'vorgang',
        targetId: c.id,
        summary: req.body.ampel && req.body.ampel !== f.ampel ? `Befund «${f.criterionTitle}»: KI ${AMPEL_LABEL[f.ampel]} → ${AMPEL_LABEL[req.body.ampel]}` : `Befund «${f.criterionTitle}» kommentiert`,
        details: { criterion: f.criterionKey, aiAmpel: f.ampel, before: prev, after: req.body },
        ...reqInfo(req),
      });
      markAudited(req);
      return next;
    },
  );

  const effective = (c: Case) =>
    (c.review?.findings ?? []).map((f) => {
      const d = c.review!.decisions[f.criterionKey];
      return { ...f, ampel: d?.ampel ?? f.ampel, exception: d?.exception, comment: d?.comment } as Finding & { exception?: string; comment?: string };
    });

  app.post(
    '/api/v1/cases/:id/actions/:action',
    {
      schema: {
        tags,
        summary: 'Statuswechsel (H2 einreichen, H3 freigeben oder nachverhandeln, verwerfen)',
        params: z.object({ id: z.string(), action: z.enum(['einreichen', 'freigeben', 'nachverhandeln', 'verwerfen']) }),
        body: z.object({ comment: z.string().max(2000).default('') }),
      },
    },
    async (req) => {
      const c = await load(req.params.id);
      const action = req.params.action;
      const a = actor(req);
      if (action === 'einreichen') {
        const open = c.clauses.filter((b) => b.origin === 'angepasst' && !b.justification?.trim());
        if (!c.clauses.length) throw new HttpError(409, 'Der Entwurf ist leer. Bitte zuerst den Entwurf erstellen.');
        if (open.length) throw new HttpError(409, `Bitte begründen Sie jede Abweichung vom Textbaustein: ${open.map((b) => b.title).join(', ')}.`, 'justification');
        const due = addDays(s.today(), 7);
        const t = await transition(req, c, action, { comment: req.body.comment, deviations: c.clauses.filter((b) => b.origin === 'angepasst').map((b) => ({ clause: b.title, justification: b.justification })) }, { due_date: due });
        await s.notify.send({ to: { role: 'rechtsdienst' }, subject: `Neuer Prüfauftrag: ${c.title}`, body: `${a.name} hat «${c.title}» zur rechtlichen Prüfung eingereicht. Prüffrist ${due.split('-').reverse().join('.')}.`, link: `/pruefungen/${c.id}` });
        await s.events.publish('case.submitted', c.id, { title: c.title, type: c.type, supplier: c.supplierName, due });
        return { status: t.to };
      }
      if (action === 'freigeben' || action === 'nachverhandeln') {
        if (!c.review) throw new HttpError(409, 'Bitte zuerst die Prüfung durchführen.');
        const eff = effective(c);
        if (action === 'freigeben') {
          const red = eff.filter((f) => f.ampel === 'rot' && !f.exception?.trim());
          if (red.length) throw new HttpError(409, `Rote Punkte lassen sich nur als begründete Ausnahme freigeben: ${red.map((f) => f.criterionTitle).join(', ')}.`, 'exception_required');
        } else if (!eff.some((f) => f.ampel !== 'gruen') && !req.body.comment.trim()) {
          throw new HttpError(409, 'Für eine Nachverhandlung braucht es mindestens einen Verhandlungspunkt oder einen Kommentar.');
        }
        const review = { ...c.review, decision: { action, comment: req.body.comment, by: a, at: new Date().toISOString() } };
        const exceptions = eff.filter((f) => f.exception).map((f) => ({ criterion: f.criterionTitle, ampel: f.ampel, exception: f.exception }));
        const t = await transition(req, c, action, { comment: req.body.comment, summary: summarize(eff), exceptions, standardVersion: c.review.standardVersion, aiFindings: summarize(c.review.findings) }, { review });
        const to = { oid: c.createdBy.oid };
        if (action === 'freigeben') {
          await s.notify.send({ to, subject: `Freigegeben: ${c.title}`, body: `${a.name} hat «${c.title}» freigegeben${exceptions.length ? ` (${exceptions.length} Ausnahme(n))` : ''}. Nächster Schritt: unterzeichnete Fassung hochladen.`, link: `/vorgaenge/${c.id}` });
          await s.events.publish('case.approved', c.id, { title: c.title, exceptions });
        } else {
          await s.notify.send({ to, subject: `Nachverhandlung: ${c.title}`, body: `${a.name} hat «${c.title}» mit ${eff.filter((f) => f.ampel !== 'gruen').length} Verhandlungspunkten zurückgegeben.`, link: `/vorgaenge/${c.id}` });
          await s.events.publish('case.returned', c.id, { title: c.title, points: eff.filter((f) => f.ampel !== 'gruen').map((f) => f.criterionTitle) });
        }
        return { status: t.to };
      }
      const t = await transition(req, c, action, { comment: req.body.comment });
      return { status: t.to };
    },
  );

  app.post(
    '/api/v1/cases/:id/documents',
    { schema: { tags, summary: 'Dokument zum Vorgang hochladen (Lieferantenpapier, neue Fassung, unterzeichnete Fassung)', params: z.object({ id: z.string() }), querystring: z.object({ kind: z.enum(['lieferantenpapier', 'neue_fassung', 'unterzeichnet']) }), consumes: ['multipart/form-data'] } },
    async (req, reply) => {
      need(req, 'cases:create');
      const c = await load(req.params.id);
      const file = await req.file();
      if (!file) throw new HttpError(400, 'Keine Datei');
      if (!/\.(pdf|docx)$/i.test(file.filename)) throw new HttpError(400, 'Nur PDF- oder Word-Dateien');
      const bytes = new Uint8Array(await file.toBuffer());
      const kind = req.query.kind;
      const doc = await saveDocument(s, { bytes, path: `${FOLDERS.cases}/${c.id}/${kind === 'unterzeichnet' ? 'Unterzeichnet - ' : ''}${file.filename.replace(/[\\/:*?"<>|]/g, '-')}`, kind, actor: actor(req), caseId: c.id });
      await s.audit.record({ actor: actor(req), action: 'dokument.hochgeladen', targetType: 'vorgang', targetId: c.id, summary: `${file.filename} zum Vorgang hochgeladen (${kind})`, details: { documentId: doc.id, path: doc.path }, ...reqInfo(req) });
      let jobId: string | null = null;
      if (kind === 'lieferantenpapier') {
        if (c.status !== 'in_pruefung' || c.review) throw new HttpError(409, 'Lieferantenpapier nur vor der ersten Prüfung');
        await s.db.query('update cases set document_id=$2, updated_at=now() where id=$1', [c.id, doc.id]);
        await s.notify.send({ to: { role: 'rechtsdienst' }, subject: `Neuer Prüfauftrag: ${c.title}`, body: `${c.supplierName} hat Vertragspapier geliefert. Bitte prüfen.`, link: `/pruefungen/${c.id}` });
        await s.db.query('update cases set due_date=$2 where id=$1', [c.id, addDays(s.today(), 7)]);
        markAudited(req);
      } else if (kind === 'neue_fassung') {
        await transition(req, c, 'neue_fassung', { documentId: doc.id }, { document_id: doc.id, source: 'lieferantenpapier', due_date: addDays(s.today(), 7) });
        await s.notify.send({ to: { role: 'rechtsdienst' }, subject: `Neue Fassung: ${c.title}`, body: 'Die nachverhandelte Fassung liegt zur Prüfung bereit.', link: `/pruefungen/${c.id}` });
      } else {
        await transition(req, c, 'unterzeichnet', { documentId: doc.id }, { signed_document_id: doc.id });
        jobId = await startIngest(s, { documentId: doc.id, actor: actor(req), caseId: c.id });
        await s.notify.send({ to: { role: 'lieferantenmanagement' }, subject: `Unterzeichnet: ${c.title}`, body: 'Die unterzeichnete Fassung wurde gelesen. Bitte Daten bestätigen (H1).', link: '/erfassen' });
      }
      return reply.status(201).send({ documentId: doc.id, jobId });
    },
  );

  app.get('/api/v1/cases/:id/document.docx', { schema: { tags, summary: 'Entwurf oder Verhandlungsschreiben als Word', params: z.object({ id: z.string() }), querystring: z.object({ kind: z.enum(['entwurf', 'verhandlung']) }) } }, async (req, reply) => {
    need(req, 'contracts:read');
    const c = await load(req.params.id);
    const para = (text: string, o: { bold?: boolean; size?: number; before?: number; italics?: boolean } = {}) => new Paragraph({ spacing: { before: o.before ?? 120 }, children: [new TextRun({ text, bold: o.bold, size: o.size ?? 21, italics: o.italics })] });
    let children: Paragraph[];
    let name: string;
    if (req.query.kind === 'entwurf') {
      name = `Entwurf ${c.title}.docx`;
      children = [
        para(c.type.toUpperCase() === c.type ? c.type : c.type, { size: 18 }),
        new Paragraph({ text: c.title, heading: HeadingLevel.HEADING_1 }),
        para(`zwischen der Liechtensteinischen Landesverwaltung, Vaduz, und ${c.supplierName}`),
        ...c.clauses.flatMap((b, i) => [new Paragraph({ text: `§ ${i + 1} ${b.title}`, heading: HeadingLevel.HEADING_2, spacing: { before: 240 } }), para(b.text)]),
      ];
    } else {
      if (!c.review) throw new HttpError(409, 'Noch keine Prüfung');
      name = `Verhandlungspunkte ${c.title}.docx`;
      const points = effective(c).filter((f) => f.ampel !== 'gruen');
      children = [
        new Paragraph({ text: `Verhandlungspunkte «${c.title}»`, heading: HeadingLevel.HEADING_1 }),
        para(`${c.supplierName}. Geprüft gegen den Prüfstandard ${c.type}, Version ${c.review.standardVersion}.`),
        ...points.flatMap((f, i) => [
          new Paragraph({ text: `${i + 1}. ${f.criterionTitle}${f.location ? ` (${f.location})` : ''}`, heading: HeadingLevel.HEADING_2, spacing: { before: 240 } }),
          para(`Beurteilung: ${AMPEL_LABEL[f.ampel]}. ${f.reason}`),
          ...(f.comment ? [para(`Hinweis des Rechtsdienstes: ${f.comment}`, { italics: true })] : []),
          ...(f.proposal ? [para('Gegenvorschlag der LLV:', { bold: true }), para(f.proposal)] : []),
        ]),
      ];
    }
    const bytes = new Uint8Array(await Packer.toBuffer(new Document({ creator: principal(req).name, sections: [{ children }] })));
    await s.audit.record({ actor: actor(req), action: 'dokument.erstellt', targetType: 'vorgang', targetId: c.id, summary: `${name} erstellt und heruntergeladen`, details: { kind: req.query.kind }, ...reqInfo(req) });
    markAudited(req);
    return sendFile(reply, bytes, name, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  });

  void newId;
}
