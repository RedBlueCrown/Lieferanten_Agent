/**
 * Agents on Azure OpenAI (managed identity, no keys). The model answers in
 * NDJSON — one JSON object per line — so every field or verdict reaches the
 * browser the moment it is written. Each object is validated with zod and
 * every value must quote the contract verbatim; values without a quote that
 * can be found in the document are dropped ("ohne Zitat kein Wert").
 */
import { z } from 'zod';
import type { ExtractedField, Finding } from '@vm/domain';
import { config } from '../config';
import { matchSupplier } from './mock';
import { allLines } from './reader';
import type { AiProvider, DraftParams, Emit, ExtractInput, ExtractOutput, ReviewInput } from './types';

const FieldLine = z.object({
  field: z.enum(['lieferant', 'typ', 'titel', 'beginn', 'ende', 'kuendigungsfrist', 'kuendigungsmodus', 'verlaengerung', 'wert', 'recht', 'gerichtsstand', 'kontakt', 'anwendung', 'sla']),
  value: z.union([z.string(), z.number()]).transform(String),
  quote: z.string().min(2),
  page: z.number().int().min(0),
  line: z.number().int().min(0),
  confidence: z.number().min(0).max(1),
});
const NoteLine = z.object({ note: z.string().min(1).max(200) });
const VerdictLine = z.object({
  verdict: z.object({
    criterionKey: z.string(),
    clauseIndex: z.number().int().nullable(),
    ampel: z.enum(['gruen', 'gelb', 'rot']),
    reason: z.string().min(3),
    proposal: z.string().default(''),
    quote: z.string().nullable().default(null),
  }),
});

const LABELS: Record<string, string> = {
  lieferant: 'Lieferant', typ: 'Vertragsart', titel: 'Bezeichnung', beginn: 'Beginn', ende: 'Ende', kuendigungsfrist: 'Kündigungsfrist (Monate)',
  kuendigungsmodus: 'Kündigung auf', verlaengerung: 'Automatische Verlängerung (Monate)', wert: 'Wert pro Jahr (CHF)', recht: 'Anwendbares Recht',
  gerichtsstand: 'Gerichtsstand', kontakt: 'Ansprechperson Lieferant', anwendung: 'Anwendung', sla: 'Service Level',
};

const EXTRACT_SYSTEM = `Du bist der Erfassungs-Agent des Vertragsmanagements der Liechtensteinischen Landesverwaltung (LLV).
Du liest einen Vertrag, dessen Zeilen mit [Seite:Zeile] nummeriert sind, und lieferst die Vertragsdaten.

Antworte ausschliesslich in NDJSON: genau ein JSON-Objekt pro Zeile, kein Markdown, kein Text davor oder danach.
Erlaubte Objekte:
{"note":"<was du gerade tust, höchstens 12 Wörter, Deutsch>"}
{"field":"<schlüssel>","value":"<wert>","quote":"<wörtliches Zitat aus genau dieser Zeile>","page":<seite>,"line":<zeile>,"confidence":<0..1>}

Schlüssel und Format:
lieferant (Firmenname des Lieferanten, nicht die LLV) · typ (eine von: Rahmenvertrag, Einzelvertrag, AVV, SaaS-Vertrag, Wartung/Support (SLA), Beratung/Dienstleistung, NDA) · titel (kurze Bezeichnung, max. 60 Zeichen) · beginn und ende (YYYY-MM-DD) · kuendigungsfrist (ganze Monate) · kuendigungsmodus (laufzeitende, monatsende, quartalsende oder jahresende) · verlaengerung (Monate der automatischen Verlängerung, 0 wenn keine) · wert (CHF pro Jahr, nur Zahl) · recht (FL, CH, AT, DE oder anderes) · gerichtsstand (Ort) · kontakt (Name der Ansprechperson des Lieferanten) · anwendung (Name der Anwendung) · sla (Verfügbarkeit und Reaktionszeiten kurz).

Regeln: Schreibe vor jeder Feldgruppe eine kurze note. Jedes field braucht ein wörtliches quote aus der angegebenen Zeile. Lass Felder weg, die nicht im Text stehen. Erfinde nichts.`;

