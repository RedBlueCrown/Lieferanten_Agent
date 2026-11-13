/**
 * Review standards maintained by the legal check (Marco) as Word documents in
 * the shared folder "Prüfstandards". One document per contract type:
 *
 *   Überschrift 1   Prüfstandard <Vertragsart>
 *   Absatz          Version: 2.0 / Stand: 21.08.2026 / Verantwortlich: …
 *   Überschrift 2   1. <Kriterium>
 *   Tabelle         Grün … | Gelb … | Rot … | Musterformulierung …
 *
 * The app reads the documents whenever they change and shows what it
 * understood, including warnings for incomplete sections. Later the same
 * structure can come from a SharePoint list instead.
 */
import { AlignmentType, Document, HeadingLevel, Packer, Paragraph, ShadingType, Table, TableCell, TableRow, TextRun, WidthType } from 'docx';
import { parse, type HTMLElement } from 'node-html-parser';
import { CONTRACT_TYPES, criterionKey, type Criterion, type ReviewStandard } from '@vm/domain';
import type { Actor, AuditLog } from '../audit';
import type { Db } from '../db';
import { FOLDERS, type DocumentStore } from '../storage/types';
import { sha256 } from '../util';

export const SYNC_ACTOR: Actor = { kind: 'system', oid: 'onedrive-sync', name: 'OneDrive-Synchronisation' };

export function standardFileName(contractType: string): string {
  return `Prüfstandard ${contractType.replace(/\//g, '-')}.docx`;
}

export function contractTypeFromFileName(name: string): string | null {
  const m = /^Prüfstandard\s+(.+)\.docx$/i.exec(name);
  if (!m) return null;
  const raw = m[1].trim();
  return CONTRACT_TYPES.find((t) => t.replace(/\//g, '-').toLowerCase() === raw.toLowerCase()) ?? raw;
}

const ROW_STYLE = {
  gruen: { label: 'Grün – akzeptabel', fill: 'DCEFE0' },
  gelb: { label: 'Gelb – verhandeln', fill: 'FBF0C9' },
  rot: { label: 'Rot – nicht akzeptabel', fill: 'F7DADA' },
  muster: { label: 'Musterformulierung', fill: 'E8EEF6' },
} as const;

export async function buildStandardDocx(s: { contractType: string; version: string; date: string; author: string; criteria: Omit<Criterion, 'key'>[] }): Promise<Uint8Array> {
  const cell = (text: string, opts: { bold?: boolean; fill?: string; width: number }) =>
    new TableCell({
      width: { size: opts.width, type: WidthType.PERCENTAGE },
      shading: opts.fill ? { type: ShadingType.CLEAR, color: 'auto', fill: opts.fill } : undefined,
      margins: { top: 80, bottom: 80, left: 100, right: 100 },
      children: [new Paragraph({ children: [new TextRun({ text, bold: opts.bold, size: 20 })] })],
    });
  const children: (Paragraph | Table)[] = [
    new Paragraph({ text: `Prüfstandard ${s.contractType}`, heading: HeadingLevel.HEADING_1 }),
    new Paragraph({ children: [new TextRun({ text: `Version: ${s.version}`, size: 20 })] }),
    new Paragraph({ children: [new TextRun({ text: `Stand: ${s.date}`, size: 20 })] }),
    new Paragraph({ children: [new TextRun({ text: `Verantwortlich: ${s.author}`, size: 20 })] }),
    new Paragraph({
      spacing: { before: 200, after: 200 },
      children: [
        new TextRun({
          text: 'So bearbeiten Sie diesen Prüfstandard: Jede Überschrift der Ebene 2 ist ein Prüfkriterium. Die Tabelle darunter hat vier Zeilen: Grün (akzeptabel), Gelb (verhandeln), Rot (nicht akzeptabel) und die Musterformulierung der LLV. Für ein neues Kriterium kopieren Sie eine Überschrift samt Tabelle. Nach dem Speichern liest die Anwendung das Dokument automatisch neu ein; erhöhen Sie bei inhaltlichen Änderungen die Version.',
          italics: true,
          size: 18,
          color: '555555',
        }),
      ],
    }),
  ];
  s.criteria.forEach((c, i) => {
    children.push(new Paragraph({ text: `${i + 1}. ${c.title}`, heading: HeadingLevel.HEADING_2, spacing: { before: 280 } }));
    children.push(
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: (['gruen', 'gelb', 'rot', 'muster'] as const).map(
          (k) => new TableRow({ children: [cell(ROW_STYLE[k].label, { bold: true, fill: ROW_STYLE[k].fill, width: 24 }), cell(c[k], { width: 76 })] }),
        ),
      }),
    );
  });
  children.push(new Paragraph({ alignment: AlignmentType.RIGHT, spacing: { before: 400 }, children: [new TextRun({ text: 'Liechtensteinische Landesverwaltung, Rechtsdienst', size: 16, color: '888888' })] }));
  const doc = new Document({ creator: s.author, title: `Prüfstandard ${s.contractType}`, sections: [{ children }] });
  return new Uint8Array(await Packer.toBuffer(doc));
}

