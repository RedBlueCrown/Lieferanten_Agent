/**
 * Splits a contract into clauses by its headings ("§ 3 Laufzeit", "3. Laufzeit",
 * "Art. 3", short all-caps lines). Deterministic: no AI involved.
 */
import type { LayoutPage } from '@vm/domain';
import type { Clause } from './types';

const HEADING = /^(§\s*\d+[a-z]?|Art\.?\s*\d+|\d{1,2}\.(\d{1,2}\.?)?)\s+\S/;

export function segmentClauses(pages: LayoutPage[]): Clause[] {
  const clauses: Clause[] = [];
  let cur: Clause | null = null;
  pages.forEach((p, pi) =>
    p.lines.forEach((l, li) => {
      const text = l.text.trim();
      const m = HEADING.exec(text);
      if (m) {
        if (cur) clauses.push(cur);
        // "1. Gegenstand: Wartung …" → heading "1. Gegenstand", text from the rest
        const colon = text.indexOf(':');
        const heading = colon > 0 && colon < 48 ? text.slice(0, colon) : text.split(/\s+/).slice(0, 4).join(' ');
        const rest = colon > 0 && colon < 48 ? text.slice(colon + 1).trim() : text;
        cur = { index: clauses.length, heading, text: rest, page: pi, line: li };
      } else if (cur) {
        cur.text += (cur.text ? ' ' : '') + text;
      }
    }),
  );
  if (cur) clauses.push(cur);
  return clauses.map((c, i) => ({ ...c, index: i }));
}
