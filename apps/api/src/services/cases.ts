import type { CaseSource, CaseStatus, Finding, ReviewSummary } from '@vm/domain';
import type { Actor } from '../audit';
import type { DraftBlock } from '../ai/types';

export interface CaseReview {
  jobId: string;
  at: string;
  standardVersion: string;
  standardPath: string;
  findings: Finding[];
  summary: ReviewSummary;
  /** Marco's per-criterion overrides and comments. */
  decisions: Record<string, { ampel?: Finding['ampel']; comment?: string; exception?: string; by: string; at: string }>;
  decision?: { action: 'freigeben' | 'nachverhandeln'; comment: string; by: Actor; at: string };
  history?: Omit<CaseReview, 'history'>[];
}

export interface CaseFields {
  subject?: string;
  start?: string;
  termMonths?: number;
  noticeMonths?: number;
  amount?: number;
  availability?: number;
  [k: string]: unknown;
}

export interface Case {
  id: string;
  title: string;
  type: string;
  supplierId: string | null;
  supplierName: string;
  source: CaseSource;
  status: CaseStatus;
  createdBy: Actor;
  fields: CaseFields;
  clauses: (DraftBlock & { justification?: string })[];
  documentId: string | null;
  signedDocumentId: string | null;
  review: CaseReview | null;
  dueDate: string | null;
  contractId: string | null;
  fixture: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

const iso = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : v ? String(v).slice(0, 10) : null);

export function toCase(r: Record<string, unknown>): Case {
  return {
    id: String(r.id),
    title: String(r.title),
    type: String(r.type),
    supplierId: (r.supplier_id as string) ?? null,
    supplierName: String(r.supplier_name),
    source: r.source as CaseSource,
    status: r.status as CaseStatus,
    createdBy: r.created_by as Actor,
    fields: (r.fields as CaseFields) ?? {},
    clauses: (r.clauses as Case['clauses']) ?? [],
    documentId: (r.document_id as string) ?? null,
    signedDocumentId: (r.signed_document_id as string) ?? null,
    review: (r.review as CaseReview) ?? null,
    dueDate: iso(r.due_date),
    contractId: (r.contract_id as string) ?? null,
    fixture: (r.fixture as string) ?? null,
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
    updatedAt: r.updated_at instanceof Date ? r.updated_at.toISOString() : String(r.updated_at),
    version: Number(r.version ?? 1),
  };
}
