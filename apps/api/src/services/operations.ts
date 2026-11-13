/**
 * Deadlines and decisions (H4), exports, the folder poller and the daily job.
 */
import { Document, Packer, Paragraph, TextRun } from 'docx';
import { addMonths, chf, computeDeadlines, computeTerm, dateCH, DECISION_LABEL, GROUP_LABEL, lockedValueTotal, type Deadline, type DeadlineDecision } from '@vm/domain';
import type { Actor } from '../audit';
import { SYSTEM } from '../audit';
import type { Services } from '../context';
import { FOLDERS } from '../storage/types';
import { HttpError, newId } from '../util';
import { contractsFolder, saveDocument, startIngest } from './agents';
import { terms } from './repo';

export async function deadlinesView(s: Services) {
  const today = s.today();
  const settings = await s.repo.settings();
  const all = computeDeadlines(await s.repo.contexts(), today, settings);
  const decided = await s.db.query<{ key: string; decision: DeadlineDecision; note: string; decided_by: Actor; decided_at: Date | string; contract_id: string | null }>(
    'select * from deadline_decisions order by decided_at desc',
  );
  const decidedKeys = new Set(decided.map((d) => d.key));
  const open = all.filter((d) => !decidedKeys.has(d.key));
  return {
    today,
    open,
    decided: decided.map((d) => ({ ...d, decided_at: new Date(d.decided_at).toISOString(), deadline: all.find((x) => x.key === d.key) ?? null })),
    lockedValue: lockedValueTotal(open),
    groups: GROUP_LABEL,
  };
}

async function terminationLetter(supplierName: string, contractTitle: string, terminationDate: string, noticeBy: string, actor: Actor): Promise<Uint8Array> {
  const p = (t: string, opts: { bold?: boolean; size?: number; before?: number } = {}) => new Paragraph({ spacing: { before: opts.before ?? 120 }, children: [new TextRun({ text: t, bold: opts.bold, size: opts.size ?? 22 })] });
  const doc = new Document({
    creator: actor.name,
    title: `Kündigung ${contractTitle}`,
    sections: [
      {
        children: [
          p('Liechtensteinische Landesverwaltung', { bold: true }),
          p('Amt für Informatik, 9490 Vaduz'),
          p(supplierName, { before: 480 }),
          p(`Vaduz, ${dateCH(new Date().toISOString().slice(0, 10))}`, { before: 360 }),
          p(`Kündigung «${contractTitle}»`, { bold: true, before: 360, size: 26 }),
          p('Sehr geehrte Damen und Herren', { before: 240 }),
          p(`Hiermit kündigen wir den Vertrag «${contractTitle}» fristgerecht per ${dateCH(terminationDate)}. Die Kündigung muss Ihnen spätestens am ${dateCH(noticeBy)} zugehen; wir bitten um eine schriftliche Bestätigung des Eingangs.`),
          p('Wir danken Ihnen für die Zusammenarbeit und bitten Sie, die Rückgabe sämtlicher Daten der LLV gemäss Vertrag vorzubereiten.'),
          p('Freundliche Grüsse', { before: 360 }),
          p(actor.name, { before: 480 }),
          p('[Unterschrift gemäss Zeichnungsberechtigung]', { size: 18 }),
        ],
      },
    ],
  });
  return new Uint8Array(await Packer.toBuffer(doc));
}

