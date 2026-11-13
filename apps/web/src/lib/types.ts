import type { Ampel, CaseAction, CaseSource, CaseStatus, Finding, ReviewSummary } from '@vm/domain';

export interface Actor {
  kind: string;
  oid: string;
  name: string;
}

export interface CaseListItem {
  id: string;
  title: string;
  type: string;
  supplierId: string | null;
  supplierName: string;
  source: CaseSource;
  status: CaseStatus;
  createdBy: Actor;
  fields: Record<string, unknown>;
  dueDate: string | null;
  updatedAt: string;
  createdAt: string;
  clauseCount: number;
  deviations: number;
  review: { summary: ReviewSummary; at: string; standardVersion: string; decision?: { action: string; comment: string; by: Actor; at: string } } | null;
}

export interface DraftClause {
  key: string;
  title: string;
  text: string;
  origin: 'baustein' | 'ki' | 'angepasst';
  template: string;
  justification?: string;
}

export interface CaseReview {
  jobId: string;
  at: string;
  standardVersion: string;
  standardPath: string;
  findings: Finding[];
  summary: ReviewSummary;
  decisions: Record<string, { ampel?: Ampel; comment?: string; exception?: string; by: string; at: string }>;
  decision?: { action: 'freigeben' | 'nachverhandeln'; comment: string; by: Actor; at: string };
}

export interface AuditRecord {
  seq: number;
  id: string;
  at: string;
  actor: { kind: string; oid: string; name: string; roles?: string[] };
  action: string;
  targetType: string | null;
  targetId: string | null;
  summary: string;
  details: Record<string, unknown>;
  hash: string;
  prevHash: string;
}

export interface CaseDetail extends Omit<CaseListItem, 'review' | 'clauseCount' | 'deviations'> {
  clauses: DraftClause[];
  documentId: string | null;
  signedDocumentId: string | null;
  contractId: string | null;
  review: CaseReview | null;
  actions: CaseAction[];
  documents: { id: string; name: string; path: string; kind: string; size: number; created_at: string }[];
  jobs: { id: string; kind: string; status: string; title: string; created_at: string }[];
  audit: AuditRecord[];
}
