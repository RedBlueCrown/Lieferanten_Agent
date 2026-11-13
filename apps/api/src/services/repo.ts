/**
 * Suppliers and contracts: rows ↔ API objects, plus the contexts the deadline
 * engine needs.
 */
import { computeTerm, type ContractTerms, type DeadlineSettings, type SupplierContext, DEFAULT_SETTINGS } from '@vm/domain';
import type { Db } from '../db';

export interface SupplierApp {
  name: string;
  level: string;
  operationsOwner: string | null;
  business: string | null;
  contact: string | null;
  note: string;
}

export interface Supplier {
  id: string;
  name: string;
  city: string | null;
  country: string | null;
  legalForm: string | null;
  class: 'A' | 'B' | 'C';
  contact: { name?: string; email?: string; phones?: { art: string; nr: string }[] };
  externalRefs: { system: string; id: string }[];
  apps: SupplierApp[];
  kpi: Record<string, { wert: string; begr: string }>;
  risk: Record<string, { wert: string; begr: string }>;
  measures: string;
  priceHistory: unknown;
  version: number;
  updatedAt: string;
}

export interface Contract {
  id: string;
  supplierId: string;
  supplierName?: string;
  supplierClass?: 'A' | 'B' | 'C';
  parentId: string | null;
  type: string;
  title: string;
  start: string | null;
  end: string | null;
  noticeMonths: number;
  noticeMode: ContractTerms['noticeMode'];
  renewalMonths: number;
  annualValue: number;
  currency: string;
  reviewDate: string | null;
  law: string | null;
  venue: string | null;
  status: ContractTerms['status'];
  terminatedPer: string | null;
  documentPath: string | null;
  note: string;
  owner: string | null;
  externalRefs: { system: string; id: string }[];
  source: unknown;
  version: number;
  updatedAt: string;
}

const iso = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : v ? String(v).slice(0, 10) : null);
const ts = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v ?? ''));

export function toSupplier(r: Record<string, unknown>): Supplier {
  return {
    id: String(r.id),
    name: String(r.name),
    city: (r.city as string) ?? null,
    country: (r.country as string) ?? null,
    legalForm: (r.legal_form as string) ?? null,
    class: r.class as Supplier['class'],
    contact: (r.contact as Supplier['contact']) ?? {},
    externalRefs: (r.external_refs as Supplier['externalRefs']) ?? [],
    apps: (r.apps as SupplierApp[]) ?? [],
    kpi: (r.kpi as Supplier['kpi']) ?? {},
    risk: (r.risk as Supplier['risk']) ?? {},
    measures: String(r.measures ?? ''),
    priceHistory: r.price_history ?? null,
    version: Number(r.version),
    updatedAt: ts(r.updated_at),
  };
}

export function toContract(r: Record<string, unknown>): Contract {
  return {
    id: String(r.id),
    supplierId: String(r.supplier_id),
    supplierName: r.supplier_name as string | undefined,
    supplierClass: r.supplier_class as Contract['supplierClass'],
    parentId: (r.parent_id as string) ?? null,
    type: String(r.type),
    title: String(r.title),
    start: iso(r.start_date),
    end: iso(r.end_date),
    noticeMonths: Number(r.notice_months ?? 0),
    noticeMode: (r.notice_mode as Contract['noticeMode']) ?? 'laufzeitende',
    renewalMonths: Number(r.renewal_months ?? 0),
    annualValue: Number(r.annual_value ?? 0),
    currency: String(r.currency ?? 'CHF'),
    reviewDate: iso(r.review_date),
    law: (r.law as string) ?? null,
    venue: (r.venue as string) ?? null,
    status: (r.status as Contract['status']) ?? 'aktiv',
    terminatedPer: iso(r.terminated_per),
    documentPath: (r.document_path as string) ?? null,
    note: String(r.note ?? ''),
    owner: (r.owner as string) ?? null,
    externalRefs: (r.external_refs as Contract['externalRefs']) ?? [],
    source: r.source ?? null,
    version: Number(r.version ?? 1),
    updatedAt: ts(r.updated_at),
  };
}

export function terms(c: Contract): ContractTerms {
  return {
    id: c.id,
    type: c.type,
    title: c.title,
    start: c.start ?? '1970-01-01',
    end: c.end,
    noticeMonths: c.noticeMonths,
    noticeMode: c.noticeMode,
    renewalMonths: c.renewalMonths,
    annualValue: c.annualValue,
    reviewDate: c.reviewDate,
    status: c.status,
    hasDocument: !!c.documentPath,
  };
}

export const CONTRACT_SELECT = `select c.*, s.name as supplier_name, s.class as supplier_class from contracts c join suppliers s on s.id = c.supplier_id`;

export class Repo {
  constructor(private readonly db: Db) {}

  async suppliers(): Promise<Supplier[]> {
    return (await this.db.query('select * from suppliers order by name')).map(toSupplier);
  }

  async supplier(id: string): Promise<Supplier | undefined> {
    const r = await this.db.one('select * from suppliers where id=$1', [id]);
    return r ? toSupplier(r) : undefined;
  }

  async contracts(where = '', params: unknown[] = []): Promise<Contract[]> {
    return (await this.db.query(`${CONTRACT_SELECT} ${where} order by s.name, c.title`, params)).map(toContract);
  }

  async contract(id: string): Promise<Contract | undefined> {
    const r = await this.db.one(`${CONTRACT_SELECT} where c.id=$1`, [id]);
    return r ? toContract(r) : undefined;
  }

  async settings(): Promise<DeadlineSettings> {
    const r = await this.db.one<{ value: DeadlineSettings }>("select value from settings where key='deadlines'");
    return { ...DEFAULT_SETTINGS, ...(r?.value ?? {}) };
  }

  async contexts(): Promise<SupplierContext[]> {
    const [sups, cons] = await Promise.all([this.suppliers(), this.contracts()]);
    return sups.map((s) => ({
      id: s.id,
      name: s.name,
      class: s.class,
      apps: s.apps.map((a) => ({ name: a.name, level: a.level, operationsOwner: a.operationsOwner })),
      hasAssessment: Object.keys(s.kpi).length > 0,
      contracts: cons.filter((c) => c.supplierId === s.id).map(terms),
    }));
  }

  withTerm(c: Contract, today: string, s: DeadlineSettings) {
    return { ...c, term: computeTerm(terms(c), today, s) };
  }
}
