/**
 * Deadline engine. Pure functions, no I/O and no AI: this is the part that
 * must keep working when everything else is down.
 *
 * Terms used:
 *   termEnd      end of the contract term that is currently running
 *   noticeBy     the notice must have reached the supplier by this day
 *   actBy        the LLV has to send it by this day (noticeBy minus a delivery
 *                buffer in workdays, skipping weekends and Liechtenstein holidays)
 *   missed       noticeBy has passed for the running term: the contract renews
 */
import { addMonths, diffDays, endOfMonth, endOfQuarter, endOfYear, type IsoDate, addDays } from './dates';
import { subtractWorkdays, workdayOnOrBefore } from './holidays';

export type NoticeMode = 'laufzeitende' | 'monatsende' | 'quartalsende' | 'jahresende';
export type SupplierClass = 'A' | 'B' | 'C';
export type ContractStatus = 'aktiv' | 'gekuendigt' | 'auslaufend' | 'beendet';

export const NOTICE_MODE_LABEL: Record<NoticeMode, string> = {
  laufzeitende: 'auf Ende der Laufzeit',
  monatsende: 'auf Monatsende',
  quartalsende: 'auf Quartalsende',
  jahresende: 'auf Jahresende',
};

export interface ContractTerms {
  id: string;
  type: string;
  title: string;
  start: IsoDate;
  /** null = unbefristet */
  end: IsoDate | null;
  noticeMonths: number;
  noticeMode: NoticeMode;
  /** 0 = no automatic renewal */
  renewalMonths: number;
  annualValue: number;
  reviewDate: IsoDate | null;
  status: ContractStatus;
  hasDocument: boolean;
}

export interface SupplierContext {
  id: string;
  name: string;
  class: SupplierClass;
  apps: { name: string; level: string; operationsOwner?: string | null }[];
  hasAssessment: boolean;
  contracts: ContractTerms[];
}

export interface DeadlineSettings {
  /** Workdays between sending a notice and its arrival. */
  bufferWorkdays: number;
  /** Reminder ladder in days before actBy, per supplier class. */
  noticeLadder: Record<SupplierClass, number[]>;
  reviewLeadDays: number;
  endLeadDays: number;
}

export const DEFAULT_SETTINGS: DeadlineSettings = {
  bufferWorkdays: 5,
  noticeLadder: { A: [180, 90, 30, 7], B: [90, 30, 7], C: [60, 14] },
  reviewLeadDays: 30,
  endLeadDays: 60,
};

export interface TermState {
  termEnd: IsoDate | null;
  renewalsSoFar: number;
  /** Date on which a notice sent now would take effect. */
  terminationDate: IsoDate | null;
  noticeBy: IsoDate | null;
  actBy: IsoDate | null;
  /** Fixed term without renewal: ends without any action. */
  endsByItself: boolean;
  missed: null | {
    noticeBy: IsoDate;
    renewsOn: IsoDate;
    extendedTo: IsoDate;
    lockedValue: number;
    nextNoticeBy: IsoDate;
    nextActBy: IsoDate;
  };
}

function noticeDates(terminationDate: IsoDate, months: number, buffer: number) {
  const noticeBy = workdayOnOrBefore(addMonths(terminationDate, -months));
  const actBy = subtractWorkdays(noticeBy, buffer);
  return { noticeBy, actBy };
}

function periodEnd(mode: NoticeMode, d: IsoDate): IsoDate {
  if (mode === 'quartalsende') return endOfQuarter(d);
  if (mode === 'jahresende') return endOfYear(d);
  return endOfMonth(d);
}

/** Where a contract stands on `today`. */
export function computeTerm(c: ContractTerms, today: IsoDate, s: DeadlineSettings = DEFAULT_SETTINGS): TermState {
  const empty: TermState = { termEnd: c.end, renewalsSoFar: 0, terminationDate: null, noticeBy: null, actBy: null, endsByItself: false, missed: null };
  if (c.status !== 'aktiv') return empty;

  // Roll the term forward over renewals that already happened.
  let termEnd = c.end;
  let renewalsSoFar = 0;
  if (termEnd && c.renewalMonths > 0) {
    while (termEnd < today) {
      termEnd = addMonths(termEnd, c.renewalMonths);
      renewalsSoFar++;
    }
  }

  if (termEnd && c.renewalMonths === 0) {
    return { ...empty, termEnd, endsByItself: true };
  }
  if (c.noticeMonths <= 0 && termEnd === null) return { ...empty, termEnd };

  const mode: NoticeMode = c.end === null && c.noticeMode === 'laufzeitende' ? 'monatsende' : c.noticeMode;

  if (mode === 'laufzeitende' && termEnd) {
    const { noticeBy, actBy } = noticeDates(termEnd, c.noticeMonths, s.bufferWorkdays);
    if (noticeBy >= today) {
      return { termEnd, renewalsSoFar, terminationDate: termEnd, noticeBy, actBy, endsByItself: false, missed: null };
    }
    const extendedTo = addMonths(termEnd, c.renewalMonths);
    const next = noticeDates(extendedTo, c.noticeMonths, s.bufferWorkdays);
    return {
      termEnd,
      renewalsSoFar,
      terminationDate: extendedTo,
      noticeBy: next.noticeBy,
      actBy: next.actBy,
      endsByItself: false,
      missed: {
        noticeBy,
        renewsOn: addDays(termEnd, 1),
        extendedTo,
        lockedValue: Math.round((c.annualValue * c.renewalMonths) / 12),
        nextNoticeBy: next.noticeBy,
        nextActBy: next.actBy,
      },
    };
  }

  // Periodic termination (month, quarter or year end): earliest period end
  // whose notice date has not passed yet.
  let p = periodEnd(mode, today);
  let guard = 0;
  while (workdayOnOrBefore(addMonths(p, -c.noticeMonths)) < today && guard++ < 200) {
    p = periodEnd(mode, addDays(p, 1));
  }
  const { noticeBy, actBy } = noticeDates(p, c.noticeMonths, s.bufferWorkdays);
  return { termEnd, renewalsSoFar, terminationDate: p, noticeBy, actBy, endsByItself: false, missed: null };
}