function text(el: HTMLElement): string {
  return el.text.replace(/\s+/g, ' ').trim();
}

function rowKind(label: string): keyof typeof ROW_STYLE | null {
  const l = label.toLowerCase();
  if (l.startsWith('grün') || l.startsWith('gruen') || l === 'akzeptabel') return 'gruen';
  if (l.startsWith('gelb') || l.startsWith('verhandel')) return 'gelb';
  if (l.startsWith('rot') || l.startsWith('nicht akzeptabel')) return 'rot';
  if (l.startsWith('muster')) return 'muster';
  return null;
}

export async function parseStandardDocx(bytes: Uint8Array, source: ReviewStandard['source'], fallbackType: string): Promise<ReviewStandard> {
  const mammoth = await import('mammoth');
  const { value: html } = await mammoth.convertToHtml({ buffer: Buffer.from(bytes) });
  const root = parse(html);
  const warnings: string[] = [];
  let contractType = fallbackType;
  let version = '';
  let date = '';
  let author = '';
  const criteria: Criterion[] = [];
  let cur: (Partial<Criterion> & { title: string }) | null = null;
  const close = () => {
    if (!cur) return;
    const missing = (['gruen', 'gelb', 'rot', 'muster'] as const).filter((k) => !cur![k]);
    if (missing.length) warnings.push(`«${cur.title}»: ${missing.map((m) => ({ gruen: 'Grün', gelb: 'Gelb', rot: 'Rot', muster: 'Musterformulierung' })[m]).join(', ')} fehlt.`);
    criteria.push({ key: criterionKey(cur.title), title: cur.title, gruen: cur.gruen ?? '', gelb: cur.gelb ?? '', rot: cur.rot ?? '', muster: cur.muster ?? '' });
    cur = null;
  };
  for (const el of root.childNodes as HTMLElement[]) {
    const tag = el.tagName?.toLowerCase();
    if (!tag) continue;
    const t = text(el);
    if (tag === 'h1') {
      const m = /Prüfstandard\s+(.+)/i.exec(t);
      if (m) contractType = m[1].trim();
    } else if (tag === 'h2' || tag === 'h3') {
      close();
      cur = { title: t.replace(/^\d+(\.\d+)*\.?\s*/, '').trim() };
    } else if (tag === 'p') {
      let m: RegExpExecArray | null;
      if ((m = /^Version:?\s*(.+)$/i.exec(t))) version = m[1].trim();
      else if ((m = /^Stand:?\s*(.+)$/i.exec(t))) date = m[1].trim();
      else if ((m = /^Verantwortlich:?\s*(.+)$/i.exec(t))) author = m[1].trim();
      else if (cur && (m = /^(Grün|Gruen|Gelb|Rot|Musterformulierung)\s*[:–-]\s*(.+)$/i.exec(t))) {
        const k = rowKind(m[1]);
        if (k) cur[k] = m[2].trim();
      }
    } else if (tag === 'table' && cur) {
      for (const tr of el.querySelectorAll('tr')) {
        const cells = tr.querySelectorAll('td, th');
        if (cells.length < 2) continue;
        const k = rowKind(text(cells[0]));
        if (k) cur[k] = text(cells[1]);
      }
    }
  }
  close();
  if (!criteria.length) warnings.push('Keine Kriterien gefunden. Erwartet werden Überschriften der Ebene 2 mit einer Tabelle darunter.');
  if (!version) warnings.push('Keine Versionsangabe («Version: …») gefunden.');
  const dup = criteria.map((c) => c.key).filter((k, i, a) => a.indexOf(k) !== i);
  if (dup.length) warnings.push(`Doppelte Kriterien: ${[...new Set(dup)].join(', ')}.`);
  return {
    contractType,
    version: version || source.lastModified?.slice(0, 10) || '1',
    updatedAt: date || source.lastModified?.slice(0, 10) || '',
    author,
    source,
    criteria,
    warnings,
  };
}

