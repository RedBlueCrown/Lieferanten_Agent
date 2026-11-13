/**
 * Demo data from the prototype: 12 suppliers, 18 contracts, the review
 * standards as Word documents in the shared folder, two supplier papers
 * waiting for the legal check, and a sample contract for the ingest demo.
 * Runs only when the database is empty.
 */
import fs from 'node:fs';
import path from 'node:path';
import { chf, dateCH } from '@vm/domain';
import { SYSTEM } from '../audit';
import { DEMO_USERS } from '../auth';
import { config, repoRoot } from '../config';
import type { Services } from '../context';
import { saveDocument } from '../services/agents';
import { buildStandardDocx, standardFileName } from '../services/standards';
import { FOLDERS } from '../storage/types';
import { textPdf } from './pdf';

interface SeedContract {
  id: string;
  type: string;
  title: string;
  start: string | null;
  end: string | null;
  noticeMonths: number;
  noticeMode: string;
  renewalMonths: number;
  annualValue: number;
  reviewDate: string | null;
  law: string | null;
  venue: string | null;
  status: string;
  documentPath: string | null;
  note: string;
}
interface SeedData {
  suppliers: (Record<string, unknown> & { id: string; name: string; contracts: SeedContract[]; contact: { name?: string } })[];
  standards: { contractType: string; version: string; date: string; criteria: { title: string; gruen: string; gelb: string; rot: string; muster: string }[] }[];
  cases: { id: string; title: string; type: string; supplierId: string; supplierName: string; received: string; due: string; clauses: { titel: string; text: string }[]; fixture: unknown[] }[];
  sampleContract: { name: string; text: string };
}

