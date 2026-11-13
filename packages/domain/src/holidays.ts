/**
 * Public holidays in Liechtenstein, used to move deadlines off days on which
 * nobody can send or receive a notice. The list follows the statutory and
 * customary holidays of the Landesverwaltung; check it against the official
 * LLV calendar before production use and extend EXTRA_CLOSED_DAYS if needed.
 */
import { addDays, type IsoDate, toIso, weekday } from './dates';

function easterSunday(year: number): Date {
  // Anonymous Gregorian algorithm (Meeus/Jones/Butcher).
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

export interface Holiday {
  date: IsoDate;
  name: string;
}

/** Additional closed days of the administration, as YYYY-MM-DD. */
export const EXTRA_CLOSED_DAYS: Holiday[] = [];

const cache = new Map<number, Holiday[]>();

export function holidaysOf(year: number): Holiday[] {
  const hit = cache.get(year);
  if (hit) return hit;
  const easter = toIso(easterSunday(year));
  const fixed: [string, string][] = [
    ['01-01', 'Neujahr'],
    ['01-02', 'Berchtoldstag'],
    ['01-06', 'Heilige Drei Könige'],
    ['02-02', 'Mariä Lichtmess'],
    ['03-19', 'Josefstag'],
    ['05-01', 'Tag der Arbeit'],
    ['08-15', 'Staatsfeiertag'],
    ['09-08', 'Mariä Geburt'],
    ['11-01', 'Allerheiligen'],
    ['12-08', 'Mariä Empfängnis'],
    ['12-24', 'Heiligabend'],
    ['12-25', 'Weihnachten'],
    ['12-26', 'Stephanstag'],
    ['12-31', 'Silvester'],
  ];
  const movable: [number, string][] = [
    [-2, 'Karfreitag'],
    [1, 'Ostermontag'],
    [39, 'Auffahrt'],
    [50, 'Pfingstmontag'],
    [60, 'Fronleichnam'],
  ];
  const list: Holiday[] = [
    ...fixed.map(([md, name]) => ({ date: `${year}-${md}`, name })),
    ...movable.map(([offset, name]) => ({ date: addDays(easter, offset), name })),
    ...EXTRA_CLOSED_DAYS.filter((h) => h.date.startsWith(String(year))),
  ].sort((a, b) => a.date.localeCompare(b.date));
  cache.set(year, list);
  return list;
}

export function isHoliday(d: IsoDate): boolean {
  return holidaysOf(Number(d.slice(0, 4))).some((h) => h.date === d);
}

export function isWorkday(d: IsoDate): boolean {
  const wd = weekday(d);
  return wd !== 0 && wd !== 6 && !isHoliday(d);
}

/** The latest workday on or before d. */
export function workdayOnOrBefore(d: IsoDate): IsoDate {
  let x = d;
  while (!isWorkday(x)) x = addDays(x, -1);
  return x;
}

/** Goes back n workdays from d (d itself does not count). */
export function subtractWorkdays(d: IsoDate, n: number): IsoDate {
  let x = d;
  let left = n;
  while (left > 0) {
    x = addDays(x, -1);
    if (isWorkday(x)) left--;
  }
  return x;
}
