/**
 * The three agent pipelines. Each one is a fixed sequence of steps (feste
 * Regeln) in which the AI provider does the reading and judging. Results are
 * proposals: they only become data at a hold point.
 */
import path from 'node:path';
import { addMonths, chf, diffDays, summarize, type ExtractedField, type Finding, type LayoutPage } from '@vm/domain';
import { layoutPlainText, readDocument } from '../ai/reader';
import { segmentClauses } from '../ai/segment';
import type { Clause, DraftBlock } from '../ai/types';
import type { Actor } from '../audit';
import { config } from '../config';
import type { Services } from '../context';
import { FOLDERS } from '../storage/types';
import { HttpError, newId, sha256 } from '../util';
import { toCase, type CaseReview } from './cases';

const svcLabel = (s: Services) => (s.ai.name === 'azure' ? `Azure OpenAI (${s.ai.model})` : 'Regelbasierte Demo-KI');

export async function saveDocument(s: Services, opts: { bytes: Uint8Array; path: string; kind: string; actor: Actor; caseId?: string | null; contractId?: string | null; contentType?: string; writeToStore?: boolean }) {
  if (opts.writeToStore !== false) await s.store.write(opts.path, opts.bytes, { contentType: opts.contentType });
  const id = newId('D');
  const name = path.posix.basename(opts.path);
  const contentType = opts.contentType ?? (name.endsWith('.pdf') ? 'application/pdf' : name.endsWith('.docx') ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : 'application/octet-stream');
  await s.db.query('insert into documents (id, path, name, kind, sha256, size, content_type, case_id, contract_id, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)', [
    id,
    opts.path,
    name,
    opts.kind,
    sha256(opts.bytes),
    opts.bytes.length,
    contentType,
    opts.caseId ?? null,
    opts.contractId ?? null,
    JSON.stringify(opts.actor),
  ]);
  return { id, name, path: opts.path };
}

export async function layoutFor(s: Services, documentId: string): Promise<{ pages: LayoutPage[]; service: string; name: string }> {
  const doc = await s.db.one<{ path: string; name: string; layout: LayoutPage[] | null }>('select path, name, layout from documents where id=$1', [documentId]);
  if (!doc) throw new Error('Dokument nicht gefunden');
  if (doc.layout) return { pages: doc.layout, service: 'Zwischenspeicher', name: doc.name };
  const { bytes } = await s.store.read(doc.path);
  const r = await readDocument(bytes, doc.name);
  await s.db.query('update documents set layout=$2 where id=$1', [documentId, JSON.stringify(r.pages)]);
  return { ...r, name: doc.name };
}

/* ---------------- Erfassung (ingest) ---------------- */

export interface IngestResult {
  documentId: string;
  fileName: string;
  path: string;
  fields: ExtractedField[];
  supplier: { id: string | null; name: string; score: number };
  checks: { level: 'ok' | 'warn' | 'error'; text: string }[];
  caseId: string | null;
  differences: { key: string; label: string; approved: string; signed: string }[];
}

function plausibility(fields: ExtractedField[], today: string): IngestResult['checks'] {
  const v = (k: string) => fields.find((f) => f.key === k)?.value;
  const out: IngestResult['checks'] = [];
  const start = v('beginn');
  const end = v('ende');
  if (start && end && end <= start) out.push({ level: 'error', text: 'Ende liegt vor dem Beginn.' });
  if (start && end) {
    const months = Math.round(diffDays(end, start) / 30.4);
    out.push({ level: 'ok', text: `Laufzeit rund ${months} Monate.` });
    const n = Number(v('kuendigungsfrist') ?? 0);
    if (n && n >= months) out.push({ level: 'warn', text: 'Kündigungsfrist ist so lang wie die Laufzeit.' });
  }
  if (end && end < today && !Number(v('verlaengerung'))) out.push({ level: 'warn', text: 'Vertrag ist bereits abgelaufen.' });
  const wert = Number(v('wert') ?? 0);
  if (!wert) out.push({ level: 'warn', text: 'Kein Jahreswert gefunden.' });
  else if (wert < 1000) out.push({ level: 'warn', text: `Jahreswert ${chf(wert)} ist ungewöhnlich tief.` });
  if (v('recht') && v('recht') !== 'FL') out.push({ level: 'warn', text: `Anwendbares Recht ${v('recht')} statt FL: Ausnahme nötig.` });
  const low = fields.filter((f) => f.confidence < 0.8);
  if (low.length) out.push({ level: 'warn', text: `${low.length} Feld${low.length > 1 ? 'er' : ''} mit tiefer Sicherheit: bitte einzeln bestätigen.` });
  if (!fields.find((f) => f.key === 'lieferant')) out.push({ level: 'error', text: 'Lieferant nicht erkannt.' });
  return out;
}

