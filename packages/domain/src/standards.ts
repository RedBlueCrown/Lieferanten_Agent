/**
 * Review standards (Prüfstandards). The legal check maintains one Word
 * document per contract type in the shared folder; the API parses it into
 * this structure. Each criterion says what is acceptable (grün), negotiable
 * (gelb) and not acceptable (rot), plus the LLV's model wording.
 */
export type Ampel = 'gruen' | 'gelb' | 'rot';

export const AMPEL_LABEL: Record<Ampel, string> = {
  gruen: 'Akzeptabel',
  gelb: 'Verhandeln',
  rot: 'Nicht akzeptabel',
};

export const CONTRACT_TYPES = [
  'Rahmenvertrag',
  'Einzelvertrag',
  'AVV',
  'SaaS-Vertrag',
  'Wartung/Support (SLA)',
  'Beratung/Dienstleistung',
  'NDA',
] as const;
export type ContractType = (typeof CONTRACT_TYPES)[number];

export interface Criterion {
  key: string;
  title: string;
  gruen: string;
  gelb: string;
  rot: string;
  muster: string;
}

export interface ReviewStandard {
  contractType: string;
  version: string;
  updatedAt: string;
  author: string;
  source: { path: string; webUrl?: string; eTag?: string; lastModified?: string };
  criteria: Criterion[];
  /** Problems found while reading the Word document (missing column, empty text …). */
  warnings: string[];
}

export interface Finding {
  criterionKey: string;
  criterionTitle: string;
  /** Heading of the clause in the contract, null if the topic is missing. */
  location: string | null;
  quote: string | null;
  ampel: Ampel;
  reason: string;
  /** Counter-proposal (usually the model wording), empty if acceptable. */
  proposal: string;
  missing: boolean;
}

export interface ReviewSummary {
  gruen: number;
  gelb: number;
  rot: number;
  missing: number;
}

export function summarize(findings: Finding[]): ReviewSummary {
  return findings.reduce(
    (s, f) => ({ ...s, [f.ampel]: s[f.ampel] + 1, missing: s.missing + (f.missing ? 1 : 0) }),
    { gruen: 0, gelb: 0, rot: 0, missing: 0 } as ReviewSummary,
  );
}

/** Stable key from a criterion title ("Haftung" → "haftung"). */
export function criterionKey(title: string): string {
  return title
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