export async function decideDeadline(s: Services, key: string, decision: DeadlineDecision, note: string, actor: Actor) {
  const view = await deadlinesView(s);
  const d = view.open.find((x) => x.key === key);
  if (!d) throw new HttpError(404, 'Frist nicht gefunden oder bereits entschieden');
  const effects: string[] = [];
  let createdCaseId: string | null = null;
  let letterPath: string | null = null;
  const contract = d.contractId ? await s.repo.contract(d.contractId) : undefined;

  if (contract) {
    const term = computeTerm(terms(contract), s.today(), await s.repo.settings());
    if (decision === 'kuendigen' && term.terminationDate) {
      await s.db.query("update contracts set status='gekuendigt', terminated_per=$2, updated_at=now(), version=version+1 where id=$1", [contract.id, term.terminationDate]);
      const bytes = await terminationLetter(contract.supplierName ?? '', contract.title, term.terminationDate, term.noticeBy!, actor);
      letterPath = `${contractsFolder(contract.supplierName ?? contract.supplierId)}/Kündigung ${contract.title.replace(/[\\/:*?"<>|]/g, '-')} ${s.today()}.docx`;
      await saveDocument(s, { bytes, path: letterPath, kind: 'kuendigung', actor, contractId: contract.id });
      effects.push(`Vertrag gekündigt per ${dateCH(term.terminationDate)}`, `Kündigungsschreiben abgelegt: ${letterPath}`);
      await s.events.publish('contract.terminated', contract.id, { terminationDate: term.terminationDate, noticeBy: term.noticeBy, supplier: contract.supplierName });
    } else if (decision === 'auslaufen') {
      await s.db.query("update contracts set status='auslaufend', updated_at=now(), version=version+1 where id=$1", [contract.id]);
      effects.push('Vertrag läuft aus');
    } else if (decision === 'review_erledigt') {
      const next = addMonths(s.today(), 12);
      await s.db.query('update contracts set review_date=$2, updated_at=now(), version=version+1 where id=$1', [contract.id, next]);
      effects.push(`Nächstes Review ${dateCH(next)}`);
    } else if (decision === 'neu_verhandeln') {
      createdCaseId = newId('C');
      await s.db.query(
        `insert into cases (id, title, type, supplier_id, supplier_name, source, status, created_by, fields) values ($1,$2,$3,$4,$5,'llv_entwurf','entwurf',$6,$7)`,
        [createdCaseId, `${contract.title} – Neuverhandlung`, contract.type, contract.supplierId, contract.supplierName, JSON.stringify(actor), JSON.stringify({ subject: contract.title, noticeMonths: contract.noticeMonths, amount: contract.annualValue, start: term.terminationDate ?? s.today(), termMonths: 36, from: contract.id })],
      );
      await s.notify.send({ to: { role: 'projektleitung' }, subject: `Neuverhandlung: ${contract.title}`, body: `${actor.name} hat entschieden, «${contract.title}» neu zu verhandeln. Ein Entwurf ist vorbereitet.`, link: `/vorgaenge/${createdCaseId}` });
      effects.push('Vorgang für die Projektleitung angelegt');
    }
  }
  await s.db.query('insert into deadline_decisions (key, contract_id, decision, note, decided_by) values ($1,$2,$3,$4,$5)', [key, d.contractId, decision, note, JSON.stringify(actor)]);
  await s.audit.record({
    actor,
    action: 'frist.entschieden',
    targetType: d.contractId ? 'vertrag' : 'lieferant',
    targetId: d.contractId ?? d.supplierId,
    summary: `H4 Fristentscheid «${DECISION_LABEL[decision]}»: ${d.contractTitle ?? d.title} (${d.supplierName})`,
    details: { holdPoint: 'H4', key, kind: d.kind, decision, note, effects, deadlineDate: d.date, createdCaseId, letterPath },
  });
  await s.events.publish('deadline.decided', d.contractId ?? d.supplierId, { key, decision, note, effects });
  return { effects, createdCaseId, letterPath };
}

/* ---------------- exports ---------------- */

function icsDate(d: string) {
  return d.replace(/-/g, '');
}