export async function startIngest(s: Services, opts: { documentId: string; actor: Actor; caseId?: string | null }): Promise<string> {
  const doc = await s.db.one<{ name: string; path: string }>('select name, path from documents where id=$1', [opts.documentId]);
  if (!doc) throw new Error('Dokument nicht gefunden');
  const storeInfo = await s.store.describe();
  return s.jobs.start<IngestResult>({
    kind: 'erfassung',
    title: `Vertrag lesen: ${doc.name}`,
    subject: { documentId: opts.documentId, fileName: doc.name, caseId: opts.caseId ?? null },
    actor: opts.actor,
    provider: s.ai,
    run: async (emit) => {
      emit({ t: 'stage', stage: 'empfang', label: 'Dokument empfangen', service: storeInfo.label, status: 'run', detail: doc.path });
      emit({ t: 'stage', stage: 'empfang', label: 'Dokument empfangen', service: storeInfo.label, status: 'done' });
      emit({ t: 'stage', stage: 'lesen', label: 'Text und Layout erkennen', service: config.ai.provider === 'azure' && config.ai.docIntelEndpoint ? 'Azure AI Document Intelligence' : 'pdf.js', status: 'run' });
      const layout = await layoutFor(s, opts.documentId);
      emit({ t: 'doc', name: doc.name, pages: layout.pages });
      emit({ t: 'stage', stage: 'lesen', label: 'Text und Layout erkennen', service: layout.service, status: 'done', detail: `${layout.pages.length} Seite(n), ${layout.pages.reduce((n, p) => n + p.lines.length, 0)} Zeilen` });

      emit({ t: 'stage', stage: 'extrahieren', label: 'Vertragsdaten auslesen', service: svcLabel(s), status: 'run' });
      const suppliers = (await s.repo.suppliers()).map((x) => ({ id: x.id, name: x.name }));
      const out = await s.ai.extract({ fileName: doc.name, pages: layout.pages, suppliers }, emit);
      emit({ t: 'stage', stage: 'extrahieren', label: 'Vertragsdaten auslesen', service: svcLabel(s), status: 'done', detail: `${out.fields.length} Felder mit Fundstelle` });

      emit({ t: 'stage', stage: 'regeln', label: 'Plausibilität prüfen', service: 'Feste Regeln', status: 'run' });
      const checks = plausibility(out.fields, s.today());
      for (const c of checks) emit({ t: 'note', text: c.text });
      const differences: IngestResult['differences'] = [];
      if (opts.caseId) {
        const row = await s.db.one('select * from cases where id=$1', [opts.caseId]);
        if (row) {
          const c = toCase(row);
          const v = (k: string) => out.fields.find((f) => f.key === k)?.value ?? '';
          const approvedEnd = c.fields.start && c.fields.termMonths ? addMonths(c.fields.start, Number(c.fields.termMonths)) : '';
          const cmp: [string, string, string, string][] = [
            ['beginn', 'Beginn', String(c.fields.start ?? ''), v('beginn')],
            ['kuendigungsfrist', 'Kündigungsfrist', String(c.fields.noticeMonths ?? ''), v('kuendigungsfrist')],
            ['wert', 'Wert pro Jahr', String(c.fields.amount ?? ''), v('wert')],
          ];
          if (approvedEnd) cmp.push(['ende', 'Ende', approvedEnd, v('ende')]);
          for (const [key, label, approved, signed] of cmp) if (approved && signed && approved !== signed) differences.push({ key, label, approved, signed });
          emit({ t: 'note', text: differences.length ? `${differences.length} Abweichung(en) zur freigegebenen Fassung` : 'Keine Abweichung zur freigegebenen Fassung' });
        }
      }
      emit({ t: 'stage', stage: 'regeln', label: 'Plausibilität prüfen', service: 'Feste Regeln', status: 'done' });
      return { documentId: opts.documentId, fileName: doc.name, path: doc.path, fields: out.fields, supplier: out.supplier, checks, caseId: opts.caseId ?? null, differences };
    },
    onDone: async (r) => {
      await s.events.publish('document.ingested', opts.documentId, { fileName: r.fileName, supplier: r.supplier.name, fields: Object.fromEntries(r.fields.map((f) => [f.key, f.value])) });
      await s.notify.send({ to: { role: 'lieferantenmanagement' }, subject: `Vertrag gelesen: ${r.fileName}`, body: `Der Erfassungs-Agent hat ${r.fields.length} Felder ausgelesen. Bitte prüfen und bestätigen.`, link: '/erfassen' });
    },
  });
}

