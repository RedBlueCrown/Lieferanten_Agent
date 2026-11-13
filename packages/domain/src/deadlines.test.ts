import { describe, expect, it } from 'vitest';
import { addMonths } from './dates';
import { holidaysOf, isWorkday, subtractWorkdays } from './holidays';
import { computeDeadlines, computeTerm, lockedValueTotal, reminderStep, type ContractTerms, type SupplierContext } from './deadlines';
import { assertTransition, availableActions, TransitionError } from './workflow';
import { can } from './roles';
import { chf } from './format';

const TODAY = '2026-11-12';

function contract(p: Partial<ContractTerms>): ContractTerms {
  return {
    id: 'V-1',
    type: 'SaaS-Vertrag',
    title: 'Test',
    start: '2024-01-01',
    end: '2026-12-31',
    noticeMonths: 3,
    noticeMode: 'laufzeitende',
    renewalMonths: 12,
    annualValue: 100_000,
    reviewDate: '2027-06-01',
    status: 'aktiv',
    hasDocument: true,
    ...p,
  };
}

describe('dates', () => {
  it('keeps month ends on month ends', () => {
    expect(addMonths('2026-12-31', -3)).toBe('2026-09-30');
    expect(addMonths('2027-02-28', -3)).toBe('2026-11-30');
    expect(addMonths('2027-02-28', 12)).toBe('2028-02-29');
    expect(addMonths('2026-01-15', 1)).toBe('2026-02-15');
  });
});

describe('Liechtenstein holidays', () => {
  it('computes movable feasts from Easter', () => {
    const h = holidaysOf(2027);
    expect(h.find((x) => x.name === 'Karfreitag')?.date).toBe('2027-03-26');
    expect(h.find((x) => x.name === 'Staatsfeiertag')?.date).toBe('2027-08-15');
  });
  it('skips weekends and holidays when counting back', () => {
    expect(isWorkday('2026-12-08')).toBe(false); // Mariä Empfängnis
    expect(subtractWorkdays('2026-11-30', 5)).toBe('2026-11-23');
  });
});

describe('computeTerm', () => {
  it('reports a missed notice with the new term and the bound value (Hosting Bürgerportal)', () => {
    const t = computeTerm(contract({ end: '2026-12-31', noticeMonths: 3, renewalMonths: 36, annualValue: 185_000 }), TODAY);
    expect(t.missed).not.toBeNull();
    expect(t.missed!.noticeBy).toBe('2026-09-30');
    expect(t.missed!.extendedTo).toBe('2029-12-31');
    expect(t.missed!.lockedValue).toBe(555_000);
    expect(t.missed!.nextNoticeBy).toBe('2029-09-28'); // 30.09.2029 is a Sunday
  });

  it('subtracts a delivery buffer of five workdays (Wartung Lohnsoftware)', () => {
    const t = computeTerm(contract({ end: '2027-02-28', noticeMonths: 3, renewalMonths: 12 }), TODAY);
    expect(t.missed).toBeNull();
    expect(t.noticeBy).toBe('2026-11-30');
    expect(t.actBy).toBe('2026-11-23');
  });

  it('moves a notice date off a public holiday', () => {
    const t = computeTerm(contract({ end: '2027-03-08', noticeMonths: 3 }), TODAY);
    expect(t.noticeBy).toBe('2026-12-07');
  });

  it('rolls the term over renewals that already happened', () => {
    const t = computeTerm(contract({ end: '2025-06-30', noticeMonths: 3, renewalMonths: 12 }), TODAY);
    expect(t.renewalsSoFar).toBe(2);
    expect(t.termEnd).toBe('2027-06-30');
    expect(t.noticeBy).toBe('2027-03-31');
    expect(t.missed).toBeNull();
  });

  it('does not ask for a notice when a fixed-term contract ends by itself (Erneuerung WLAN)', () => {
    const t = computeTerm(contract({ end: '2026-12-15', noticeMonths: 1, renewalMonths: 0 }), TODAY);
    expect(t.endsByItself).toBe(true);
    expect(t.actBy).toBeNull();
  });

  it('finds the next possible month end for an open-ended contract', () => {
    const t = computeTerm(contract({ end: null, noticeMonths: 3, noticeMode: 'monatsende', renewalMonths: 0 }), TODAY);
    expect(t.terminationDate).toBe('2027-02-28');
    expect(t.noticeBy).toBe('2026-11-30');
  });

  it('ignores contracts that are no longer active', () => {
    const t = computeTerm(contract({ status: 'gekuendigt' }), TODAY);
    expect(t.noticeBy).toBeNull();
  });
});

describe('computeDeadlines', () => {
  const suppliers: SupplierContext[] = [
    {
      id: 'L-1',
      name: 'Alpina Cloud Services GmbH',
      class: 'A',
      hasAssessment: true,
      apps: [{ name: 'Bürgerportal', level: 'L3', operationsOwner: 'S. Hasler' }],
      contracts: [contract({ id: 'V-2210', end: '2026-12-31', noticeMonths: 3, renewalMonths: 36, annualValue: 185_000, reviewDate: '2026-10-15' })],
    },
    {
      id: 'L-2',
      name: 'Gamprin Netzwerk AG',
      class: 'A',
      hasAssessment: true,
      apps: [],
      contracts: [contract({ id: 'V-2231', type: 'Einzelvertrag', end: '2026-12-15', noticeMonths: 1, renewalMonths: 0, reviewDate: null, hasDocument: false })],
    },
  ];
  const all = computeDeadlines(suppliers, TODAY);

  it('groups a missed notice as overdue and sums the bound value', () => {
    const missed = all.find((d) => d.kind === 'verpasst');
    expect(missed?.group).toBe('ueberfaellig');
    expect(lockedValueTotal(all)).toBe(555_000);
  });

  it('flags a missing AVV for an L3 application', () => {
    expect(all.some((d) => d.kind === 'luecke' && d.title.includes('AVV fehlt'))).toBe(true);
  });

  it('raises a single end-of-contract item and no notice item for a non-renewing contract', () => {
    const wlan = all.filter((d) => d.contractId === 'V-2231' && d.kind !== 'luecke');
    expect(wlan.map((d) => d.kind)).toEqual(['ende']);
  });

  it('reports data gaps last', () => {
    expect(all[all.length - 1].group).toBe('luecken');
  });

  it('picks the reminder step of the ladder', () => {
    expect(reminderStep(11, [90, 30, 7])).toBe(30);
    expect(reminderStep(5, [90, 30, 7])).toBe(7);
    expect(reminderStep(120, [90, 30, 7])).toBeNull();
  });
});

describe('workflow', () => {
  it('lets only the project lead submit a draft (H2)', () => {
    expect(assertTransition('entwurf', 'einreichen', ['projektleitung']).to).toBe('in_pruefung');
    expect(() => assertTransition('entwurf', 'einreichen', ['rechtsdienst'])).toThrow(TransitionError);
  });
  it('rejects a transition from the wrong status', () => {
    expect(() => assertTransition('entwurf', 'freigeben', ['rechtsdienst'])).toThrow(/nicht möglich/);
  });
  it('lists the actions available to a role', () => {
    expect(availableActions('in_pruefung', ['rechtsdienst']).sort()).toEqual(['freigeben', 'nachverhandeln']);
  });
  it('maps permissions to roles', () => {
    expect(can(['projektleitung'], 'contracts:write')).toBe(false);
    expect(can(['lieferantenmanagement'], 'contracts:decide')).toBe(true);
  });
});

describe('format', () => {
  it('formats Swiss francs', () => {
    expect(chf(1_166_000)).toBe('CHF 1’166’000');
  });
});
