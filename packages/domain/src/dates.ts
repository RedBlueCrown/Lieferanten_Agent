/**
 * Calendar dates as ISO strings (YYYY-MM-DD), computed in UTC so that time
 * zones and daylight saving never shift a deadline by a day.
 */
export type IsoDate = string;

export function parseIso(d: IsoDate): Date {
  const [y, m, day] = d.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, day));
}

export function toIso(d: Date): IsoDate {
  return d.toISOString().slice(0, 10);
}

export function todayIso(override?: string): IsoDate {
  if (override) return override;
  const now = new Date();
  // Liechtenstein local date (Europe/Vaduz) regardless of server time zone.
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Vaduz', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  return parts;
}

export function addDays(d: IsoDate, n: number): IsoDate {
  const x = parseIso(d);
  x.setUTCDate(x.getUTCDate() + n);
  return toIso(x);
}

function daysInMonth(y: number, m0: number): number {
  return new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();
}

function isLastDayOfMonth(d: Date): boolean {
  return d.getUTCDate() === daysInMonth(d.getUTCFullYear(), d.getUTCMonth());
}

/**
 * Adds months. A date on the last day of its month stays on the last day
 * (31.12. − 3 Monate = 30.09.; 28.02.2027 + 12 Monate = 29.02.2028 would be
 * wrong for a term ending "Ende Februar", so month ends map to month ends).
 */
export function addMonths(d: IsoDate, n: number): IsoDate {
  const x = parseIso(d);
  const y = x.getUTCFullYear();
  const m0 = x.getUTCMonth() + n;
  const ty = y + Math.floor(m0 / 12);
  const tm = ((m0 % 12) + 12) % 12;
  const dim = daysInMonth(ty, tm);
  const day = isLastDayOfMonth(x) ? dim : Math.min(x.getUTCDate(), dim);
  return toIso(new Date(Date.UTC(ty, tm, day)));
}

export function diffDays(a: IsoDate, b: IsoDate): number {
  return Math.round((parseIso(a).getTime() - parseIso(b).getTime()) / 86_400_000);
}

export function maxDate(a: IsoDate, b: IsoDate): IsoDate {
  return a > b ? a : b;
}

export function endOfMonth(d: IsoDate): IsoDate {
  const x = parseIso(d);
  return toIso(new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + 1, 0)));
}

export function endOfQuarter(d: IsoDate): IsoDate {
  const x = parseIso(d);
  const qEndMonth = Math.floor(x.getUTCMonth() / 3) * 3 + 2;
  return toIso(new Date(Date.UTC(x.getUTCFullYear(), qEndMonth + 1, 0)));
}

export function endOfYear(d: IsoDate): IsoDate {
  return `${d.slice(0, 4)}-12-31`;
}

export function weekday(d: IsoDate): number {
  return parseIso(d).getUTCDay(); // 0 = Sunday
}