/* ---------------- Prüfung (review) ---------------- */

function clausesFromDraft(blocks: DraftBlock[]): { pages: LayoutPage[]; clauses: Clause[] } {
  const text = blocks.map((b, i) => `§ ${i + 1} ${b.title}\n${b.text}`).join('\n\n');
  const pages = layoutPlainText(text);
  return { pages, clauses: segmentClauses(pages) };
}

export async function startReview(s: Services, caseId: string, actor: Actor): Promise<string> {
  const c = toCase((await s.db.one('select * from cases where id=$1', [caseId]))!);
  const standard = await s.standards.get(c.type);
  if (!standard) throw new HttpError(409, `Kein Prüfstandard für ${c.type} im Ordner «${FOLDERS.standards}». Bitte das Word-Dokument ablegen.`);
  return s.jobs.start<{ findings: Finding[]; standardVersion: string }>({
    kind: 'pruefung',
    title: `Rechtsprüfung: ${c.title}`,
    subject: { caseId, contractType: c.type, standardVersion: standard.version },
    actor,
    provider: s.ai,
    run: async (emit) => {
      emit({ t: 'stage', stage: 'standard', label: `Prüfstandard ${c.type} laden`, service: (await s.store.describe()).label, status: 'run', detail: standard.source.path });
      emit({ t: 'note', text: `Prüfstandard Version ${standard.version} mit ${standard.criteria.length} Kriterien von ${standard.author || 'Rechtsdienst'}` });
      emit({ t: 'stage', stage: 'standard', label: `Prüfstandard ${c.type} laden`, service: 'Word-Dokument', status: 'done', detail: `Version ${standard.version}, ${standard.criteria.length} Kriterien` });

      emit({ t: 'stage', stage: 'lesen', label: 'Vertrag lesen und gliedern', service: 'Feste Regeln', status: 'run' });
      let pages: LayoutPage[];
      let clauses: Clause[];
      let name: string;
      const unchanged = new Set<string>();
      if (c.source === 'llv_entwurf') {
        ({ pages, clauses } = clausesFromDraft(c.clauses));
        name = `${c.title} (LLV-Entwurf)`;
        c.clauses.forEach((b) => b.origin === 'baustein' && unchanged.add(b.key));
      } else {
        const layout = await layoutFor(s, c.documentId!);
        pages = layout.pages;
        name = layout.name;
        clauses = segmentClauses(pages);
      }
      emit({ t: 'doc', name, pages });
      emit({ t: 'stage', stage: 'lesen', label: 'Vertrag lesen und gliedern', service: 'Feste Regeln', status: 'done', detail: `${clauses.length} Klauseln erkannt` });

      // Unchanged LLV text blocks are pre-approved; only the rest goes to the AI.
      const pre: Finding[] = [];
      let criteria = standard.criteria;
      if (unchanged.size) {
        emit({ t: 'stage', stage: 'vorpruefung', label: 'Unveränderte Textbausteine', service: 'Feste Regeln', status: 'run' });
        for (const crit of standard.criteria.filter((x) => unchanged.has(x.key))) {
          const idx = c.clauses.findIndex((b) => b.key === crit.key) + 0;
          const cl = clauses[idx];
          const f: Finding = { criterionKey: crit.key, criterionTitle: crit.title, location: cl?.heading ?? crit.title, quote: cl?.text.slice(0, 200) ?? null, ampel: 'gruen', reason: `Unveränderter Textbaustein aus Prüfstandard ${standard.version}: gilt als vorgeprüft.`, proposal: '', missing: false };
          pre.push(f);
          emit({ t: 'verdict', clauseIndex: cl?.index ?? null, criterionKey: f.criterionKey, criterionTitle: f.criterionTitle, ampel: 'gruen', reason: f.reason, proposal: '', quote: f.quote, missing: false });
        }
        criteria = standard.criteria.filter((x) => !unchanged.has(x.key));
        emit({ t: 'stage', stage: 'vorpruefung', label: 'Unveränderte Textbausteine', service: 'Feste Regeln', status: 'done', detail: `${pre.length} vorgeprüft, ${criteria.length} für die KI` });
      }

      emit({ t: 'stage', stage: 'pruefen', label: 'Klauseln gegen den Standard prüfen', service: svcLabel(s), status: 'run' });
      const fixture = c.fixture ? (JSON.parse(c.fixture) as Finding[]) : undefined;
      const relevant = unchanged.size ? clauses.filter((cl, i) => !unchanged.has(c.clauses[i]?.key)) : clauses;
      const { findings } = criteria.length ? await s.ai.review({ contractType: c.type, clauses: relevant, standard: { ...standard, criteria }, fixture }, emit) : { findings: [] as Finding[] };
      const all = [...pre, ...findings];
      const sum = summarize(all);
      emit({ t: 'stage', stage: 'pruefen', label: 'Klauseln gegen den Standard prüfen', service: svcLabel(s), status: 'done', detail: `${sum.gruen} grün, ${sum.gelb} gelb, ${sum.rot} rot` });
      return { findings: all, standardVersion: standard.version };
    },
    onDone: async (r, jobId) => {
      const row = await s.db.one<{ review: CaseReview | null }>('select review from cases where id=$1', [caseId]);
      const prev = row?.review;
      const review: CaseReview = {
        jobId,
        at: new Date().toISOString(),
        standardVersion: r.standardVersion,
        standardPath: standard.source.path,
        findings: r.findings,
        summary: summarize(r.findings),
        decisions: {},
        history: prev ? [...(prev.history ?? []), (({ history: _h, ...rest }) => rest)(prev)] : [],
      };
      await s.db.query('update cases set review=$2, updated_at=now(), version=version+1 where id=$1', [caseId, JSON.stringify(review)]);
      await s.events.publish('review.completed', caseId, { summary: review.summary, standardVersion: r.standardVersion });
    },
  });
}