export class StandardsService {
  constructor(private readonly db: Db, private readonly store: DocumentStore, private readonly audit: AuditLog) {}

  /** Reads all changed Word documents. Returns the contract types that changed. */
  async sync(actor: Actor = SYNC_ACTOR): Promise<string[]> {
    const files = (await this.store.list(FOLDERS.standards)).filter((f) => !f.isFolder && f.name.toLowerCase().endsWith('.docx'));
    const changed: string[] = [];
    for (const f of files) {
      const type = contractTypeFromFileName(f.name);
      if (!type) continue;
      const existing = await this.db.one<{ parsed: ReviewStandard }>('select parsed from standards where contract_type=$1', [type]);
      if (existing && existing.parsed.source.eTag === f.eTag) continue;
      const { bytes, item } = await this.store.read(f.path);
      const parsed = await parseStandardDocx(bytes, { path: item.path, webUrl: item.webUrl, eTag: item.eTag, lastModified: item.lastModified }, type);
      const hash = sha256(JSON.stringify(parsed.criteria));
      const before = existing?.parsed;
      if (before && sha256(JSON.stringify(before.criteria)) === hash && before.version === parsed.version) {
        // Saved without content changes: remember the new eTag only.
        await this.db.query('update standards set parsed=$2 where contract_type=$1', [type, JSON.stringify(parsed)]);
        continue;
      }
      await this.db.query(
        `insert into standards (contract_type, version, parsed, updated_at) values ($1,$2,$3,now())
         on conflict (contract_type) do update set version=excluded.version, parsed=excluded.parsed, updated_at=now()`,
        [type, parsed.version, JSON.stringify(parsed)],
      );
      const titles = (s?: ReviewStandard) => new Map((s?.criteria ?? []).map((c) => [c.key, c]));
      const a = titles(before);
      const b = titles(parsed);
      const added = [...b.keys()].filter((k) => !a.has(k)).map((k) => b.get(k)!.title);
      const removed = [...a.keys()].filter((k) => !b.has(k)).map((k) => a.get(k)!.title);
      const modified = [...b.keys()].filter((k) => a.has(k) && JSON.stringify(a.get(k)) !== JSON.stringify(b.get(k))).map((k) => b.get(k)!.title);
      await this.audit.record({
        actor,
        action: before ? 'pruefstandard.aktualisiert' : 'pruefstandard.eingelesen',
        targetType: 'pruefstandard',
        targetId: type,
        summary: before ? `Prüfstandard ${type} neu eingelesen (Version ${parsed.version})` : `Prüfstandard ${type} eingelesen (Version ${parsed.version})`,
        details: { file: f.path, version: parsed.version, previousVersion: before?.version ?? null, criteria: parsed.criteria.length, added, removed, modified, warnings: parsed.warnings, contentHash: hash },
      });
      changed.push(type);
    }
    return changed;
  }

  async get(contractType: string): Promise<ReviewStandard | undefined> {
    return (await this.db.one<{ parsed: ReviewStandard }>('select parsed from standards where contract_type=$1', [contractType]))?.parsed;
  }

  async list(): Promise<ReviewStandard[]> {
    return (await this.db.query<{ parsed: ReviewStandard }>('select parsed from standards order by contract_type')).map((r) => r.parsed);
  }
}