export function buildIcs(deadlines: Deadline[]): string {
  const now = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const esc = (t: string) => t.replace(/\\/g, '\\\\').replace(/[,;]/g, (m) => `\\${m}`).replace(/\n/g, '\\n');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//LLV//Vertragsmanagement//DE', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:Vertragsfristen LLV'];
  for (const d of deadlines.filter((x) => x.date)) {
    const next = new Date(Date.parse(d.date! + 'T00:00:00Z') + 86_400_000).toISOString().slice(0, 10);
    lines.push(
      'BEGIN:VEVENT',
      `UID:${d.key.replace(/[^a-zA-Z0-9-]/g, '-')}@vertragsmanagement.llv`,
      `DTSTAMP:${now}`,
      `DTSTART;VALUE=DATE:${icsDate(d.date!)}`,
      `DTEND;VALUE=DATE:${icsDate(next)}`,
      `SUMMARY:${esc(`${d.title}: ${d.contractTitle ?? d.supplierName}`)}`,
      `DESCRIPTION:${esc(`${d.supplierName}\n${d.detail}`)}`,
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

export async function buildXlsx(s: Services): Promise<Uint8Array> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Vertragsmanagement LLV';
  const today = s.today();
  const settings = await s.repo.settings();
  const ws = wb.addWorksheet('Verträge');
  ws.columns = [
    { header: 'ID', key: 'id', width: 10 },
    { header: 'Lieferant', key: 'supplier', width: 30 },
    { header: 'Bezeichnung', key: 'title', width: 38 },
    { header: 'Vertragsart', key: 'type', width: 22 },
    { header: 'Beginn', key: 'start', width: 12 },
    { header: 'Laufzeitende', key: 'end', width: 13 },
    { header: 'Kündigungsfrist (Mt.)', key: 'notice', width: 12 },
    { header: 'Verlängerung (Mt.)', key: 'renewal', width: 12 },
    { header: 'Nächster Kündigungstermin', key: 'noticeBy', width: 16 },
    { header: 'Wert p. a. (CHF)', key: 'value', width: 14 },
    { header: 'Recht', key: 'law', width: 8 },
    { header: 'Status', key: 'status', width: 12 },
    { header: 'Ablage', key: 'doc', width: 50 },
  ];
  for (const c of await s.repo.contracts()) {
    const t = computeTerm(terms(c), today, settings);
    ws.addRow({ id: c.id, supplier: c.supplierName, title: c.title, type: c.type, start: c.start, end: t.termEnd ?? c.end ?? 'unbefristet', notice: c.noticeMonths, renewal: c.renewalMonths, noticeBy: t.noticeBy ?? '', value: c.annualValue, law: c.law, status: c.status, doc: c.documentPath ?? '' });
  }
  ws.getRow(1).font = { bold: true };
  const wd = wb.addWorksheet('Fristen');
  wd.columns = [
    { header: 'Gruppe', key: 'group', width: 22 },
    { header: 'Art', key: 'kind', width: 18 },
    { header: 'Handeln bis', key: 'date', width: 13 },
    { header: 'Lieferant', key: 'supplier', width: 30 },
    { header: 'Vertrag', key: 'contract', width: 36 },
    { header: 'Hinweis', key: 'detail', width: 80 },
  ];
  for (const d of (await deadlinesView(s)).open) wd.addRow({ group: GROUP_LABEL[d.group], kind: d.title, date: d.date ?? '', supplier: d.supplierName, contract: d.contractTitle ?? '', detail: d.detail });
  wd.getRow(1).font = { bold: true };
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

/** Writes the current state to the Export folder for third-party systems. */
export async function exportToStore(s: Services, actor: Actor) {
  const stamp = s.today();
  const view = await deadlinesView(s);
  const contracts = await s.repo.contracts();
  const files: string[] = [];
  const put = async (name: string, bytes: Uint8Array) => {
    const p = `${FOLDERS.export}/${name}`;
    await s.store.write(p, bytes);
    files.push(p);
  };
  await put(`Vertraege_${stamp}.xlsx`, await buildXlsx(s));
  await put('vertraege.json', new TextEncoder().encode(JSON.stringify({ exportedAt: new Date().toISOString(), contracts }, null, 2)));
  await put('fristen.ics', new TextEncoder().encode(buildIcs(view.open)));
  await s.audit.record({ actor, action: 'export.erstellt', targetType: 'ordner', targetId: FOLDERS.export, summary: `Export in den Ordner «${FOLDERS.export}» (${contracts.length} Verträge)`, details: { files } });
  return files;
}

/* ---------------- folder poller ---------------- */

export const INBOX_ACTOR: Actor = { kind: 'system', oid: 'onedrive-eingang', name: 'OneDrive-Eingang' };

/** Picks up new files in "Eingang" and changed review standards. */
export async function pollStore(s: Services) {
  const changedStandards = await s.standards.sync();
  const started: string[] = [];
  for (const f of await s.store.list(FOLDERS.inbox)) {
    if (f.isFolder || !/\.(pdf|docx)$/i.test(f.name)) continue;
    const seen = await s.db.one<{ etag: string }>('select etag from store_seen where path=$1', [f.path]);
    if (seen && seen.etag === f.eTag) continue;
    await s.db.query('insert into store_seen (path, etag) values ($1,$2) on conflict (path) do update set etag=excluded.etag, seen_at=now()', [f.path, f.eTag ?? '']);
    const { bytes } = await s.store.read(f.path);
    const doc = await saveDocument(s, { bytes, path: f.path, kind: 'eingang', actor: INBOX_ACTOR, writeToStore: false });
    await s.audit.record({ actor: INBOX_ACTOR, action: 'dokument.eingang', targetType: 'dokument', targetId: doc.id, summary: `Neue Datei im Eingang: ${f.name}`, details: { path: f.path, size: f.size } });
    started.push(await startIngest(s, { documentId: doc.id, actor: INBOX_ACTOR }));
  }
  return { changedStandards, started };
}

/* ---------------- daily job ---------------- */

export async function runDaily(s: Services) {
  const view = await deadlinesView(s);
  let sent = 0;
  for (const d of view.open) {
    if (d.kind === 'verpasst') {
      const ok = await s.notify.send({
        to: { role: 'lieferantenmanagement' },
        subject: `Kündigungstermin verpasst: ${d.contractTitle}`,
        body: `${d.supplierName}: ${d.detail} Zusätzlich gebunden: ${chf(d.term?.missed?.lockedValue ?? 0)}.`,
        link: '/',
        dedupeKey: `${d.key}|verpasst`,
      });
      if (ok) {
        sent++;
        await s.events.publish('deadline.missed', d.contractId ?? d.supplierId, { key: d.key, supplier: d.supplierName, contract: d.contractTitle, missed: d.term?.missed });
      }
    } else if (d.kind === 'kuendigung' && d.reminderStep) {
      const ok = await s.notify.send({
        to: { role: 'lieferantenmanagement' },
        subject: `Kündigungstermin in ${d.daysLeft} Tagen: ${d.contractTitle}`,
        body: `${d.supplierName}: ${d.detail}`,
        link: '/',
        dedupeKey: `${d.key}|${d.reminderStep}`,
      });
      if (ok) {
        sent++;
        await s.events.publish('deadline.upcoming', d.contractId ?? d.supplierId, { key: d.key, actBy: d.date, noticeBy: d.term?.noticeBy, terminationDate: d.term?.terminationDate, reminderStep: d.reminderStep });
      }
    }
  }
  const poll = await pollStore(s);
  const dispatched = await s.events.dispatch();
  await s.audit.record({ actor: SYSTEM, action: 'job.taeglich', summary: `Täglicher Lauf: ${sent} Erinnerung(en), ${poll.started.length} neue Datei(en), ${dispatched} Ereignis(se) zugestellt`, details: { today: view.today, open: view.open.length, sent, poll, dispatched } });
  return { sent, poll, dispatched };
}