/** The contract of a case as clauses, for the review screen. */
export async function caseClauses(s: Services, caseId: string): Promise<{ name: string; clauses: Clause[] }> {
  const c = toCase((await s.db.one('select * from cases where id=$1', [caseId]))!);
  if (c.source === 'llv_entwurf') return { name: `${c.title} (LLV-Entwurf)`, clauses: clausesFromDraft(c.clauses).clauses };
  if (!c.documentId) return { name: '', clauses: [] };
  const layout = await layoutFor(s, c.documentId);
  return { name: layout.name, clauses: segmentClauses(layout.pages) };
}

/* ---------------- Entwurf (draft) ---------------- */

function fill(template: string, p: Record<string, string>): string {
  return template.replace(/\[([^\]]+)\]/g, (m, k: string) => p[k.toLowerCase()] ?? m);
}

export async function startDraft(s: Services, caseId: string, actor: Actor): Promise<string> {
  const c = toCase((await s.db.one('select * from cases where id=$1', [caseId]))!);
  const standard = await s.standards.get(c.type);
  if (!standard) throw new HttpError(409, `Kein Prüfstandard für ${c.type} im Ordner «${FOLDERS.standards}».`);
  return s.jobs.start<{ blocks: DraftBlock[] }>({
    kind: 'entwurf',
    title: `Entwurf erstellen: ${c.title}`,
    subject: { caseId, contractType: c.type, standardVersion: standard.version },
    actor,
    provider: s.ai,
    run: async (emit) => {
      emit({ t: 'stage', stage: 'standard', label: 'Textbausteine laden', service: (await s.store.describe()).label, status: 'run', detail: standard.source.path });
      emit({ t: 'stage', stage: 'standard', label: 'Textbausteine laden', service: 'Word-Dokument', status: 'done', detail: `Prüfstandard ${c.type}, Version ${standard.version}` });
      const f = c.fields;
      const params: Record<string, string> = {
        laufzeit: f.termMonths ? `${f.termMonths} Monaten` : '[Laufzeit]',
        frist: f.noticeMonths ? String(f.noticeMonths) : '[Frist]',
        betrag: f.amount ? `${chf(Number(f.amount))} pro Jahr` : '[Betrag]',
      };
      emit({ t: 'stage', stage: 'formulieren', label: 'Vertragsgegenstand formulieren', service: svcLabel(s), status: 'run' });
      const subjectText = await s.ai.formulateSubject(
        { contractType: c.type, supplierName: c.supplierName, title: c.title, subject: String(f.subject ?? ''), start: String(f.start ?? ''), termMonths: Number(f.termMonths ?? 0), noticeMonths: Number(f.noticeMonths ?? 0), amount: Number(f.amount ?? 0), availability: Number(f.availability ?? 0) },
        emit,
      );
      emit({ t: 'stage', stage: 'formulieren', label: 'Vertragsgegenstand formulieren', service: svcLabel(s), status: 'done' });
      const blocks: DraftBlock[] = [{ key: 'gegenstand', title: 'Vertragsgegenstand', text: subjectText, origin: 'ki', template: '' }];
      emit({ t: 'block', index: 0, title: 'Vertragsgegenstand', text: subjectText, origin: 'ki' });

      emit({ t: 'stage', stage: 'zusammenstellen', label: 'Vertrag aus Textbausteinen zusammenstellen', service: 'Feste Regeln', status: 'run' });
      for (const crit of standard.criteria) {
        let text = fill(crit.muster, params);
        if (crit.key === 'verfuegbarkeit' && f.availability) text = text.replace(/\d{2}\.\d+ %/, `${f.availability} %`);
        blocks.push({ key: crit.key, title: crit.title, text, origin: 'baustein', template: text });
        emit({ t: 'block', index: blocks.length - 1, title: crit.title, text, origin: 'baustein' });
        await new Promise((r) => setTimeout(r, s.ai.name === 'mock' ? 260 : 0));
      }
      emit({ t: 'stage', stage: 'zusammenstellen', label: 'Vertrag aus Textbausteinen zusammenstellen', service: 'Feste Regeln', status: 'done', detail: `${blocks.length} Klauseln` });
      return { blocks };
    },
    onDone: async (r) => {
      await s.db.query('update cases set clauses=$2, updated_at=now(), version=version+1 where id=$1', [caseId, JSON.stringify(r.blocks)]);
    },
  });
}

export function contractsFolder(supplierName: string) {
  return `${FOLDERS.contracts}/${supplierName.replace(/[\\/:*?"<>|]/g, '-')}`;
}
