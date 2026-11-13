import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { MockAiProvider } from './mock';
import { layoutPlainText } from './reader';
import { segmentClauses } from './segment';

const seed = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../seed-assets/seed-data.json'), 'utf8'));

describe('rule-based extraction on the sample contract', () => {
  it('reads every term, including phrases that wrap onto the next line', async () => {
    const pages = layoutPlainText(seed.sampleContract.text);
    const ai = new MockAiProvider();
    // No pacing in tests.
    const out = await ai.extract({ fileName: 'x.pdf', pages, suppliers: [{ id: 'L-1005', name: 'Medicus Soft AG' }] }, () => {});
    const v = Object.fromEntries(out.fields.map((f) => [f.key, f.value]));
    expect(v.lieferant).toBe('Medicus Soft AG');
    expect(v.typ).toBe('Wartung/Support (SLA)');
    expect(v.beginn).toBe('2027-01-01');
    expect(v.ende).toBe('2028-12-31');
    expect(v.verlaengerung).toBe('12');
    expect(v.kuendigungsfrist).toBe('6');
    expect(v.wert).toBe('28800');
    expect(v.recht).toBe('FL');
    expect(v.gerichtsstand).toBe('Vaduz');
    expect(out.supplier.id).toBe('L-1005');
    // Every value carries a quote from its own line.
    for (const f of out.fields) expect(pages[f.page].lines[f.line].text.length).toBeGreaterThan(0);
  }, 30_000);

  it('splits a supplier paper into its clauses', () => {
    const c = seed.cases[0];
    const pages = layoutPlainText(c.clauses.map((k: { titel: string; text: string }) => `${k.titel}: ${k.text}`).join('\n'));
    expect(segmentClauses(pages).map((x) => x.heading)).toEqual(c.clauses.map((k: { titel: string }) => k.titel));
  });
});