export type DeadlineKind = 'verpasst' | 'kuendigung' | 'ende' | 'review' | 'luecke';
export type DeadlineGroup = 'ueberfaellig' | 'diese_woche' | 'naechste_30' | 'spaeter' | 'luecken';
export type Severity = 'kritisch' | 'hoch' | 'mittel' | 'info';

export const GROUP_LABEL: Record<DeadlineGroup, string> = {
  ueberfaellig: 'Verpasst oder überfällig',
  diese_woche: 'Diese Woche',
  naechste_30: 'Nächste 30 Tage',
  spaeter: 'Später',
  luecken: 'Datenlücken',
};

export const KIND_LABEL: Record<DeadlineKind, string> = {
  verpasst: 'Kündigung verpasst',
  kuendigung: 'Kündigungstermin',
  ende: 'Vertragsende',
  review: 'Review',
  luecke: 'Datenlücke',
};

export interface Deadline {
  /** Stable identity, used to acknowledge a deadline. */
  key: string;
  kind: DeadlineKind;
  group: DeadlineGroup;
  severity: Severity;
  supplierId: string;
  supplierName: string;
  supplierClass: SupplierClass;
  contractId: string | null;
  contractTitle: string | null;
  contractType: string | null;
  /** The day the LLV has to act by (null for data gaps). */
  date: IsoDate | null;
  daysLeft: number | null;
  title: string;
  detail: string;
  term?: TermState;
  /** Reminder step reached today (days before actBy), for notifications. */
  reminderStep?: number | null;
}

function groupFor(daysLeft: number): DeadlineGroup {
  if (daysLeft < 0) return 'ueberfaellig';
  if (daysLeft <= 7) return 'diese_woche';
  if (daysLeft <= 30) return 'naechste_30';
  return 'spaeter';
}

function severityFor(daysLeft: number): Severity {
  if (daysLeft < 0) return 'kritisch';
  if (daysLeft <= 7) return 'kritisch';
  if (daysLeft <= 30) return 'hoch';
  return 'mittel';
}

/** The ladder step that is due today, if any (largest step ≥ daysLeft). */
export function reminderStep(daysLeft: number, ladder: number[]): number | null {
  const steps = [...ladder].sort((a, b) => a - b);
  const step = steps.find((x) => daysLeft <= x);
  return step ?? null;
}

const fmt = (d: IsoDate) => `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}`;