const REVIEW_SYSTEM = `Du bist der Prüf-Agent des Rechtsdienstes der Liechtensteinischen Landesverwaltung (LLV).
Du prüfst Vertragsklauseln gegen den Prüfstandard des Rechtsdienstes. Für jedes Kriterium beschreibt der Standard, was akzeptabel (gruen), verhandelbar (gelb) und nicht akzeptabel (rot) ist, und gibt eine Musterformulierung vor.

Antworte ausschliesslich in NDJSON, ein JSON-Objekt pro Zeile:
{"note":"<was du gerade prüfst, höchstens 12 Wörter>"}
{"verdict":{"criterionKey":"<key>","clauseIndex":<index der Klausel oder null wenn das Thema fehlt>,"ampel":"gruen|gelb|rot","reason":"<Begründung, 1-2 Sätze, Deutsch>","proposal":"<Gegenvorschlag; bei gruen leer>","quote":"<wörtliches Zitat aus der Klausel oder null>"}}

Regeln: Genau ein verdict pro Kriterium. Fehlt ein Thema im Vertrag, ist clauseIndex null und ampel in der Regel rot. Stütze jede Bewertung auf die Beschreibung im Standard. Der Gegenvorschlag basiert auf der Musterformulierung.`;

function norm(s: string) {
  return s.toLowerCase().replace(/\s+/g, ' ').replace(/[«»"„“]/g, '').trim();
}

export class AzureAiProvider implements AiProvider {
  readonly name = 'azure' as const;
  readonly model = config.ai.openaiDeployment;
  readonly promptVersion = 'azure-1.0';
  private client?: import('openai').AzureOpenAI;

  private async getClient() {
    if (this.client) return this.client;
    const { AzureOpenAI } = await import('openai');
    const { DefaultAzureCredential, getBearerTokenProvider } = await import('@azure/identity');
    this.client = new AzureOpenAI({
      endpoint: config.ai.openaiEndpoint,
      apiVersion: config.ai.openaiApiVersion,
      deployment: config.ai.openaiDeployment,
      azureADTokenProvider: getBearerTokenProvider(new DefaultAzureCredential(), 'https://cognitiveservices.azure.com/.default'),
    });
    return this.client;
  }

  private async *ndjson(system: string, user: string, emit: Emit): AsyncGenerator<unknown> {
    const client = await this.getClient();
    const stream = await client.chat.completions.create({
      model: config.ai.openaiDeployment,
      stream: true,
      temperature: 0,
      stream_options: { include_usage: true },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    });
    let buf = '';
    for await (const chunk of stream) {
      if (chunk.usage) emit({ t: 'metric', tokensIn: chunk.usage.prompt_tokens, tokensOut: chunk.usage.completion_tokens, model: this.model });
      buf += chunk.choices[0]?.delta?.content ?? '';
      let i: number;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (line.startsWith('{')) {
          try {
            yield JSON.parse(line);
          } catch {
            /* incomplete or invalid line: ignored */
          }
        }
      }
    }
    if (buf.trim().startsWith('{')) {
      try {
        yield JSON.parse(buf.trim());
      } catch {
        /* ignored */
      }
    }
  }

  async extract(input: ExtractInput, emit: Emit): Promise<ExtractOutput> {
    const lines = allLines(input.pages);
    emit({ t: 'metric', pages: input.pages.length, lines: lines.length, model: this.model });
    const numbered = lines.map((l) => `[${l.page}:${l.line}] ${l.text}`).join('\n');
    const fields: ExtractedField[] = [];
    for await (const obj of this.ndjson(EXTRACT_SYSTEM, `Datei: ${input.fileName}\n\n${numbered}`, emit)) {
      const note = NoteLine.safeParse(obj);
      if (note.success) {
        emit({ t: 'note', text: note.data.note });
        continue;
      }
      const f = FieldLine.safeParse(obj);
      if (!f.success || fields.some((x) => x.key === f.data.field)) continue;
      // Verify the citation against the document.
      let src = lines.find((l) => l.page === f.data.page && l.line === f.data.line && norm(l.text).includes(norm(f.data.quote)));
      src ??= lines.find((l) => norm(l.text).includes(norm(f.data.quote)));
      if (!src) continue;
      const field: ExtractedField = { key: f.data.field, label: LABELS[f.data.field], value: f.data.value, quote: f.data.quote, page: src.page, line: src.line, confidence: f.data.confidence };
      fields.push(field);
      emit({ t: 'scan', page: src.page, line: src.line });
      emit({ t: 'field', ...field });
    }
    emit({ t: 'note', text: 'Gleiche den Lieferanten mit dem Lieferantenstamm ab' });
    const supplier = matchSupplier(fields.find((f) => f.key === 'lieferant')?.value ?? '', input.suppliers);
    emit({ t: 'match', supplierId: supplier.id, supplierName: supplier.name, score: supplier.score });
    return { fields, supplier };
  }

  async review(input: ReviewInput, emit: Emit): Promise<{ findings: Finding[] }> {
    const { standard, clauses } = input;
    const user = [
      `Vertragsart: ${input.contractType}. Prüfstandard Version ${standard.version}.`,
      '',
      'KRITERIEN:',
      ...standard.criteria.map((c) => JSON.stringify({ key: c.key, titel: c.title, gruen: c.gruen, gelb: c.gelb, rot: c.rot, muster: c.muster })),
      '',
      'KLAUSELN:',
      ...clauses.map((c) => JSON.stringify({ index: c.index, ueberschrift: c.heading, text: c.text })),
    ].join('\n');
    const findings: Finding[] = [];
    const seenClause = new Set<number>();
    for await (const obj of this.ndjson(REVIEW_SYSTEM, user, emit)) {
      const note = NoteLine.safeParse(obj);
      if (note.success) {
        emit({ t: 'note', text: note.data.note });
        continue;
      }
      const v = VerdictLine.safeParse(obj);
      if (!v.success) continue;
      const d = v.data.verdict;
      const crit = standard.criteria.find((c) => c.key === d.criterionKey);
      if (!crit || findings.some((f) => f.criterionKey === crit.key)) continue;
      const clause = d.clauseIndex === null ? undefined : clauses.find((c) => c.index === d.clauseIndex);
      if (clause && !seenClause.has(clause.index)) {
        seenClause.add(clause.index);
        emit({ t: 'clause', index: clause.index, heading: clause.heading, page: clause.page, line: clause.line });
        emit({ t: 'scan', page: clause.page, line: clause.line });
      }
      const f: Finding = {
        criterionKey: crit.key,
        criterionTitle: crit.title,
        location: clause?.heading ?? null,
        quote: clause ? (d.quote && norm(clause.text).includes(norm(d.quote)) ? d.quote : clause.text.slice(0, 280)) : null,
        ampel: d.ampel,
        reason: d.reason,
        proposal: d.ampel === 'gruen' ? '' : d.proposal || crit.muster,
        missing: !clause,
      };
      findings.push(f);
      emit({ t: 'verdict', clauseIndex: clause?.index ?? null, criterionKey: f.criterionKey, criterionTitle: f.criterionTitle, ampel: f.ampel, reason: f.reason, proposal: f.proposal, quote: f.quote, missing: f.missing });
    }
    for (const crit of standard.criteria.filter((c) => !findings.some((f) => f.criterionKey === c.key))) {
      const f: Finding = { criterionKey: crit.key, criterionTitle: crit.title, location: null, quote: null, ampel: 'gelb', reason: 'Das Modell hat dieses Kriterium nicht bewertet. Bitte manuell beurteilen.', proposal: crit.muster, missing: false };
      findings.push(f);
      emit({ t: 'verdict', clauseIndex: null, criterionKey: f.criterionKey, criterionTitle: f.criterionTitle, ampel: f.ampel, reason: f.reason, proposal: f.proposal, quote: null, missing: false });
    }
    return { findings };
  }

  async formulateSubject(p: DraftParams, emit: Emit): Promise<string> {
    emit({ t: 'note', text: 'Formuliere den Vertragsgegenstand aus Ihrer Beschreibung' });
    const client = await this.getClient();
    const r = await client.chat.completions.create({
      model: config.ai.openaiDeployment,
      temperature: 0.2,
      messages: [
        { role: 'system', content: 'Du formulierst die Klausel «Vertragsgegenstand» für einen Vertrag der Liechtensteinischen Landesverwaltung. Sachlich, 2 bis 3 Sätze, liechtensteinische Rechtschreibung (ss statt ß). Nur der Klauseltext, ohne Überschrift.' },
        { role: 'user', content: `Vertragsart: ${p.contractType}\nLieferant: ${p.supplierName}\nBezeichnung: ${p.title}\nBeschreibung der Projektleitung: ${p.subject}` },
      ],
    });
    if (r.usage) emit({ t: 'metric', tokensIn: r.usage.prompt_tokens, tokensOut: r.usage.completion_tokens, model: this.model });
    return (r.choices[0]?.message?.content ?? '').trim();
  }
}
