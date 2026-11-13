/**
 * Demo agents without a language model. They read the real text of the
 * document with transparent rules (patterns for dates, periods, amounts and
 * law) and compare clauses with the legal check's own wording. Results are
 * labelled "Regelbasiert (Demo)" in the UI. The pacing is slowed down a little
 * so the agent stage can be followed; the Azure provider runs at full speed.
 */
import { criterionKey, type Ampel, type ExtractedField, type Finding } from '@vm/domain';
import { sleep as rawSleep } from '../util';

// The demo agents pause between steps so the agent stage can be followed; tests skip that.
const sleep = (ms: number) => (process.env.VITEST ? Promise.resolve() : rawSleep(ms));
import { allLines } from './reader';
import type { AiProvider, Clause, DraftParams, Emit, ExtractInput, ExtractOutput, ReviewInput } from './types';

const MONTHS: Record<string, number> = {
  januar: 1, jänner: 1, februar: 2, märz: 3, maerz: 3, april: 4, mai: 5, juni: 6, juli: 7, august: 8, september: 9, oktober: 10, november: 11, dezember: 12,
};

function germanDate(s: string): string | null {
  const m = /(\d{1,2})\.\s*([A-Za-zäöüÄÖÜ]+)\s+(\d{4})/.exec(s);
  if (m && MONTHS[m[2].toLowerCase()]) return `${m[3]}-${String(MONTHS[m[2].toLowerCase()]).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  const n = /(\d{1,2})\.(\d{1,2})\.(\d{4})/.exec(s);
  if (n) return `${n[3]}-${n[2].padStart(2, '0')}-${n[1].padStart(2, '0')}`;
  return null;
}

const WORD_NUM: Record<string, number> = { ein: 1, einem: 1, eines: 1, zwei: 2, drei: 3, vier: 4, sechs: 6, zwölf: 12 };
function num(s: string): number {
  return WORD_NUM[s.toLowerCase()] ?? Number(s);
}

function money(s: string): number | null {
  const m = /CHF\s*([\d'’.,]+)/.exec(s);
  if (!m) return null;
  return Number(m[1].replace(/[’'.]/g, '').replace(/,\d{2}$/, '').replace(/[–-]+$/, ''));
}

interface Hit {
  key: string;
  value: string;
  quote: string;
  page: number;
  line: number;
  confidence: number;
  note: string;
}

const LABELS: Record<string, string> = {
  lieferant: 'Lieferant', typ: 'Vertragsart', titel: 'Bezeichnung', beginn: 'Beginn', ende: 'Ende', kuendigungsfrist: 'Kündigungsfrist (Monate)',
  kuendigungsmodus: 'Kündigung auf', verlaengerung: 'Automatische Verlängerung (Monate)', wert: 'Wert pro Jahr (CHF)', recht: 'Anwendbares Recht',
  gerichtsstand: 'Gerichtsstand', kontakt: 'Ansprechperson Lieferant', anwendung: 'Anwendung', sla: 'Service Level',
};

function findFields(lines: { page: number; line: number; text: string }[]): Hit[] {
  const hits: Hit[] = [];
  const add = (h: Hit) => {
    if (!hits.some((x) => x.key === h.key)) hits.push(h);
  };
  const full = lines.map((l) => l.text).join('\n');

  // Contract type from the title and the whole text.
  const typeRules: [RegExp, string][] = [
    [/auftragsverarbeitung/i, 'AVV'],
    [/geheimhaltungs|vertraulichkeitsvereinbarung|\bNDA\b/i, 'NDA'],
    [/rahmenvertrag/i, 'Rahmenvertrag'],
    [/wartung|support/i, 'Wartung/Support (SLA)'],
    [/saas|software as a service|hosting|cloud/i, 'SaaS-Vertrag'],
    [/beratung|dienstleistung|consulting/i, 'Beratung/Dienstleistung'],
  ];
  for (const l of lines.slice(0, 6)) {
    const t = typeRules.find(([re]) => re.test(l.text));
    if (t) {
      add({ key: 'typ', value: t[1], quote: l.text.slice(0, 80), page: l.page, line: l.line, confidence: 0.95, note: 'Bestimme die Vertragsart aus dem Titel' });
      break;
    }
  }
  if (!hits.some((h) => h.key === 'typ')) {
    const t = typeRules.find(([re]) => re.test(full));
    add({ key: 'typ', value: t?.[1] ?? 'Einzelvertrag', quote: lines[0]?.text.slice(0, 80) ?? '', page: 0, line: 0, confidence: t ? 0.78 : 0.55, note: 'Bestimme die Vertragsart aus dem Inhalt' });
  }

  lines.forEach((l, i) => {
    // Phrases often wrap onto the next line: match on this line plus the
    // next one, but only accept matches that start on this line.
    const next = lines[i + 1] && lines[i + 1].page === l.page ? lines[i + 1].text : '';
    const t = next ? `${l.text} ${next}` : l.text;
    const own = l.text.length;
    const exec = (re: RegExp) => {
      const r = re.exec(t);
      return r && r.index < own ? r : null;
    };
    let m: RegExpExecArray | null;
    if ((m = exec(/(?:und|sowie)\s+(?:der|die|dem)\s+([A-ZÄÖÜ][\w&.\- ]+?\s(?:AG|GmbH|SA|Ltd\.?|Anstalt|Est\.|KG))/))) {
      add({ key: 'lieferant', value: m[1].trim(), quote: m[0].replace(/^(und|sowie)\s+(der|die|dem)\s+/, ''), page: l.page, line: l.line, confidence: 0.97, note: 'Suche die Vertragsparteien' });
    }
    if ((m = exec(/(?:beginnt|tritt)\s+(?:am|per|mit)\s+(\d{1,2}\.\s*[A-Za-zäöü]+\s+\d{4}|\d{1,2}\.\d{1,2}\.\d{4})/)) && germanDate(m[1])) {
      add({ key: 'beginn', value: germanDate(m[1])!, quote: m[0], page: l.page, line: l.line, confidence: 0.98, note: 'Lese den Vertragsbeginn' });
    }
    if ((m = exec(/(?:gilt|läuft|dauert)\s+bis\s+(?:zum\s+)?(\d{1,2}\.\s*[A-Za-zäöü]+\s+\d{4}|\d{1,2}\.\d{1,2}\.\d{4})/)) && germanDate(m[1])) {
      add({ key: 'ende', value: germanDate(m[1])!, quote: m[0], page: l.page, line: l.line, confidence: 0.98, note: 'Lese das Laufzeitende' });
    }
    if ((m = exec(/verlängert sich[^.]*?um\s+(?:jeweils\s+)?(?:weitere\s+)?(\d+|ein|zwei|drei)\s+(Monate|Jahre?)/i))) {
      const n = num(m[1]) * (m[2].toLowerCase().startsWith('jahr') ? 12 : 1);
      add({ key: 'verlaengerung', value: String(n), quote: m[0], page: l.page, line: l.line, confidence: 0.94, note: 'Prüfe die automatische Verlängerung' });
    }
    if ((m = exec(/Frist von\s+(\d+|einem|drei|sechs|zwölf)\s+(Monat(?:en)?|Tagen)/i))) {
      const months = m[2].toLowerCase().startsWith('tag') ? Math.max(1, Math.round(num(m[1]) / 30)) : num(m[1]);
      add({ key: 'kuendigungsfrist', value: String(months), quote: m[0], page: l.page, line: l.line, confidence: 0.96, note: 'Lese die Kündigungsfrist' });
      const mode = /ende eines (kalender)?monats/i.test(t) ? 'monatsende' : /quartal/i.test(t) ? 'quartalsende' : /(kalender)?jahres/i.test(t) ? 'jahresende' : 'laufzeitende';
      add({ key: 'kuendigungsmodus', value: mode, quote: m[0], page: l.page, line: l.line, confidence: /ende/i.test(t) ? 0.9 : 0.7, note: 'Bestimme, auf welchen Termin gekündigt werden kann' });
    }
    if (/CHF/.test(l.text) && !hits.some((h) => h.key === 'wert')) {
      const v = money(l.text);
      if (v) {
        const monthly = /pro monat|monatlich/i.test(l.text);
        add({ key: 'wert', value: String(monthly ? v * 12 : v), quote: (/CHF[^,;.]*/.exec(l.text) ?? [l.text])[0].slice(0, 80), page: l.page, line: l.line, confidence: /jahr|jährlich/i.test(l.text) ? 0.97 : 0.8, note: 'Ermittle die Vergütung' });
      }
    }
    if ((m = exec(/(liechtensteinische|schweizerische|schweizer|österreichische|deutsche)s?\s+Recht/i))) {
      const map: Record<string, string> = { liechtensteinische: 'FL', schweizerische: 'CH', schweizer: 'CH', österreichische: 'AT', deutsche: 'DE' };
      add({ key: 'recht', value: map[m[1].toLowerCase()] ?? m[1], quote: m[0], page: l.page, line: l.line, confidence: 0.99, note: 'Bestimme das anwendbare Recht' });
    }
    if ((m = exec(/Gerichtsstand\s+(?:ist\s+)?([A-ZÄÖÜ][a-zäöü]+)/))) {
      add({ key: 'gerichtsstand', value: m[1], quote: m[0], page: l.page, line: l.line, confidence: 0.99, note: 'Lese den Gerichtsstand' });
    }
    if ((m = exec(/Ansprechpartner(?:in)?(?:\s+Lieferant)?:\s*([A-ZÄÖÜ][a-zäöü]+\s+[A-ZÄÖÜ][a-zäöü]+)/))) {
      add({ key: 'kontakt', value: m[1], quote: m[0], page: l.page, line: l.line, confidence: 0.97, note: 'Suche die Ansprechperson' });
    }
    if ((m = exec(/(?:Applikation|Anwendung|Software)\s+«([^»]+)»/))) {
      add({ key: 'anwendung', value: m[1], quote: m[0], page: l.page, line: l.line, confidence: 0.9, note: 'Erkenne die betroffene Anwendung' });
    }
    if ((m = exec(/Verfügbarkeit\s+(?:von\s+)?(\d{2}(?:[.,]\d+)?)\s*%[^;.]*/))) {
      const reakt = /Reaktion innert\s+(\d+)\s+Stunden?/.exec(t);
      add({ key: 'sla', value: `${m[1].replace(',', '.')} %${reakt ? ` / P1 Reaktion ${reakt[1]} h` : ''}`, quote: m[0].slice(0, 90), page: l.page, line: l.line, confidence: 0.91, note: 'Lese die Service Levels' });
    }
  });

  const typ = hits.find((h) => h.key === 'typ')?.value ?? 'Vertrag';
  const app = hits.find((h) => h.key === 'anwendung');
  if (app) {
    const prefix = typ.startsWith('Wartung') ? 'Wartung' : typ === 'SaaS-Vertrag' ? 'Betrieb' : typ;
    add({ key: 'titel', value: `${prefix} ${app.value}`, quote: app.quote, page: app.page, line: app.line, confidence: 0.86, note: 'Leite eine Bezeichnung ab' });
  } else if (lines[0]) {
    add({ key: 'titel', value: lines[0].text.replace(/\s+Nr\..*$/, '').slice(0, 70), quote: lines[0].text.slice(0, 80), page: lines[0].page, line: lines[0].line, confidence: 0.7, note: 'Leite eine Bezeichnung ab' });
  }
  return hits;
}

function similarity(a: string, b: string): number {
  const tok = (s: string) => new Set(s.toLowerCase().replace(/[^a-zäöü0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 3));
  const A = tok(a);
  const B = tok(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  A.forEach((w) => B.has(w) && inter++);
  return inter / Math.sqrt(A.size * B.size);
}

export function normalizeName(s: string): string {
  return s.toLowerCase().replace(/\b(ag|gmbh|sa|ltd|anstalt|est)\b/g, '').replace(/[^a-zäöü0-9]/g, '');
}

export function matchSupplier(name: string, suppliers: { id: string; name: string }[]) {
  const n = normalizeName(name);
  let best = { id: null as string | null, name, score: 0 };
  for (const s of suppliers) {
    const m = normalizeName(s.name);
    const score = m === n ? 1 : m.includes(n) || n.includes(m) ? 0.9 : similarity(s.name, name);
    if (score > best.score) best = { id: s.id, name: s.name, score };
  }
  return best.score >= 0.6 ? best : { id: null, name, score: best.score };
}

const KEYWORDS: Record<string, string[]> = {
  'rangfolge-der-vertragsbestandteile': ['geltung', 'rangfolge', 'geschäftsbedingungen', 'bestandteile'],
  abrufverfahren: ['abruf', 'bestellung', 'mindestabnahme'],
  'laufzeit-und-verlaengerung': ['laufzeit', 'verlänger', 'abgeschlossen'],
  kuendigung: ['kündig', 'beendigung', 'beendet'],
  'verguetung-und-preisanpassung': ['preise', 'vergütung', 'gebühr', 'pauschal'],
  haftung: ['haftung'],
  'datenschutz-und-datenstandort': ['datenschutz', 'rechenzentr', 'personendaten', 'gespeichert'],
  'geheimhaltung-und-amtsgeheimnis': ['vertraulich', 'geheim'],
  'nutzungs-und-schutzrechte': ['urheber', 'nutzungsrecht', 'schutzrecht', 'eigentum'],
  verfuegbarkeit: ['verfügbarkeit'],
  'reaktions-und-loesungszeiten': ['reaktion', 'priorität', 'lösung'],
  'service-credits': ['gutschrift', 'credit', 'pönale'],
  'exit-und-datenrueckgabe': ['rückgabe', 'download', 'herausgabe', 'migration'],
  'beizug-von-subunternehmern': ['subunternehm', 'unterauftrag'],
  'technische-und-organisatorische-massnahmen': ['technische und organisatorische', 'iso 27001', 'tom'],
  'meldung-von-datenschutzverletzungen': ['meldung', 'verletzung'],
  'kontroll-und-auditrechte': ['audit', 'kontrolle', 'überprüfen'],
  'stundensaetze-und-spesen': ['honorar', 'stundensatz', '/h', 'spesen'],
  schluesselpersonen: ['projektteam', 'schlüsselperson', 'wechsel'],
  'abnahme-und-gewaehrleistung': ['abnahme', 'abgenommen', 'gewährleist'],
  konventionalstrafe: ['konventionalstrafe'],
  'anwendbares-recht-und-gerichtsstand': ['gerichtsstand', 'anwendbar'],
};

function findClause(key: string, title: string, clauses: Clause[]): Clause | null {
  const words = KEYWORDS[key] ?? title.toLowerCase().split(/\W+/).filter((w) => w.length > 4);
  let best: { c: Clause; s: number } | null = null;
  for (const c of clauses) {
    const h = c.heading.toLowerCase();
    const t = c.text.toLowerCase();
    const s = words.reduce((acc, w) => acc + (h.includes(w) ? 3 : 0) + (t.includes(w) ? 1 : 0), 0);
    if (s > 0 && (!best || s > best.s)) best = { c, s };
  }
  return best?.c ?? null;
}

/** Rules for the criteria with clear numbers; null = fall back to wording comparison. */
function rule(key: string, text: string): { ampel: Ampel; reason: string } | null {
  const t = text.toLowerCase();
  let m: RegExpExecArray | null;
  switch (key) {
    case 'anwendbares-recht-und-gerichtsstand': {
      const fl = /liechtenstein/.test(t);
      const vaduz = /vaduz/.test(t);
      if (fl && vaduz) return { ampel: 'gruen', reason: 'Liechtensteinisches Recht und Gerichtsstand Vaduz.' };
      if (/schweiz/.test(t) && vaduz) return { ampel: 'gelb', reason: 'Schweizer Recht mit Gerichtsstand Vaduz ist verhandelbar.' };
      return { ampel: 'rot', reason: 'Ausländisches Recht oder Gerichtsstand ausserhalb Liechtensteins.' };
    }
    case 'laufzeit-und-verlaengerung':
      if ((m = /um (?:jeweils )?(?:weitere )?(\d+) monate/.exec(t))) {
        const n = Number(m[1]);
        if (n <= 12) return { ampel: 'gruen', reason: `Verlängerung um ${n} Monate liegt im Standard (höchstens 12).` };
        if (n <= 24) return { ampel: 'gelb', reason: `Verlängerung um ${n} Monate ist verhandelbar (13 bis 24).` };
        return { ampel: 'rot', reason: `Automatische Verlängerung um ${n} Monate übersteigt die Obergrenze von 24 Monaten.` };
      }
      return null;
    case 'kuendigung':
      if (/kalenderjahr|jahresende|ende eines jahres/.test(t)) return { ampel: 'gelb', reason: 'Kündigung nur auf Jahresende möglich.' };
      if ((m = /frist von (\d+) monaten/.exec(t))) {
        const n = Number(m[1]);
        return n <= 6 ? { ampel: 'gruen', reason: `Kündigungsfrist ${n} Monate.` } : n <= 12 ? { ampel: 'gelb', reason: `Kündigungsfrist ${n} Monate ist lang.` } : { ampel: 'rot', reason: `Kündigungsfrist ${n} Monate.` };
      }
      return null;
    case 'verguetung-und-preisanpassung':
      if ((m = /(\d+(?:[.,]\d+)?)\s*%/.exec(t))) {
        const n = Number(m[1].replace(',', '.'));
        if (n <= 3) return { ampel: 'gruen', reason: `Anpassung höchstens ${n} %.` };
        if (n <= 5) return { ampel: 'gelb', reason: `Anpassung bis ${n} % ist verhandelbar.` };
        return { ampel: 'rot', reason: `Preisanpassung bis ${n} % pro Jahr übersteigt die Obergrenze; Indexbindung fehlt.` };
      }
      return null;
    case 'haftung':
      if (/ausgeschlossen/.test(t) || /(drei|3) monaten/.test(t)) return { ampel: 'rot', reason: 'Haftung stark beschränkt oder für Datenverlust ausgeschlossen.' };
      if (/jahres|gesamthonorar/.test(t)) return { ampel: 'gruen', reason: 'Haftung in Höhe des Jahreswerts beziehungsweise Gesamthonorars.' };
      return null;
    case 'verfuegbarkeit':
      if ((m = /(\d{2}[.,]\d+)\s*%/.exec(t))) {
        const n = Number(m[1].replace(',', '.'));
        const monthly = /monat/.test(t);
        if (n >= 99.5 && monthly) return { ampel: 'gruen', reason: `${n} % pro Monat.` };
        if (n >= 99.0) return { ampel: 'gelb', reason: `${n} %${monthly ? ' pro Monat' : ' im Jahresmittel'}; Standard verlangt 99.5 % pro Monat.` };
        return { ampel: 'rot', reason: `Verfügbarkeit ${n} % liegt unter 99 %.` };
      }
      return null;
    case 'datenschutz-und-datenstandort':
      if (/usa|vereinigte staaten|drittstaat/.test(t)) return { ampel: /standardvertragsklauseln/.test(t) ? 'gelb' : 'rot', reason: 'Zugriff aus einem Drittstaat; nur mit Garantien und Zustimmung der LLV.' };
      if (/ewr|schweiz|liechtenstein|frankfurt|deutschland/.test(t)) return { ampel: 'gruen', reason: 'Datenhaltung in Liechtenstein, der Schweiz oder im EWR.' };
      return null;
    case 'geheimhaltung-und-amtsgeheimnis':
      if ((m = /(\d+) jahren?/.exec(t))) {
        const n = Number(m[1]);
        return n < 5 ? { ampel: 'rot', reason: `Vertraulichkeit nur ${n} Jahre; Mindestdauer 5 Jahre.` } : { ampel: 'gelb', reason: `Befristet auf ${n} Jahre.` };
      }
      if (/über das vertragsende|unbefristet/.test(t)) return { ampel: 'gruen', reason: 'Unbefristete Geheimhaltung.' };
      return null;
    case 'nutzungs-und-schutzrechte':
      if (/verbleiben beim (berater|lieferant|anbieter)/.test(t)) return { ampel: 'rot', reason: 'Rechte an eigens erstellten Ergebnissen verbleiben beim Lieferanten.' };
      if (/eigentum des kunden|gehen .* über|nutzungsrecht/.test(t)) return { ampel: 'gruen', reason: 'Nutzungsrecht und Dateneigentum entsprechen dem Standard.' };
      return null;
    case 'exit-und-datenrueckgabe':
      if (/30 tage/.test(t)) return { ampel: 'gruen', reason: 'Rückgabe innert 30 Tagen in Standardformat.' };
      if (/90 tage|nach aufwand/.test(t)) return { ampel: 'gelb', reason: 'Rückgabe später oder kostenpflichtig.' };
      return null;
    case 'abnahme-und-gewaehrleistung':
      if ((m = /(\d+) arbeitstagen/.exec(t)) && Number(m[1]) < 10) return { ampel: 'rot', reason: `Abnahmefiktion nach ${m[1]} Arbeitstagen; Minimum 10.` };
      return null;
    case 'schluesselpersonen':
      if (/zustimmung/.test(t)) return { ampel: 'gruen', reason: 'Wechsel nur mit Zustimmung.' };
      if (/information/.test(t)) return { ampel: 'gelb', reason: 'Wechsel nur mit Information statt Zustimmung.' };
      return null;
    case 'stundensaetze-und-spesen': {
      const rates = [...t.matchAll(/chf\s*(\d{3})/g)].map((x) => Number(x[1]));
      const max = Math.max(0, ...rates);
      if (max > 198 || /spesen pauschal|reisezeit wird/.test(t)) return { ampel: 'rot', reason: 'Ansätze mehr als 10 % über LLV-Ansätzen oder Reisezeit/Spesen verrechnet.' };
      if (max > 180) return { ampel: 'gelb', reason: 'Ansätze bis 10 % über LLV-Ansätzen.' };
      return max ? { ampel: 'gruen', reason: 'Ansätze gemäss LLV.' } : null;
    }
    case 'rangfolge-der-vertragsbestandteile':
      if (/geschäftsbedingungen.*(vor|gehen)/.test(t) && !/keine anwendung/.test(t)) return { ampel: 'rot', reason: 'AGB des Lieferanten gehen dem Vertrag vor.' };
      if (/keine anwendung/.test(t)) return { ampel: 'gruen', reason: 'AGB des Lieferanten ausgeschlossen.' };
      return null;
    default:
      return null;
  }
}

export class MockAiProvider implements AiProvider {
  readonly name = 'mock' as const;
  readonly model = 'Regelbasiert (Demo)';
  readonly promptVersion = 'regeln-1.0';

  async extract(input: ExtractInput, emit: Emit): Promise<ExtractOutput> {
    const lines = allLines(input.pages);
    const hits = findFields(lines);
    emit({ t: 'metric', pages: input.pages.length, lines: lines.length, model: this.model });
    const byPos = new Map<string, Hit[]>();
    hits.forEach((h) => byPos.set(`${h.page}:${h.line}`, [...(byPos.get(`${h.page}:${h.line}`) ?? []), h]));
    for (const l of lines) {
      emit({ t: 'scan', page: l.page, line: l.line });
      await sleep(70);
      for (const h of byPos.get(`${l.page}:${l.line}`) ?? []) {
        emit({ t: 'note', text: h.note });
        await sleep(260);
        emit({ t: 'field', key: h.key, label: LABELS[h.key] ?? h.key, value: h.value, quote: h.quote, page: h.page, line: h.line, confidence: h.confidence });
        await sleep(360);
      }
    }
    const fields: ExtractedField[] = hits.map((h) => ({ key: h.key, label: LABELS[h.key] ?? h.key, value: h.value, quote: h.quote, page: h.page, line: h.line, confidence: h.confidence }));
    const supName = fields.find((f) => f.key === 'lieferant')?.value ?? '';
    emit({ t: 'note', text: 'Gleiche den Lieferanten mit dem Lieferantenstamm ab' });
    await sleep(400);
    const supplier = matchSupplier(supName, input.suppliers);
    emit({ t: 'match', supplierId: supplier.id, supplierName: supplier.name, score: supplier.score });
    return { fields, supplier };
  }

  async review(input: ReviewInput, emit: Emit): Promise<{ findings: Finding[] }> {
    const { standard, clauses } = input;
    const assigned = new Map<number, typeof standard.criteria>();
    const missing: typeof standard.criteria = [];
    for (const c of standard.criteria) {
      const cl = findClause(c.key, c.title, clauses);
      if (cl) assigned.set(cl.index, [...(assigned.get(cl.index) ?? []), c]);
      else missing.push(c);
    }
    const findings: Finding[] = [];
    emit({ t: 'metric', model: this.model });
    for (const cl of clauses) {
      emit({ t: 'clause', index: cl.index, heading: cl.heading, page: cl.page, line: cl.line });
      emit({ t: 'scan', page: cl.page, line: cl.line });
      await sleep(420);
      for (const crit of assigned.get(cl.index) ?? []) {
        emit({ t: 'note', text: `Vergleiche «${cl.heading}» mit dem Kriterium «${crit.title}»` });
        await sleep(520);
        const fx = input.fixture?.find((f) => f.criterionKey === crit.key);
        let ampel: Ampel;
        let reason: string;
        if (fx) {
          ampel = fx.ampel;
          reason = fx.reason;
        } else {
          const r = rule(crit.key, cl.text);
          if (r) ({ ampel, reason } = r);
          else {
            const scores: [Ampel, number][] = [['gruen', similarity(cl.text, crit.gruen)], ['gelb', similarity(cl.text, crit.gelb)], ['rot', similarity(cl.text, crit.rot)]];
            scores.sort((a, b) => b[1] - a[1]);
            ampel = scores[0][1] > 0.08 ? scores[0][0] : 'gelb';
            reason = scores[0][1] > 0.08 ? `Am nächsten an der Stufe «${ampel === 'gruen' ? 'Grün' : ampel === 'gelb' ? 'Gelb' : 'Rot'}» des Prüfstandards; bitte bestätigen.` : 'Keine eindeutige Zuordnung zum Prüfstandard; bitte manuell beurteilen.';
          }
        }
        const proposal = ampel === 'gruen' ? '' : fx?.proposal || crit.muster;
        const f: Finding = { criterionKey: crit.key, criterionTitle: crit.title, location: cl.heading, quote: cl.text.slice(0, 280), ampel, reason, proposal, missing: false };
        findings.push(f);
        emit({ t: 'verdict', clauseIndex: cl.index, criterionKey: f.criterionKey, criterionTitle: f.criterionTitle, ampel, reason, proposal, quote: f.quote, missing: false });
        await sleep(380);
      }
    }
    if (missing.length) {
      emit({ t: 'note', text: `Suche nach Themen, die im Vertrag fehlen (${missing.length} Kriterien ohne Fundstelle)` });
      await sleep(600);
    }
    for (const crit of missing) {
      const f: Finding = { criterionKey: crit.key, criterionTitle: crit.title, location: null, quote: null, ampel: 'rot', reason: 'Im Vertrag nicht geregelt. Der Prüfstandard verlangt eine Regelung.', proposal: crit.muster, missing: true };
      findings.push(f);
      emit({ t: 'verdict', clauseIndex: null, criterionKey: f.criterionKey, criterionTitle: f.criterionTitle, ampel: 'rot', reason: f.reason, proposal: f.proposal, quote: null, missing: true });
      await sleep(320);
    }
    return { findings };
  }

  async formulateSubject(p: DraftParams, emit: Emit): Promise<string> {
    emit({ t: 'note', text: 'Formuliere den Vertragsgegenstand aus Ihrer Beschreibung' });
    await sleep(700);
    const desc = p.subject.trim().replace(/\.$/, '');
    return `Gegenstand dieses Vertrags ist ${desc ? desc.charAt(0).toLowerCase() + desc.slice(1) : p.title}. Der Lieferant erbringt die Leistungen für die Liechtensteinische Landesverwaltung fachgerecht und nach dem aktuellen Stand der Technik. Die Einzelheiten ergeben sich aus der Leistungsbeschreibung in Anhang 1.`;
  }
}

export { criterionKey };
