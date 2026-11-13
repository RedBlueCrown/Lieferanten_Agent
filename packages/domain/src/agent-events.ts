/**
 * What an AI agent reports while it works. The API streams these events to
 * the browser (server-sent events) and the "agent stage" animates them, so
 * the animation always shows real steps: the page being read, the line a
 * value came from, the clause being checked against which criterion.
 */
import type { Ampel } from './standards';

export type AgentKind = 'erfassung' | 'pruefung' | 'entwurf' | 'abgleich';

export const AGENT_LABEL: Record<AgentKind, string> = {
  erfassung: 'Erfassungs-Agent',
  pruefung: 'Prüf-Agent',
  entwurf: 'Entwurfs-Agent',
  abgleich: 'Abgleichs-Agent',
};

/** One line of text with its box on the page, in PDF points (origin top-left). */
export interface LayoutLine {
  text: string;
  box: [x: number, y: number, w: number, h: number];
}

export interface LayoutPage {
  width: number;
  height: number;
  lines: LayoutLine[];
}

export type AgentEvent =
  | { t: 'stage'; stage: string; label: string; service: string; status: 'run' | 'done' | 'skip'; detail?: string }
  | { t: 'doc'; name: string; pages: LayoutPage[] }
  | { t: 'scan'; page: number; line: number }
  | { t: 'note'; text: string }
  | { t: 'field'; key: string; label: string; value: string; quote: string; page: number; line: number; confidence: number }
  | { t: 'match'; supplierId: string | null; supplierName: string; score: number }
  | { t: 'clause'; index: number; heading: string; page: number; line: number }
  | {
      t: 'verdict';
      clauseIndex: number | null;
      criterionKey: string;
      criterionTitle: string;
      ampel: Ampel;
      reason: string;
      proposal: string;
      quote: string | null;
      missing: boolean;
    }
  | { t: 'block'; index: number; title: string; text: string; origin: 'baustein' | 'ki' }
  | { t: 'metric'; tokensIn?: number; tokensOut?: number; pages?: number; lines?: number; model?: string }
  | { t: 'done'; result: unknown }
  | { t: 'error'; message: string };

/** Event as stored and streamed: with sequence number and ms since start. */
export type StampedEvent = AgentEvent & { seq: number; ms: number };

export interface ExtractedField {
  key: string;
  label: string;
  value: string;
  quote: string;
  page: number;
  line: number;
  confidence: number;
}

/** The fields the extraction agent looks for, in display order. */
export const EXTRACT_FIELDS: { key: string; label: string; kind: 'text' | 'date' | 'number' | 'select' }[] = [
  { key: 'lieferant', label: 'Lieferant', kind: 'text' },
  { key: 'typ', label: 'Vertragsart', kind: 'select' },
  { key: 'titel', label: 'Bezeichnung', kind: 'text' },
  { key: 'beginn', label: 'Beginn', kind: 'date' },
  { key: 'ende', label: 'Ende', kind: 'date' },
  { key: 'kuendigungsfrist', label: 'Kündigungsfrist (Monate)', kind: 'number' },
  { key: 'kuendigungsmodus', label: 'Kündigung auf', kind: 'select' },
  { key: 'verlaengerung', label: 'Automatische Verlängerung (Monate)', kind: 'number' },
  { key: 'wert', label: 'Wert pro Jahr (CHF)', kind: 'number' },
  { key: 'recht', label: 'Anwendbares Recht', kind: 'text' },
  { key: 'gerichtsstand', label: 'Gerichtsstand', kind: 'text' },
  { key: 'kontakt', label: 'Ansprechperson Lieferant', kind: 'text' },
  { key: 'anwendung', label: 'Anwendung', kind: 'text' },
  { key: 'sla', label: 'Service Level', kind: 'text' },
];
