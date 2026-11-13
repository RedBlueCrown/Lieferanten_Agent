/**
 * The fixed process. A case (Vorgang) carries a contract from the first draft
 * or the supplier's paper to an active contract in the register. Every move is
 * a transition in this table; the API rejects anything else. Four of them are
 * hold points where the workflow waits for a person.
 */
import type { Role } from './roles';

export type HoldPoint = 'H1' | 'H2' | 'H3' | 'H4';

export const HOLD_POINTS: Record<HoldPoint, { label: string; role: Role; question: string }> = {
  H1: { label: 'Daten bestätigen', role: 'lieferantenmanagement', question: 'Stimmen die ausgelesenen Vertragsdaten?' },
  H2: { label: 'Entwurf einreichen', role: 'projektleitung', question: 'Ist der Entwurf vollständig und sind Abweichungen begründet?' },
  H3: { label: 'Rechtlich entscheiden', role: 'rechtsdienst', question: 'Freigeben oder nachverhandeln?' },
  H4: { label: 'Fristentscheid', role: 'lieferantenmanagement', question: 'Kündigen, verlängern, neu verhandeln oder auslaufen lassen?' },
};

export type CaseStatus = 'entwurf' | 'in_pruefung' | 'nachverhandlung' | 'freigegeben' | 'unterzeichnet' | 'aktiv' | 'verworfen';
export type CaseSource = 'llv_entwurf' | 'lieferantenpapier';

export const CASE_STATUS_LABEL: Record<CaseStatus, string> = {
  entwurf: 'Entwurf',
  in_pruefung: 'Beim Rechtsdienst',
  nachverhandlung: 'Nachverhandlung',
  freigegeben: 'Zur Unterzeichnung',
  unterzeichnet: 'Unterzeichnet, Daten prüfen',
  aktiv: 'Aktiv',
  verworfen: 'Verworfen',
};

/** The order shown in the progress tracker. */
export const CASE_TRACK: CaseStatus[] = ['entwurf', 'in_pruefung', 'freigegeben', 'unterzeichnet', 'aktiv'];

export type CaseAction = 'einreichen' | 'freigeben' | 'nachverhandeln' | 'neue_fassung' | 'unterzeichnet' | 'uebernehmen' | 'verwerfen';

export interface Transition {
  from: CaseStatus[];
  to: CaseStatus;
  role: Role;
  label: string;
  holdPoint?: HoldPoint;
}

export const CASE_TRANSITIONS: Record<CaseAction, Transition> = {
  einreichen: { from: ['entwurf'], to: 'in_pruefung', role: 'projektleitung', label: 'Zur rechtlichen Prüfung einreichen', holdPoint: 'H2' },
  freigeben: { from: ['in_pruefung'], to: 'freigegeben', role: 'rechtsdienst', label: 'Freigeben', holdPoint: 'H3' },
  nachverhandeln: { from: ['in_pruefung'], to: 'nachverhandlung', role: 'rechtsdienst', label: 'Zur Nachverhandlung zurückgeben', holdPoint: 'H3' },
  neue_fassung: { from: ['nachverhandlung'], to: 'in_pruefung', role: 'projektleitung', label: 'Neue Fassung einreichen' },
  unterzeichnet: { from: ['freigegeben'], to: 'unterzeichnet', role: 'projektleitung', label: 'Unterzeichnete Fassung hochladen' },
  uebernehmen: { from: ['unterzeichnet'], to: 'aktiv', role: 'lieferantenmanagement', label: 'Daten bestätigen und übernehmen', holdPoint: 'H1' },
  verwerfen: { from: ['entwurf', 'nachverhandlung'], to: 'verworfen', role: 'projektleitung', label: 'Verwerfen' },
};

export class TransitionError extends Error {
  constructor(message: string, public readonly status: 403 | 409) {
    super(message);
  }
}

export function assertTransition(current: CaseStatus, action: CaseAction, roles: readonly Role[]): Transition {
  const t = CASE_TRANSITIONS[action];
  if (!t) throw new TransitionError(`Unbekannte Aktion ${action}`, 409);
  if (!roles.includes(t.role)) throw new TransitionError(`Nur die Rolle ${t.role} darf «${t.label}» ausführen.`, 403);
  if (!t.from.includes(current)) throw new TransitionError(`«${t.label}» ist im Status «${CASE_STATUS_LABEL[current]}» nicht möglich.`, 409);
  return t;
}

export function availableActions(current: CaseStatus, roles: readonly Role[]): CaseAction[] {
  return (Object.keys(CASE_TRANSITIONS) as CaseAction[]).filter((a) => {
    const t = CASE_TRANSITIONS[a];
    return t.from.includes(current) && roles.includes(t.role);
  });
}

/** Decisions at a notice deadline (H4). */
export type DeadlineDecision = 'kuendigen' | 'verlaengern' | 'neu_verhandeln' | 'auslaufen' | 'sonderkuendigung_pruefen' | 'review_erledigt' | 'nicht_zutreffend';

export const DECISION_LABEL: Record<DeadlineDecision, string> = {
  kuendigen: 'Kündigen',
  verlaengern: 'Verlängern',
  neu_verhandeln: 'Neu verhandeln',
  auslaufen: 'Auslaufen lassen',
  sonderkuendigung_pruefen: 'Sonderkündigung prüfen',
  review_erledigt: 'Review erledigt',
  nicht_zutreffend: 'Nicht zutreffend',
};
