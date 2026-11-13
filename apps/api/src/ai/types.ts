import type { AgentEvent, ExtractedField, Finding, LayoutPage, ReviewStandard } from '@vm/domain';

export type Emit = (e: AgentEvent) => void;

export interface Clause {
  index: number;
  heading: string;
  text: string;
  page: number;
  line: number;
}

export interface ExtractInput {
  fileName: string;
  pages: LayoutPage[];
  suppliers: { id: string; name: string }[];
}

export interface ExtractOutput {
  fields: ExtractedField[];
  supplier: { id: string | null; name: string; score: number };
}

export interface ReviewInput {
  contractType: string;
  clauses: Clause[];
  standard: ReviewStandard;
  /** Curated result for the seeded demo cases (mock provider only). */
  fixture?: Finding[];
}

export interface DraftParams {
  contractType: string;
  supplierName: string;
  title: string;
  subject: string;
  start: string;
  termMonths: number;
  noticeMonths: number;
  amount: number;
  availability?: number;
}

export interface DraftBlock {
  key: string;
  title: string;
  text: string;
  origin: 'baustein' | 'ki' | 'angepasst';
  /** Model wording the block came from, to detect later edits. */
  template: string;
}

export interface AiProvider {
  readonly name: 'mock' | 'azure';
  readonly model: string;
  readonly promptVersion: string;
  extract(input: ExtractInput, emit: Emit): Promise<ExtractOutput>;
  review(input: ReviewInput, emit: Emit): Promise<{ findings: Finding[] }>;
  /** Writes the free-text parts of a draft (the subject clause). */
  formulateSubject(p: DraftParams, emit: Emit): Promise<string>;
}
