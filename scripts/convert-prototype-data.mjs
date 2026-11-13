// One-off: converts the prototype's demo data (prototype/src/data.js) into
// apps/api/seed-assets/seed-data.json in the API's schema.
// Usage: node scripts/convert-prototype-data.mjs
import fs from 'node:fs';
import vm from 'node:vm';

const src = fs.readFileSync('prototype/src/data.js', 'utf8');
const sandbox = { window: {} };
vm.runInNewContext(src, sandbox);
const D = sandbox.window.LLV_DATA;

const key = (title) => title.toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function history(l) {
  const total = l.vertraege.reduce((s, v) => s + (v.wert || 0), 0);
  if (!total) return [];
  const notes = ['Neuverhandlung Rahmenvertrag', 'Teuerungsausgleich begrenzt', 'Mengenrabatt vereinbart', 'Mehrjahresbindung gegen Rabatt', 'Lizenzmodell umgestellt', ''];
  const h = [...l.id].reduce((s, c) => s + c.charCodeAt(0), 0);
  const g = 0.02 + (h % 5) * 0.012;
  const rate = 140 + (h % 6) * 10;
  return [2021, 2022, 2023, 2024, 2025, 2026].map((y, i) => {
    const verh = Math.round(total / Math.pow(1 + g, 2026 - y) / 100) * 100;
    const rab = 0.02 + ((h + y) % 4) * 0.025;
    return { year: y, offered: Math.round((verh * (1 + rab)) / 100) * 100, negotiated: verh, hourlyRate: Math.round(rate * Math.pow(1.018, i)), note: (h + y) % 3 === 0 ? notes[(h + y) % notes.length] : '' };
  });
}

const folder = (name) => `Verträge/${name.replace(/[\\/:*?"<>|]/g, '-')}`;

const suppliers = D.LIEFERANTEN.map((l) => ({
  id: l.id,
  name: l.name,
  city: l.ort,
  country: l.land,
  legalForm: l.rechtsform,
  class: l.klasse,
  contact: { name: l.kontakt, email: l.mail, phones: l.telefone ?? [] },
  apps: l.apps.map((a) => ({ name: a.name, level: a.level, operationsOwner: a.betrieb || null, business: a.fach || null, contact: a.kontakt || null, note: a.anm || '' })),
  kpi: l.kpi,
  risk: l.risiko,
  measures: l.massnahmen || '',
  priceHistory: history(l),
  contracts: l.vertraege.map((v) => ({
    id: v.id,
    type: v.typ,
    title: v.titel,
    start: v.beginn || null,
    end: v.ende || null,
    noticeMonths: v.kuendigungsfrist || 0,
    noticeMode: 'laufzeitende',
    renewalMonths: v.autoVerl || 0,
    annualValue: v.wert || 0,
    reviewDate: v.review || null,
    law: v.recht || null,
    venue: v.gerichtsstand || null,
    status: 'aktiv',
    documentPath: v.ablage ? `${folder(l.name)}/${v.ablage.split('/').pop()}` : null,
    note: v.anmerkung || '',
  })),
}));

const criteria = Object.fromEntries(Object.entries(D.KLAUSELN).map(([k, c]) => [k, { key: key(c.titel), title: c.titel, gruen: c.ok, gelb: c.verh, rot: c.nicht, muster: c.muster }]));

const standards = Object.entries(D.STANDARD_KLAUSELN).map(([type, keys]) => ({
  contractType: type,
  version: D.STANDARD_META[type].version,
  date: D.STANDARD_META[type].geaendert.split('-').reverse().join('.'),
  criteria: keys.map((k) => ({ title: criteria[k].title, gruen: criteria[k].gruen, gelb: criteria[k].gelb, rot: criteria[k].rot, muster: criteria[k].muster })),
}));

const cases = D.PRUEFAUFTRAEGE.map((p) => ({
  id: p.id.replace('P-', 'C-'),
  title: p.titel,
  type: p.typ,
  supplierId: p.lieferantId,
  supplierName: p.lieferant,
  received: p.eingang,
  due: p.frist,
  clauses: p.klauseln,
  fixture: (D.FALLBACK_REVIEW[p.id] ?? []).map((f) => ({
    criterionKey: criteria[f.klausel].key,
    criterionTitle: criteria[f.klausel].title,
    location: f.fundstelle,
    quote: null,
    ampel: f.ampel,
    reason: f.begruendung,
    proposal: f.vorschlag,
    missing: false,
  })),
}));

const out = { generatedFrom: 'prototype/src/data.js', suppliers, standards, cases, sampleContract: D.BEISPIEL_PDF, persons: D.PERS };
fs.mkdirSync('apps/api/seed-assets', { recursive: true });
fs.writeFileSync('apps/api/seed-assets/seed-data.json', JSON.stringify(out, null, 2));
console.log(`suppliers ${suppliers.length}, contracts ${suppliers.reduce((n, s) => n + s.contracts.length, 0)}, standards ${standards.length}, cases ${cases.length}`);