export function computeDeadlines(
  suppliers: SupplierContext[],
  today: IsoDate,
  s: DeadlineSettings = DEFAULT_SETTINGS,
): Deadline[] {
  const out: Deadline[] = [];
  for (const sup of suppliers) {
    const base = { supplierId: sup.id, supplierName: sup.name, supplierClass: sup.class };
    const ladder = s.noticeLadder[sup.class];
    const horizon = Math.max(...ladder);

    for (const c of sup.contracts) {
      if (c.status === 'beendet') continue;
      const cb = { ...base, contractId: c.id, contractTitle: c.title, contractType: c.type };
      const term = computeTerm(c, today, s);

      if (term.missed && term.termEnd && term.termEnd >= today) {
        const m = term.missed;
        out.push({
          ...cb,
          key: `verpasst|${c.id}|${m.noticeBy}`,
          kind: 'verpasst',
          group: 'ueberfaellig',
          severity: 'kritisch',
          date: m.noticeBy,
          daysLeft: diffDays(m.noticeBy, today),
          title: 'Kündigungstermin verpasst',
          detail: `Verlängert sich am ${fmt(m.renewsOn)} bis ${fmt(m.extendedTo)}. Nächster Kündigungstermin ${fmt(m.nextNoticeBy)}.`,
          term,
          reminderStep: null,
        });
      } else if (term.actBy && !term.endsByItself && c.status === 'aktiv') {
        const daysLeft = diffDays(term.actBy, today);
        if (daysLeft <= horizon) {
          out.push({
            ...cb,
            key: `kuendigung|${c.id}|${term.noticeBy}`,
            kind: 'kuendigung',
            group: groupFor(daysLeft),
            severity: severityFor(daysLeft),
            date: term.actBy,
            daysLeft,
            title: 'Kündigung oder Verlängerung entscheiden',
            detail: `Kündigung absenden bis ${fmt(term.actBy)}, eintreffen bis ${fmt(term.noticeBy!)}, wirksam per ${fmt(term.terminationDate!)}.${c.renewalMonths ? ` Sonst Verlängerung um ${c.renewalMonths} Monate.` : ''}`,
            term,
            reminderStep: reminderStep(daysLeft, ladder),
          });
        }
      }

      if (term.endsByItself && term.termEnd && term.termEnd >= today) {
        const daysLeft = diffDays(term.termEnd, today);
        if (daysLeft <= s.endLeadDays) {
          out.push({
            ...cb,
            key: `ende|${c.id}|${term.termEnd}`,
            kind: 'ende',
            group: groupFor(daysLeft),
            severity: daysLeft <= 14 ? 'hoch' : 'mittel',
            date: term.termEnd,
            daysLeft,
            title: 'Vertrag läuft aus',
            detail: `Endet am ${fmt(term.termEnd)} ohne Kündigung. Nachfolge oder Abschluss regeln.`,
            term,
            reminderStep: null,
          });
        }
      }

      if (c.reviewDate && c.status === 'aktiv') {
        const daysLeft = diffDays(c.reviewDate, today);
        if (daysLeft <= s.reviewLeadDays) {
          out.push({
            ...cb,
            key: `review|${c.id}|${c.reviewDate}`,
            kind: 'review',
            group: groupFor(daysLeft),
            severity: daysLeft < 0 ? 'hoch' : 'mittel',
            date: c.reviewDate,
            daysLeft,
            title: daysLeft < 0 ? 'Review überfällig' : 'Review fällig',
            detail: `Vertrag und Leistung des Lieferanten überprüfen, Review-Datum ${fmt(c.reviewDate)}.`,
            term,
            reminderStep: null,
          });
        }
      }

      if (c.status === 'aktiv') {
        if (!c.hasDocument) {
          out.push(gap(cb, `dokument|${c.id}`, 'Kein Vertragsdokument abgelegt', 'Unterzeichnete Fassung im Ordner ablegen oder hochladen.', 'mittel'));
        }
        if (!c.reviewDate && c.type !== 'NDA') {
          out.push(gap(cb, `reviewdatum|${c.id}`, 'Review-Datum fehlt', 'Ein Datum für die nächste Überprüfung festlegen.', 'info'));
        }
      }
    }

    const nc = { ...base, contractId: null, contractTitle: null, contractType: null };
    const hasAvv = sup.contracts.some((c) => c.type === 'AVV' && c.status !== 'beendet');
    for (const app of sup.apps) {
      if ((app.level === 'L3' || app.level === 'L4') && !hasAvv) {
        out.push(gap(nc, `avv|${sup.id}|${app.name}`, `AVV fehlt für ${app.level}-Anwendung «${app.name}»`, 'Ab Level L3 ist eine Auftragsverarbeitungsvereinbarung Pflicht.', 'kritisch'));
      }
      if (!app.operationsOwner) {
        out.push(gap(nc, `betrieb|${sup.id}|${app.name}`, `Betriebsverantwortung fehlt für «${app.name}»`, 'Verantwortliche Person für den Betrieb hinterlegen.', 'info'));
      }
    }
    if (!sup.hasAssessment) {
      out.push(gap(nc, `kpi|${sup.id}`, 'Leistungsbeurteilung nicht erfasst', 'KPI- und Risikobeurteilung des Lieferanten erfassen.', 'info'));
    }
  }

  const sevRank: Record<Severity, number> = { kritisch: 0, hoch: 1, mittel: 2, info: 3 };
  return out.sort((a, b) => {
    if (a.group === 'luecken' || b.group === 'luecken') {
      if (a.group !== b.group) return a.group === 'luecken' ? 1 : -1;
      return sevRank[a.severity] - sevRank[b.severity];
    }
    return (a.daysLeft ?? 0) - (b.daysLeft ?? 0);
  });
}

function gap(
  base: Omit<Deadline, 'key' | 'kind' | 'group' | 'severity' | 'date' | 'daysLeft' | 'title' | 'detail'>,
  key: string,
  title: string,
  detail: string,
  severity: Severity,
): Deadline {
  return { ...base, key: `luecke|${key}`, kind: 'luecke', group: 'luecken', severity, date: null, daysLeft: null, title, detail };
}

/** Sum of the value bound by missed notices. */
export function lockedValueTotal(deadlines: Deadline[]): number {
  return deadlines.reduce((s, d) => s + (d.kind === 'verpasst' && d.term?.missed ? d.term.missed.lockedValue : 0), 0);
}