function loadSeed(): SeedData {
  const candidates = [path.join(repoRoot, 'apps/api/seed-assets/seed-data.json'), path.resolve('seed-assets/seed-data.json'), path.resolve('apps/api/seed-assets/seed-data.json')];
  const file = candidates.find((p) => fs.existsSync(p));
  if (!file) throw new Error('seed-data.json nicht gefunden');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export async function seedIfEmpty(s: Services) {
  const n = await s.db.one<{ n: string }>('select count(*) as n from suppliers');
  if (Number(n?.n) > 0) {
    await s.standards.sync().catch(() => undefined);
    return false;
  }
  const data = loadSeed();
  const marco = DEMO_USERS.find((u) => u.firstName === 'Marco')!;
  const fabian = DEMO_USERS.find((u) => u.firstName === 'Fabian')!;

  // Review standards as Word documents in the shared folder (written only if missing).
  const existing = new Set((await s.store.list(FOLDERS.standards)).map((f) => f.name));
  for (const st of data.standards) {
    const name = standardFileName(st.contractType);
    if (existing.has(name)) continue;
    await s.store.write(`${FOLDERS.standards}/${name}`, await buildStandardDocx({ ...st, author: marco.name }));
  }

  for (const sup of data.suppliers) {
    await s.db.query(
      'insert into suppliers (id, name, city, country, legal_form, class, contact, apps, kpi, risk, measures, price_history) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
      [sup.id, sup.name, sup.city, sup.country, sup.legalForm, sup.class, JSON.stringify(sup.contact), JSON.stringify(sup.apps), JSON.stringify(sup.kpi), JSON.stringify(sup.risk), sup.measures, JSON.stringify(sup.priceHistory)],
    );
    for (const c of sup.contracts) {
      await s.db.query(
        `insert into contracts (id, supplier_id, type, title, start_date, end_date, notice_months, notice_mode, renewal_months, annual_value, review_date, law, venue, status, document_path, note, source)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
        [c.id, sup.id, c.type, c.title, c.start, c.end, c.noticeMonths, c.noticeMode, c.renewalMonths, c.annualValue, c.reviewDate, c.law, c.venue, c.status, c.documentPath, c.note, JSON.stringify({ via: 'demodaten' })],
      );
      if (c.documentPath) {
        const bytes = await textPdf({
          title: c.title.toUpperCase(),
          subtitle: `${c.type} zwischen der Liechtensteinischen Landesverwaltung und der ${sup.name}`,
          paragraphs: [
            { heading: '1. Gegenstand', text: `${c.title}. Die Einzelheiten ergeben sich aus den Anhängen.` },
            { heading: '2. Laufzeit', text: `Der Vertrag beginnt am ${dateCH(c.start)}${c.end ? ` und gilt bis ${dateCH(c.end)}` : ' und gilt unbefristet'}.${c.renewalMonths ? ` Er verlängert sich danach stillschweigend um jeweils ${c.renewalMonths} Monate.` : ''}` },
            ...(c.noticeMonths ? [{ heading: '3. Kündigung', text: `Jede Partei kann den Vertrag mit einer Frist von ${c.noticeMonths} Monaten auf das Ende der Laufzeit kündigen.` }] : []),
            ...(c.annualValue ? [{ heading: '4. Vergütung', text: `Pauschal ${chf(c.annualValue)} pro Jahr exkl. MWST.` }] : []),
            { heading: '5. Recht', text: `Anwendbar ist ${c.law === 'FL' ? 'liechtensteinisches' : c.law === 'CH' ? 'schweizerisches' : c.law === 'DE' ? 'deutsches' : 'liechtensteinisches'} Recht. Gerichtsstand ist ${c.venue ?? 'Vaduz'}.` },
          ],
          footer: 'Demodokument, erzeugt aus den Prototyp-Daten.',
        });
        await saveDocument(s, { bytes, path: c.documentPath, kind: 'vertrag', actor: SYSTEM, contractId: c.id });
      }
    }
  }

  // Supplier papers waiting for the legal check, submitted by Fabian.
  for (const c of data.cases) {
    await s.db.query(
      `insert into cases (id, title, type, supplier_id, supplier_name, source, status, created_by, fields, due_date, fixture, created_at)
       values ($1,$2,$3,$4,$5,'lieferantenpapier','in_pruefung',$6,'{}',$7,$8,$9)`,
      [c.id, c.title, c.type, c.supplierId, c.supplierName, JSON.stringify({ kind: 'user', oid: fabian.oid, name: fabian.name, roles: fabian.roles }), c.due, JSON.stringify(c.fixture), c.received],
    );
    const bytes = await textPdf({ title: c.title, subtitle: `${c.type}, Vertragsentwurf der ${c.supplierName}`, paragraphs: c.clauses.map((k) => ({ text: `${k.titel}: ${k.text}` })), footer: `Eingereicht am ${dateCH(c.received)}.` });
    const doc = await saveDocument(s, { bytes, path: `${FOLDERS.cases}/${c.id}/${c.supplierName.split(' ')[0]} Vertragsentwurf.pdf`, kind: 'lieferantenpapier', actor: SYSTEM, caseId: c.id });
    await s.db.query('update cases set document_id=$2 where id=$1', [c.id, doc.id]);
  }

  // Sample contract for the ingest demo.
  const sample = data.sampleContract;
  const lines = sample.text.split('\n');
  await s.store.write(
    `${FOLDERS.samples}/${sample.name}`,
    await textPdf({ title: lines[0], paragraphs: lines.slice(1).map((t) => ({ text: t })) }),
  );

  await s.audit.record({
    actor: SYSTEM,
    action: 'system.demodaten',
    summary: `Demodaten geladen: ${data.suppliers.length} Lieferanten, ${data.suppliers.reduce((n, x) => n + x.contracts.length, 0)} Verträge, ${data.standards.length} Prüfstandards, ${data.cases.length} Prüfaufträge`,
    details: { storage: (await s.store.describe()).label, today: s.today(), dataDir: config.dataDir },
  });
  await s.standards.sync();
  return true;
}
